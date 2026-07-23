import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { useDebounce } from './useDebounce'
import type { Category } from '@/types/database.types'

export interface POSVariant {
  id: string
  size: string | null
  color: string | null
  price: number
  // Cantidad realmente disponible para venta = stock_qty - reserved_qty.
  // Exponemos este valor como stock_qty al POS para que ninguna comprobación
  // de stock ignore las reservas de separados.
  stock_qty: number
  // Stock físico total (incluye lo reservado). Informativo: lo usa el
  // VariantPickerModal para mostrar "X total, Y reservado".
  total_stock_qty: number
  reserved_qty: number
  barcode: string | null
  sku: string | null
  is_active: boolean
}

export interface POSProduct {
  id: string
  name: string
  brand: string | null
  image_url: string | null
  is_serialized: boolean
  // Fase B: precio sugerido de la plantilla serializada (null en accesorios).
  // Fuente del precio mostrado y semilla del precio de una unidad nueva.
  suggested_price: number | null
  category: Pick<Category, 'id' | 'name' | 'color'> | null
  variants: POSVariant[]
}

interface RawVariant {
  id: string
  size: string | null
  color: string | null
  price: number
  stock_qty: number
  reserved_qty: number
  barcode: string | null
  sku: string | null
  is_active: boolean
}

interface RawProduct {
  id: string
  name: string
  brand: string | null
  image_url: string | null
  is_serialized: boolean
  suggested_price: number | null
  categories: { id: string; name: string; color: string | null } | null
  variants: RawVariant[]
}

export function usePOSProducts() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['pos-products', storeId],
    queryFn: async (): Promise<POSProduct[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, name, brand, image_url, is_serialized, suggested_price, categories(id, name, color), variants(id, size, color, price, stock_qty, reserved_qty, barcode, sku, is_active)',
        )
        .eq('store_id' as never, storeId)
        .eq('is_active' as never, true)
        // El servicio de reparación no se vende suelto por el POS (se cobra vía
        // deliver_repair). Se excluye de la búsqueda de productos vendibles.
        .eq('is_service' as never, false)
        .order('name' as never)
      if (error) throw error
      return (data ?? []).map((row) => {
        const r = row as unknown as RawProduct
        return {
          id: r.id,
          name: r.name,
          brand: r.brand,
          image_url: r.image_url,
          is_serialized: r.is_serialized,
          suggested_price: r.suggested_price,
          category: r.categories,
          variants: (r.variants ?? [])
            .filter((v) => v.is_active)
            .map<POSVariant>((v) => ({
              id: v.id,
              size: v.size,
              color: v.color,
              price: v.price,
              // Disponible real = stock físico - reservado por separados activos.
              stock_qty: Math.max(0, (v.stock_qty ?? 0) - (v.reserved_qty ?? 0)),
              total_stock_qty: v.stock_qty ?? 0,
              reserved_qty: v.reserved_qty ?? 0,
              barcode: v.barcode,
              sku: v.sku,
              is_active: v.is_active,
            })),
        }
      })
    },
    enabled: !!storeId,
    staleTime: 60_000,
  })
}

export function usePOSSearch(query: string) {
  const dq = useDebounce(query.trim(), 300)
  const { data: all = [], isLoading } = usePOSProducts()

  const data = useMemo(() => {
    if (!dq) return all
    const lower = dq.toLowerCase()
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        (p.brand ?? '').toLowerCase().includes(lower) ||
        p.variants.some(
          (v) => v.barcode === dq || (v.sku ?? '').toLowerCase().includes(lower),
        ),
    )
  }, [all, dq])

  return { data, isLoading }
}

/** Returns the single variant that matches an exact barcode scan, or null. */
export function findVariantByBarcode(
  products: POSProduct[],
  barcode: string,
): { product: POSProduct; variant: POSVariant } | null {
  for (const p of products) {
    const v = p.variants.find((v) => v.barcode === barcode)
    if (v) return { product: p, variant: v }
  }
  return null
}
