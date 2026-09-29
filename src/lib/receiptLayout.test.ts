import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RECEIPT_WIDTH,
  RECEIPT_GUIDE_ATTR,
  isReceiptWidth,
  receiptFontPx,
  receiptInk,
  receiptLayout,
  receiptPrintCss,
} from './receiptLayout'

describe('receiptLayout', () => {
  it('80mm conserva la geometría histórica (72mm útiles, margen 4mm, en color)', () => {
    const l = receiptLayout(80)
    expect(l).toMatchObject({ widthMm: 80, printableMm: 72, paddingXMm: 4, compact: false, monochrome: false })
  })

  it('58mm deja 48mm útiles (384 puntos a 203 dpi) centrados, compacto y en negro', () => {
    const l = receiptLayout(58)
    expect(l).toMatchObject({ widthMm: 58, printableMm: 48, compact: true, monochrome: true })
    expect(l.widthMm - 2 * l.paddingXMm).toBe(l.printableMm)
  })

  it('en ambos anchos el margen interno deja el texto dentro del área imprimible', () => {
    for (const w of [58, 80] as const) {
      const l = receiptLayout(w)
      expect(l.widthMm - 2 * l.paddingXMm).toBe(l.printableMm)
    }
  })

  it('un valor inválido o ausente cae al default de 80mm', () => {
    expect(DEFAULT_RECEIPT_WIDTH).toBe(80)
    for (const v of [undefined, null, 0, 57, '58', 'abc', 100]) {
      expect(receiptLayout(v).widthMm).toBe(80)
    }
  })

  it('isReceiptWidth solo acepta los números 58 y 80', () => {
    expect(isReceiptWidth(58)).toBe(true)
    expect(isReceiptWidth(80)).toBe(true)
    expect(isReceiptWidth('58')).toBe(false)
    expect(isReceiptWidth(72)).toBe(false)
  })
})

describe('receiptFontPx / receiptInk', () => {
  it('en 58mm ningún texto baja de 10px (el legal de 9px sube a 10)', () => {
    expect(receiptFontPx(receiptLayout(58), 9)).toBe(10)
    expect(receiptFontPx(receiptLayout(58), 14)).toBe(14)
  })

  it('en 80mm respeta los 9px históricos', () => {
    expect(receiptFontPx(receiptLayout(80), 9)).toBe(9)
  })

  it('en 58mm toda la tinta es negra; en 80mm respeta el color', () => {
    expect(receiptInk(receiptLayout(58), '#525252')).toBe('#000')
    expect(receiptInk(receiptLayout(58), '#dc2626')).toBe('#000')
    expect(receiptInk(receiptLayout(80), '#dc2626')).toBe('#dc2626')
  })
})

describe('receiptPrintCss', () => {
  it('fija la hoja y el contenedor al ancho del papel', () => {
    const css = receiptPrintCss('c58', receiptLayout(58))
    expect(css).toContain('size: 58mm auto')
    expect(css).toContain('width: 58mm !important')
    expect(css).not.toContain('80mm')
  })

  it('80mm sigue imprimiendo a 80mm', () => {
    const css = receiptPrintCss('c80', receiptLayout(80))
    expect(css).toContain('size: 80mm auto')
    expect(css).toContain('width: 80mm !important')
  })

  it('aísla solo el contenedor indicado y quita la guía de pantalla', () => {
    const css = receiptPrintCss('mi-recibo', receiptLayout(80))
    expect(css).toMatch(/#mi-recibo \* \{ visibility: visible !important; \}/)
    expect(css).toContain(`#mi-recibo [${RECEIPT_GUIDE_ATTR}] { outline: none !important; }`)
  })

  it('fuerza tinta negra solo en 58mm', () => {
    expect(receiptPrintCss('x', receiptLayout(58))).toContain('color: #000 !important')
    expect(receiptPrintCss('x', receiptLayout(80))).not.toContain('color: #000 !important')
  })
})
