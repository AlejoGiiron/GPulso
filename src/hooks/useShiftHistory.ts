import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { bogotaDayStartToUtc, bogotaDayEndToUtc } from '@/lib/dates'
import { reconcileCash, shiftDifference } from '@/lib/shiftCalc'
import { fetchShiftCashCommissions } from '@/lib/shiftCommissions'
import type { CashShift, Profile } from '@/types/database.types'

export const SHIFT_HISTORY_PAGE_SIZE = 50

export interface ShiftHistoryFilters {
  cashierId: string | 'all'
  dateFrom: string
  dateTo: string
  page: number
}

export interface ShiftHistoryRow {
  shift: CashShift
  cashierName: string
  cashSales: number
  totalExpenses: number
  expectedCash: number
  overdraft: number
  countedCash: number
  difference: number
}

export interface ShiftHistoryResult {
  rows: ShiftHistoryRow[]
  totalCount: number
  page: number
  pageSize: number
}

type RawShift = CashShift & {
  profiles: { full_name: string } | null
}

// ── Lista paginada de turnos cerrados ─────────────────────────────────────────

export function useShiftHistory(filters: ShiftHistoryFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<ShiftHistoryResult>({
    queryKey: ['shift-history', storeId, filters],
    queryFn: async () => {
      const from = filters.page * SHIFT_HISTORY_PAGE_SIZE
      const to = from + SHIFT_HISTORY_PAGE_SIZE - 1

      let q = supabase
        .from('cash_shifts')
        .select(
          `id, store_id, opened_by, closed_by, opening_amount,
           closing_amount, opened_at, closed_at, updated_at,
           profiles:opened_by(full_name)`,
          { count: 'exact' },
        )
        .eq('store_id' as never, storeId)
        .not('closed_at' as never, 'is', null)
        .order('closed_at' as never, { ascending: false })
        .range(from, to)

      if (filters.cashierId !== 'all') {
        q = q.eq('opened_by' as never, filters.cashierId)
      }
      // closed_at se guarda en UTC; convertimos los límites de la fecha civil
      // de Bogotá a UTC para no excluir turnos cerrados de noche.
      if (filters.dateFrom) {
        q = q.gte('closed_at' as never, bogotaDayStartToUtc(filters.dateFrom))
      }
      if (filters.dateTo) {
        q = q.lte('closed_at' as never, bogotaDayEndToUtc(filters.dateTo))
      }

      const { data, error, count } = await q
      if (error) throw error

      const shiftsRaw = (data ?? []) as unknown as RawShift[]
      if (shiftsRaw.length === 0) {
        return {
          rows: [],
          totalCount: count ?? 0,
          page: filters.page,
          pageSize: SHIFT_HISTORY_PAGE_SIZE,
        }
      }

      // Aggregamos ventas en efectivo y egresos por turno con 2 consultas.
      const shiftIds = shiftsRaw.map((s) => s.id)
      const ownerByShift = new Map<string, { opened_by: string; opened_at: string; closed_at: string | null }>()
      for (const s of shiftsRaw) {
        ownerByShift.set(s.id, {
          opened_by: s.opened_by,
          opened_at: s.opened_at,
          closed_at: s.closed_at,
        })
      }

      const { data: expensesRaw, error: expErr } = await supabase
        .from('cash_expenses')
        .select('shift_id, amount')
        .in('shift_id' as never, shiftIds)
        .eq('store_id' as never, storeId)
      if (expErr) throw expErr

      const expByShift = new Map<string, number>()
      for (const e of (expensesRaw ?? []) as unknown as {
        shift_id: string
        amount: number | string
      }[]) {
        expByShift.set(
          e.shift_id,
          (expByShift.get(e.shift_id) ?? 0) + Number(e.amount),
        )
      }

      // Imputación híbrida (026): las ventas/abonos NUEVOS se agrupan por
      // shift_id (exacto); los PRE-026 (shift_id NULL) caen al método legacy
      // por opened_by + ventana de tiempo. userIds/earliest/latest alimentan
      // solo el camino legacy; el filtro shift_id IS NULL evita doble conteo.
      const userIds = Array.from(new Set(shiftsRaw.map((s) => s.opened_by)))
      const earliest = shiftsRaw.reduce(
        (min, s) => (s.opened_at < min ? s.opened_at : min),
        shiftsRaw[0].opened_at,
      )
      const latest = shiftsRaw.reduce(
        (max, s) =>
          (s.closed_at ?? s.opened_at) > max
            ? (s.closed_at ?? s.opened_at)
            : max,
        shiftsRaw[0].closed_at ?? shiftsRaw[0].opened_at,
      )

      // Excluir órdenes generadas al completar separados: cada abono ya
      // contó como ingreso del turno donde se cobró.
      const { data: convRaw, error: convErr } = await supabase
        .from('layaways')
        .select('converted_order_id')
        .eq('store_id' as never, storeId)
        .not('converted_order_id' as never, 'is', null)
        .gte('completed_at' as never, earliest)
        .lte('completed_at' as never, latest)
      if (convErr) throw convErr
      const excludedOrderIds = new Set(
        ((convRaw ?? []) as unknown as { converted_order_id: string | null }[])
          .map((r) => r.converted_order_id)
          .filter((id): id is string => !!id),
      )

      const cashByShift = new Map<string, number>()

      // Helper: imputa una fila legacy (sin shift_id) a su turno por opened_by
      // + ventana de tiempo (mismo criterio que el cuadre).
      const addLegacyByWindow = (
        createdBy: string,
        createdAt: string,
        amount: number,
      ) => {
        for (const s of shiftsRaw) {
          if (s.opened_by !== createdBy) continue
          if (createdAt < s.opened_at) continue
          if (s.closed_at && createdAt > s.closed_at) continue
          cashByShift.set(s.id, (cashByShift.get(s.id) ?? 0) + amount)
          break
        }
      }

      // ── Ventas en efectivo ────────────────────────────────────────────────
      // La PORCIÓN en efectivo de cada venta vive en order_payments (032). Antes
      // se sumaba orders.total de las órdenes con payment_method='cash'; ahora se
      // suman las filas method='cash' de order_payments (una venta mixta aporta
      // solo su parte efectivo). JOIN orders!inner para heredar shift_id/ventana,
      // estado y is_credit. Los fiados no tienen filas en order_payments (032) y
      // además se filtran con is_credit=false.
      // NUEVO (026): filas cash imputadas por orders.shift_id.
      const { data: newOrders, error: newOrdersErr } = await supabase
        .from('order_payments')
        .select('amount, orders!inner(id, shift_id, is_credit, status)')
        .eq('store_id' as never, storeId)
        .eq('method' as never, 'cash')
        .eq('orders.status' as never, 'completed')
        .eq('orders.is_credit' as never, false)
        .in('orders.shift_id' as never, shiftIds)
      if (newOrdersErr) throw newOrdersErr
      for (const row of (newOrders ?? []) as unknown as {
        amount: number | string
        orders: { id: string; shift_id: string | null } | null
      }[]) {
        const o = row.orders
        if (!o || !o.shift_id) continue
        if (excludedOrderIds.has(o.id)) continue
        cashByShift.set(
          o.shift_id,
          (cashByShift.get(o.shift_id) ?? 0) + Number(row.amount),
        )
      }

      // PRE-026: filas cash de órdenes con shift_id NULL, por opened_by + ventana.
      const { data: legacyOrders, error: legacyOrdersErr } = await supabase
        .from('order_payments')
        .select(
          'amount, orders!inner(id, created_at, created_by, shift_id, is_credit, status)',
        )
        .eq('store_id' as never, storeId)
        .eq('method' as never, 'cash')
        .eq('orders.status' as never, 'completed')
        // También aquí se excluyen las fiadas del efectivo (ruta legacy).
        .eq('orders.is_credit' as never, false)
        .is('orders.shift_id' as never, null)
        .in('orders.created_by' as never, userIds)
        .gte('orders.created_at' as never, earliest)
        .lte('orders.created_at' as never, latest)
      if (legacyOrdersErr) throw legacyOrdersErr
      for (const row of (legacyOrders ?? []) as unknown as {
        amount: number | string
        orders: {
          id: string
          created_at: string
          created_by: string
        } | null
      }[]) {
        const o = row.orders
        if (!o) continue
        if (excludedOrderIds.has(o.id)) continue
        addLegacyByWindow(o.created_by, o.created_at, Number(row.amount))
      }

      // ── Abonos de separados en efectivo ────────────────────────────────────
      // NUEVO (026): abonos imputados por shift_id.
      const { data: newPays, error: newPaysErr } = await supabase
        .from('layaway_payments')
        .select('amount, shift_id')
        .eq('store_id' as never, storeId)
        .eq('payment_method' as never, 'cash')
        .in('shift_id' as never, shiftIds)
        // Excluir abonos históricos (028): no son ingreso del turno.
        .eq('is_historical' as never, false)
      if (newPaysErr) throw newPaysErr
      for (const p of (newPays ?? []) as unknown as {
        amount: number | string
        shift_id: string
      }[]) {
        cashByShift.set(
          p.shift_id,
          (cashByShift.get(p.shift_id) ?? 0) + Number(p.amount),
        )
      }

      // PRE-026: abonos con shift_id NULL, por opened_by + ventana.
      const { data: legacyPays, error: legacyPaysErr } = await supabase
        .from('layaway_payments')
        .select('amount, created_at, created_by')
        .eq('store_id' as never, storeId)
        .eq('payment_method' as never, 'cash')
        .is('shift_id' as never, null)
        // Ruta CRÍTICA: sin este filtro, un abono histórico (shift_id NULL)
        // sería absorbido por ventana de tiempo + cajero (028).
        .eq('is_historical' as never, false)
        .in('created_by' as never, userIds)
        .gte('created_at' as never, earliest)
        .lte('created_at' as never, latest)
      if (legacyPaysErr) throw legacyPaysErr
      for (const p of (legacyPays ?? []) as unknown as {
        amount: number | string
        created_at: string
        created_by: string
      }[]) {
        addLegacyByWindow(p.created_by, p.created_at, Number(p.amount))
      }

      // ── Abonos de FIADO en efectivo (029) ──────────────────────────────────
      // NUEVO (026): abonos imputados por shift_id. Excluye históricos.
      const { data: newCredit, error: newCreditErr } = await supabase
        .from('credit_payments')
        .select('amount, shift_id')
        .eq('store_id' as never, storeId)
        .eq('payment_method' as never, 'cash')
        .eq('is_historical' as never, false)
        .in('shift_id' as never, shiftIds)
      if (newCreditErr) throw newCreditErr
      for (const p of (newCredit ?? []) as unknown as {
        amount: number | string
        shift_id: string
      }[]) {
        cashByShift.set(
          p.shift_id,
          (cashByShift.get(p.shift_id) ?? 0) + Number(p.amount),
        )
      }

      // PRE-026: abonos de fiado con shift_id NULL, por opened_by + ventana.
      // Ruta CRÍTICA: el filtro is_historical evita que un abono histórico
      // (shift_id NULL) sea absorbido por la ventana de tiempo + cajero.
      const { data: legacyCredit, error: legacyCreditErr } = await supabase
        .from('credit_payments')
        .select('amount, created_at, created_by')
        .eq('store_id' as never, storeId)
        .eq('payment_method' as never, 'cash')
        .is('shift_id' as never, null)
        .eq('is_historical' as never, false)
        .in('created_by' as never, userIds)
        .gte('created_at' as never, earliest)
        .lte('created_at' as never, latest)
      if (legacyCreditErr) throw legacyCreditErr
      for (const p of (legacyCredit ?? []) as unknown as {
        amount: number | string
        created_at: string
        created_by: string
      }[]) {
        addLegacyByWindow(p.created_by, p.created_at, Number(p.amount))
      }

      // ── Comisiones por crédito en efectivo (Fase 4) ────────────────────────
      // Imputación DIRECTA por shift_id (la tabla es nueva, sin ruta legacy).
      // Vía compartida con useShiftClosing → misma fuente para el cuadre, así la
      // columna "Esperado" del historial coincide con el recibo impreso.
      const commissionByShift = await fetchShiftCashCommissions(storeId, shiftIds)
      for (const [sid, total] of commissionByShift) {
        cashByShift.set(sid, (cashByShift.get(sid) ?? 0) + total)
      }

      const rows: ShiftHistoryRow[] = shiftsRaw.map((s) => {
        const openingAmount = Number(s.opening_amount)
        const cashSales = cashByShift.get(s.id) ?? 0
        const totalExpenses = expByShift.get(s.id) ?? 0
        const rec = reconcileCash(openingAmount + cashSales, totalExpenses)
        const countedCash =
          s.closing_amount != null ? Number(s.closing_amount) : 0
        return {
          shift: {
            id: s.id,
            store_id: s.store_id,
            opened_by: s.opened_by,
            closed_by: s.closed_by,
            opening_amount: openingAmount,
            closing_amount: countedCash,
            opened_at: s.opened_at,
            closed_at: s.closed_at,
            updated_at: s.updated_at,
          },
          cashierName: s.profiles?.full_name ?? 'Cajero',
          cashSales,
          totalExpenses,
          expectedCash: rec.expectedCash,
          overdraft: rec.overdraft,
          countedCash,
          difference: shiftDifference(countedCash, rec),
        }
      })

      return {
        rows,
        totalCount: count ?? rows.length,
        page: filters.page,
        pageSize: SHIFT_HISTORY_PAGE_SIZE,
      }
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}

// ── Lista de cajeros de la tienda para el filtro ──────────────────────────────

export function useStoreCashiers() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<Profile[]>({
    queryKey: ['store-cashiers', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('store_id' as never, storeId)
        .order('full_name' as never)
      if (error) throw error
      return (data ?? []) as unknown as Profile[]
    },
    enabled: !!storeId,
    staleTime: 5 * 60 * 1_000,
  })
}
