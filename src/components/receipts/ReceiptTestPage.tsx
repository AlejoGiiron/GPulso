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
} from './ReceiptParts'
import { useReceiptInk } from './receiptContext'

// Página de prueba para calibrar la impresora térmica sin datos reales: marca
// los bordes del área útil, cuenta caracteres por renglón y muestra los casos
// que el ancho compacto tuvo que rediagramar (línea larga, IMEI, texto legal).

const TEST_PRINT_CONTAINER_ID = 'gpulso-receipt-test-print'
const TEST_PRINT_STYLE_ID = 'gpulso-receipt-test-print-style'

// 40 caracteres numerados por decenas: lo que se lea completo en un renglón es
// la capacidad real del papel a 11px.
const RULER = '1234567890'.repeat(4)

export function ReceiptTestPage({ storeName, printedAt }: { storeName: string; printedAt: Date }) {
  const { layout, fs } = useReceiptInk()
  return (
    <ReceiptShell>
      <ReceiptHeader storeName={storeName} caption="Calibración de impresora" docTitle="PÁGINA DE PRUEBA" />

      <Divider strong />

      <Section>
        <Line label="Papel:" value={`${layout.widthMm} mm`} />
        <Line label="Ancho útil:" value={`${layout.printableMm} mm`} />
      </Section>

      <SectionTitle>1. Bordes del área útil</SectionTitle>
      <div
        style={{
          border: '1px solid #000',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '2px 1px',
          fontWeight: 700,
        }}
      >
        <span>◀</span>
        <span style={{ fontSize: fs(10) }}>{layout.printableMm} mm</span>
        <span>▶</span>
      </div>
      <SmallText style={{ marginTop: 2 }}>
        Deben verse las dos flechas y el recuadro completo. Si se corta un lado,
        anota cuál y cuántos mm.
      </SmallText>

      <Divider />

      <SectionTitle>2. Caracteres por renglón</SectionTitle>
      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>{RULER}</div>
      <SmallText>Anota el último número que se lee completo.</SmallText>

      <Divider />

      <SectionTitle>3. Renglón largo</SectionTitle>
      <Line label="Abonos de separados:" value="$1.207.000" />
      <Line strong label="Total ventas:" value="$12.253.000" />

      <Divider />

      <SectionTitle>4. IMEI</SectionTitle>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.5 }}>356938035643809</div>

      <Divider />

      <SectionTitle>5. Texto legal</SectionTitle>
      <SmallText>
        El equipo se entrega para diagnóstico y/o reparación. Pasados 30 días sin
        reclamar, el establecimiento no se hace responsable.
      </SmallText>

      <Divider strong />
      <PrintedAt at={printedAt} />
    </ReceiptShell>
  )
}

export function ReceiptTestPagePrint(props: { storeName: string; printedAt: Date }) {
  return (
    <ReceiptPrintContainer containerId={TEST_PRINT_CONTAINER_ID} styleId={TEST_PRINT_STYLE_ID}>
      <ReceiptTestPage {...props} />
    </ReceiptPrintContainer>
  )
}
