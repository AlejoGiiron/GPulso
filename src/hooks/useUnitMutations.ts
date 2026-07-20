import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import toast from 'react-hot-toast'

// Traduce errores crudos de Postgres a mensajes humanos. El usuario NUNCA debe
// ver un error de constraint de Postgres.
export function humanizeUnitError(err: unknown): string {
  const e = err as { code?: string; message?: string }
  if (e?.code === '23505') return 'Uno de los seriales ya existe: revisa la lista.'
  return e?.message ?? 'No se pudo completar la operación.'
}

type AddManualUnitInput = {
  variant_id: string
  serial: string
  cost: number | null
  notas: string | null
}

export function useUnitMutations() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const storeId = getActiveStoreId(profile)

  function invalidate(variantId?: string) {
    void queryClient.invalidateQueries({ queryKey: ['units'] })
    void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    void queryClient.invalidateQueries({ queryKey: ['products', storeId] })
    void queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] })
    if (variantId) void queryClient.invalidateQueries({ queryKey: ['variants', variantId] })
  }

  // C2b — ingreso manual de una unidad suelta. Crea la unidad 'disponible' (el
  // trigger de sincronización pone stock_qty) + un stock_movement 'adjustment'
  // como los ajustes actuales. purchase_invoice_item_id NULL es válido aquí.
  const addManualUnit = useMutation({
    mutationFn: async ({ variant_id, serial, cost, notas }: AddManualUnitInput) => {
      const trimmed = serial.trim()
      if (!trimmed) throw new Error('El serial no puede estar vacío.')

      const { data: unit, error: uErr } = await supabase
        .from('units')
        .insert({
          store_id: storeId,
          variant_id,
          serial: trimmed,
          cost,
          notas: notas?.trim() || null,
        } as never)
        .select()
        .single()
      if (uErr) throw uErr
      const unitId = (unit as { id: string }).id

      const { error: mErr } = await supabase.from('stock_movements').insert({
        variant_id,
        store_id: storeId,
        type: 'adjustment',
        qty: 1,
        notes: notas?.trim() || 'Ingreso manual de unidad',
        created_by: profile!.id,
        // Estampa la unidad (042) para la línea de tiempo del Bloque E.
        unit_id: unitId,
      } as never)
      // Best-effort: si el movimiento falla, la unidad ya existe (no revertimos;
      // el stock es correcto por el trigger). Se avisa pero no rompe el ingreso.
      if (mErr) toast.error('Unidad creada, pero no se registró el movimiento.')

      return unit
    },
    onSuccess: (_d, vars) => {
      invalidate(vars.variant_id)
      toast.success('Unidad agregada')
    },
    onError: (err) => toast.error(humanizeUnitError(err)),
  })

  // C2a — recepción en ráfaga por línea de factura (RPC atómica del servidor).
  const receiveSerials = useMutation({
    mutationFn: async ({
      invoiceItemId,
      serials,
    }: {
      invoiceItemId: string
      serials: string[]
    }) => {
      const { data, error } = await supabase.rpc('receive_serialized_units' as never, {
        p_invoice_item_id: invoiceItemId,
        p_serials: serials,
      } as never)
      if (error) throw error
      return data as number
    },
    onSuccess: () => invalidate(),
    // El error lo maneja el panel (mapeo a mensaje humano) para poder marcar la
    // lista; acá no mostramos toast para no duplicar.
  })

  return { addManualUnit, receiveSerials }
}
