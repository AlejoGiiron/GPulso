import { describe, expect, it } from 'vitest'
import { buildReturnReceiptData, returnReference, type BuildReturnReceiptInput } from './returnReceipt'

const order: BuildReturnReceiptInput['order'] = {
  order_number: 54,
  customer: { full_name: 'Cliente Prueba', phone: '3000000000' },
  items: [
    { id: 'oi-1', variant_id: 'v-1', product_name: 'AIRPODS PRO 2', brand: 'Iphone', size: null, color: null, unit_price: 110000 },
    { id: 'oi-2', variant_id: 'v-2', product_name: 'CABLE USB-TC 5A', brand: 'ATB', size: null, color: 'Negro', unit_price: 15000 },
  ],
}

function input(over: Partial<BuildReturnReceiptInput> = {}): BuildReturnReceiptInput {
  return {
    kind: 'return',
    returnId: '3f1c2b9a-0000-4000-8000-00000abc12de',
    createdAt: '2026-09-28T20:12:00Z',
    order,
    returnQtys: { 'v-1': 1 },
    exchangeItems: [],
    exchange: { difference: 0, orderTotal: 0, refundDue: 0 },
    methodLabel: 'Efectivo',
    ...over,
  }
}

describe('buildReturnReceiptData', () => {
  it('devolución: solo los ítems con cantidad devuelta y reembolso = precio pagado × cantidad', () => {
    const d = buildReturnReceiptData(input({ returnQtys: { 'v-1': 1, 'v-2': 0 } }))
    expect(d.returned.map((l) => l.name)).toEqual(['AIRPODS PRO 2'])
    expect(d.refundTotal).toBe(110000)
    expect(d.newItems).toEqual([])
    expect(d.order_number).toBe(54)
  })

  it('suma varias unidades de varios ítems', () => {
    const d = buildReturnReceiptData(input({ returnQtys: { 'v-1': 1, 'v-2': 2 } }))
    expect(d.refundTotal).toBe(110000 + 2 * 15000)
  })

  it('cambio más caro: muestra el cobro al cliente (orderTotal neteado)', () => {
    const d = buildReturnReceiptData(
      input({
        kind: 'exchange',
        returnQtys: { 'v-2': 1 },
        exchangeItems: [
          { variant_id: 'v-9', product_name: 'CARGADOR TC-IP', size: null, color: null, qty: 1, list_price: 50000 },
        ],
        exchange: { difference: 35000, orderTotal: 35000, refundDue: 0 },
      }),
    )
    expect(d.newItems).toHaveLength(1)
    expect(d.newItems[0].unitPrice).toBe(50000)
    expect(d.exchangeDifference).toBe(35000)
    expect(d.exchangeAmount).toBe(35000)
  })

  it('cambio más barato: muestra lo que devuelve la tienda (refundDue)', () => {
    const d = buildReturnReceiptData(
      input({
        kind: 'exchange',
        exchange: { difference: -60000, orderTotal: 0, refundDue: 60000 },
      }),
    )
    expect(d.exchangeAmount).toBe(60000)
  })

  it('cambio sin diferencia: monto 0', () => {
    const d = buildReturnReceiptData(input({ kind: 'exchange' }))
    expect(d.exchangeAmount).toBe(0)
  })

  it('en una devolución ignora los ítems de cambio aunque vengan', () => {
    const d = buildReturnReceiptData(
      input({
        exchangeItems: [{ variant_id: 'v-9', product_name: 'X', size: null, color: null, qty: 1, list_price: 1 }],
      }),
    )
    expect(d.newItems).toEqual([])
  })

  it('referencia = últimos 6 caracteres del id en mayúscula (la misma de pantalla)', () => {
    expect(returnReference('3f1c2b9a-0000-4000-8000-00000abc12de')).toBe('BC12DE')
    expect(buildReturnReceiptData(input()).reference).toBe('BC12DE')
  })
})
