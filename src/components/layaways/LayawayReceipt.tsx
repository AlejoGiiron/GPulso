import { fmtCOP } from '@/lib/formatters'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { fmtReceiptDateTime, fmtReceiptLongDate } from '@/lib/receiptFormat'
import { DEFAULT_ORG_CONFIG } from '@/hooks/useOrg'
import type { LayawayDetail } from '@/hooks/useLayaways'
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

const LAYAWAY_PRINT_CONTAINER_ID = 'gpulso-layaway-receipt-print'
const LAYAWAY_PRINT_STYLE_ID = 'gpulso-layaway-receipt-print-style'

export interface LayawayReceiptProps {
  layaway: LayawayDetail
  storeName: string
  printedAt: Date
  /**
   * Condiciones del separado (una por línea), configurables desde
   * Configuración → Separados (organizations.config.layaway_terms). Si llega
   * vacío se cae al default para no dejar el recibo sin condiciones.
   */
  terms: string[]
}

export function LayawayReceipt({
  layaway,
  storeName,
  printedAt,
  terms,
}: LayawayReceiptProps) {
  const { muted, fs } = useReceiptInk()
  const balance = layaway.balance_pending
  // Fallback defensivo: nunca dejar el recibo sin condiciones.
  const finalTerms = terms.length > 0 ? terms : DEFAULT_ORG_CONFIG.layaway_terms

  // Agrupa los abonos por momento (created_at): N filas del mismo instante son
  // un abono MIXTO (pagos mixtos, 032) → se muestran como un abono con desglose,
  // no como abonos separados. Preserva el orden de aparición.
  type AbonoPayment = (typeof layaway.payments)[number]
  const paymentGroups: AbonoPayment[][] = []
  const byMoment = new Map<string, AbonoPayment[]>()
  for (const p of layaway.payments) {
    const g = byMoment.get(p.created_at)
    if (g) {
      g.push(p)
    } else {
      const ng = [p]
      byMoment.set(p.created_at, ng)
      paymentGroups.push(ng)
    }
  }

  return (
    <ReceiptShell>
      <ReceiptHeader storeName={storeName} docTitle={`SEPARADO #${layaway.layaway_number}`} />

      <Divider strong />

      {/* Metadatos */}
      <Section>
        <Line
          label="Cliente:"
          value={layaway.customer_name}
          valueStyle={{ fontWeight: 600 }}
        />
        {layaway.customer_phone && <Line label="Tel:" value={layaway.customer_phone} />}
        <Line label="Fecha:" value={fmtReceiptDateTime(layaway.created_at)} />
        <Line label="Vence:" value={fmtReceiptDateTime(layaway.expires_at)} />
        {layaway.created_by_name && (
          <Line label="Creado por:" value={layaway.created_by_name} />
        )}
      </Section>

      <Divider strong />

      {/* Ítems */}
      <Section>
        <SectionTitle>ÍTEMS</SectionTitle>
        {layaway.items.map((it) => (
          <div key={it.id} style={{ marginBottom: 2 }}>
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
        <Divider />
        {layaway.discount > 0 && (
          <>
            <Line label="Subtotal:" value={fmtCOP(layaway.subtotal)} />
            <Line label="Descuento:" value={`-${fmtCOP(layaway.discount)}`} />
          </>
        )}
        <Line strong label="Total:" value={fmtCOP(layaway.total)} />
      </Section>

      <Divider strong />

      {/* Abonos */}
      <Section>
        <SectionTitle>ABONOS</SectionTitle>
        {layaway.payments.length === 0 ? (
          <div style={{ ...muted, fontStyle: 'italic' }}>Sin abonos</div>
        ) : (
          paymentGroups.map((group) => {
            // Abono de un solo método: una línea, como antes.
            if (group.length === 1) {
              const p = group[0]
              return (
                <Line
                  key={p.id}
                  label={`${PAYMENT_METHODS[p.payment_method].label}${
                    p.is_historical ? ' (histórico)' : ''
                  }`}
                  value={fmtCOP(p.amount)}
                />
              )
            }
            // Abono MIXTO: total del abono + desglose por método debajo.
            const sum = group.reduce((s, p) => s + p.amount, 0)
            return (
              <div key={group[0].id}>
                <Line
                  label={`Abono mixto${group[0].is_historical ? ' (histórico)' : ''}:`}
                  value={fmtCOP(sum)}
                />
                {group.map((p) => (
                  <Line
                    key={p.id}
                    indent
                    mutedValue
                    label={`${PAYMENT_METHODS[p.payment_method].label}:`}
                    value={fmtCOP(p.amount)}
                  />
                ))}
              </div>
            )
          })
        )}
        <Divider />
        <Line plainLabel label="Pagado:" value={fmtCOP(layaway.paid_amount)} />
        <Line strong label="Saldo:" value={fmtCOP(balance)} />
      </Section>

      <Divider strong />

      {balance > 0 && (
        <>
          <div style={{ textAlign: 'center', margin: '6px 0' }}>
            <div style={muted}>Cobra antes de:</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              {fmtReceiptLongDate(layaway.expires_at)}
            </div>
          </div>
          <Divider strong />
        </>
      )}

      <div style={{ marginTop: 4 }}>
        <SectionTitle>IMPORTANTE</SectionTitle>
        {finalTerms.map((term, i) => (
          <div key={i} style={muted}>
            - {term}
          </div>
        ))}
      </div>

      <PrintedAt at={printedAt} />
    </ReceiptShell>
  )
}

export function LayawayReceiptPrint(props: LayawayReceiptProps) {
  return (
    <ReceiptPrintContainer
      containerId={LAYAWAY_PRINT_CONTAINER_ID}
      styleId={LAYAWAY_PRINT_STYLE_ID}
    >
      <LayawayReceipt {...props} />
    </ReceiptPrintContainer>
  )
}
