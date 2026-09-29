import type { CSSProperties, ReactNode } from 'react'
import { useBusinessName } from '@/hooks/useOrg'
import { receiptHeaderNames } from '@/lib/receiptHeader'
import { fmtReceiptDateTime } from '@/lib/receiptFormat'
import { RECEIPT_GUIDE_ATTR } from '@/lib/receiptLayout'
import { useReceiptPrintStyle } from '@/lib/receiptPrint'
import { useReceiptInk, useReceiptLayout } from './receiptContext'

// Piezas compartidas de los comprobantes térmicos (venta, separado, cuadre,
// taller, devolución). El ancho sale de la tienda (58/80mm, receiptLayout):
// la vista previa en pantalla mide lo mismo que el papel y muestra con una
// guía punteada el área que el cabezal realmente imprime.

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** Contenedor del comprobante: ancho del papel + margen hasta el área útil. */
export function ReceiptShell({ children }: { children: ReactNode }) {
  const { layout, color } = useReceiptInk()
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 11,
        lineHeight: 1.4,
        color: color('#1a1a1a'),
        background: '#fff',
        padding: `${layout.paddingYMm}mm ${layout.paddingXMm}mm`,
        width: `${layout.widthMm}mm`,
        boxSizing: 'border-box',
        overflowWrap: 'anywhere',
      }}
    >
      {/* Guía del área imprimible (solo pantalla; el CSS de impresión la quita). */}
      <div
        {...{ [RECEIPT_GUIDE_ATTR]: '' }}
        style={{ outline: '1px dashed #cbd5e1', outlineOffset: 1 }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Encabezado común: negocio (organizations.name) en grande, tienda debajo si
 * difiere, líneas descriptivas opcionales y el título del documento.
 */
export function ReceiptHeader({
  storeName,
  docTitle,
  caption,
}: {
  storeName: string
  docTitle: ReactNode
  caption?: ReactNode
}) {
  const { muted } = useReceiptInk()
  const header = receiptHeaderNames(useBusinessName(), storeName)
  return (
    <div style={{ textAlign: 'center', marginBottom: 6 }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1 }}>{header.title}</div>
      {header.subtitle && <div style={muted}>{header.subtitle}</div>}
      {caption && <div style={muted}>{caption}</div>}
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{docTitle}</div>
    </div>
  )
}

/** Separador en CSS (antes: 31 caracteres fijos que no caben en 48mm). */
export function Divider({ strong = false }: { strong?: boolean }) {
  const { color } = useReceiptInk()
  return (
    <div
      role="separator"
      style={{
        borderTop: strong ? `3px double ${color('#525252')}` : `1px dashed ${color('#737373')}`,
        margin: strong ? '5px 0' : '3px 0',
      }}
    />
  )
}

export function Section({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ margin: '6px 0', ...style }}>{children}</div>
}

export function SectionTitle({ children, color }: { children: ReactNode; color?: string }) {
  const ink = useReceiptInk()
  return (
    <div style={{ fontWeight: 700, marginBottom: 2, color: color ? ink.color(color) : undefined }}>
      {children}
    </div>
  )
}

interface LineProps {
  label: ReactNode
  value: ReactNode
  /** Etiqueta y valor en negrita (totales). */
  strong?: boolean
  /** Etiqueta en tinta normal en vez de secundaria. */
  plainLabel?: boolean
  mutedValue?: boolean
  /** Sangría de un carácter para sub-líneas (desgloses). */
  indent?: boolean
  valueStyle?: CSSProperties
}

/**
 * Renglón etiqueta ↔ valor. Si no caben juntos (≈26 caracteres en 58mm), el
 * valor baja al renglón siguiente alineado a la derecha en vez de pisarse.
 */
export function Line({
  label,
  value,
  strong = false,
  plainLabel = false,
  mutedValue = false,
  indent = false,
  valueStyle,
}: LineProps) {
  const { muted } = useReceiptInk()
  const weight: CSSProperties | undefined = strong ? { fontWeight: 700 } : undefined
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        columnGap: '1ch',
      }}
    >
      <span
        style={{
          ...(strong || plainLabel ? undefined : muted),
          ...weight,
          paddingLeft: indent ? '1ch' : undefined,
        }}
      >
        {label}
      </span>
      <span
        style={{
          marginLeft: 'auto',
          textAlign: 'right',
          ...weight,
          ...(mutedValue ? muted : undefined),
          ...valueStyle,
        }}
      >
        {value}
      </span>
    </div>
  )
}

/** Texto chico (legal, condiciones, notas): 9px en 80mm, 10px mínimo en 58mm. */
export function SmallText({
  children,
  center = false,
  style,
}: {
  children: ReactNode
  center?: boolean
  style?: CSSProperties
}) {
  const { muted, fs } = useReceiptInk()
  return (
    <div style={{ ...muted, fontSize: fs(9), textAlign: center ? 'center' : undefined, ...style }}>
      {children}
    </div>
  )
}

export function PrintedAt({ at }: { at: Date }) {
  const { muted } = useReceiptInk()
  return (
    <div style={{ textAlign: 'center', ...muted, marginTop: 6 }}>
      Impreso: {fmtReceiptDateTime(at)}
    </div>
  )
}

/**
 * Contenedor oculto en pantalla y visible solo al imprimir, con el @media
 * print ajustado al ancho del papel de la tienda.
 */
export function ReceiptPrintContainer({
  containerId,
  styleId,
  children,
}: {
  containerId: string
  styleId: string
  children: ReactNode
}) {
  useReceiptPrintStyle(styleId, containerId, useReceiptLayout())
  return (
    <div id={containerId} style={{ display: 'none' }} aria-hidden="true">
      {children}
    </div>
  )
}
