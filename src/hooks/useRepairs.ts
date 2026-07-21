import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { todayInBogota } from '@/lib/dateRange'
import { bogotaDayStartToUtc } from '@/lib/dates'
import { repairPartsCost, daysSince } from '@/lib/repairs'
import type {
  RepairOrder,
  RepairStatus,
  RepairPart,
  RepairStatusHistory,
  RepairChecklist,
} from '@/types/database.types'

// ── Tablero (kanban) ─────────────────────────────────────────────────────────

export interface RepairBoardCard {
  id: string
  order_number: number
  status: RepairStatus
  marca: string
  modelo: string
  imei_serial: string | null
  color: string | null
  falla_reportada: string
  precio: number | null
  created_at: string
  delivered_at: string | null
  customer_name: string
  customer_phone: string | null
  /** Suma de repuestos. 0 si el usuario no tiene reparaciones.ver_costos (el RLS
   *  de repair_parts no le devuelve filas → la tarjeta muestra el precio). */
  parts_cost: number
  /** true si el usuario ve costos (para decidir qué mostrar en la tarjeta). */
  cost_visible: boolean
  days_open: number
}

export interface RepairBoard {
  recibido: RepairBoardCard[]
  en_reparacion: RepairBoardCard[]
  listo: RepairBoardCard[]
  entregado_hoy: RepairBoardCard[]
}

interface RawBoardRow {
  id: string
  order_number: number
  status: RepairStatus
  marca: string
  modelo: string
  imei_serial: string | null
  color: string | null
  falla_reportada: string
  precio: number | null
  created_at: string
  delivered_at: string | null
  customers: { full_name: string; phone: string | null } | null
}

const BOARD_COLS =
  'id, order_number, status, marca, modelo, imei_serial, color, falla_reportada, precio, created_at, delivered_at, customers(full_name, phone)'

export function useRepairBoard() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['repairs', 'board', storeId],
    queryFn: async (): Promise<RepairBoard> => {
      const todayStartUtc = bogotaDayStartToUtc(todayInBogota())

      // Abiertas (todo lo que no está entregado) + entregadas HOY.
      const [openRes, deliveredRes] = await Promise.all([
        supabase
          .from('repair_orders')
          .select(BOARD_COLS)
          .eq('store_id' as never, storeId)
          .neq('status' as never, 'entregado')
          .order('created_at' as never, { ascending: true }),
        supabase
          .from('repair_orders')
          .select(BOARD_COLS)
          .eq('store_id' as never, storeId)
          .eq('status' as never, 'entregado')
          .gte('delivered_at' as never, todayStartUtc)
          .order('delivered_at' as never, { ascending: false }),
      ])
      if (openRes.error) throw openRes.error
      if (deliveredRes.error) throw deliveredRes.error

      const rows = [
        ...((openRes.data ?? []) as unknown as RawBoardRow[]),
        ...((deliveredRes.data ?? []) as unknown as RawBoardRow[]),
      ]

      // Costos de repuestos en UNA query (RLS: vacío si no hay ver_costos).
      const ids = rows.map((r) => r.id)
      let partsByRepair = new Map<string, number>()
      let costVisible = false
      if (ids.length > 0) {
        const { data: parts, error } = await supabase
          .from('repair_parts')
          .select('repair_order_id, costo')
          .in('repair_order_id' as never, ids as never)
        if (error) throw error
        const rawParts = (parts ?? []) as unknown as {
          repair_order_id: string
          costo: number
        }[]
        costVisible = rawParts.length > 0
        partsByRepair = rawParts.reduce((map, p) => {
          map.set(p.repair_order_id, (map.get(p.repair_order_id) ?? 0) + Number(p.costo))
          return map
        }, new Map<string, number>())
      }

      const toCard = (r: RawBoardRow): RepairBoardCard => ({
        id: r.id,
        order_number: r.order_number,
        status: r.status,
        marca: r.marca,
        modelo: r.modelo,
        imei_serial: r.imei_serial,
        color: r.color,
        falla_reportada: r.falla_reportada,
        precio: r.precio,
        created_at: r.created_at,
        delivered_at: r.delivered_at,
        customer_name: r.customers?.full_name ?? '—',
        customer_phone: r.customers?.phone ?? null,
        parts_cost: partsByRepair.get(r.id) ?? 0,
        cost_visible: costVisible,
        days_open: daysSince(r.created_at),
      })

      const board: RepairBoard = {
        recibido: [],
        en_reparacion: [],
        listo: [],
        entregado_hoy: [],
      }
      for (const r of rows) {
        const card = toCard(r)
        if (r.status === 'entregado') board.entregado_hoy.push(card)
        else board[r.status].push(card)
      }
      return board
    },
    enabled: !!storeId,
    staleTime: 15_000,
  })
}

// ── Detalle ──────────────────────────────────────────────────────────────────

export interface RepairDetailPart extends RepairPart {
  product_name: string | null
  variant_label: string | null
}

export interface RepairDetailHistory extends RepairStatusHistory {
  changed_by_name: string | null
}

export interface RepairDetail extends RepairOrder {
  customer_name: string
  customer_phone: string | null
  received_by_name: string | null
  delivered_by_name: string | null
  history: RepairDetailHistory[]
  parts: RepairDetailPart[]
  /** Suma de repuestos (0/oculto si no hay ver_costos). */
  parts_cost: number
  cost_visible: boolean
}

interface RawDetailRow extends Omit<RepairOrder, 'checklist'> {
  checklist: RepairChecklist
  customers: { full_name: string; phone: string | null } | null
  received: { full_name: string } | null
  delivered: { full_name: string } | null
}

export function useRepairDetail(repairId: string | null) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['repairs', 'detail', repairId],
    queryFn: async (): Promise<RepairDetail> => {
      const { data, error } = await supabase
        .from('repair_orders')
        .select(
          '*, customers(full_name, phone), received:received_by(full_name), delivered:delivered_by(full_name)',
        )
        .eq('id' as never, repairId as never)
        .single()
      if (error) throw error
      const row = data as unknown as RawDetailRow

      const [histRes, partsRes] = await Promise.all([
        supabase
          .from('repair_status_history')
          .select('*, profiles:changed_by(full_name)')
          .eq('repair_order_id' as never, repairId as never)
          .order('created_at' as never, { ascending: true }),
        supabase
          .from('repair_parts')
          .select('*, variants(size, color, products(name))')
          .eq('repair_order_id' as never, repairId as never)
          .order('created_at' as never, { ascending: true }),
      ])
      if (histRes.error) throw histRes.error
      if (partsRes.error) throw partsRes.error

      const history = ((histRes.data ?? []) as unknown as (RepairStatusHistory & {
        profiles: { full_name: string } | null
      })[]).map<RepairDetailHistory>((h) => ({
        ...h,
        changed_by_name: h.profiles?.full_name ?? null,
      }))

      const rawParts = (partsRes.data ?? []) as unknown as (RepairPart & {
        variants: { size: string | null; color: string | null; products: { name: string } | null } | null
      })[]
      const parts = rawParts.map<RepairDetailPart>((p) => ({
        ...p,
        product_name: p.variants?.products?.name ?? null,
        variant_label: p.variants
          ? [p.variants.size, p.variants.color].filter(Boolean).join(' · ') || null
          : null,
      }))

      return {
        ...(row as RepairOrder),
        customer_name: row.customers?.full_name ?? '—',
        customer_phone: row.customers?.phone ?? null,
        received_by_name: row.received?.full_name ?? null,
        delivered_by_name: row.delivered?.full_name ?? null,
        history,
        parts,
        parts_cost: repairPartsCost(parts),
        cost_visible: parts.length > 0,
      }
    },
    enabled: !!repairId && !!storeId,
    staleTime: 10_000,
  })
}

// ── Badge: equipos listos esperando retiro ───────────────────────────────────

export function useReadyRepairsCount() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['repairs', 'ready-count', storeId],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('repair_orders')
        .select('id', { count: 'exact', head: true })
        .eq('store_id' as never, storeId)
        .eq('status' as never, 'listo')
      if (error) throw error
      return count ?? 0
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}
