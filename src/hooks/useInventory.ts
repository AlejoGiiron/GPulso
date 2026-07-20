import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { bogotaDayStartToUtc, bogotaDayEndToUtc } from '@/lib/dates'
import type { Variant, StockMovement, StockMovementType } from '@/types/database.types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type VariantRow = Variant & {
  products: {
    id: string
    name: string
    brand: string | null
    category_id: string | null
    is_serialized: boolean
    categories: { id: string; name: string } | null
  }
  /** Disponible = stock_qty - reserved_qty (precalculado en cliente). */
  available: number
  /** Estado de stock calculado sobre `available`, no sobre stock_qty físico. */
  stock_state: 'out' | 'low' | 'ok'
}

export type MovementRow = StockMovement & {
  variants: {
    size: string | null
    color: string | null
    products: { name: string }
  } | null
}

export interface MovementFilters {
  type: StockMovementType | 'all'
  dateFrom: string
  dateTo: string
}

export const MOV_PAGE_SIZE = 50

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useStockLevels() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['inventory', 'stock-levels', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('variants')
        .select(`
          *,
          products!inner(
            id, name, brand, category_id, is_serialized,
            categories(id, name)
          )
        `)
        .eq('store_id' as never, storeId)
        .eq('is_active' as never, true)
        .order('created_at' as never, { ascending: false })

      if (error) throw error

      type Raw = Omit<VariantRow, 'available' | 'stock_state'>
      const rows = (data ?? []) as unknown as Raw[]
      return rows.map<VariantRow>((v) => {
        const available = Math.max(0, (v.stock_qty ?? 0) - (v.reserved_qty ?? 0))
        const min = v.min_stock ?? 0
        const stock_state: 'out' | 'low' | 'ok' =
          available === 0 ? 'out' : available <= min ? 'low' : 'ok'
        return { ...v, available, stock_state }
      })
    },
    enabled: !!storeId,
    staleTime: 30_000,
  })
}

export function useStockMovements(filters: MovementFilters, page: number) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['inventory', 'movements', storeId, filters, page],
    queryFn: async () => {
      let query = supabase
        .from('stock_movements')
        .select(
          `*, variants(size, color, products(name))`,
          { count: 'exact' },
        )
        .eq('store_id' as never, storeId)
        .order('created_at' as never, { ascending: false })
        .range(page * MOV_PAGE_SIZE, (page + 1) * MOV_PAGE_SIZE - 1)

      if (filters.type !== 'all') {
        query = query.eq('type' as never, filters.type)
      }
      if (filters.dateFrom) {
        query = query.gte('created_at' as never, bogotaDayStartToUtc(filters.dateFrom))
      }
      if (filters.dateTo) {
        query = query.lte('created_at' as never, bogotaDayEndToUtc(filters.dateTo))
      }

      const { data, error, count } = await query
      if (error) throw error
      return {
        rows: (data ?? []) as unknown as MovementRow[],
        total: count ?? 0,
      }
    },
    enabled: !!storeId,
    staleTime: 10_000,
  })
}

export function useStoreProfiles() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['profiles', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('store_id' as never, storeId)
      if (error) throw error
      return (data ?? []) as { id: string; full_name: string }[]
    },
    enabled: !!storeId,
    staleTime: 300_000,
  })
}
