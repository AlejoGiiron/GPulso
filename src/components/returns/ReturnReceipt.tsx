import { fmtCOP } from '@/lib/formatters'
import { fmtReceiptDateTime } from '@/lib/receiptFormat'
import type { ReturnReceiptData, ReturnReceiptLine } from '@/lib/returnReceipt'
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

// Comprobante de devolución / cambio. Antes el botón "Imprimir" de Devoluciones
// imprimía la pantalla entera (sidebar incluido); ahora imprime este
// comprobante aislado, al ancho de papel de la tienda, como el resto.

const RETURN_PRINT_CONTAINER_ID = 'gpulso-return-receipt-print'
const RETURN_PRINT_STYLE_ID = 'gpulso-return-receipt-print-style'

export interface ReturnReceiptProps {
  data: ReturnReceiptData
  storeName: string
  printedAt: Date
}

function ItemList({ items }: { items: ReturnReceiptLine[] }) {
  const { muted, fs } = useReceiptInk()
  return (
    <>
      {items.map((it) => (
        <div key={it.key} style={{ marginBottom: 2 }}>
          {it.brand && (
            <div
              style={{ ...muted, fontSize: fs(9), textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              {it.brand}
            </div>
          )}
          <div>{it.name}</div>
          {(it.size || it.color) && (
            <div style={muted}>
              {[it.size ? `V:${it.size}` : null, it.color ? `C:${it.color}` : null]
                .filter(Boolean)
                .join(' ')}
            </div>
          )}
          <Line
            indent
            label={`${it.qty} × ${fmtCOP(it.unitPrice)}`}
            value={fmtCOP(it.qty * it.unitPrice)}
          />
        </div>
      ))}
    </>
  )
}

export function ReturnReceipt({ data, storeName, printedAt }: ReturnReceiptProps) {
  const { muted } = useReceiptInk()
  const isReturn = data.kind === 'return'
  const title = isReturn ? 'DEVOLUCIÓN' : 'CAMBIO'

  return (
    <ReceiptShell>
      <ReceiptHeader storeName={storeName} docTitle={`${title} #${data.reference}`} />

      <Divider strong />

      <Section>
        <Line label="Fecha:" value={fmtReceiptDateTime(data.created_at)} />
        <Line label="Venta original:" value={`#${data.order_number}`} />
        {data.customer && (
          <>
            <Line
              label="Cliente:"
              value={data.customer.full_name}
              valueStyle={{ fontWeight: 600 }}
            />
            {data.customer.phone && <Line label="Tel:" value={data.customer.phone} />}
          </>
        )}
      </Section>

      <Divider strong />

      <Section>
        <SectionTitle>ÍTEMS DEVUELTOS</SectionTitle>
        <ItemList items={data.returned} />
      </Section>

      {!isReturn && data.newItems.length > 0 && (
        <>
          <Divider />
          <Section>
            <SectionTitle>ÍTEMS NUEVOS</SectionTitle>
            <ItemList items={data.newItems} />
          </Section>
        </>
      )}

      <Divider strong />

      <Section>
        {isReturn ? (
          <Line strong label="Reembolso:" value={fmtCOP(data.refundTotal)} />
        ) : data.exchangeDifference > 0 ? (
          <Line strong label="Cobra al cliente:" value={fmtCOP(data.exchangeAmount)} />
        ) : data.exchangeDifference < 0 ? (
          <Line strong label="Devuelve la tienda:" value={fmtCOP(data.exchangeAmount)} />
        ) : (
          <Line strong label="Diferencia:" value={fmtCOP(0)} />
        )}
        <Line
          label={isReturn ? 'Método reembolso:' : 'Método pago:'}
          value={data.methodLabel}
        />
      </Section>

      <Divider strong />

      <div style={{ textAlign: 'center', marginTop: 6 }}>
        <div style={{ fontWeight: 600 }}>Gracias por su preferencia</div>
        <div style={{ ...muted, marginTop: 2 }}>Conserva este comprobante.</div>
      </div>

      <PrintedAt at={printedAt} />
    </ReceiptShell>
  )
}

export function ReturnReceiptPrint(props: ReturnReceiptProps) {
  return (
    <ReceiptPrintContainer
      containerId={RETURN_PRINT_CONTAINER_ID}
      styleId={RETURN_PRINT_STYLE_ID}
    >
      <ReturnReceipt {...props} />
    </ReceiptPrintContainer>
  )
}
