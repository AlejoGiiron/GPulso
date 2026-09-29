import { fmtCOP } from '@/lib/formatters'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { fmtReceiptDateTime, fmtReceiptTime } from '@/lib/receiptFormat'
import type {
  CashShift,
  CashExpense,
  PaymentMethod,
} from '@/types/database.types'
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

function fmtDuration(opened: string, closed: string | Date): string {
  const a = new Date(opened).getTime()
  const b = (closed instanceof Date ? closed : new Date(closed)).getTime()
  const totalMin = Math.max(0, Math.round((b - a) / 60_000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

/**
 * Fila de detalle con hora ("[19:16] #12 Transferencia: $110.000"). En 80mm va
 * en un renglón; en 58mm no cabe (~34 caracteres) y pasa a dos: hora y
 * referencia arriba, método y monto abajo.
 */
function DetailRow({
  createdAt,
  lead,
  method,
  amount,
}: {
  createdAt: string
  lead: string
  method?: string
  amount: number
}) {
  const { layout, muted } = useReceiptInk()
  const time = `[${fmtReceiptTime(createdAt)}]`
  if (!layout.compact) {
    return (
      <Line
        label={`${time} ${lead}${method ? ` ${method}` : ''}:`}
        value={fmtCOP(amount)}
      />
    )
  }
  return (
    <div>
      <div style={muted}>
        {time} {lead}
      </div>
      <Line indent label={method ?? ''} value={fmtCOP(amount)} />
    </div>
  )
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
  const { muted, color, fs } = useReceiptInk()
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
  const badgeInk = color(badgeColor)

  return (
    <ReceiptShell>
      <ReceiptHeader storeName={storeName} docTitle="Cuadre de caja" />

      <Divider strong />

      {/* Metadatos del turno */}
      <Section>
        <Line label="Cajero:" value={userName} valueStyle={{ fontWeight: 600 }} />
        <Line label="Apertura:" value={fmtReceiptDateTime(shift.opened_at)} />
        <Line label="Cierre:" value={fmtReceiptDateTime(closedAt)} />
        <Line label="Duración:" value={duration} />
      </Section>

      <Divider strong />

      {/* Ventas por método (incluye abonos de separados) */}
      <Section>
        <SectionTitle>VENTAS POR MÉTODO</SectionTitle>
        {salesByMethod.length === 0 ? (
          <div style={{ ...muted, fontStyle: 'italic' }}>Sin ventas registradas</div>
        ) : (
          salesByMethod.map((row) => (
            <Line
              key={row.method}
              label={`${PAYMENT_METHODS[row.method].label}:`}
              value={
                <>
                  {fmtCOP(row.total)} <span style={muted}>({row.count})</span>
                </>
              }
            />
          ))
        )}
        <Divider />
        {(lpTotal > 0 || cpTotal > 0) && (
          <>
            {/* Excluye separados Y fiados → atribución correcta (antes los
                fiados quedaban escondidos acá). */}
            <Line label="Ventas directas:" value={fmtCOP(totalSales - lpTotal - cpTotal)} />
            {lpTotal > 0 && <Line label="Abonos de separados:" value={fmtCOP(lpTotal)} />}
            {cpTotal > 0 && <Line label="Abonos de fiados:" value={fmtCOP(cpTotal)} />}
          </>
        )}
        <Line strong label="Total ventas:" value={fmtCOP(totalSales)} />
        <Line
          label="Transacciones:"
          value={orderCount + lpRows.length + cpRows.length}
        />
      </Section>

      {/* Abonos de separados (detalle por abono) */}
      {lpRows.length > 0 && (
        <>
          <Divider strong />
          <Section>
            <SectionTitle>ABONOS DE SEPARADOS</SectionTitle>
            {lpRows.map((p) => (
              <DetailRow
                key={p.id}
                createdAt={p.created_at}
                lead={`#${p.layaway_number}`}
                method={PAYMENT_METHODS[p.payment_method].label}
                amount={Number(p.amount)}
              />
            ))}
            <Divider />
            <Line strong label="Total abonos:" value={fmtCOP(lpTotal)} />
          </Section>
        </>
      )}

      {/* Abonos de fiados (detalle por abono) — espejo de los de separado.
          Un abono mixto son N filas (una por método) con el mismo #, así que
          aparece como varias líneas con su método, igual que en separados. */}
      {cpRows.length > 0 && (
        <>
          <Divider strong />
          <Section>
            <SectionTitle>ABONOS DE FIADOS</SectionTitle>
            {cpRows.map((p) => (
              <DetailRow
                key={p.id}
                createdAt={p.created_at}
                lead={`#${p.order_number}`}
                method={PAYMENT_METHODS[p.payment_method].label}
                amount={Number(p.amount)}
              />
            ))}
            <Divider />
            <Line strong label="Total abonos:" value={fmtCOP(cpTotal)} />
          </Section>
        </>
      )}

      {/* Devoluciones (ingresos y egresos por devolución/cambio, aparte) */}
      {hasReturns && (
        <>
          <Divider strong />
          <Section>
            <SectionTitle>DEVOLUCIONES</SectionTitle>
            <Line label="+ Ingresos (cobro dif):" value={fmtCOP(returnsIncome)} />
            <Line label="- Reembolsos:" value={`-${fmtCOP(returnsExpense)}`} />
            <Divider />
            <Line
              strong
              label="Neto devoluciones:"
              value={
                returnsIncome - returnsExpense >= 0
                  ? `+${fmtCOP(returnsIncome - returnsExpense)}`
                  : fmtCOP(returnsIncome - returnsExpense)
              }
            />
          </Section>
        </>
      )}

      {/* Comisiones por crédito en efectivo (Fase 4; ya dentro de cashSales) */}
      {commissionsIncome > 0 && (
        <>
          <Divider strong />
          <Section>
            <SectionTitle>COMISIONES DE CRÉDITO</SectionTitle>
            <Line label="+ Ingreso efectivo:" value={fmtCOP(commissionsIncome)} />
            <div style={{ ...muted, fontSize: fs(10), fontStyle: 'italic' }}>
              Incluido en ventas efec. del cuadre
            </div>
          </Section>
        </>
      )}

      {/* Egresos (regulares; los reembolsos se muestran en Devoluciones) */}
      {regularExpenses.length > 0 && (
        <>
          <Divider strong />
          <Section>
            <SectionTitle>EGRESOS</SectionTitle>
            {regularExpenses.map((e) => (
              <DetailRow
                key={e.id}
                createdAt={e.created_at}
                lead={e.reason}
                amount={Number(e.amount)}
              />
            ))}
            <Divider />
            <Line strong label="Total egresos:" value={fmtCOP(regularExpensesTotal)} />
          </Section>
        </>
      )}

      <Divider strong />

      {/* Cuadre de efectivo */}
      <Section>
        <SectionTitle>CUADRE DE EFECTIVO</SectionTitle>
        <Line label="Apertura:" value={fmtCOP(shift.opening_amount)} />
        <Line label="+ Ventas efec:" value={fmtCOP(props.cashSales)} />
        {totalExpenses > 0 && <Line label="- Egresos:" value={`-${fmtCOP(totalExpenses)}`} />}
        <Divider />
        <Line strong label="Esperado:" value={fmtCOP(expectedCash)} />
        {overdraft > 0 && (
          <Line
            label={<span style={{ color: color('#dc2626') }}>Sobregiro:</span>}
            value={`-${fmtCOP(overdraft)}`}
            valueStyle={{ color: color('#dc2626') }}
          />
        )}
        <Line label="Contado:" value={fmtCOP(countedCash)} />
        <Divider />
        <Line
          strong
          label="Diferencia:"
          value={difference >= 0 ? `+${fmtCOP(difference)}` : fmtCOP(difference)}
          valueStyle={{ color: badgeInk }}
        />
        <div
          style={{
            textAlign: 'center',
            marginTop: 4,
            fontWeight: 700,
            letterSpacing: 1,
            color: badgeInk,
            border: `1px dashed ${badgeInk}`,
            padding: '2px 0',
          }}
        >
          {badgeText}
        </div>
      </Section>

      <Divider strong />

      <PrintedAt at={printedAt} />
    </ReceiptShell>
  )
}

// ── Contenedor para impresión (oculto en pantalla) ────────────────────────────

export function CashShiftReceiptPrint(props: CashShiftReceiptProps) {
  return (
    <ReceiptPrintContainer containerId={SHIFT_PRINT_CONTAINER_ID} styleId={SHIFT_PRINT_STYLE_ID}>
      <CashShiftReceipt {...props} />
    </ReceiptPrintContainer>
  )
}
