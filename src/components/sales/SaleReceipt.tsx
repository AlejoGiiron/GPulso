import { fmtCOP } from '@/lib/formatters'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { fmtReceiptDateTime } from '@/lib/receiptFormat'
import type { PaymentMethod } from '@/types/database.types'
import {
  Divider,
  Line,
  PrintedAt,
  ReceiptHeader,
  ReceiptPrintContainer,
  ReceiptShell,
  Section,
  SectionTitle,
} from '@/components/receipts/ReceiptParts'
import { useReceiptInk } from '@/components/receipts/receiptContext'

const SALE_PRINT_CONTAINER_ID = 'gpulso-sale-receipt-print'
const SALE_PRINT_STYLE_ID = 'gpulso-sale-receipt-print-style'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface SaleReceiptItem {
  variant_id: string
  product_name: string
  brand: string | null
  size: string | null
  color: string | null
  // Fase B serializados: etiqueta de variante en texto libre + IMEI/serial de la
  // unidad. En accesorios ambos van null y se muestran size/color.
  variant_label: string | null
  serial: string | null
  qty: number
  // unit_price = precio FINAL vendido; list_price = catálogo (para el tachado).
  unit_price: number
  list_price: number
}

export interface SaleReceiptCustomer {
  full_name: string
  phone: string | null
}

export interface SaleReceiptData {
  order_number: number
  created_at: string | Date
  subtotal: number
  discount: number
  surcharge: number
  total: number
  payment_method: PaymentMethod
  cash_received: number | null
  // Desglose de pagos (order_payments, 032). Con >1 línea es una venta MIXTA →
  // el recibo muestra cada método con su monto. Con 1 línea o ausente, se
  // muestra el método único (payment_method), igual que antes.
  payments?: { method: PaymentMethod; amount: number }[]
  items: SaleReceiptItem[]
  customer: SaleReceiptCustomer | null
  // Fiado (029): si viene, el recibo se rotula FIADO y muestra el abono inicial
  // y el SALDO PENDIENTE que el cliente queda debiendo.
  credit?: {
    paid: number
    balance: number
    // Método del abono inicial (null si no hubo abono).
    payment_method: PaymentMethod | null
    // Desglose del abono inicial cuando fue MIXTO (>1 método).
    payments?: { method: PaymentMethod; amount: number }[]
  } | null
}

export interface SaleReceiptProps {
  sale: SaleReceiptData
  storeName: string
  printedAt: Date
}

// ── Componente principal ──────────────────────────────────────────────────────

export function SaleReceipt({ sale, storeName, printedAt }: SaleReceiptProps) {
  const { muted, fs } = useReceiptInk()
  // Venta mixta = más de una línea de pago. El vuelto se calcula sobre la
  // PORCIÓN efectivo (en simple, esa porción es el total).
  const isMixed = (sale.payments?.length ?? 0) > 1
  const cashPortion =
    sale.payments?.find((p) => p.method === 'cash')?.amount ?? sale.total
  const change =
    sale.cash_received != null && sale.cash_received > cashPortion
      ? sale.cash_received - cashPortion
      : 0

  return (
    <ReceiptShell>
      <ReceiptHeader
        storeName={storeName}
        docTitle={`${sale.credit ? 'FIADO' : 'VENTA'} #${sale.order_number}`}
      />

      <Divider strong />

      <Section>
        <Line label="Fecha:" value={fmtReceiptDateTime(sale.created_at)} />
        {sale.customer && (
          <>
            <Line
              label="Cliente:"
              value={sale.customer.full_name}
              valueStyle={{ fontWeight: 600 }}
            />
            {sale.customer.phone && <Line label="Tel:" value={sale.customer.phone} />}
          </>
        )}
      </Section>

      <Divider strong />

      <Section>
        <SectionTitle>ÍTEMS</SectionTitle>
        {sale.items.map((it) => (
          <div key={it.serial ?? it.variant_id} style={{ marginBottom: 2 }}>
            {it.brand && (
              <div
                style={{
                  ...muted,
                  fontSize: fs(9),
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {it.brand}
              </div>
            )}
            <div>{it.product_name}</div>
            {(it.size || it.color) && (
              <div style={muted}>
                {[it.size ? `V:${it.size}` : null, it.color ? `C:${it.color}` : null]
                  .filter(Boolean)
                  .join(' ')}
              </div>
            )}
            {/* Serializado: etiqueta de variante libre + IMEI/serial. */}
            {it.variant_label && <div style={muted}>{it.variant_label}</div>}
            {it.serial && <div style={muted}>IMEI: {it.serial}</div>}
            {it.list_price > it.unit_price && (
              <div style={{ ...muted, fontSize: fs(9) }}>
                Antes:{' '}
                <span style={{ textDecoration: 'line-through' }}>
                  {fmtCOP(it.list_price)}
                </span>
              </div>
            )}
            <Line
              indent
              label={`${it.qty} × ${fmtCOP(it.unit_price)}`}
              value={fmtCOP(it.qty * it.unit_price)}
            />
          </div>
        ))}
      </Section>

      <Divider strong />

      <Section>
        <Line label="Subtotal:" value={fmtCOP(sale.subtotal)} />
        {sale.discount > 0 && <Line label="Descuento:" value={`-${fmtCOP(sale.discount)}`} />}
        {sale.surcharge > 0 && (
          <Line label="Recargo Addi:" value={`+${fmtCOP(sale.surcharge)}`} />
        )}
        <Divider />
        <Line strong label="Total:" value={fmtCOP(sale.total)} valueStyle={{ fontSize: 13 }} />
        {!sale.credit && (
          <>
            {isMixed ? (
              <>
                <div style={{ ...muted, marginTop: 2 }}>Pago (mixto):</div>
                {sale.payments!.map((p) => (
                  <Line
                    key={p.method}
                    indent
                    label={`${PAYMENT_METHODS[p.method].label}:`}
                    value={fmtCOP(p.amount)}
                  />
                ))}
              </>
            ) : (
              <Line label="Pago:" value={PAYMENT_METHODS[sale.payment_method].label} />
            )}
            {sale.cash_received != null && (
              <Line label="Recibido:" value={fmtCOP(sale.cash_received)} />
            )}
            {change > 0 && <Line label="Cambio:" value={fmtCOP(change)} />}
          </>
        )}

        {sale.credit && (
          <>
            <Line label="Venta a crédito:" value="FIADO" />
            {(sale.credit.payments?.length ?? 0) > 1 ? (
              <>
                <Line label="Abono inicial (mixto):" value={fmtCOP(sale.credit.paid)} />
                {sale.credit.payments!.map((p) => (
                  <Line
                    key={p.method}
                    indent
                    mutedValue
                    label={`${PAYMENT_METHODS[p.method].label}:`}
                    value={fmtCOP(p.amount)}
                  />
                ))}
              </>
            ) : (
              <Line
                label="Abono inicial:"
                value={`${fmtCOP(sale.credit.paid)}${
                  sale.credit.payment_method
                    ? ` (${PAYMENT_METHODS[sale.credit.payment_method].label})`
                    : ''
                }`}
              />
            )}
            <Divider />
            <Line
              strong
              label="SALDO A DEBER:"
              value={fmtCOP(sale.credit.balance)}
              valueStyle={{ fontSize: 13 }}
            />
          </>
        )}
      </Section>

      <Divider strong />

      {sale.credit ? (
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <div style={{ fontWeight: 700 }}>DEBE: {fmtCOP(sale.credit.balance)}</div>
          <div style={{ ...muted, marginTop: 2 }}>
            Conserva este recibo. Gracias por tu compra.
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <div style={{ fontWeight: 600 }}>¡Gracias por tu compra!</div>
          <div style={{ ...muted, marginTop: 2 }}>
            Conserva este recibo para devoluciones.
          </div>
        </div>
      )}

      <PrintedAt at={printedAt} />
    </ReceiptShell>
  )
}

// ── Contenedor para impresión (oculto en pantalla) ────────────────────────────

export function SaleReceiptPrint(props: SaleReceiptProps) {
  return (
    <ReceiptPrintContainer containerId={SALE_PRINT_CONTAINER_ID} styleId={SALE_PRINT_STYLE_ID}>
      <SaleReceipt {...props} />
    </ReceiptPrintContainer>
  )
}
