import { fmtCOP } from '@/lib/formatters'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { useReceiptPrintStyle } from '@/lib/receiptPrint'
import type {
  CashShift,
  CashExpense,
  PaymentMethod,
} from '@/types/database.types'

const SHIFT_PRINT_CONTAINER_ID = 'gpulso-shift-receipt-print'
const SHIFT_PRINT_STYLE_ID = 'gpulso-shift-receipt-print-style'

export interface SalesByMethodRow {
  method: PaymentMethod
  count: number
  total: number
  regularTotal?: number
  layawayTotal?: number
  // Abonos de FIADO cobrados en este método (029). Parte del efectivo.
  creditTotal?: number
}

export interface LayawayPaymentReceiptRow {
  id: string
  layaway_number: number
  amount: number
  payment_method: PaymentMethod
  created_at: string
}

export interface CreditPaymentReceiptRow {
  id: string
  order_number: number
  amount: number
  payment_method: PaymentMethod
  created_at: string
}

export interface CashShiftReceiptProps {
  shift: CashShift
  expenses: CashExpense[]
  salesByMethod: SalesByMethodRow[]
  totalSales: number
  cashSales: number
  totalExpenses: number
  expectedCash: number
  overdraft?: number
  orderCount: number
  countedCash: number
  difference: number
  storeName: string
  userName: string
  printedAt: Date
  layawayPayments?: LayawayPaymentReceiptRow[]
  layawayPaymentsTotal?: number
  // Abonos de FIADO del turno (detalle + total). Espejo de los de separado.
  creditPayments?: CreditPaymentReceiptRow[]
  creditPaymentsTotal?: number
  regularSalesTotal?: number
  // Devoluciones (presentación aparte; no afectan el cuadre).
  returnsIncome?: number
  returnsExpense?: number
  // Comisiones por crédito en efectivo (Fase 4). Ya están dentro de cashSales;
  // esto solo las muestra en su propia sección para que no queden escondidas.
  commissionsIncome?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function fmtHHmm(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

function fmtDuration(opened: string, closed: string | Date): string {
  const a = new Date(opened).getTime()
  const b = (closed instanceof Date ? closed : new Date(closed)).getTime()
  const totalMin = Math.max(0, Math.round((b - a) / 60_000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

// ── Subcomponentes visuales ───────────────────────────────────────────────────

const DIVIDER = '═══════════════════════════════'
const SUBDIV = '───────────────────────────────'

function Line({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between' }}>{children}</div>
}

// ── Componente principal ──────────────────────────────────────────────────────

export function CashShiftReceipt(props: CashShiftReceiptProps) {
  const {
    shift,
    expenses,
    salesByMethod,
    totalSales,
    totalExpenses,
    expectedCash,
    orderCount,
    countedCash,
    difference,
    storeName,
    userName,
    printedAt,
    layawayPayments,
    layawayPaymentsTotal,
  } = props
  const lpTotal = layawayPaymentsTotal ?? 0
  const lpRows = layawayPayments ?? []
  // Abonos de FIADO: mismo tratamiento que los de separado (línea resumen +
  // sección de detalle). El dinero ya está en cashSales/totalSales; esto solo
  // lo desglosa para que no quede escondido dentro de "Ventas directas".
  const cpTotal = props.creditPaymentsTotal ?? 0
  const cpRows = props.creditPayments ?? []
  const overdraft = props.overdraft ?? 0

  // Devoluciones: ingresos (órdenes con return_id) y reembolsos (cash_expenses
  // kind='return'). Se muestran aparte; los egresos del recibo excluyen los
  // reembolsos. El CUADRE de efectivo no cambia (sigue usando totalExpenses).
  const returnsIncome = props.returnsIncome ?? 0
  const returnsExpense = props.returnsExpense ?? 0
  const hasReturns = returnsIncome > 0 || returnsExpense > 0
  // Comisiones por crédito en efectivo: ya suman a cashSales; se listan aparte.
  const commissionsIncome = props.commissionsIncome ?? 0
  const regularExpenses = expenses.filter((e) => e.kind !== 'return')
  const regularExpensesTotal = regularExpenses.reduce(
    (sum, e) => sum + Number(e.amount),
    0,
  )

  const closedAt = shift.closed_at ? new Date(shift.closed_at) : printedAt
  const duration = fmtDuration(shift.opened_at, closedAt)

  let badgeText = 'CUADRADO'
  let badgeColor = '#525252'
  if (difference > 0) {
    badgeText = 'SOBRANTE'
    badgeColor = '#059669'
  } else if (difference < 0) {
    badgeText = 'FALTANTE'
    badgeColor = '#dc2626'
  }

  const sectionStyle: React.CSSProperties = { margin: '6px 0' }
  const monoLight: React.CSSProperties = { color: '#525252' }

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
        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>
          Cuadre de caja
        </div>
      </div>

      <div style={{ ...monoLight }}>{DIVIDER}</div>

      {/* Metadatos del turno */}
      <div style={sectionStyle}>
        <Line>
          <span style={monoLight}>Cajero:</span>
          <span style={{ fontWeight: 600 }}>{userName}</span>
        </Line>
        <Line>
          <span style={monoLight}>Apertura:</span>
          <span>{fmtDateTime(shift.opened_at)}</span>
        </Line>
        <Line>
          <span style={monoLight}>Cierre:</span>
          <span>{fmtDateTime(closedAt)}</span>
        </Line>
        <Line>
          <span style={monoLight}>Duración:</span>
          <span>{duration}</span>
        </Line>
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      {/* Ventas por método (incluye abonos de separados) */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>VENTAS POR MÉTODO</div>
        {salesByMethod.length === 0 ? (
          <div style={{ ...monoLight, fontStyle: 'italic' }}>
            Sin ventas registradas
          </div>
        ) : (
          salesByMethod.map((row) => (
            <Line key={row.method}>
              <span style={monoLight}>
                {PAYMENT_METHODS[row.method].label}:
              </span>
              <span>
                {fmtCOP(row.total)}{' '}
                <span style={monoLight}>({row.count})</span>
              </span>
            </Line>
          ))
        )}
        <div style={monoLight}>{SUBDIV}</div>
        {(lpTotal > 0 || cpTotal > 0) && (
          <>
            <Line>
              <span style={monoLight}>Ventas directas:</span>
              {/* Excluye separados Y fiados → atribución correcta (antes los
                  fiados quedaban escondidos acá). */}
              <span>{fmtCOP(totalSales - lpTotal - cpTotal)}</span>
            </Line>
            {lpTotal > 0 && (
              <Line>
                <span style={monoLight}>Abonos de separados:</span>
                <span>{fmtCOP(lpTotal)}</span>
              </Line>
            )}
            {cpTotal > 0 && (
              <Line>
                <span style={monoLight}>Abonos de fiados:</span>
                <span>{fmtCOP(cpTotal)}</span>
              </Line>
            )}
          </>
        )}
        <Line>
          <span style={{ fontWeight: 700 }}>Total ventas:</span>
          <span style={{ fontWeight: 700 }}>{fmtCOP(totalSales)}</span>
        </Line>
        <Line>
          <span style={monoLight}>Transacciones:</span>
          <span>{orderCount + lpRows.length + cpRows.length}</span>
        </Line>
      </div>

      {/* Abonos de separados (detalle por abono) */}
      {lpRows.length > 0 && (
        <>
          <div style={monoLight}>{DIVIDER}</div>
          <div style={sectionStyle}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>
              ABONOS DE SEPARADOS
            </div>
            {lpRows.map((p) => (
              <Line key={p.id}>
                <span style={monoLight}>
                  [{fmtHHmm(p.created_at)}] #{p.layaway_number}{' '}
                  {PAYMENT_METHODS[p.payment_method].label}:
                </span>
                <span>{fmtCOP(Number(p.amount))}</span>
              </Line>
            ))}
            <div style={monoLight}>{SUBDIV}</div>
            <Line>
              <span style={{ fontWeight: 700 }}>Total abonos:</span>
              <span style={{ fontWeight: 700 }}>{fmtCOP(lpTotal)}</span>
            </Line>
          </div>
        </>
      )}

      {/* Abonos de fiados (detalle por abono) — espejo de los de separado.
          Un abono mixto son N filas (una por método) con el mismo #, así que
          aparece como varias líneas con su método, igual que en separados. */}
      {cpRows.length > 0 && (
        <>
          <div style={monoLight}>{DIVIDER}</div>
          <div style={sectionStyle}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>
              ABONOS DE FIADOS
            </div>
            {cpRows.map((p) => (
              <Line key={p.id}>
                <span style={monoLight}>
                  [{fmtHHmm(p.created_at)}] #{p.order_number}{' '}
                  {PAYMENT_METHODS[p.payment_method].label}:
                </span>
                <span>{fmtCOP(Number(p.amount))}</span>
              </Line>
            ))}
            <div style={monoLight}>{SUBDIV}</div>
            <Line>
              <span style={{ fontWeight: 700 }}>Total abonos:</span>
              <span style={{ fontWeight: 700 }}>{fmtCOP(cpTotal)}</span>
            </Line>
          </div>
        </>
      )}

      {/* Devoluciones (ingresos y egresos por devolución/cambio, aparte) */}
      {hasReturns && (
        <>
          <div style={monoLight}>{DIVIDER}</div>
          <div style={sectionStyle}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>DEVOLUCIONES</div>
            <Line>
              <span style={monoLight}>+ Ingresos (cobro dif):</span>
              <span>{fmtCOP(returnsIncome)}</span>
            </Line>
            <Line>
              <span style={monoLight}>- Reembolsos:</span>
              <span>-{fmtCOP(returnsExpense)}</span>
            </Line>
            <div style={monoLight}>{SUBDIV}</div>
            <Line>
              <span style={{ fontWeight: 700 }}>Neto devoluciones:</span>
              <span style={{ fontWeight: 700 }}>
                {returnsIncome - returnsExpense >= 0
                  ? `+${fmtCOP(returnsIncome - returnsExpense)}`
                  : fmtCOP(returnsIncome - returnsExpense)}
              </span>
            </Line>
          </div>
        </>
      )}

      {/* Comisiones por crédito en efectivo (Fase 4; ya dentro de cashSales) */}
      {commissionsIncome > 0 && (
        <>
          <div style={monoLight}>{DIVIDER}</div>
          <div style={sectionStyle}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>
              COMISIONES DE CRÉDITO
            </div>
            <Line>
              <span style={monoLight}>+ Ingreso efectivo:</span>
              <span>{fmtCOP(commissionsIncome)}</span>
            </Line>
            <div style={{ ...monoLight, fontSize: 10, fontStyle: 'italic' }}>
              Incluido en ventas efec. del cuadre
            </div>
          </div>
        </>
      )}

      {/* Egresos (regulares; los reembolsos se muestran en Devoluciones) */}
      {regularExpenses.length > 0 && (
        <>
          <div style={monoLight}>{DIVIDER}</div>
          <div style={sectionStyle}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>EGRESOS</div>
            {regularExpenses.map((e) => (
              <Line key={e.id}>
                <span style={monoLight}>
                  [{fmtHHmm(e.created_at)}] {e.reason}:
                </span>
                <span>{fmtCOP(Number(e.amount))}</span>
              </Line>
            ))}
            <div style={monoLight}>{SUBDIV}</div>
            <Line>
              <span style={{ fontWeight: 700 }}>Total egresos:</span>
              <span style={{ fontWeight: 700 }}>
                {fmtCOP(regularExpensesTotal)}
              </span>
            </Line>
          </div>
        </>
      )}

      <div style={monoLight}>{DIVIDER}</div>

      {/* Cuadre de efectivo */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>CUADRE DE EFECTIVO</div>
        <Line>
          <span style={monoLight}>Apertura:</span>
          <span>{fmtCOP(shift.opening_amount)}</span>
        </Line>
        <Line>
          <span style={monoLight}>+ Ventas efec:</span>
          <span>{fmtCOP(props.cashSales)}</span>
        </Line>
        {totalExpenses > 0 && (
          <Line>
            <span style={monoLight}>- Egresos:</span>
            <span>-{fmtCOP(totalExpenses)}</span>
          </Line>
        )}
        <div style={monoLight}>{SUBDIV}</div>
        <Line>
          <span style={{ fontWeight: 700 }}>Esperado:</span>
          <span style={{ fontWeight: 700 }}>{fmtCOP(expectedCash)}</span>
        </Line>
        {overdraft > 0 && (
          <Line>
            <span style={{ ...monoLight, color: '#dc2626' }}>Sobregiro:</span>
            <span style={{ color: '#dc2626' }}>-{fmtCOP(overdraft)}</span>
          </Line>
        )}
        <Line>
          <span style={monoLight}>Contado:</span>
          <span>{fmtCOP(countedCash)}</span>
        </Line>
        <div style={monoLight}>{SUBDIV}</div>
        <Line>
          <span style={{ fontWeight: 700 }}>Diferencia:</span>
          <span style={{ fontWeight: 700, color: badgeColor }}>
            {difference >= 0 ? `+${fmtCOP(difference)}` : fmtCOP(difference)}
          </span>
        </Line>
        <div
          style={{
            textAlign: 'center',
            marginTop: 4,
            fontWeight: 700,
            letterSpacing: 1,
            color: badgeColor,
            border: `1px dashed ${badgeColor}`,
            padding: '2px 0',
          }}
        >
          {badgeText}
        </div>
      </div>

      <div style={monoLight}>{DIVIDER}</div>

      <div style={{ textAlign: 'center', ...monoLight, marginTop: 4 }}>
        Impreso: {fmtDateTime(printedAt)}
      </div>
    </div>
  )
}

// ── Contenedor para impresión (oculto en pantalla) ────────────────────────────

export function CashShiftReceiptPrint(props: CashShiftReceiptProps) {
  useReceiptPrintStyle(SHIFT_PRINT_STYLE_ID, SHIFT_PRINT_CONTAINER_ID)
  return (
    <div
      id={SHIFT_PRINT_CONTAINER_ID}
      style={{ display: 'none' }}
      aria-hidden="true"
    >
      <CashShiftReceipt {...props} />
    </div>
  )
}
