import { fmtCOP } from '@/lib/formatters'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { fmtReceiptDateTime } from '@/lib/receiptFormat'
import {
  CHECKLIST_DANOS,
  CHECKLIST_VERIFICACIONES,
} from '@/lib/repairs'
import type { PaymentMethod, RepairChecklist } from '@/types/database.types'
import {
  Divider,
  Line,
  PrintedAt,
  ReceiptHeader,
  ReceiptPrintContainer,
  ReceiptShell,
  Section,
  SectionTitle,
  SmallText,
} from '@/components/receipts/ReceiptParts'
import { useReceiptInk } from '@/components/receipts/receiptContext'

// Comprobantes térmicos del taller (Fase 3 / Bloque C). Mismo patrón de
// impresión aislada que el resto de comprobantes (ReceiptParts), al ancho de
// papel de la tienda (58/80mm).

const RECEP_CONTAINER_ID = 'gpulso-repair-reception-print'
const RECEP_STYLE_ID = 'gpulso-repair-reception-print-style'
const DELIV_CONTAINER_ID = 'gpulso-repair-delivery-print'
const DELIV_STYLE_ID = 'gpulso-repair-delivery-print-style'

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

// ── Bloques ───────────────────────────────────────────────────────────────────

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
  const { muted } = useReceiptInk()
  const marked = items.filter((it) => values?.[it.key])
  return (
    <div style={{ margin: '4px 0' }}>
      <SectionTitle color={color}>{title}</SectionTitle>
      {marked.length === 0 ? (
        <div style={muted}>— ninguno</div>
      ) : (
        marked.map((it) => <div key={it.key}>• {it.label}</div>)
      )}
    </div>
  )
}

/**
 * Equipo + IMEI. El IMEI va en su PROPIO renglón y en grande: es el dato con
 * el que se reclama el equipo en el mostrador (y "IMEI/Serial" + 15 dígitos no
 * cabe en un renglón de 58mm).
 */
function EquipoBlock({ equipo }: { equipo: RepairReceiptEquipo }) {
  const { muted } = useReceiptInk()
  return (
    <div style={{ margin: '6px 0' }}>
      <div style={{ fontWeight: 700 }}>
        {equipo.marca} {equipo.modelo}
      </div>
      {equipo.color && <Line label="Color" value={equipo.color} />}
      <div style={{ ...muted, marginTop: 2 }}>IMEI / Serial</div>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.5, wordBreak: 'break-all' }}>
        {equipo.imei_serial || '—'}
      </div>
    </div>
  )
}

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ margin: '4px 0' }}>
      <SectionTitle>{title}</SectionTitle>
      <div>{text}</div>
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
    <ReceiptShell>
      <ReceiptHeader
        storeName={storeName}
        caption="Comprobante de recepción"
        docTitle={`RECEPCIÓN #${data.order_number}`}
      />

      <Divider strong />

      <Section>
        <Line label="Fecha" value={fmtReceiptDateTime(data.created_at)} />
        <Line label="Cliente" value={data.customer_name} valueStyle={{ fontWeight: 700 }} />
        {data.customer_phone && <Line label="Teléfono" value={data.customer_phone} />}
      </Section>

      <Divider />
      <EquipoBlock equipo={data} />

      <Divider />
      <TextBlock title="Falla reportada" text={data.falla_reportada} />

      <ChecklistBlock title="Daños al recibir" items={CHECKLIST_DANOS} values={data.checklist.danos} color="#b45309" />
      <ChecklistBlock title="Verificaciones" items={CHECKLIST_VERIFICACIONES} values={data.checklist.verificaciones} color="#047857" />

      {data.accesorios && <TextBlock title="Accesorios" text={data.accesorios} />}
      {data.observaciones && <TextBlock title="Observaciones" text={data.observaciones} />}

      <Divider strong />
      <SmallText style={{ marginTop: 4 }}>{LEGAL_RECEPCION}</SmallText>
      <PrintedAt at={printedAt} />
    </ReceiptShell>
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
    <ReceiptShell>
      <ReceiptHeader
        storeName={storeName}
        caption="Comprobante de entrega"
        docTitle={`ENTREGA #${data.order_number}`}
      />

      <Divider strong />

      <Section>
        <Line label="Fecha" value={fmtReceiptDateTime(data.delivered_at)} />
        <Line label="Cliente" value={data.customer_name} valueStyle={{ fontWeight: 700 }} />
      </Section>

      <Divider />
      <EquipoBlock equipo={data} />

      <Divider />
      <Section>
        <Line strong label="TOTAL" value={fmtCOP(data.precio)} />
        <Line label="Método" value={methodLabel} />
        {data.payment_method === 'cash' && data.cash_received != null && (
          <>
            <Line label="Recibido" value={fmtCOP(data.cash_received)} />
            <Line label="Cambio" value={fmtCOP(change)} />
          </>
        )}
      </Section>

      <Divider strong />
      <SmallText style={{ marginTop: 4 }}>{LEGAL_GARANTIA}</SmallText>
      <PrintedAt at={printedAt} />
    </ReceiptShell>
  )
}

// ── Contenedores de impresión (ocultos en pantalla, visibles al imprimir) ─────

export function RepairReceptionReceiptPrint(props: { data: RepairReceptionData } & WithStore) {
  return (
    <ReceiptPrintContainer containerId={RECEP_CONTAINER_ID} styleId={RECEP_STYLE_ID}>
      <RepairReceptionReceipt {...props} />
    </ReceiptPrintContainer>
  )
}

export function RepairDeliveryReceiptPrint(props: { data: RepairDeliveryData } & WithStore) {
  return (
    <ReceiptPrintContainer containerId={DELIV_CONTAINER_ID} styleId={DELIV_STYLE_ID}>
      <RepairDeliveryReceipt {...props} />
    </ReceiptPrintContainer>
  )
}
