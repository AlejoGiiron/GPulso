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

// ── IMEIs de una venta (E3): serial por línea de order_items ────────────────
export function useOrderItemUnits(itemIds: string[]) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['units', 'by-order-items', [...itemIds].sort()],
    queryFn: async (): Promise<Record<string, string[]>> => {
      const { data, error } = await supabase
        .from('units')
        .select('serial, order_item_id')
        .eq('store_id' as never, storeId)
        .in('order_item_id' as never, itemIds as never)
      if (error) throw error
      const map: Record<string, string[]> = {}
      for (const u of (data ?? []) as { serial: string; order_item_id: string | null }[]) {
        if (u.order_item_id) (map[u.order_item_id] ??= []).push(u.serial)
      }
      return map
    },
    enabled: itemIds.length > 0 && !!storeId,
    staleTime: 15_000,
  })
}

// ── Equipos comprados por un cliente (E2) ───────────────────────────────────
export interface CustomerUnit {
  unit_id: string
  serial: string
  name: string
  brand: string | null
  size: string | null
  color: string | null
  order_number: number | null
  bought_at: string
}

// Unidades que el cliente posee HOY (vendidas y ligadas a una orden suya). Si se
// devolvió, la unidad se desliga (A6) y deja de aparecer → "equipos comprados"
// = actualmente en su poder. Robusto en 3 consultas acotadas (sin N+1).
export function useCustomerUnits(customerId: string | null) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['units', 'by-customer', customerId],
    queryFn: async (): Promise<CustomerUnit[]> => {
      if (!customerId) return []
      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_number, created_at')
        .eq('store_id' as never, storeId)
        .eq('customer_id' as never, customerId as never)
      const orderList = (orders ?? []) as { id: string; order_number: number; created_at: string }[]
      if (orderList.length === 0) return []
      const orderById = new Map(orderList.map((o) => [o.id, o]))

      const { data: itemsData } = await supabase
        .from('order_items')
        .select('id, order_id')
        .in('order_id' as never, orderList.map((o) => o.id) as never)
      const items = (itemsData ?? []) as { id: string; order_id: string }[]
      if (items.length === 0) return []
      const orderByItem = new Map(items.map((it) => [it.id, it.order_id]))

      const { data: unitsData } = await supabase
        .from('units')
        .select('id, serial, order_item_id, variants!inner(size, color, products!inner(name, brand))')
        .eq('store_id' as never, storeId)
        .eq('status' as never, 'vendida')
        .in('order_item_id' as never, items.map((it) => it.id) as never)
      const units = (unitsData ?? []) as unknown as {
        id: string; serial: string; order_item_id: string | null
        variants: { size: string | null; color: string | null; products: { name: string; brand: string | null } }
      }[]

      return units.map((u) => {
        const oid = u.order_item_id ? orderByItem.get(u.order_item_id) : undefined
        const o = oid ? orderById.get(oid) : undefined
        return {
          unit_id: u.id,
          serial: u.serial,
          name: u.variants.products.name,
          brand: u.variants.products.brand,
          size: u.variants.size,
          color: u.variants.color,
          order_number: o?.order_number ?? null,
          bought_at: o?.created_at ?? '',
        }
      })
    },
    enabled: !!customerId && !!storeId,
    staleTime: 15_000,
  })
}

// ── Ficha de unidad con línea de tiempo (E1) ────────────────────────────────
export interface UnitTimelineEvent {
  kind: 'ingreso' | 'venta' | 'devolucion'
  at: string
  label: string
  detail: string | null
}
export interface UnitDetail {
  unit_id: string
  serial: string
  status: UnitStatus
  cost: number | null
  name: string
  brand: string | null
  size: string | null
  color: string | null
  origin: string | null
  events: UnitTimelineEvent[]
}

export function useUnitDetail(unitId: string | null) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['units', 'detail', unitId],
    queryFn: async (): Promise<UnitDetail | null> => {
      if (!unitId) return null
      // 1) Unidad + variante/producto + origen (factura).
      const { data: uData, error: uErr } = await supabase
        .from('units')
        .select(
          `id, serial, status, cost, created_at, notas,
           variants!inner(size, color, products!inner(name, brand)),
           purchase_invoice_items(purchase_invoices(invoice_number))`,
        )
        .eq('id' as never, unitId as never)
        .eq('store_id' as never, storeId)
        .maybeSingle()
      if (uErr || !uData) return null
      const u = uData as unknown as {
        id: string; serial: string; status: UnitStatus; cost: number | null
        created_at: string; notas: string | null
        variants: { size: string | null; color: string | null; products: { name: string; brand: string | null } }
        purchase_invoice_items: { purchase_invoices: { invoice_number: string } | null } | null
      }

      // 2) Movimientos de la unidad (venta/devolución) + vendedor.
      const { data: mData } = await supabase
        .from('stock_movements')
        .select('id, type, created_at, reference_id, created_by, profiles:created_by(full_name)')
        .eq('unit_id' as never, unitId as never)
        .in('type' as never, ['sale', 'return'] as never)
        .order('created_at' as never, { ascending: true })
      const movements = (mData ?? []) as unknown as {
        type: 'sale' | 'return'; created_at: string; reference_id: string | null
        profiles: { full_name: string } | null
      }[]

      // 3) Órdenes de las ventas (cliente + número).
      const orderIds = movements.filter((m) => m.type === 'sale').map((m) => m.reference_id).filter(Boolean) as string[]
      const orderInfo: Record<string, { number: number; customer: string | null }> = {}
      if (orderIds.length > 0) {
        const { data: oData } = await supabase
          .from('orders')
          .select('id, order_number, customers(full_name)')
          .in('id' as never, orderIds as never)
        for (const o of (oData ?? []) as unknown as { id: string; order_number: number; customers: { full_name: string } | null }[]) {
          orderInfo[o.id] = { number: o.order_number, customer: o.customers?.full_name ?? null }
        }
      }

      const origin =
        u.purchase_invoice_items?.purchase_invoices?.invoice_number
          ? `Compra · Fac. ${u.purchase_invoice_items.purchase_invoices.invoice_number}`
          : u.notas
            ? 'Ingreso manual'
            : null

      const events: UnitTimelineEvent[] = [
        { kind: 'ingreso', at: u.created_at, label: 'Ingreso', detail: origin },
        ...movements.map<UnitTimelineEvent>((m) => {
          if (m.type === 'sale') {
            const info = m.reference_id ? orderInfo[m.reference_id] : undefined
            return {
              kind: 'venta',
              at: m.created_at,
              label: info ? `Venta · Orden #${info.number}` : 'Venta',
              detail: [info?.customer ? `Cliente: ${info.customer}` : null, m.profiles?.full_name ? `Vendió: ${m.profiles.full_name}` : null]
                .filter(Boolean)
                .join(' · ') || null,
            }
          }
          return { kind: 'devolucion', at: m.created_at, label: 'Devolución', detail: m.profiles?.full_name ? `Recibió: ${m.profiles.full_name}` : null }
        }),
      ]

      return {
        unit_id: u.id,
        serial: u.serial,
        status: u.status,
        cost: u.cost,
        name: u.variants.products.name,
        brand: u.variants.products.brand,
        size: u.variants.size,
        color: u.variants.color,
        origin,
        events,
      }
    },
    enabled: !!unitId && !!storeId,
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
