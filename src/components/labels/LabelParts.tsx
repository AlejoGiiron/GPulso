import { Fragment, type ReactNode } from 'react'
import { fmtCOP } from '@/lib/formatters'
import {
  DOT_MM,
  LABEL_GUIDE_ATTR,
  LABEL_PADDING_Y_MM,
  LABEL_SAFE_MARGIN_MM,
  WARN_LABEL_HEIGHT_MM,
  barcodeFit,
  encodeCode128,
  labelPage,
  labelPrintCss,
  priceFontPt,
  type LabelMedia,
} from '@/lib/labelLayout'
import { usePrintCss } from '@/lib/receiptPrint'
import type { LabelFields, LabelSize } from '@/types/config.types'

// Etiqueta adhesiva para impresora térmica de etiquetas (ver labelLayout.ts).
// Contenido: nombre, precio en grande y código de barras (siempre). Todo negro,
// sin borde. La vista previa en pantalla usa el mismo componente a tamaño real.

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'

/**
 * Código de barras nítido: cada módulo mide un número ENTERO de puntos del
 * cabezal (203 dpi) y el SVG se dibuja sin antialiasing, así el driver no lo
 * rasteriza con barras de ancho irregular. Si no cabe, avisa en vez de
 * imprimir barras que el lector no va a leer.
 */
export function BarcodeBars({ code, labelWidthMm }: { code: string; labelWidthMm: number }) {
  const bits = encodeCode128(code)
  const fit = bits ? barcodeFit(bits, labelWidthMm) : null
  if (!bits || !fit?.fits) {
    return (
      <div
        style={{
          border: '0.3mm solid #000',
          fontSize: '6.5pt',
          fontWeight: 700,
          textAlign: 'center',
          padding: '1mm',
          lineHeight: 1.15,
        }}
      >
        CÓDIGO NO CABE
        <br />
        <span style={{ fontWeight: 400 }}>{code || '(sin código)'}</span>
      </div>
    )
  }
  // Rachas de '1' → un rect por barra (en unidades de módulo).
  const bars: { x: number; w: number }[] = []
  for (let i = 0; i < bits.length; ) {
    if (bits[i] === '1') {
      let j = i
      while (j < bits.length && bits[j] === '1') j++
      bars.push({ x: i, w: j - i })
      i = j
    } else i++
  }
  const widthMm = bits.length * fit.moduleDots * DOT_MM
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', minHeight: 0 }}>
      <svg
        viewBox={`0 0 ${bits.length} 10`}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        style={{ width: `${widthMm}mm`, flex: 1, minHeight: '5mm', display: 'block' }}
        aria-label={`Código de barras ${code}`}
      >
        {bars.map((b) => (
          <rect key={b.x} x={b.x} y={0} width={b.w} height={10} fill="#000" />
        ))}
      </svg>
      <div style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '7pt', letterSpacing: '0.08em', lineHeight: 1.1, marginTop: '0.4mm' }}>
        {code}
      </div>
    </div>
  )
}

export interface LabelContent {
  name: string
  brand: string | null
  variantText: string | null
  sku: string | null
  price: number
  code: string
}

/**
 * Marcas de borde para calibrar: esquinas en L y marcas a mitad de cada lado,
 * justo en el borde de la etiqueta. Si al imprimir se ven completas y pegadas
 * al borde físico, el área impresa coincide con la etiqueta. En SVG (no fondo
 * CSS) para que se impriman aunque "Gráficos de fondo" esté apagado.
 */
function CalibrationMarks({ size }: { size: LabelSize }) {
  const w = size.width_mm
  const h = size.height_mm
  const l = 3 // largo de la esquina (mm)
  const t = 1.5 // largo de la marca central (mm)
  const s = 0.4 // grosor (mm) ≈ 3 puntos
  const o = s / 2
  const d = [
    `M${o} ${l} V${o} H${l}`,
    `M${w - l} ${o} H${w - o} V${l}`,
    `M${o} ${h - l} V${h - o} H${l}`,
    `M${w - l} ${h - o} H${w - o} V${h - l}`,
    `M${w / 2} ${o} V${t}`,
    `M${w / 2} ${h - o} V${h - t}`,
    `M${o} ${h / 2} H${t}`,
    `M${w - o} ${h / 2} H${w - t}`,
  ].join(' ')
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke="#000" strokeWidth={s} />
    </svg>
  )
}

/**
 * Una etiqueta al tamaño exacto (mm). La guía punteada marca el área útil (solo
 * pantalla). Con `calibration`, agrega marcas de borde (etiquetas de prueba).
 */
export function LabelCard({
  size,
  fields,
  content,
  calibration = false,
}: {
  size: LabelSize
  fields: LabelFields
  content: LabelContent
  calibration?: boolean
}) {
  const usefulMm = size.width_mm - 2 * LABEL_SAFE_MARGIN_MM
  const compact = size.height_mm < WARN_LABEL_HEIGHT_MM
  const priceText = fmtCOP(content.price)
  const pricePt = Math.min(priceFontPt(priceText, usefulMm), compact ? 12 : 16)
  const topLine = [fields.brand ? content.brand : null, fields.sku ? content.sku : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      style={{
        position: 'relative',
        width: `${size.width_mm}mm`,
        height: `${size.height_mm}mm`,
        padding: `${LABEL_PADDING_Y_MM}mm ${LABEL_SAFE_MARGIN_MM}mm`,
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: '#fff',
        color: '#000',
        fontFamily: FONT,
      }}
    >
      <div
        {...{ [LABEL_GUIDE_ATTR]: '' }}
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          outline: '1px dashed #94a3b8',
          outlineOffset: 0,
        }}
      >
        {topLine && (
          <div style={{ fontSize: '6.5pt', fontWeight: 600, textTransform: 'uppercase', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {topLine}
          </div>
        )}
        {fields.name && (
          <div
            style={{
              fontSize: compact ? '8pt' : '9pt',
              fontWeight: 700,
              lineHeight: 1.15,
              display: '-webkit-box',
              WebkitLineClamp: compact ? 1 : 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
          >
            {content.name}
          </div>
        )}
        {fields.size_color && content.variantText && (
          <div style={{ fontSize: '7pt', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {content.variantText}
          </div>
        )}
        {fields.price && (
          <div style={{ fontSize: `${pricePt}pt`, fontWeight: 800, lineHeight: 1.05, whiteSpace: 'nowrap', marginTop: '0.3mm' }}>
            {priceText}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, marginTop: '0.8mm' }}>
          <BarcodeBars code={content.code} labelWidthMm={size.width_mm} />
        </div>
      </div>
      {calibration && <CalibrationMarks size={size} />}
    </div>
  )
}

/**
 * Hoja de impresión: una etiqueta por página del tamaño exacto (troquelado) o
 * con margen de corte debajo (continuo). Oculta en pantalla.
 */
export function LabelPrintSheet({
  containerId,
  styleId,
  size,
  media,
  gapMm,
  children,
}: {
  containerId: string
  styleId: string
  size: LabelSize
  media: LabelMedia
  gapMm: number
  children: ReactNode[]
}) {
  const page = labelPage(size, media, gapMm)
  usePrintCss(styleId, labelPrintCss(containerId, page))
  return (
    <div id={containerId} style={{ display: 'none' }} aria-hidden="true">
      {children.map((child, i) => (
        <Fragment key={i}>
          <div
            style={{
              width: `${page.pageWidthMm}mm`,
              height: `${page.pageHeightMm}mm`,
              overflow: 'hidden',
              breakAfter: i < children.length - 1 ? 'page' : 'auto',
              pageBreakAfter: i < children.length - 1 ? 'always' : 'auto',
            }}
          >
            {child}
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/** Vista previa a tamaño real de una página (etiqueta + margen de corte si es continuo). */
export function LabelPagePreview({
  size,
  media,
  gapMm,
  children,
}: {
  size: LabelSize
  media: LabelMedia
  gapMm: number
  children: ReactNode
}) {
  const page = labelPage(size, media, gapMm)
  const cutMm = page.pageHeightMm - size.height_mm
  return (
    <div style={{ width: `${page.pageWidthMm}mm`, boxShadow: '0 1px 4px rgba(0,0,0,.18)', background: '#fff' }}>
      {children}
      {cutMm > 0 && (
        <div
          style={{
            height: `${cutMm}mm`,
            borderTop: '1px dashed #94a3b8',
            fontSize: 8,
            color: '#94a3b8',
            textAlign: 'center',
            lineHeight: `${cutMm}mm`,
            overflow: 'hidden',
          }}
        >
          corte
        </div>
      )}
    </div>
  )
}
