import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import type {
  RepairOrder,
  RepairStatus,
  RepairChecklist,
  RepairPartSource,
  Order,
  PaymentMethod,
} from '@/types/database.types'

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface CreateRepairInput {
  customer_id: string
  marca: string
  modelo: string
  imei_serial: string | null
  color: string | null
  falla_reportada: string
  checklist: RepairChecklist
  observaciones: string | null
  accesorios: string | null
  password_equipo: string | null
  precio: number | null
}

export interface DeliverRepairInput {
  repairId: string
  payments: { method: PaymentMethod; amount: number }[]
  cash_received: number | null
}

export interface AddRepairPartInput {
  repairId: string
  source: RepairPartSource
  variant_id: string | null
  qty: number | null
  descripcion: string | null
  costo: number | null
}

function useInvalidateRepairs() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['repairs'] })
  }
}

// Un repuesto de inventario mueve stock: refresca inventario además de repairs.
function useInvalidateRepairsAndStock() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['repairs'] })
    void qc.invalidateQueries({ queryKey: ['inventory'] })
    void qc.invalidateQueries({ queryKey: ['variants'] })
    void qc.invalidateQueries({ queryKey: ['products'] })
    void qc.invalidateQueries({ queryKey: ['pos-products'] })
    void qc.invalidateQueries({ queryKey: ['stock-movements'] })
  }
}

// Invalidación amplia tras una ENTREGA (genera venta + mueve caja).
function useInvalidateAfterDeliver() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['repairs'] })
    void qc.invalidateQueries({ queryKey: ['orders'] })
    void qc.invalidateQueries({ queryKey: ['sales-history'] })
    void qc.invalidateQueries({ queryKey: ['cash-shift'] })
    void qc.invalidateQueries({ queryKey: ['shift-closing'] })
    void qc.invalidateQueries({ queryKey: ['customers'] })
  }
}

// ── Crear (recepción) ─────────────────────────────────────────────────────────

export function useCreateRepair() {
  const { profile } = useAuth()
  const invalidate = useInvalidateRepairs()

  return useMutation({
    mutationFn: async (input: CreateRepairInput): Promise<RepairOrder> => {
      const storeId = getActiveStoreId(profile)
      if (!storeId || !profile?.id) throw new Error('Sesión inválida.')
      if (!input.customer_id) throw new Error('La reparación necesita un cliente.')
      if (!input.marca.trim() || !input.modelo.trim()) throw new Error('Falta marca o modelo.')
      if (!input.falla_reportada.trim()) throw new Error('Describe la falla reportada.')

      const { data, error } = await supabase
        .from('repair_orders')
        .insert({
          store_id: storeId,
          customer_id: input.customer_id,
          marca: input.marca.trim(),
          modelo: input.modelo.trim(),
          imei_serial: input.imei_serial?.trim() || null,
          color: input.color?.trim() || null,
          falla_reportada: input.falla_reportada.trim(),
          checklist: input.checklist,
          observaciones: input.observaciones?.trim() || null,
          accesorios: input.accesorios?.trim() || null,
          password_equipo: input.password_equipo?.trim() || null,
          precio: input.precio,
          received_by: profile.id,
        } as never)
        .select()
        .single()
      if (error) throw error
      return data as unknown as RepairOrder
    },
    onSuccess: () => {
      invalidate()
      toast.success('Equipo recibido')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Editar campos / precio ────────────────────────────────────────────────────

export interface UpdateRepairInput {
  id: string
  patch: Partial<
    Pick<
      RepairOrder,
      | 'marca'
      | 'modelo'
      | 'imei_serial'
      | 'color'
      | 'falla_reportada'
      | 'checklist'
      | 'observaciones'
      | 'accesorios'
      | 'password_equipo'
      | 'precio'
    >
  >
}

export function useUpdateRepair() {
  const invalidate = useInvalidateRepairs()
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateRepairInput): Promise<void> => {
      const { error } = await supabase
        .from('repair_orders')
        .update(patch as never)
        .eq('id' as never, id as never)
      if (error) throw error
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Avanzar estado (recibido → en_reparacion → listo) ─────────────────────────

// Mensaje único de la regla precio-para-listo, compartido por la mutación y por
// la guarda de cliente (RepairDetailModal) para no tener dos variantes del texto.
export const REPAIR_READY_PRICE_ERROR = 'Define el precio antes de marcar como listo'

type RepairsDbClient = typeof supabase

/**
 * Avanza el estado de una reparación. Para pasar a 'listo' el precio debe estar
 * definido (se cobra al entregar). La fuente de verdad es la BD, NO el llamador:
 * releemos el precio real de la orden y validamos ESE valor, para que la regla no
 * dependa de que cada punto de avance (modal, kanban, o uno futuro) recuerde
 * pasarlo. Recibe el client como parámetro para poder testearse sin red.
 *
 * NOTA (deuda, ver FORKED_FROM.md): el avance de estado es un UPDATE plano sin
 * RPC; esta guarda vive solo en cliente y es saltable por API directa.
 */
export async function advanceRepairStatus(
  client: RepairsDbClient,
  id: string,
  status: RepairStatus,
): Promise<void> {
  if (status === 'listo') {
    const { data, error: readErr } = await client
      .from('repair_orders')
      .select('precio')
      .eq('id' as never, id as never)
      .single()
    if (readErr) throw readErr
    if ((data as { precio: number | null } | null)?.precio == null) {
      throw new Error(REPAIR_READY_PRICE_ERROR)
    }
  }
  const { error } = await client
    .from('repair_orders')
    .update({ status } as never)
    .eq('id' as never, id as never)
  if (error) throw error
}

export function useAdvanceRepairStatus() {
  const invalidate = useInvalidateRepairs()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: RepairStatus }): Promise<void> =>
      advanceRepairStatus(supabase, id, status),
    onSuccess: () => {
      invalidate()
      toast.success('Estado actualizado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Entregar (cobrar) — RPC atómica ───────────────────────────────────────────

export function useDeliverRepair() {
  const invalidate = useInvalidateAfterDeliver()
  return useMutation({
    mutationFn: async (input: DeliverRepairInput): Promise<Order> => {
      const { data: orderId, error } = await supabase.rpc('deliver_repair' as never, {
        p_repair_id: input.repairId,
        p_payments: input.payments.map((p) => ({ method: p.method, amount: p.amount })),
        p_cash_received: input.cash_received,
      } as never)
      if (error) throw error

      const { data: order, error: fetchErr } = await supabase
        .from('orders')
        .select()
        .eq('id' as never, orderId as never)
        .single()
      if (fetchErr || !order) {
        throw new Error('Entrega registrada, pero no se pudo cargar el comprobante.')
      }
      return order as Order
    },
    onSuccess: () => {
      invalidate()
      toast.success('Entrega cobrada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Repuestos — RPCs atómicas ─────────────────────────────────────────────────

export function useAddRepairPart() {
  const invalidate = useInvalidateRepairsAndStock()
  return useMutation({
    mutationFn: async (input: AddRepairPartInput): Promise<string> => {
      const { data, error } = await supabase.rpc('add_repair_part' as never, {
        p_repair_id: input.repairId,
        p_source: input.source,
        p_variant_id: input.variant_id,
        p_qty: input.qty,
        p_descripcion: input.descripcion,
        p_costo: input.costo,
      } as never)
      if (error) throw error
      return data as unknown as string
    },
    onSuccess: () => {
      invalidate()
      // El consumo de inventario mueve stock.
      toast.success('Repuesto agregado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useRemoveRepairPart() {
  const invalidate = useInvalidateRepairsAndStock()
  return useMutation({
    mutationFn: async (partId: string): Promise<void> => {
      const { error } = await supabase.rpc('remove_repair_part' as never, {
        p_part_id: partId,
      } as never)
      if (error) throw error
    },
    onSuccess: () => {
      invalidate()
      toast.success('Repuesto eliminado')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
