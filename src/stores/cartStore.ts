import { create } from 'zustand'
import { isValidGiftReason } from '@/lib/giftReasons'

export interface CartItem {
  variant_id: string
  product_id: string
  name: string
  brand: string | null
  size: string | null
  color: string | null
  // Fase 2: línea de EQUIPO serializado. unit_id/serial identifican la unidad
  // EXACTA vendida. Para accesorios ambos van null. Una unidad = una línea
  // (qty fija en 1, sin stepper). La identidad de línea es lineKey().
  unit_id: string | null
  serial: string | null
  // Precio FINAL editable (con descuento por ítem aplicado). Arranca igual a
  // list_price (sin descuento) y se baja con setItemPrice respetando el tope.
  unit_price: number
  // Precio de catálogo del ítem (referencia para el tope y el tachado).
  list_price: number
  qty: number
  stock_qty: number
  // Regalo (cortesía $0). Requiere permiso ventas.regalo en la UI. Cuando
  // isGift=true: unit_price=0 y giftReason es uno de la lista de giftReasons
  // (coherente con el CHECK order_items_gift_coherent de la 027).
  isGift: boolean
  giftReason: string | null
  // unit_price que tenía la línea ANTES de marcarla como regalo (preserva un
  // descuento por ítem previo). Se restaura al desmarcar. null si no aplica.
  prevUnitPrice: number | null
}

// Precio final mínimo permitido para un ítem dado el tope (en pesos):
// minFinal = max(0, list_price - tope). El tope (max_item_discount) vive en la
// config; se pasa como argumento para que el store garantice el clamp.
export function minFinalPrice(listPrice: number, maxItemDiscount: number): number {
  return Math.max(0, listPrice - Math.max(0, maxItemDiscount))
}

// Clampa un precio final propuesto al rango permitido [minFinal, list_price].
export function clampItemPrice(
  finalPrice: number,
  listPrice: number,
  maxItemDiscount: number,
): number {
  const min = minFinalPrice(listPrice, maxItemDiscount)
  const fp = Number.isFinite(finalPrice) ? finalPrice : listPrice
  return Math.round(Math.min(Math.max(fp, min), listPrice))
}

// Identidad de una línea del carrito: la unidad serializada si la hay, si no la
// variante. Un accesorio se agrupa por variante; cada equipo es su propia línea.
export function lineKey(item: Pick<CartItem, 'unit_id' | 'variant_id'>): string {
  return item.unit_id ?? item.variant_id
}

interface CartStore {
  items: CartItem[]
  customer_id: string | null
  addItem: (
    item: Omit<
      CartItem,
      | 'qty'
      | 'isGift'
      | 'giftReason'
      | 'prevUnitPrice'
      | 'unit_id'
      | 'serial'
      | 'unit_price'
    > & { unit_id?: string | null; serial?: string | null; unit_price?: number },
  ) => void
  // Todas las mutaciones de línea reciben la CLAVE de línea (lineKey): variant_id
  // para accesorios, unit_id para equipos.
  removeItem: (key: string) => void
  setQty: (key: string, qty: number) => void
  // Fija el precio FINAL de la línea, clampeado a [max(0, list-tope), list].
  setItemPrice: (
    key: string,
    finalPrice: number,
    maxItemDiscount: number,
  ) => void
  // Marca/desmarca la línea como regalo ($0). Al marcar guarda el precio
  // previo; al desmarcar lo restaura. Un motivo inválido no marca (defensa
  // de coherencia con el CHECK de la BD).
  setItemGift: (
    key: string,
    isGift: boolean,
    reason?: string | null,
  ) => void
  setCustomer: (id: string | null) => void
  clear: () => void
}

export const useCartStore = create<CartStore>((set) => ({
  items: [],
  customer_id: null,

  addItem: (newItem) =>
    set((s) => {
      const unit_id = newItem.unit_id ?? null
      const serial = newItem.serial ?? null

      // EQUIPO serializado: cada unidad es su propia línea, qty fija en 1. No se
      // agrupa; si la misma unidad ya está en el carrito, no se duplica.
      if (unit_id) {
        if (s.items.some((i) => i.unit_id === unit_id)) return s
        return {
          items: [
            ...s.items,
            {
              ...newItem,
              unit_id,
              serial,
              unit_price: newItem.list_price,
              qty: 1,
              stock_qty: 1, // una unidad; el stepper no aplica
              isGift: false,
              giftReason: null,
              prevUnitPrice: null,
            },
          ],
        }
      }

      // ACCESORIO: se agrupa por variante (comportamiento heredado).
      const existing = s.items.find(
        (i) => i.unit_id === null && i.variant_id === newItem.variant_id,
      )
      if (existing) {
        const next = Math.min(existing.qty + 1, newItem.stock_qty)
        return {
          items: s.items.map((i) =>
            i.unit_id === null && i.variant_id === newItem.variant_id
              ? { ...i, qty: next }
              : i,
          ),
        }
      }
      if (newItem.stock_qty <= 0) return s
      return {
        items: [
          ...s.items,
          {
            ...newItem,
            unit_id: null,
            serial: null,
            unit_price: newItem.list_price,
            qty: 1,
            isGift: false,
            giftReason: null,
            prevUnitPrice: null,
          },
        ],
      }
    }),

  removeItem: (key) =>
    set((s) => ({ items: s.items.filter((i) => lineKey(i) !== key) })),

  setQty: (key, qty) =>
    set((s) => {
      if (qty <= 0) return { items: s.items.filter((i) => lineKey(i) !== key) }
      return {
        items: s.items.map((i) =>
          lineKey(i) === key ? { ...i, qty: Math.min(qty, i.stock_qty) } : i,
        ),
      }
    }),

  setItemPrice: (key, finalPrice, maxItemDiscount) =>
    set((s) => ({
      items: s.items.map((i) =>
        lineKey(i) === key
          ? {
              ...i,
              unit_price: clampItemPrice(finalPrice, i.list_price, maxItemDiscount),
            }
          : i,
      ),
    })),

  setItemGift: (key, isGift, reason) =>
    set((s) => ({
      items: s.items.map((i) => {
        if (lineKey(i) !== key) return i
        if (isGift) {
          // Motivo inválido → no se marca (mantiene la coherencia del CHECK).
          if (!isValidGiftReason(reason ?? null)) return i
          return {
            ...i,
            isGift: true,
            giftReason: reason ?? null,
            // Solo captura el precio previo la PRIMERA vez (si ya era regalo,
            // conserva el prevUnitPrice original para no perderlo).
            prevUnitPrice: i.isGift ? i.prevUnitPrice : i.unit_price,
            unit_price: 0,
          }
        }
        // Desmarcar: restaura el precio previo (o el catálogo si no había).
        return {
          ...i,
          isGift: false,
          giftReason: null,
          unit_price: i.prevUnitPrice ?? i.list_price,
          prevUnitPrice: null,
        }
      }),
    })),

  setCustomer: (id) => set({ customer_id: id }),
  clear: () => set({ items: [], customer_id: null }),
}))

// Línea con precio catálogo y precio final, mínimo común para calcular totales.
// Tanto CartItem (POS) como DraftItem/NewLayawayItem (separados) la satisfacen,
// así que la misma fórmula sirve para ventas y separados.
export interface PricedLine {
  list_price: number
  unit_price: number
  qty: number
}

/**
 * Totales con descuento por ítem:
 *   subtotal    = Σ round(list_price · qty)   (valor de catálogo)
 *   total       = Σ round(unit_price · qty)    (valor final cobrado)
 *   discountAmt = subtotal − total             (descuento total, derivado)
 *
 * Se redondea por línea antes de sumar para que el cuadre sea exacto (sin
 * drift) y discountAmt = subtotal − total cierre siempre.
 */
export function cartTotals(items: PricedLine[]) {
  const subtotal = items.reduce((s, i) => s + Math.round(i.list_price * i.qty), 0)
  const total = items.reduce((s, i) => s + Math.round(i.unit_price * i.qty), 0)
  const discountAmt = Math.max(0, subtotal - total)
  return { subtotal, discountAmt, total }
}

/**
 * Totales DERIVADOS de una orden a partir de sus ítems (con list_price y
 * unit_price final) y el recargo. Reutiliza cartTotals para que la fórmula de
 * redondeo sea idéntica a la del carrito y el cuadre cierre exacto:
 *   subtotal = Σ round(list·qty)
 *   discount = subtotal − Σ round(unit·qty)   (derivado, ≥ 0)
 *   total    = Σ round(unit·qty) + surcharge
 */
export function orderTotals(items: PricedLine[], surcharge = 0) {
  const { subtotal, discountAmt, total } = cartTotals(items)
  const sc = Math.max(0, surcharge)
  return { subtotal, discount: discountAmt, surcharge: sc, total: total + sc }
}
