import { fmtCOP } from '@/lib/formatters'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { useReceiptPrintStyle } from '@/lib/receiptPrint'
import {
  CHECKLIST_DANOS,
  CHECKLIST_VERIFICACIONES,
} from '@/lib/repairs'
import type { PaymentMethod, RepairChecklist } from '@/types/database.types'

// Comprobantes térmicos 80mm del taller (Fase 3 / Bloque C). Mismo patrón de
// impresión aislada que SaleReceipt/CashShiftReceipt (useReceiptPrintStyle).

const RECEP_CONTAINER_ID = 'gpulso-repair-reception-print'
const RECEP_STYLE_ID = 'gpulso-repair-reception-print-style'
const DELIV_CONTAINER_ID = 'gpulso-repair-delivery-print'
const DELIV_STYLE_ID = 'gpulso-repair-delivery-print-style'

const DIVIDER = '═══════════════════════════════'
const SUBDIV = '───────────────────────────────'

// PLACEHOLDERS legales (el texto real lo definirá el cliente).
const LEGAL_RECEPCION =
  'El equipo se entrega para diagnóstico y/o reparación. Pasados 30 días sin ' +
  'reclamar, el establecimiento no se hace responsable. Presenta este ' +
  'comprobante para retirar. [Texto legal pendiente de definir.]'
const LEGAL_GARANTIA =
  'Garantía sobre la reparación realizada. No cubre daños nuevos, golpes ni ' +
  'humedad posteriores. [Texto de garantía pendiente de definir.]'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface RepairReceiptEquipo {
  order_number: number
  marca: string
  modelo: string
  imei_serial: string | null
  color: string | null
}

export interface RepairReceptionData extends RepairReceiptEquipo {
  created_at: string | Date
  customer_name: string
  customer_phone: string | null
  falla_reportada: string
  checklist: RepairChecklist
  accesorios: string | null
  observaciones: string | null
}

export interface RepairDeliveryData extends RepairReceiptEquipo {
  delivered_at: string | Date
  customer_name: string
  precio: number
  payment_method: PaymentMethod
  cash_received: number | null
}

interface WithStore {
  storeName: string
  printedAt: Date
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

const wrapStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  lineHeight: 1.4,
  color: '#1a1a1a',
  background: '#fff',
  padding: '4mm',
  width: '80mm',
  boxSizing: 'border-box',
}
const muted: React.CSSProperties = { color: '#525252' }

function Line({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between' }}>{children}</div>
}

function ChecklistBlock({
  title,
  items,
  values,
  color,
}: {
  title: string
  items: { key: string; label: string }[]
  values: Record<string, boolean> | undefined
  color: string
}) {
  const marked = items.filter((it) => values?.[it.key])
  return (
    <div style={{ margin: '4px 0' }}>
      <div style={{ fontWeight: 700, color }}>{title}</div>
      {marked.length === 0 ? (
        <div style={muted}>— ninguno</div>
      ) : (
        marked.map((it) => <div key={it.key}>• {it.label}</div>)
      )}
    </div>
  )
}

function EquipoBlock({ equipo }: { equipo: RepairReceiptEquipo }) {
  return (
    <div style={{ margin: '6px 0' }}>
      <div style={{ fontWeight: 700 }}>
        {equipo.marca} {equipo.modelo}
      </div>
      {equipo.color && <Line><span style={muted}>Color</span><span>{equipo.color}</span></Line>}
      <Line>
        <span style={muted}>IMEI/Serial</span>
        <span style={{ fontWeight: 700 }}>{equipo.imei_serial || '—'}</span>
      </Line>
    </div>
  )
}

// ── RECEPCIÓN (copia cliente) ─────────────────────────────────────────────────

export function RepairReceptionReceipt({
  data,
  storeName,
  printedAt,
}: {
  data: RepairReceptionData
} & WithStore) {
  return (
    <div style={wrapStyle}>
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>{storeName || 'Taller'}</div>
        <div style={{ fontSize: 11, ...muted }}>Comprobante de recepción</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
          RECEPCIÓN #{data.order_number}
        </div>
      </div>

      <div style={muted}>{DIVIDER}</div>

      <div style={{ margin: '6px 0' }}>
        <Line><span style={muted}>Fecha</span><span>{fmtDateTime(data.created_at)}</span></Line>
        <Line><span style={muted}>Cliente</span><span style={{ fontWeight: 700 }}>{data.customer_name}</span></Line>
        {data.customer_phone && (
          <Line><span style={muted}>Teléfono</span><span>{data.customer_phone}</span></Line>
        )}
      </div>

      <div style={muted}>{SUBDIV}</div>
      <EquipoBlock equipo={data} />

      <div style={muted}>{SUBDIV}</div>
      <div style={{ margin: '4px 0' }}>
        <div style={{ fontWeight: 700 }}>Falla reportada</div>
        <div>{data.falla_reportada}</div>
      </div>

      <ChecklistBlock title="Daños al recibir" items={CHECKLIST_DANOS} values={data.checklist.danos} color="#b45309" />
      <ChecklistBlock title="Verificaciones" items={CHECKLIST_VERIFICACIONES} values={data.checklist.verificaciones} color="#047857" />

      {data.accesorios && (
        <div style={{ margin: '4px 0' }}>
          <div style={{ fontWeight: 700 }}>Accesorios</div>
          <div>{data.accesorios}</div>
        </div>
      )}
      {data.observaciones && (
        <div style={{ margin: '4px 0' }}>
          <div style={{ fontWeight: 700 }}>Observaciones</div>
          <div>{data.observaciones}</div>
        </div>
      )}

      <div style={muted}>{DIVIDER}</div>
      <div style={{ fontSize: 9, ...muted, marginTop: 4 }}>{LEGAL_RECEPCION}</div>
      <div style={{ textAlign: 'center', fontSize: 9, ...muted, marginTop: 6 }}>
        Impreso {fmtDateTime(printedAt)}
      </div>
    </div>
  )
}

// ── ENTREGA / PAGO ────────────────────────────────────────────────────────────

export function RepairDeliveryReceipt({
  data,
  storeName,
  printedAt,
}: {
  data: RepairDeliveryData
} & WithStore) {
  const methodLabel = PAYMENT_METHODS[data.payment_method]?.label ?? data.payment_method
  const change =
    data.cash_received != null && data.cash_received > data.precio
      ? data.cash_received - data.precio
      : 0
  return (
    <div style={wrapStyle}>
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>{storeName || 'Taller'}</div>
        <div style={{ fontSize: 11, ...muted }}>Comprobante de entrega</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
          ENTREGA #{data.order_number}
        </div>
      </div>

      <div style={muted}>{DIVIDER}</div>

      <div style={{ margin: '6px 0' }}>
        <Line><span style={muted}>Fecha</span><span>{fmtDateTime(data.delivered_at)}</span></Line>
        <Line><span style={muted}>Cliente</span><span style={{ fontWeight: 700 }}>{data.customer_name}</span></Line>
      </div>

      <div style={muted}>{SUBDIV}</div>
      <EquipoBlock equipo={data} />

      <div style={muted}>{SUBDIV}</div>
      <div style={{ margin: '6px 0' }}>
        <Line>
          <span style={{ fontWeight: 700 }}>TOTAL</span>
          <span style={{ fontWeight: 700 }}>{fmtCOP(data.precio)}</span>
        </Line>
        <Line><span style={muted}>Método</span><span>{methodLabel}</span></Line>
        {data.payment_method === 'cash' && data.cash_received != null && (
          <>
            <Line><span style={muted}>Recibido</span><span>{fmtCOP(data.cash_received)}</span></Line>
            <Line><span style={muted}>Cambio</span><span>{fmtCOP(change)}</span></Line>
          </>
        )}
      </div>

      <div style={muted}>{DIVIDER}</div>
      <div style={{ fontSize: 9, ...muted, marginTop: 4 }}>{LEGAL_GARANTIA}</div>
      <div style={{ textAlign: 'center', fontSize: 9, ...muted, marginTop: 6 }}>
        Impreso {fmtDateTime(printedAt)}
      </div>
    </div>
  )
}

// ── Contenedores de impresión (ocultos en pantalla, visibles al imprimir) ─────

export function RepairReceptionReceiptPrint(props: { data: RepairReceptionData } & WithStore) {
  useReceiptPrintStyle(RECEP_STYLE_ID, RECEP_CONTAINER_ID)
  return (
    <div id={RECEP_CONTAINER_ID} style={{ display: 'none' }}>
      <RepairReceptionReceipt {...props} />
    </div>
  )
}

export function RepairDeliveryReceiptPrint(props: { data: RepairDeliveryData } & WithStore) {
  useReceiptPrintStyle(DELIV_STYLE_ID, DELIV_CONTAINER_ID)
  return (
    <div id={DELIV_CONTAINER_ID} style={{ display: 'none' }}>
      <RepairDeliveryReceipt {...props} />
    </div>
  )
}
