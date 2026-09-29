// Geometría de los comprobantes térmicos según el ancho de papel de la tienda
// (stores.config.receipt_width_mm). Lógica pura: la usan el contenedor de
// pantalla (ReceiptShell), el CSS de impresión (receiptPrintCss) y la
// Configuración, para que la vista previa y la impresión nunca diverjan.
//
// Modelo: la hoja mide lo que mide el papel (@page size) y el comprobante
// ocupa esa hoja completa; el margen interno horizontal deja el texto dentro
// del área IMPRIMIBLE del cabezal, centrada en el papel.
//
//   80mm → 72mm imprimibles → margen 4mm por lado (valores históricos).
//   58mm → 48mm imprimibles (384 puntos a 203 dpi, Goojprt PT-260) → 5mm.

export type ReceiptWidthMm = 58 | 80

export const RECEIPT_WIDTHS: readonly ReceiptWidthMm[] = [80, 58]
export const DEFAULT_RECEIPT_WIDTH: ReceiptWidthMm = 80

export function isReceiptWidth(value: unknown): value is ReceiptWidthMm {
  return value === 58 || value === 80
}

export interface ReceiptLayout {
  /** Ancho del papel = ancho de la hoja (@page) y del comprobante. */
  widthMm: ReceiptWidthMm
  /** Área imprimible del cabezal (ancho útil del texto). */
  printableMm: number
  /** Margen interno horizontal = (papel - imprimible) / 2. */
  paddingXMm: number
  paddingYMm: number
  /**
   * Diagramación compacta: líneas de detalle en dos renglones y etiquetas que
   * bajan el valor al renglón siguiente cuando no caben (~26-28 caracteres).
   */
  compact: boolean
  /** Todo el texto en negro: los grises salen tramados y débiles en térmica. */
  monochrome: boolean
  /** Tamaño mínimo de letra (px) para textos chicos: legal, marca, "Impreso". */
  minFontPx: number
}

// AFINAR AQUÍ tras la prueba física: si la PT-260 corta texto por un lado,
// ajustar printableMm/paddingXMm del 58 (ver docs/PRUEBA-IMPRESORA-58MM.md).
const LAYOUTS: Record<ReceiptWidthMm, ReceiptLayout> = {
  80: {
    widthMm: 80,
    printableMm: 72,
    paddingXMm: 4,
    paddingYMm: 4,
    compact: false,
    monochrome: false,
    minFontPx: 9,
  },
  58: {
    widthMm: 58,
    printableMm: 48,
    paddingXMm: 5,
    paddingYMm: 3,
    compact: true,
    monochrome: true,
    minFontPx: 10,
  },
}

export function receiptLayout(width: unknown): ReceiptLayout {
  return LAYOUTS[isReceiptWidth(width) ? width : DEFAULT_RECEIPT_WIDTH]
}

/** Tamaño de letra respetando el mínimo del ancho (10px en 58mm). */
export function receiptFontPx(layout: ReceiptLayout, px: number): number {
  return Math.max(px, layout.minFontPx)
}

/** Color de tinta: en monocromo todo es negro; en 80mm respeta el color. */
export function receiptInk(layout: ReceiptLayout, color: string): string {
  return layout.monochrome ? '#000' : color
}

/** Atributo que marca la guía punteada del área imprimible (solo pantalla). */
export const RECEIPT_GUIDE_ATTR = 'data-receipt-guide'

/**
 * CSS de impresión aislada para un contenedor de comprobante: oculta el resto
 * del body, fija la hoja al ancho del papel y quita la guía de pantalla. En
 * monocromo fuerza la tinta negra también en impresión (defensa por si algún
 * color quedó fuera del contexto).
 */
export function receiptPrintCss(containerId: string, layout: ReceiptLayout): string {
  const id = `#${containerId}`
  const mono = layout.monochrome
    ? `
        ${id}, ${id} * { color: #000 !important; border-color: #000 !important; }`
    : ''
  return `
      @media print {
        body > * { visibility: hidden !important; }
        ${id},
        ${id} * { visibility: visible !important; }
        ${id} {
          display: block !important;
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: ${layout.widthMm}mm !important;
          padding: 0 !important;
          margin: 0 !important;
          box-sizing: border-box !important;
          background: #fff !important;
        }
        ${id} [${RECEIPT_GUIDE_ATTR}] { outline: none !important; }${mono}
        @page { margin: 0; size: ${layout.widthMm}mm auto; }
      }
    `
}
