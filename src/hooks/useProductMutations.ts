import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import toast from 'react-hot-toast'
import type { Product, Variant } from '@/types/database.types'

type CreateProductInput = {
  name: string
  description: string | null
  brand: string | null
  category_id: string | null
  image_url: string | null
  size_type: string
  is_serialized?: boolean
}

type UpdateProductInput = Partial<CreateProductInput> & { id: string }

// Producto de variante "Única" en UN paso (Fase 2, Bloque B): crea el producto
// y su ÚNICA variante (size/color en NULL → invisible en la UI) de una vez.
// initialStock solo aplica a NO serializados; los serializados nacen con 0
// unidades y se cargan por inventario/compra.
type CreateSimpleInput = CreateProductInput & {
  price: number
  cost_price: number | null
  initial_stock: number
}

export function useProductMutations() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const storeId = getActiveStoreId(profile)

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['products', storeId] })
  }

  const create = useMutation({
    mutationFn: async (input: CreateProductInput) => {
      const { data, error } = await supabase
        .from('products')
        .insert({ ...input, store_id: storeId, is_active: true } as never)
        .select()
        .single()
      if (error) throw error
      return data as Product
    },
    onSuccess: () => {
      invalidate()
      toast.success('Producto creado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const createSimple = useMutation({
    mutationFn: async ({
      price,
      cost_price,
      initial_stock,
      is_serialized,
      ...productInput
    }: CreateSimpleInput) => {
      // 1. Producto
      const { data: prod, error: pErr } = await supabase
        .from('products')
        .insert({
          ...productInput,
          is_serialized: is_serialized ?? false,
          store_id: storeId,
          is_active: true,
        } as never)
        .select()
        .single()
      if (pErr) throw pErr
      const product = prod as Product

      // 2. Variante ÚNICA (size/color NULL → invisible). Serializado nace con 0
      //    stock; el trigger de unidades lo mantendrá al cargar unidades.
      const { data: variant, error: vErr } = await supabase
        .from('variants')
        .insert({
          product_id: product.id,
          store_id: storeId,
          size: null,
          color: null,
          sku: null,
          barcode: null,
          price,
          cost_price,
          stock_qty: is_serialized ? 0 : initial_stock,
          min_stock: 0,
          is_active: true,
        } as never)
        .select()
        .single()
      if (vErr) {
        // Rollback compensatorio: no dejar el producto huérfano sin variante.
        await supabase.from('products').delete().eq('id' as never, product.id)
        throw vErr
      }
      return { product, variant: variant as Variant }
    },
    onSuccess: () => {
      invalidate()
      toast.success('Producto creado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const update = useMutation({
    mutationFn: async ({ id, ...changes }: UpdateProductInput) => {
      const { data, error } = await supabase
        .from('products')
        .update(changes as never)
        .eq('id' as never, id)
        .select()
        .single()
      if (error) throw error
      return data as Product
    },
    onSuccess: () => {
      invalidate()
      toast.success('Producto actualizado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  async function uploadImage(file: File, fileId: string): Promise<string | null> {
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${storeId}/${fileId}.${ext}`
    const { error } = await supabase.storage
      .from('product-images')
      .upload(path, file, { upsert: true })
    if (error) {
      toast.error('Error subiendo imagen: ' + error.message)
      return null
    }
    return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl
  }

  return { create, createSimple, update, uploadImage }
}
