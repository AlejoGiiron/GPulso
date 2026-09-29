export interface ReturnReceiptLine {
  key: string
  brand: string | null
  name: string
  size: string | null
  color: string | null
  qty: number
  unitPrice: number
}

export interface ReturnReceiptData {
  kind: 'return' | 'exchange'
  /** Referencia corta de la devolución (últimos 6 del id, como en pantalla). */
  reference: string
  created_at: string | Date
  order_number: number
  customer: { full_name: string; phone: string | null } | null
  returned: ReturnReceiptLine[]
  /** Ítems que se lleva el cliente (solo en cambio). */
  newItems: ReturnReceiptLine[]
  /** Devolución: dinero que se le reembolsa al cliente. */
  refundTotal: number
  /** Cambio: diferencia en base catálogo (positivo = cobra al cliente, negativo = devuelve la tienda). */
  exchangeDifference: number
  /** Monto de esa diferencia ya neteado (cobro o reembolso), como lo registró la caja. */
  exchangeAmount: number
  methodLabel: string
}

// Arma los datos del comprobante de devolución/cambio a partir del estado de
// la pantalla de Devoluciones. Misma aritmética que mostraba el modal antes:
// reembolso = Σ precio pagado × cantidad devuelta; en un cambio la diferencia
// y su monto salen de calculateExchangeAmounts (returnCalc), ya neteados.

interface ReturnedSource {
  id: string
  variant_id: string
  product_name: string
  brand: string | null
  size: string | null
  color: string | null
  unit_price: number
}

interface NewItemSource {
  variant_id: string
  product_name: string
  size: string | null
  color: string | null
  qty: number
  list_price: number
}

export interface BuildReturnReceiptInput {
  kind: 'return' | 'exchange'
  returnId: string
  createdAt: string
  order: {
    order_number: number
    customer: { full_name: string; phone: string | null } | null
    items: ReturnedSource[]
  }
  /** Cantidad devuelta por variant_id (0 o ausente = no se devuelve). */
  returnQtys: Record<string, number>
  exchangeItems: NewItemSource[]
  /** calculateExchangeAmounts: difference / orderTotal (cobro) / refundDue. */
  exchange: { difference: number; orderTotal: number; refundDue: number }
  methodLabel: string
}

export function returnReference(returnId: string): string {
  return returnId.slice(-6).toUpperCase()
}

export function buildReturnReceiptData(input: BuildReturnReceiptInput): ReturnReceiptData {
  const returned: ReturnReceiptLine[] = input.order.items
    .filter((i) => (input.returnQtys[i.variant_id] ?? 0) > 0)
    .map((i) => ({
      key: i.id,
      brand: i.brand,
      name: i.product_name,
      size: i.size,
      color: i.color,
      qty: input.returnQtys[i.variant_id],
      unitPrice: i.unit_price,
    }))

  const newItems: ReturnReceiptLine[] =
    input.kind === 'exchange'
      ? input.exchangeItems.map((e) => ({
          key: e.variant_id,
          brand: null,
          name: e.product_name,
          size: e.size,
          color: e.color,
          qty: e.qty,
          unitPrice: e.list_price,
        }))
      : []

  const refundTotal = returned.reduce((sum, l) => sum + l.unitPrice * l.qty, 0)
  const diff = input.exchange.difference

  return {
    kind: input.kind,
    reference: returnReference(input.returnId),
    created_at: input.createdAt,
    order_number: input.order.order_number,
    customer: input.order.customer,
    returned,
    newItems,
    refundTotal,
    exchangeDifference: diff,
    exchangeAmount: diff > 0 ? input.exchange.orderTotal : diff < 0 ? input.exchange.refundDue : 0,
    methodLabel: input.methodLabel,
  }
}
