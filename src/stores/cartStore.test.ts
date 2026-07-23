import { describe, it, expect, beforeEach } from 'vitest'
import {
  cartTotals,
  orderTotals,
  clampItemPrice,
  minFinalPrice,
  lineKey,
  useCartStore,
  type CartItem,
} from './cartStore'

function item(
  fields: Partial<CartItem> & { list_price: number; qty: number },
): CartItem {
  return {
    variant_id: fields.variant_id ?? 'v1',
    product_id: fields.product_id ?? 'p1',
    name: fields.name ?? 'Producto',
    brand: fields.brand ?? null,
    size: fields.size ?? null,
    color: fields.color ?? null,
    variant_label: fields.variant_label ?? null,
    unit_id: fields.unit_id ?? null,
    serial: fields.serial ?? null,
    // Por defecto sin descuento: unit_price = list_price.
    unit_price: fields.unit_price ?? fields.list_price,
    list_price: fields.list_price,
    qty: fields.qty,
    stock_qty: fields.stock_qty ?? 99,
    isGift: fields.isGift ?? false,
    giftReason: fields.giftReason ?? null,
    prevUnitPrice: fields.prevUnitPrice ?? null,
  }
}

// ── cartTotals ────────────────────────────────────────────────────────────────

describe('cartTotals', () => {
  it('carrito vacío devuelve subtotal, descuento y total en 0', () => {
    expect(cartTotals([])).toEqual({ subtotal: 0, discountAmt: 0, total: 0 })
  })

  it('ítem sin descuento (unit = list): subtotal = total, descuento 0', () => {
    const items = [item({ list_price: 10_000, qty: 2 })]
    expect(cartTotals(items)).toEqual({
      subtotal: 20_000,
      discountAmt: 0,
      total: 20_000,
    })
  })

  it('varios ítems sin descuento suman bien', () => {
    const items = [
      item({ variant_id: 'a', list_price: 15_000, qty: 1 }),
      item({ variant_id: 'b', list_price: 25_000, qty: 2 }),
      item({ variant_id: 'c', list_price: 5_000, qty: 3 }),
    ]
    // 15.000 + 50.000 + 15.000 = 80.000
    const t = cartTotals(items)
    expect(t.subtotal).toBe(80_000)
    expect(t.total).toBe(80_000)
    expect(t.discountAmt).toBe(0)
  })

  it('descuento por línea: subtotal catálogo, total final, descuento derivado', () => {
    // Catálogo 50.000, vendido a 30.000, qty 2.
    const items = [item({ list_price: 50_000, unit_price: 30_000, qty: 2 })]
    const t = cartTotals(items)
    expect(t.subtotal).toBe(100_000) // 50.000 · 2
    expect(t.total).toBe(60_000) // 30.000 · 2
    expect(t.discountAmt).toBe(40_000) // 100.000 − 60.000
  })

  it('varios ítems con distintos descuentos por línea', () => {
    const items = [
      item({ variant_id: 'a', list_price: 50_000, unit_price: 30_000, qty: 1 }), // -20.000
      item({ variant_id: 'b', list_price: 20_000, unit_price: 20_000, qty: 2 }), // sin desc
      item({ variant_id: 'c', list_price: 40_000, unit_price: 35_000, qty: 1 }), // -5.000
    ]
    const t = cartTotals(items)
    expect(t.subtotal).toBe(50_000 + 40_000 + 40_000) // 130.000
    expect(t.total).toBe(30_000 + 40_000 + 35_000) // 105.000
    expect(t.discountAmt).toBe(25_000)
  })

  it('redondeo: total = Σ round(unit·qty), discount = subtotal − total', () => {
    const items = [
      item({ variant_id: 'a', list_price: 1_500.5, unit_price: 1_000.5, qty: 2 }),
      item({ variant_id: 'b', list_price: 999.99, unit_price: 999.99, qty: 3 }),
    ]
    // subtotal = round(3001) + round(2999.97) = 3001 + 3000 = 6001
    // total    = round(2001) + round(2999.97) = 2001 + 3000 = 5001
    const t = cartTotals(items)
    expect(t.subtotal).toBe(6_001)
    expect(t.total).toBe(5_001)
    expect(t.discountAmt).toBe(1_000)
    // El descuento cierra exacto: subtotal − total
    expect(t.discountAmt).toBe(t.subtotal - t.total)
  })
})

// ── orderTotals (derivación de la orden) ──────────────────────────────────────

describe('orderTotals', () => {
  it('deriva subtotal catálogo, descuento y total sin recargo', () => {
    const items = [
      item({ variant_id: 'a', list_price: 50_000, unit_price: 30_000, qty: 2 }), // -40.000
      item({ variant_id: 'b', list_price: 20_000, unit_price: 20_000, qty: 1 }), // sin desc
    ]
    const r = orderTotals(items)
    expect(r.subtotal).toBe(120_000) // 50k·2 + 20k
    expect(r.discount).toBe(40_000) // subtotal − Σ unit·qty (80.000)
    expect(r.surcharge).toBe(0)
    expect(r.total).toBe(80_000) // Σ unit·qty + 0
    // El descuento cierra exacto: subtotal − total_productos
    expect(r.discount).toBe(r.subtotal - (r.total - r.surcharge))
  })

  it('suma el recargo al total sin afectar subtotal/descuento', () => {
    const items = [item({ list_price: 50_000, unit_price: 30_000, qty: 1 })]
    const r = orderTotals(items, 15_000)
    expect(r.subtotal).toBe(50_000)
    expect(r.discount).toBe(20_000)
    expect(r.surcharge).toBe(15_000)
    expect(r.total).toBe(45_000) // 30.000 final + 15.000 recargo
  })

  it('recargo negativo se trata como 0', () => {
    const items = [item({ list_price: 10_000, unit_price: 10_000, qty: 1 })]
    const r = orderTotals(items, -5_000)
    expect(r.surcharge).toBe(0)
    expect(r.total).toBe(10_000)
  })

  it('redondeo exacto: discount = subtotal − total_productos', () => {
    const items = [
      item({ variant_id: 'a', list_price: 1_500.5, unit_price: 1_000.5, qty: 2 }),
      item({ variant_id: 'b', list_price: 999.99, unit_price: 999.99, qty: 3 }),
    ]
    const r = orderTotals(items, 100)
    const totalProductos = r.total - r.surcharge
    expect(r.subtotal).toBe(6_001) // round(3001)+round(2999.97)
    expect(totalProductos).toBe(5_001) // round(2001)+round(2999.97)
    expect(r.discount).toBe(1_000)
    expect(r.discount).toBe(r.subtotal - totalProductos)
  })

  it('acepta líneas mínimas (PricedLine), como las del separado', () => {
    // DraftItem/NewLayawayItem no son CartItem completos: basta con
    // list_price/unit_price/qty (la firma PricedLine).
    const lines = [
      { list_price: 50_000, unit_price: 30_000, qty: 2 },
      { list_price: 20_000, unit_price: 20_000, qty: 1 },
    ]
    const r = orderTotals(lines) // separados: sin recargo
    expect(r.subtotal).toBe(120_000)
    expect(r.discount).toBe(40_000)
    expect(r.surcharge).toBe(0)
    expect(r.total).toBe(80_000)
  })
})

// ── clamp del tope (función pura) ─────────────────────────────────────────────

describe('clampItemPrice / minFinalPrice (tope)', () => {
  it('minFinalPrice = max(0, list − tope)', () => {
    expect(minFinalPrice(50_000, 30_000)).toBe(20_000)
    expect(minFinalPrice(25_000, 30_000)).toBe(0) // tope mayor que el precio
    expect(minFinalPrice(50_000, 0)).toBe(50_000) // sin descuento
  })

  it('clampa al mínimo: no se puede bajar por debajo de (list − tope)', () => {
    // list 50.000, tope 30.000 → mínimo 20.000
    expect(clampItemPrice(10_000, 50_000, 30_000)).toBe(20_000)
  })

  it('clampa al catálogo: no se puede subir por encima de list', () => {
    expect(clampItemPrice(60_000, 50_000, 30_000)).toBe(50_000)
  })

  it('tope = 0 → el precio final queda fijo en list', () => {
    expect(clampItemPrice(10_000, 50_000, 0)).toBe(50_000)
    expect(clampItemPrice(50_000, 50_000, 0)).toBe(50_000)
  })

  it('tope ≥ list → el precio final puede llegar a 0', () => {
    expect(clampItemPrice(0, 25_000, 30_000)).toBe(0)
    expect(clampItemPrice(5_000, 25_000, 30_000)).toBe(5_000)
  })

  it('valor no finito cae al catálogo (sin descuento)', () => {
    expect(clampItemPrice(NaN, 50_000, 30_000)).toBe(50_000)
  })
})

// ── setItemPrice (acción del store) ───────────────────────────────────────────

describe('useCartStore.setItemPrice', () => {
  beforeEach(() => {
    useCartStore.setState({ items: [], customer_id: null })
  })

  function addCatalogItem(variant_id: string, listPrice: number, stock = 99) {
    useCartStore.getState().addItem({
      variant_id,
      product_id: 'p1',
      name: 'Producto',
      brand: null,
      size: null,
      color: null,
      unit_price: listPrice,
      list_price: listPrice,
      stock_qty: stock,
    })
  }

  it('un ítem nuevo arranca con unit_price = list_price', () => {
    addCatalogItem('a', 50_000)
    expect(useCartStore.getState().items[0].unit_price).toBe(50_000)
  })

  it('aplica el precio final clampeado al mínimo del tope', () => {
    addCatalogItem('a', 50_000)
    useCartStore.getState().setItemPrice('a', 10_000, 30_000) // mínimo 20.000
    expect(useCartStore.getState().items[0].unit_price).toBe(20_000)
  })

  it('clampa al catálogo si se intenta subir el precio', () => {
    addCatalogItem('a', 50_000)
    useCartStore.getState().setItemPrice('a', 70_000, 30_000)
    expect(useCartStore.getState().items[0].unit_price).toBe(50_000)
  })

  it('tope 0 → no se puede modificar (queda en list)', () => {
    addCatalogItem('a', 50_000)
    useCartStore.getState().setItemPrice('a', 30_000, 0)
    expect(useCartStore.getState().items[0].unit_price).toBe(50_000)
  })

  it('tope ≥ list → permite llegar a 0', () => {
    addCatalogItem('a', 25_000)
    useCartStore.getState().setItemPrice('a', 0, 30_000)
    expect(useCartStore.getState().items[0].unit_price).toBe(0)
  })

  it('solo afecta la línea del variant indicado', () => {
    addCatalogItem('a', 50_000)
    addCatalogItem('b', 40_000)
    useCartStore.getState().setItemPrice('a', 30_000, 30_000)
    const items = useCartStore.getState().items
    expect(items.find((i) => i.variant_id === 'a')!.unit_price).toBe(30_000)
    expect(items.find((i) => i.variant_id === 'b')!.unit_price).toBe(40_000)
  })

  it('un ítem nuevo arranca sin regalo', () => {
    addCatalogItem('a', 50_000)
    const it0 = useCartStore.getState().items[0]
    expect(it0.isGift).toBe(false)
    expect(it0.giftReason).toBe(null)
    expect(it0.prevUnitPrice).toBe(null)
  })
})

// ── setItemGift (marcar/desmarcar regalo) ─────────────────────────────────────

describe('useCartStore.setItemGift', () => {
  beforeEach(() => {
    useCartStore.setState({ items: [], customer_id: null })
  })

  function addCatalogItem(variant_id: string, listPrice: number, stock = 99) {
    useCartStore.getState().addItem({
      variant_id,
      product_id: 'p1',
      name: 'Producto',
      brand: null,
      size: null,
      color: null,
      unit_price: listPrice,
      list_price: listPrice,
      stock_qty: stock,
    })
  }

  it('marcar regalo: unit_price 0 + motivo + guarda el precio previo', () => {
    addCatalogItem('a', 50_000)
    useCartStore.getState().setItemGift('a', true, 'regalo')
    const it0 = useCartStore.getState().items[0]
    expect(it0.isGift).toBe(true)
    expect(it0.giftReason).toBe('regalo')
    expect(it0.unit_price).toBe(0)
    expect(it0.prevUnitPrice).toBe(50_000)
  })

  it('desmarcar restaura el precio de catálogo', () => {
    addCatalogItem('a', 50_000)
    useCartStore.getState().setItemGift('a', true, 'muestra')
    useCartStore.getState().setItemGift('a', false)
    const it0 = useCartStore.getState().items[0]
    expect(it0.isGift).toBe(false)
    expect(it0.giftReason).toBe(null)
    expect(it0.unit_price).toBe(50_000)
    expect(it0.prevUnitPrice).toBe(null)
  })

  it('preserva el descuento por ítem al marcar y desmarcar regalo', () => {
    addCatalogItem('a', 50_000)
    // Descuento por ítem: baja a 30.000
    useCartStore.getState().setItemPrice('a', 30_000, 30_000)
    // Marcar regalo → 0, guardando 30.000
    useCartStore.getState().setItemGift('a', true, 'promocion')
    expect(useCartStore.getState().items[0].unit_price).toBe(0)
    expect(useCartStore.getState().items[0].prevUnitPrice).toBe(30_000)
    // Desmarcar → vuelve al 30.000 con descuento, no al catálogo
    useCartStore.getState().setItemGift('a', false)
    expect(useCartStore.getState().items[0].unit_price).toBe(30_000)
  })

  it('motivo inválido no marca el ítem como regalo', () => {
    addCatalogItem('a', 50_000)
    useCartStore.getState().setItemGift('a', true, 'inventado')
    const it0 = useCartStore.getState().items[0]
    expect(it0.isGift).toBe(false)
    expect(it0.unit_price).toBe(50_000)
  })

  it('sin motivo (undefined) no marca el ítem como regalo', () => {
    addCatalogItem('a', 50_000)
    useCartStore.getState().setItemGift('a', true)
    expect(useCartStore.getState().items[0].isGift).toBe(false)
  })

  it('re-marcar con otro motivo conserva el precio previo original', () => {
    addCatalogItem('a', 50_000)
    useCartStore.getState().setItemPrice('a', 40_000, 30_000)
    useCartStore.getState().setItemGift('a', true, 'regalo')
    // Cambiar el motivo sin desmarcar
    useCartStore.getState().setItemGift('a', true, 'compensacion')
    const it0 = useCartStore.getState().items[0]
    expect(it0.giftReason).toBe('compensacion')
    expect(it0.unit_price).toBe(0)
    // prevUnitPrice sigue siendo el 40.000 original, no 0
    expect(it0.prevUnitPrice).toBe(40_000)
  })

  it('solo afecta la línea indicada', () => {
    addCatalogItem('a', 50_000)
    addCatalogItem('b', 40_000)
    useCartStore.getState().setItemGift('a', true, 'regalo')
    const items = useCartStore.getState().items
    expect(items.find((i) => i.variant_id === 'a')!.isGift).toBe(true)
    expect(items.find((i) => i.variant_id === 'b')!.isGift).toBe(false)
  })
})

// ── Carrito con equipos serializados (Fase 2) ─────────────────────────────────

describe('useCartStore — equipos serializados', () => {
  beforeEach(() => {
    useCartStore.setState({ items: [], customer_id: null })
  })

  it('lineKey usa unit_id si lo hay, si no variant_id', () => {
    expect(lineKey({ unit_id: 'u1', variant_id: 'v1' })).toBe('u1')
    expect(lineKey({ unit_id: null, variant_id: 'v1' })).toBe('v1')
  })

  it('dos unidades de la MISMA variante son dos líneas (no se agrupan)', () => {
    const base = { product_id: 'p1', name: 'iPhone', brand: null, size: '128GB', color: 'Azul', list_price: 1_000_000, stock_qty: 2 }
    useCartStore.getState().addItem({ ...base, variant_id: 'v1', unit_id: 'u1', serial: 'IMEI-1' })
    useCartStore.getState().addItem({ ...base, variant_id: 'v1', unit_id: 'u2', serial: 'IMEI-2' })
    const items = useCartStore.getState().items
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.qty === 1)).toBe(true)
  })

  it('agregar la MISMA unidad dos veces no la duplica', () => {
    const u = { product_id: 'p1', name: 'iPhone', brand: null, size: null, color: null, list_price: 1_000_000, stock_qty: 1, variant_id: 'v1', unit_id: 'u1', serial: 'IMEI-1' }
    useCartStore.getState().addItem(u)
    useCartStore.getState().addItem(u)
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().items[0].qty).toBe(1)
  })

  it('setQty sobre un equipo se clampa a 1 (sin stepper)', () => {
    useCartStore.getState().addItem({ product_id: 'p1', name: 'iPhone', brand: null, size: null, color: null, list_price: 1_000_000, stock_qty: 1, variant_id: 'v1', unit_id: 'u1', serial: 'IMEI-1' })
    useCartStore.getState().setQty('u1', 5)
    expect(useCartStore.getState().items[0].qty).toBe(1)
  })

  it('removeItem por unit_id quita solo esa unidad', () => {
    const base = { product_id: 'p1', name: 'iPhone', brand: null, size: null, color: null, list_price: 1_000_000, stock_qty: 2 }
    useCartStore.getState().addItem({ ...base, variant_id: 'v1', unit_id: 'u1', serial: 'IMEI-1' })
    useCartStore.getState().addItem({ ...base, variant_id: 'v1', unit_id: 'u2', serial: 'IMEI-2' })
    useCartStore.getState().removeItem('u1')
    const items = useCartStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].unit_id).toBe('u2')
  })

  it('un accesorio (unit_id null) sigue agrupándose por variante', () => {
    const acc = { product_id: 'p2', name: 'Cargador', brand: null, size: null, color: null, list_price: 50_000, stock_qty: 10, variant_id: 'va' }
    useCartStore.getState().addItem(acc)
    useCartStore.getState().addItem(acc)
    const items = useCartStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].qty).toBe(2)
  })
})
