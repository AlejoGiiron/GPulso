import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import type { Unit } from '@/types/database.types'

// Unidad con el contexto de producto/variante para la ficha y la búsqueda.
export type UnitRow = Unit & {
  variants: {
    size: string | null
    color: string | null
    products: { name: string; brand: string | null }
  } | null
  // Origen legible (factura de compra) si vino por compra.
  purchase_invoice_items: {
    invoice_id: string
    purchase_invoices: { invoice_number: string; invoice_date: string } | null
  } | null
}

const UNIT_SELECT = `
  *,
  variants!inner(size, color, products!inner(name, brand)),
  purchase_invoice_items(invoice_id, purchase_invoices(invoice_number, invoice_date))
`

// Unidades de UNA variante (todas: disponible/reservada/vendida), recientes primero.
export function useVariantUnits(variantId: string | null | undefined, enabled = true) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['units', 'by-variant', variantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('units')
        .select(UNIT_SELECT)
        .eq('variant_id' as never, variantId as never)
        .eq('store_id' as never, storeId)
        .order('created_at' as never, { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as UnitRow[]
    },
    enabled: !!variantId && !!storeId && enabled,
    staleTime: 15_000,
  })
}

// Conteo de unidades disponibles por variante (para "N unidades" en inventario)
// ya vive en variants.stock_qty (derivado por trigger), así que NO se re-consulta.

// Búsqueda GLOBAL por serial (C3): serial exacto (trim), en cualquier estado.
// El UNIQUE(org, serial) garantiza a lo sumo una fila.
export function useUnitBySerial(serial: string) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)
  const term = serial.trim()

  return useQuery({
    queryKey: ['units', 'by-serial', storeId, term],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('units')
        .select(UNIT_SELECT)
        .eq('store_id' as never, storeId)
        .eq('serial' as never, term)
        .maybeSingle()
      if (error) throw error
      return (data as unknown as UnitRow | null) ?? null
    },
    enabled: !!storeId && term.length >= 3,
    staleTime: 5_000,
  })
}
