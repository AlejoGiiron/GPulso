import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import type { Store, Profile } from '@/types/database.types'
import type { StoreConfig } from '@/types/config.types'
import { migrateLegacyPaymentMethods } from '@/lib/paymentMethods'
import { DEFAULT_SIZE_TYPES } from '@/lib/sizeTypes'
import { DEFAULT_LABEL_SIZES, DEFAULT_LABEL_SIZE_ID, findLabelSize } from '@/lib/labelSizes'
import { DEFAULT_RECEIPT_WIDTH, isReceiptWidth } from '@/lib/receiptLayout'
import {
  DEFAULT_CONTINUOUS_GAP_MM,
  DEFAULT_LABEL_MAX_WIDTH_MM,
  DEFAULT_LABEL_MEDIA,
  MAX_LABEL_GAP_MM,
  isLabelMedia,
} from '@/lib/labelLayout'

export const DEFAULT_CONFIG: StoreConfig = {
  timezone: 'America/Bogota',
  currency: 'COP',
  size_types: DEFAULT_SIZE_TYPES,
  colors: [
    { name: 'Negro', hex: '#000000' },
    { name: 'Blanco', hex: '#ffffff' },
    { name: 'Gris', hex: '#9ca3af' },
    { name: 'Azul', hex: '#3b82f6' },
    { name: 'Rojo', hex: '#ef4444' },
    { name: 'Verde', hex: '#22c55e' },
    { name: 'Amarillo', hex: '#eab308' },
    { name: 'Naranja', hex: '#f97316' },
    { name: 'Violeta', hex: '#8b5cf6' },
    { name: 'Rosa', hex: '#ec4899' },
    { name: 'Café', hex: '#92400e' },
    { name: 'Beige', hex: '#d4b483' },
  ],
  brands: [],
  return_days_limit: 30,
  adjustment_reasons: ['Ingreso de mercancía', 'Ajuste por conteo', 'Merma', 'Otro'],
  payment_methods: ['cash', 'card', 'transfer', 'addi'],
  expense_reasons: ['Mercado', 'Servicios', 'Domicilio', 'Imprevisto', 'Otro'],
  payment_qr_url: null,
  label_sizes: DEFAULT_LABEL_SIZES,
  label_default_size_id: DEFAULT_LABEL_SIZE_ID,
  label_fields: { name: true, price: true, size_color: false, brand: false, sku: false },
  layaway_initial_payment_mode: 'none',
  layaway_initial_payment_value: 0,
  layaway_default_days: 90,
  // Default seguro: 0 = no se permite descuento hasta que el admin lo configure.
  max_item_discount: 0,
  layaway_discount_mode: 'none',
  layaway_discount_value: 0,
  // Comisiones por crédito: $100.000 total, reparto 50/50 (editable en Config).
  commission_default_amount: 100000,
  commission_worker_share: 0.5,
  receipt_width_mm: DEFAULT_RECEIPT_WIDTH,
  label_media: DEFAULT_LABEL_MEDIA,
  label_gap_mm: DEFAULT_CONTINUOUS_GAP_MM,
  label_max_width_mm: DEFAULT_LABEL_MAX_WIDTH_MM,
}

export function resolveConfig(raw: Record<string, unknown> | null | undefined): StoreConfig {
  if (!raw) return { ...DEFAULT_CONFIG }
  const r = raw as Partial<StoreConfig> & { nequi_qr_url?: string | null }
  const legacyMethods = Array.isArray(r.payment_methods)
    ? migrateLegacyPaymentMethods(r.payment_methods)
    : DEFAULT_CONFIG.payment_methods
  const legacyQrUrl =
    r.payment_qr_url !== undefined ? r.payment_qr_url : (r.nequi_qr_url ?? null)
  // Tamaños de etiqueta: seeding de los 3 base si la tienda no tiene ninguno.
  const labelSizes =
    Array.isArray(r.label_sizes) && r.label_sizes.length > 0
      ? r.label_sizes
      : DEFAULT_LABEL_SIZES
  // Predeterminado: usa el id guardado; si no, mapea el label_format legacy
  // (cuyos valores '38x25'/'50x30'/'58x40' son los ids de los base); valida
  // que exista y, si no, cae al primer tamaño disponible.
  const defaultCandidate = r.label_default_size_id ?? r.label_format ?? DEFAULT_LABEL_SIZE_ID
  const labelDefaultSizeId = findLabelSize(labelSizes, defaultCandidate)
    ? defaultCandidate
    : labelSizes[0].id
  return {
    ...DEFAULT_CONFIG,
    ...r,
    colors: Array.isArray(r.colors) ? r.colors : DEFAULT_CONFIG.colors,
    size_types:
      Array.isArray(r.size_types) && r.size_types.length > 0
        ? r.size_types
        : DEFAULT_CONFIG.size_types,
    brands: Array.isArray(r.brands) ? r.brands : DEFAULT_CONFIG.brands,
    adjustment_reasons: Array.isArray(r.adjustment_reasons)
      ? r.adjustment_reasons
      : DEFAULT_CONFIG.adjustment_reasons,
    expense_reasons:
      Array.isArray(r.expense_reasons) && r.expense_reasons.length > 0
        ? r.expense_reasons
        : DEFAULT_CONFIG.expense_reasons,
    payment_methods: legacyMethods,
    payment_qr_url: legacyQrUrl,
    label_sizes: labelSizes,
    label_default_size_id: labelDefaultSizeId,
    label_fields: r.label_fields
      ? { ...DEFAULT_CONFIG.label_fields, ...r.label_fields }
      : DEFAULT_CONFIG.label_fields,
    // Solo 58 u 80; cualquier otro valor (o ausente) imprime como siempre, a 80.
    receipt_width_mm: isReceiptWidth(r.receipt_width_mm)
      ? r.receipt_width_mm
      : DEFAULT_CONFIG.receipt_width_mm,
    label_media: isLabelMedia(r.label_media) ? r.label_media : DEFAULT_CONFIG.label_media,
    label_gap_mm:
      typeof r.label_gap_mm === 'number' && Number.isFinite(r.label_gap_mm)
        ? Math.min(MAX_LABEL_GAP_MM, Math.max(0, r.label_gap_mm))
        : DEFAULT_CONFIG.label_gap_mm,
    // Entre 20 y 120mm; fuera de eso es un dato corrupto → default.
    label_max_width_mm:
      typeof r.label_max_width_mm === 'number' &&
      r.label_max_width_mm >= 20 &&
      r.label_max_width_mm <= 120
        ? r.label_max_width_mm
        : DEFAULT_CONFIG.label_max_width_mm,
  }
}

/**
 * Devuelve la configuración resuelta (con defaults aplicados) de la tienda
 * activa. Unifica el patrón `resolveConfig(store?.config)` repetido en toda la
 * app y memoiza el resultado por referencia de la tienda para no recrear el
 * objeto en cada render (estabiliza dependencias de useMemo/useEffect).
 */
export function useResolvedConfig(): StoreConfig {
  const { data: store } = useStoreConfig()
  return useMemo(() => resolveConfig(store?.config ?? null), [store])
}

export function useStoreConfig() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<Store>({
    queryKey: ['store', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('id' as never, storeId)
        .single()
      if (error) throw error
      return data as unknown as Store
    },
    enabled: !!storeId,
    staleTime: 5 * 60 * 1_000,
  })
}

export function useStoreUsers() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<Profile[]>({
    queryKey: ['store-users', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('store_id' as never, storeId)
        .order('full_name' as never)
      if (error) throw error
      return (data ?? []) as unknown as Profile[]
    },
    enabled: !!storeId,
    staleTime: 5 * 60 * 1_000,
  })
}
