import { fmtCOP } from '@/lib/formatters'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { useReceiptPrintStyle } from '@/lib/receiptPrint'
import { DEFAULT_ORG_CONFIG } from '@/hooks/useOrg'
import type { LayawayDetail } from '@/hooks/useLayaways'

const LAYAWAY_PRINT_CONTAINER_ID = 'gpulso-layaway-receipt-print'
const LAYAWAY_PRINT_STYLE_ID = 'gpulso-layaway-receipt-print-style'

const DIVIDER = '═══════════════════════════════'
const SUBDIV = '───────────────────────────────'

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

function fmtDateTime(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(d)
}

function fmtDateOnly(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso)
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(d)
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      {children}
    </div>
  )
}

export function LayawayReceipt({
  layaway,
  storeName,
  printedAt,
  terms,
}: LayawayReceiptProps) {
  const monoLight: React.CSSProperties = { color: '#525252' }
  const sectionStyle: React.CSSProperties = { margin: '6px 0' }
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
    <div
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.4,
        color: '#1a1a1a',
        background: '#fff',
        padding: '4mm',
        width: '80mm',
        boxSizing: 'border-box',
      }}
    >
      {/* Encabezado */}
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>
          G-MURA
        </div>
        <div style={{ fontSize: 11, ...monoLight }}>{storeName}</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
          SEPARADO #{layaway.layaway_number}
        </div>
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      {/* Metadatos */}
      <div style={sectionStyle}>
        <Line>
          <span style={monoLight}>Cliente:</span>
          <span style={{ fontWeight: 600 }}>{layaway.customer_name}</span>
        </Line>
        {layaway.customer_phone && (
          <Line>
            <span style={monoLight}>Tel:</span>
            <span>{layaway.customer_phone}</span>
          </Line>
        )}
        <Line>
          <span style={monoLight}>Fecha:</span>
          <span>{fmtDateTime(layaway.created_at)}</span>
        </Line>
        <Line>
          <span style={monoLight}>Vence:</span>
          <span>{fmtDateTime(layaway.expires_at)}</span>
        </Line>
        {layaway.created_by_name && (
          <Line>
            <span style={monoLight}>Creado por:</span>
            <span>{layaway.created_by_name}</span>
          </Line>
        )}
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      {/* Ítems */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>ÍTEMS</div>
        {layaway.items.map((it) => (
          <div key={it.id} style={{ marginBottom: 2 }}>
            {it.brand && (
              <div
                style={{
                  ...monoLight,
                  fontSize: 9,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {it.brand}
              </div>
            )}
            <div>{it.product_name}</div>
            <div style={monoLight}>
              {[
                it.size ? `T:${it.size}` : null,
                it.color ? `C:${it.color}` : null,
              ]
                .filter(Boolean)
                .join(' ')}
            </div>
            {it.list_price > it.unit_price && (
              <div style={{ ...monoLight, fontSize: 9 }}>
                Antes:{' '}
                <span style={{ textDecoration: 'line-through' }}>
                  {fmtCOP(it.list_price)}
                </span>
              </div>
            )}
            <Line>
              <span style={monoLight}>
                {' '}
                {it.qty} × {fmtCOP(it.unit_price)}
              </span>
              <span>{fmtCOP(it.qty * it.unit_price)}</span>
            </Line>
          </div>
        ))}
        <div style={monoLight}>{SUBDIV}</div>
        {layaway.discount > 0 && (
          <>
            <Line>
              <span style={monoLight}>Subtotal:</span>
              <span>{fmtCOP(layaway.subtotal)}</span>
            </Line>
            <Line>
              <span style={monoLight}>Descuento:</span>
              <span>-{fmtCOP(layaway.discount)}</span>
            </Line>
          </>
        )}
        <Line>
          <span style={{ fontWeight: 700 }}>Total:</span>
          <span style={{ fontWeight: 700 }}>{fmtCOP(layaway.total)}</span>
        </Line>
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      {/* Abonos */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>ABONOS</div>
        {layaway.payments.length === 0 ? (
          <div style={{ ...monoLight, fontStyle: 'italic' }}>Sin abonos</div>
        ) : (
          paymentGroups.map((group) => {
            // Abono de un solo método: una línea, como antes.
            if (group.length === 1) {
              const p = group[0]
              return (
                <Line key={p.id}>
                  <span style={monoLight}>
                    {PAYMENT_METHODS[p.payment_method].label}
                    {p.is_historical ? ' (histórico)' : ''}
                  </span>
                  <span>{fmtCOP(p.amount)}</span>
                </Line>
              )
            }
            // Abono MIXTO: total del abono + desglose por método debajo.
            const sum = group.reduce((s, p) => s + p.amount, 0)
            return (
              <div key={group[0].id}>
                <Line>
                  <span style={monoLight}>
                    Abono mixto
                    {group[0].is_historical ? ' (histórico)' : ''}:
                  </span>
                  <span>{fmtCOP(sum)}</span>
                </Line>
                {group.map((p) => (
                  <Line key={p.id}>
                    <span style={{ ...monoLight, paddingLeft: 10 }}>
                      {PAYMENT_METHODS[p.payment_method].label}:
                    </span>
                    <span style={monoLight}>{fmtCOP(p.amount)}</span>
                  </Line>
                ))}
              </div>
            )
          })
        )}
        <div style={monoLight}>{SUBDIV}</div>
        <Line>
          <span>Pagado:</span>
          <span>{fmtCOP(layaway.paid_amount)}</span>
        </Line>
        <Line>
          <span style={{ fontWeight: 700 }}>Saldo:</span>
          <span style={{ fontWeight: 700 }}>{fmtCOP(balance)}</span>
        </Line>
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      {balance > 0 && (
        <div style={{ textAlign: 'center', margin: '6px 0' }}>
          <div style={monoLight}>Cobra antes de:</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>
            {fmtDateOnly(layaway.expires_at)}
          </div>
        </div>
      )}

      <div style={monoLight}>{DIVIDER}</div>

      <div style={{ marginTop: 4 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>IMPORTANTE</div>
        {finalTerms.map((term, i) => (
          <div key={i} style={monoLight}>
            - {term}
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', ...monoLight, marginTop: 6 }}>
        Impreso: {fmtDateTime(printedAt)}
      </div>
    </div>
  )
}

export function LayawayReceiptPrint(props: LayawayReceiptProps) {
  useReceiptPrintStyle(LAYAWAY_PRINT_STYLE_ID, LAYAWAY_PRINT_CONTAINER_ID)
  return (
    <div
      id={LAYAWAY_PRINT_CONTAINER_ID}
      style={{ display: 'none' }}
      aria-hidden="true"
    >
      <LayawayReceipt {...props} />
    </div>
  )
}
