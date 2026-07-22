import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import toast from 'react-hot-toast'
import type { Variant } from '@/types/database.types'

type CreateVariantInput = {
  product_id: string
  size: string | null
  color: string | null
  sku: string | null
  barcode: string | null
  price: number
  cost_price: number | null
  stock_qty: number
  min_stock: number
}

// stock_qty NO es editable por esta vía: el stock solo se mueve por
// compra / ajuste / venta / devolución / apertura (cada uno deja rastro en
// stock_movements). El alta (create) sí fija el stock inicial → genera su
// movimiento 'opening' (trigger 052). Editar una variante nunca toca el stock.
type UpdateVariantInput = {
  id: string
} & Partial<
  Pick<
    Variant,
    'size' | 'color' | 'sku' | 'barcode' | 'price' | 'cost_price' | 'min_stock' | 'is_active'
  >
>

export function useVariantMutations(productId: string) {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const storeId = getActiveStoreId(profile)

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['variants', productId] })
    void queryClient.invalidateQueries({ queryKey: ['products', storeId] })
  }

  const create = useMutation({
    mutationFn: async (input: CreateVariantInput) => {
      const { data, error } = await supabase
        .from('variants')
        .insert({ ...input, store_id: storeId, is_active: true } as never)
        .select()
        .single()
      if (error) throw error
      return data as Variant
    },
    onSuccess: () => {
      invalidate()
      toast.success('Variante creada')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const update = useMutation({
    mutationFn: async ({ id, ...changes }: UpdateVariantInput) => {
      const { data, error } = await supabase
        .from('variants')
        .update(changes as never)
        .eq('id' as never, id)
        .select()
        .single()
      if (error) throw error
      return data as Variant
    },
    onSuccess: () => {
      invalidate()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { data, error } = await supabase
        .from('variants')
        .update({ is_active: !isActive } as never)
        .eq('id' as never, id)
        .select()
        .single()
      if (error) throw error
      return data as Variant
    },
    onSuccess: (_data, variables) => {
      invalidate()
      toast.success(variables.isActive ? 'Variante desactivada' : 'Variante activada')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return { create, update, toggleActive }
}
