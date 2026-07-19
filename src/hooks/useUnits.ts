import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import type { Unit, UnitStatus } from '@/types/database.types'

// Forma plana de una unidad para vender en el POS (con precio de la variante).
export interface UnitForSale {
  unit_id: string
  serial: string
  variant_id: string
  product_id: string
  name: string
  brand: string | null
  size: string | null
  color: string | null
  price: number
  status: UnitStatus
}

// Búsqueda IMPERATIVA por serial exacto para el escáner del POS (no un hook).
// Devuelve la unidad + el precio de su variante, o null si no existe.
export async function lookupUnitBySerial(
  storeId: string,
  serial: string,
): Promise<UnitForSale | null> {
  const term = serial.trim()
  if (!term || !storeId) return null
  const { data, error } = await supabase
    .from('units')
    .select(
      `id, serial, status, variant_id,
       variants!inner(price, size, color, product_id, products!inner(id, name, brand))`,
    )
    .eq('store_id' as never, storeId)
    .eq('serial' as never, term)
    .maybeSingle()
  if (error || !data) return null
  const u = data as unknown as {
    id: string
    serial: string
    status: UnitStatus
    variant_id: string
    variants: {
      price: number
      size: string | null
      color: string | null
      product_id: string
      products: { id: string; name: string; brand: string | null }
    }
  }
  return {
    unit_id: u.id,
    serial: u.serial,
    variant_id: u.variant_id,
    product_id: u.variants.product_id,
    name: u.variants.products.name,
    brand: u.variants.products.brand,
    size: u.variants.size,
    color: u.variants.color,
    price: u.variants.price,
    status: u.status,
  }
}

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

// Unidades (cualquier estado) de un conjunto de variantes — para el selector de
// unidades del POS (D2). Devuelve la forma plana UnitForSale + estado.
export function useUnitsForVariants(variantIds: string[], enabled = true) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['units', 'for-variants', storeId, [...variantIds].sort()],
    queryFn: async (): Promise<UnitForSale[]> => {
      const { data, error } = await supabase
        .from('units')
        .select(
          `id, serial, status, variant_id,
           variants!inner(price, size, color, product_id, products!inner(name, brand))`,
        )
        .eq('store_id' as never, storeId)
        .in('variant_id' as never, variantIds as never)
        .order('status' as never, { ascending: true })
        .order('created_at' as never, { ascending: true })
      if (error) throw error
      type Raw = {
        id: string; serial: string; status: UnitStatus; variant_id: string
        variants: {
          price: number; size: string | null; color: string | null; product_id: string
          products: { name: string; brand: string | null }
        }
      }
      return ((data ?? []) as unknown as Raw[]).map((u) => ({
        unit_id: u.id,
        serial: u.serial,
        variant_id: u.variant_id,
        product_id: u.variants.product_id,
        name: u.variants.products.name,
        brand: u.variants.products.brand,
        size: u.variants.size,
        color: u.variants.color,
        price: u.variants.price,
        status: u.status,
      }))
    },
    enabled: enabled && variantIds.length > 0 && !!storeId,
    staleTime: 10_000,
  })
}

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
