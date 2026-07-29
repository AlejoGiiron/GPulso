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
    onError: (err: Error) => {
      // El CHECK repair_orders_precio_required_when_ready (migración
      // 20260728_1630) impide dejar el precio en NULL con la orden ya en
      // 'listo'/'entregado'. Postgres lo reporta con el nombre de la constraint,
      // que no le dice nada al usuario: traducimos SOLO este caso.
      if (err.message.includes('repair_orders_precio_required_when_ready')) {
        return toast.error('Una reparación lista o entregada no puede quedar sin precio.')
      }
      toast.error(err.message)
    },
  })
}

// ── Avanzar / retroceder estado — RPC atómica ─────────────────────────────────

// Mensaje de la regla precio-para-listo usado como PRE-chequeo de cliente (evita
// un viaje a la BD cuando ya sabemos que falta el precio). Es el mismo texto que
// devuelve la RPC, para que el usuario no vea dos redacciones de la misma regla.
export const REPAIR_READY_PRICE_ERROR = 'Define el precio antes de marcar como listo.'

type RepairsDbClient = typeof supabase

/**
 * Mueve el estado de una reparación llamando a la RPC `advance_repair_status`
 * (migración 20260728_1630). TODA la validación vive en la BD:
 *   · permiso reparaciones.gestionar y orden de la tienda activa
 *   · transición válida: recibido → en_reparacion → listo, más el retroceso
 *     listo → en_reparacion. Sin saltos.
 *   · precio obligatorio para 'listo' (releído de la BD, no del llamador)
 *   · 'entregado' RECHAZADO: eso lo hace deliver_repair, que crea la venta y el
 *     pago. Antes se podía escribir el estado directo y saltarse el cobro.
 *
 * Los errores se propagan TAL CUAL: los mensajes de la RPC están redactados para
 * el usuario final (el de 'entregado' lo manda a "Entregar y cobrar", el de
 * transición explica el flujo). Envolverlos en un genérico perdería esa guía.
 *
 * Recibe el client como parámetro para poder testearse sin red.
 */
export async function advanceRepairStatus(
  client: RepairsDbClient,
  id: string,
  status: RepairStatus,
): Promise<void> {
  const { error } = await client.rpc('advance_repair_status' as never, {
    p_repair_id: id,
    p_new_status: status,
  } as never)
  if (error) throw error
}

export interface AdvanceRepairInput {
  id: string
  status: RepairStatus
  /**
   * Estado de origen. Solo se usa para elegir el texto del toast: `en_reparacion`
   * se alcanza tanto avanzando (desde 'recibido') como retrocediendo (desde
   * 'listo'), y decir "Estado actualizado" en un retroceso lo haría pasar
   * inadvertido. La validación real de la transición es de la BD, no de esto.
   */
  from?: RepairStatus
}

export function useAdvanceRepairStatus() {
  const invalidate = useInvalidateRepairs()
  return useMutation({
    mutationFn: ({ id, status }: AdvanceRepairInput): Promise<void> =>
      advanceRepairStatus(supabase, id, status),
    onSuccess: (_data, { status, from }) => {
      invalidate()
      const isRevert = from === 'listo' && status === 'en_reparacion'
      toast.success(isRevert ? 'Devuelta a reparación' : 'Estado actualizado')
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
