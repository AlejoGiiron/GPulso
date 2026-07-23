import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { useDebounce } from './useDebounce'
import toast from 'react-hot-toast'

// Traduce errores de la RPC/BD a mensajes humanos. La RPC ya trae mensajes claros
// (nombre duplicado, IMEI ya registrado, precio, permiso); el 23505 es la red final.
export function humanizeEquipmentError(err: unknown): string {
  const e = err as { code?: string; message?: string }
  if (e?.code === '23505') return 'Ese IMEI ya está registrado en el sistema.'
  return e?.message ?? 'No se pudo crear el equipo.'
}

export interface CreateEquipmentInput {
  name: string
  brand: string | null
  category_id: string | null
  description: string | null
  suggested_price: number
  serial: string
  unit_cost: number | null
  variant_label: string | null
  // Precio de la primera unidad; null = usar el sugerido al leer.
  unit_price: number | null
}

export interface CreatedEquipment {
  product_id: string
  variant_id: string
  unit_id: string
}

// Puerta 1: crea plantilla serializada + variante ancla + primera unidad en UN
// gesto atómico (RPC 055). La RPC valida permiso/tienda/precio, rechaza nombre
// duplicado y serial duplicado, y no deja plantillas huérfanas.
export function useCreateEquipmentWithUnit() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const storeId = getActiveStoreId(profile)

  return useMutation({
    mutationFn: async (input: CreateEquipmentInput): Promise<CreatedEquipment> => {
      const { data, error } = await supabase.rpc('create_equipment_with_unit' as never, {
        p_name: input.name.trim(),
        p_brand: input.brand?.trim() || null,
        p_category_id: input.category_id,
        p_description: input.description?.trim() || null,
        p_suggested_price: input.suggested_price,
        p_serial: input.serial.trim(),
        p_unit_cost: input.unit_cost,
        p_variant_label: input.variant_label?.trim() || null,
        p_unit_price: input.unit_price,
      } as never)
      if (error) throw error
      return data as CreatedEquipment
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products', storeId] })
      void queryClient.invalidateQueries({ queryKey: ['pos-products', storeId] })
      void queryClient.invalidateQueries({ queryKey: ['units'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (err) => toast.error(humanizeEquipmentError(err)),
  })
}

// Plantilla serializada existente (para el dedup: "¿Es este? → agregar unidad").
export interface SerializedTemplate {
  id: string
  name: string
  brand: string | null
  suggested_price: number | null
  variant_id: string
}

// Busca plantillas serializadas ACTIVAS por nombre/marca. Sirve para OFRECERLAS
// antes de crear una nueva (evita segundas plantillas del mismo modelo). Devuelve
// también la variante ancla, para agregarle una unidad (puerta 3) sin otra query.
export function useSerializedTemplateSearch(query: string, enabled = true) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)
  const dq = useDebounce(query.trim(), 250)

  return useQuery({
    queryKey: ['serialized-templates', storeId, dq],
    queryFn: async (): Promise<SerializedTemplate[]> => {
      if (dq.length < 2) return []
      const { data, error } = await supabase
        .from('products')
        .select('id, name, brand, suggested_price, variants(id, is_active)')
        .eq('store_id' as never, storeId)
        .eq('is_serialized' as never, true)
        .eq('is_active' as never, true)
        .or(`name.ilike.%${dq}%,brand.ilike.%${dq}%`)
        .limit(8)
      if (error) throw error
      type Raw = {
        id: string; name: string; brand: string | null; suggested_price: number | null
        variants: { id: string; is_active: boolean }[]
      }
      return ((data ?? []) as unknown as Raw[])
        .map((p) => {
          // Variante ancla: la activa (los serializados tienen una sola).
          const anchor = p.variants.find((v) => v.is_active) ?? p.variants[0]
          return anchor
            ? { id: p.id, name: p.name, brand: p.brand, suggested_price: p.suggested_price, variant_id: anchor.id }
            : null
        })
        .filter((t): t is SerializedTemplate => t !== null)
    },
    enabled: enabled && !!storeId,
    staleTime: 10_000,
  })
}

// Sugerencias para el datalist de variant_label: etiquetas ya usadas en la tienda
// (autoconstruye el catálogo, sin config aparte). Distintas, no vacías.
export function useVariantLabelSuggestions() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['variant-label-suggestions', storeId],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('units')
        .select('variant_label')
        .eq('store_id' as never, storeId)
        .not('variant_label' as never, 'is', null)
        .limit(500)
      if (error) throw error
      const set = new Set<string>()
      for (const r of (data ?? []) as { variant_label: string | null }[]) {
        const v = r.variant_label?.trim()
        if (v) set.add(v)
      }
      return [...set].sort()
    },
    enabled: !!storeId,
    staleTime: 60_000,
  })
}
