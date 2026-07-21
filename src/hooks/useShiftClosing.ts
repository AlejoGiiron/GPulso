import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import {
  calculateShiftSummary,
  type SalesByMethod,
  type OrderPaymentInput,
} from '@/lib/shiftCalc'
import { fetchShiftCashCommissions } from '@/lib/shiftCommissions'
import type {
  CashShift,
  CashExpense,
  PaymentMethod,
} from '@/types/database.types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type { SalesByMethod }

export interface LayawayPaymentRow {
  id: string
  layaway_number: number
  amount: number
  payment_method: PaymentMethod
  created_at: string
}

export interface CreditPaymentRow {
  id: string
  order_number: number
  amount: number
  payment_method: PaymentMethod
  created_at: string
}

export interface ShiftClosingData {
  shift: CashShift
  expenses: CashExpense[]
  salesByMethod: SalesByMethod[]
  totalSales: number
  cashSales: number
  totalExpenses: number
  expectedCash: number
  overdraft: number
  orderCount: number
  layawayPayments: LayawayPaymentRow[]
  layawayPaymentsTotal: number
  creditPayments: CreditPaymentRow[]
  creditPaymentsTotal: number
  commissionsIncome: number
  regularSalesTotal: number
  returnsIncome: number
  returnsExpense: number
  returnsNet: number
  regularExpensesTotal: number
  storeName: string
  userName: string
}

type RawOrder = {
  id: string
  total: number | string
  return_id: string | null
}

type RawOrderPayment = {
  order_id: string
  method: PaymentMethod
  amount: number | string
}

type RawLayawayPayment = {
  id: string
  amount: number | string
  payment_method: PaymentMethod
  created_at: string
  layaways: { layaway_number: number } | null
}

type RawCreditPayment = {
  id: string
  amount: number | string
  payment_method: PaymentMethod
  created_at: string
  orders: { order_number: number } | null
}

type RawConvertedOrder = {
  converted_order_id: string | null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useShiftClosing(shiftId: string | null) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<ShiftClosingData | null>({
    queryKey: ['shift-closing', shiftId, storeId],
    queryFn: async () => {
      if (!shiftId) return null

      const { data: shiftRaw, error: shiftErr } = await supabase
        .from('cash_shifts')
        .select(
          `id, store_id, opened_by, closed_by, opening_amount,
           closing_amount, opened_at, closed_at, updated_at,
           profiles:opened_by(full_name),
           stores:store_id(name)`,
        )
        .eq('id' as never, shiftId)
        .eq('store_id' as never, storeId)
        .single()

      if (shiftErr || !shiftRaw) {
        throw new Error(shiftErr?.message ?? 'No se pudo cargar el turno')
      }

      type RawShift = CashShift & {
        profiles: { full_name: string } | null
        stores: { name: string } | null
      }
      const shiftJoin = shiftRaw as unknown as RawShift
      const userName = shiftJoin.profiles?.full_name ?? 'Cajero'
      const storeName = shiftJoin.stores?.name ?? 'G-Pulso'

      const shift: CashShift = {
        id: shiftJoin.id,
        store_id: shiftJoin.store_id,
        opened_by: shiftJoin.opened_by,
        closed_by: shiftJoin.closed_by,
        opening_amount: Number(shiftJoin.opening_amount),
        closing_amount:
          shiftJoin.closing_amount != null
            ? Number(shiftJoin.closing_amount)
            : null,
        opened_at: shiftJoin.opened_at,
        closed_at: shiftJoin.closed_at,
        updated_at: shiftJoin.updated_at,
      }

      // 1. IDs de órdenes generadas al completar separados dentro de la ventana
      //    del turno. Estas órdenes se EXCLUYEN del cuadre porque cada abono
      //    individual del separado ya cuenta como ingreso del día que se cobró.
      let cQuery = supabase
        .from('layaways')
        .select('converted_order_id')
        .eq('store_id' as never, storeId)
        .not('converted_order_id' as never, 'is', null)
        .gte('completed_at' as never, shift.opened_at)
      if (shift.closed_at) {
        cQuery = cQuery.lte('completed_at' as never, shift.closed_at)
      }
      const { data: convRaw, error: convErr } = await cQuery
      if (convErr) throw convErr

      const excludedOrderIds = new Set(
        ((convRaw ?? []) as unknown as RawConvertedOrder[])
          .map((r) => r.converted_order_id)
          .filter((id): id is string => !!id),
      )

      // 2+3. Órdenes y abonos del turno. Modelo NUEVO (026): imputación DIRECTA
      //   por shift_id. Compat PRE-026: los turnos anteriores al deploy tienen
      //   sus ventas/abonos con shift_id NULL; para ellos caemos al método legacy
      //   (ventana de tiempo + opened_by). La decisión es por turno: un turno es
      //   enteramente "nuevo" (todo con shift_id) o "viejo" (todo NULL), nunca
      //   mezclado, así que basta ver si el filtro por shift_id devuelve algo.
      const { data: ordersByShift, error: ordersErr } = await supabase
        .from('orders')
        .select('id, total, return_id')
        .eq('store_id' as never, storeId)
        .eq('shift_id' as never, shiftId)
        .eq('status' as never, 'completed')
        // Las órdenes FIADAS (029) NO son efectivo del turno: su total no entró,
        // solo entran los abonos (credit_payments, abajo). Se excluyen del cuadre.
        .eq('is_credit' as never, false)
      if (ordersErr) throw ordersErr

      const { data: paysByShift, error: paymentsErr } = await supabase
        .from('layaway_payments')
        .select(
          `id, amount, payment_method, created_at,
           layaways:layaway_id(layaway_number)`,
        )
        .eq('store_id' as never, storeId)
        .eq('shift_id' as never, shiftId)
        // Los abonos históricos (028) NO son ingreso de este turno: el dinero
        // entró antes de cargar el separado. Se excluyen del cuadre.
        .eq('is_historical' as never, false)
        .order('created_at' as never, { ascending: true })
      if (paymentsErr) throw paymentsErr

      const { data: creditByShift, error: creditErr } = await supabase
        .from('credit_payments')
        .select(
          `id, amount, payment_method, created_at,
           orders:order_id(order_number)`,
        )
        .eq('store_id' as never, storeId)
        .eq('shift_id' as never, shiftId)
        // Excluir abonos históricos: dinero recibido antes de cargar el fiado
        // viejo, no entró a esta caja (mismo criterio que #3C en separados).
        .eq('is_historical' as never, false)
        .order('created_at' as never, { ascending: true })
      if (creditErr) throw creditErr

      let orders = (ordersByShift ?? []) as unknown as RawOrder[]
      let paymentsRaw = (paysByShift ?? []) as unknown as RawLayawayPayment[]
      let creditRaw = (creditByShift ?? []) as unknown as RawCreditPayment[]

      // Fallback legacy (pre-026): ninguna fila imputada por shift_id → este
      // turno es anterior al deploy; reconstruir por ventana de tiempo + opened_by.
      // Para un turno NUEVO sin actividad este camino también da 0 (resultado
      // idéntico), así que no introduce imprecisión.
      if (
        orders.length === 0 &&
        paymentsRaw.length === 0 &&
        creditRaw.length === 0
      ) {
        let oQuery = supabase
          .from('orders')
          .select('id, total, return_id')
          .eq('store_id' as never, storeId)
          .eq('created_by' as never, shift.opened_by)
          .eq('status' as never, 'completed')
          // También aquí se excluyen las fiadas del efectivo (ruta legacy).
          .eq('is_credit' as never, false)
          .gte('created_at' as never, shift.opened_at)
        if (shift.closed_at) {
          oQuery = oQuery.lte('created_at' as never, shift.closed_at)
        }
        const { data: legacyOrders, error: loErr } = await oQuery
        if (loErr) throw loErr

        let pQuery = supabase
          .from('layaway_payments')
          .select(
            `id, amount, payment_method, created_at,
             layaways:layaway_id(layaway_number)`,
          )
          .eq('store_id' as never, storeId)
          .eq('created_by' as never, shift.opened_by)
          // Ruta CRÍTICA: sin este filtro, un abono histórico (shift_id NULL)
          // sería absorbido por ventana de tiempo + cajero (028).
          .eq('is_historical' as never, false)
          .gte('created_at' as never, shift.opened_at)
        if (shift.closed_at) {
          pQuery = pQuery.lte('created_at' as never, shift.closed_at)
        }
        const { data: legacyPays, error: lpErr } = await pQuery
          .order('created_at' as never, { ascending: true })
        if (lpErr) throw lpErr

        // Ruta CRÍTICA (como en #3C): un abono histórico de fiado (shift_id NULL)
        // sería absorbido por ventana + cajero sin el filtro is_historical.
        let cQuery2 = supabase
          .from('credit_payments')
          .select(
            `id, amount, payment_method, created_at,
             orders:order_id(order_number)`,
          )
          .eq('store_id' as never, storeId)
          .eq('created_by' as never, shift.opened_by)
          .eq('is_historical' as never, false)
          .gte('created_at' as never, shift.opened_at)
        if (shift.closed_at) {
          cQuery2 = cQuery2.lte('created_at' as never, shift.closed_at)
        }
        const { data: legacyCredit, error: lcErr } = await cQuery2
          .order('created_at' as never, { ascending: true })
        if (lcErr) throw lcErr

        orders = (legacyOrders ?? []) as unknown as RawOrder[]
        paymentsRaw = (legacyPays ?? []) as unknown as RawLayawayPayment[]
        creditRaw = (legacyCredit ?? []) as unknown as RawCreditPayment[]
      }

      // Desglose de pagos por orden (032). La selección de QUÉ órdenes entran
      // al turno ya se resolvió arriba (shift_id moderno o ventana legacy); acá
      // solo traemos el reparto por método de esas órdenes. Los fiados no tienen
      // filas en order_payments (excluidos en la 032) y además ya se filtraron
      // con is_credit=false, así que no aportan efectivo. Una venta de un solo
      // método trae una fila (monto = total) → cuadre idéntico al anterior.
      const orderIds = orders.map((o) => o.id)
      const paymentsByOrder = new Map<string, OrderPaymentInput[]>()
      if (orderIds.length > 0) {
        const { data: opRaw, error: opErr } = await supabase
          .from('order_payments')
          .select('order_id, method, amount')
          .eq('store_id' as never, storeId)
          .in('order_id' as never, orderIds)
        if (opErr) throw opErr
        for (const p of (opRaw ?? []) as unknown as RawOrderPayment[]) {
          const list = paymentsByOrder.get(p.order_id) ?? []
          list.push({ method: p.method, amount: Number(p.amount) })
          paymentsByOrder.set(p.order_id, list)
        }
      }

      const layawayPayments: LayawayPaymentRow[] = paymentsRaw.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        payment_method: p.payment_method,
        created_at: p.created_at,
        layaway_number: p.layaways?.layaway_number ?? 0,
      }))

      const creditPayments: CreditPaymentRow[] = creditRaw.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        payment_method: p.payment_method,
        created_at: p.created_at,
        order_number: p.orders?.order_number ?? 0,
      }))

      // 4. Egresos del turno
      const { data: expensesRaw, error: expErr } = await supabase
        .from('cash_expenses')
        .select('*')
        .eq('shift_id' as never, shiftId)
        .eq('store_id' as never, storeId)
        .order('created_at' as never, { ascending: true })

      if (expErr) throw expErr
      const expenses = (expensesRaw ?? []) as unknown as CashExpense[]

      // 4b. Comisiones por crédito en efectivo imputadas al turno (Fase 4). Vía
      //    compartida con useShiftHistory (fetchShiftCashCommissions): una sola
      //    fuente para la imputación de comisiones al cuadre.
      const commissionByShift = await fetchShiftCashCommissions(storeId, [shiftId])
      const commissionsCash = commissionByShift.get(shiftId) ?? 0

      // 5. Agregación pura del cuadre (orders + abonos + comisiones - egresos). La función
      //    excluye las órdenes generadas al completar separados para no contar
      //    dos veces el dinero.
      const summary = calculateShiftSummary({
        openingAmount: shift.opening_amount,
        orders: orders.map((o) => ({
          id: o.id,
          total: Number(o.total),
          payments: paymentsByOrder.get(o.id) ?? [],
          return_id: o.return_id,
        })),
        excludedOrderIds,
        layawayPayments,
        creditPayments: creditPayments.map((p) => ({
          amount: p.amount,
          payment_method: p.payment_method,
        })),
        commissionIncomes:
          commissionsCash > 0 ? [{ amount: commissionsCash }] : [],
        expenses: expenses.map((e) => ({ amount: Number(e.amount), kind: e.kind })),
      })

      return {
        shift,
        expenses,
        salesByMethod: summary.salesByMethod,
        totalSales: summary.totalSales,
        cashSales: summary.cashSales,
        totalExpenses: summary.totalExpenses,
        expectedCash: summary.expectedCash,
        overdraft: summary.overdraft,
        orderCount: summary.orderCount,
        layawayPayments,
        layawayPaymentsTotal: summary.layawayPaymentsTotal,
        creditPayments,
        creditPaymentsTotal: summary.creditPaymentsTotal,
        commissionsIncome: summary.commissionsIncome,
        regularSalesTotal: summary.regularSalesTotal,
        returnsIncome: summary.returnsIncome,
        returnsExpense: summary.returnsExpense,
        returnsNet: summary.returnsNet,
        regularExpensesTotal: summary.regularExpensesTotal,
        storeName,
        userName,
      }
    },
    enabled: !!shiftId && !!storeId,
    staleTime: 15_000,
  })
}
