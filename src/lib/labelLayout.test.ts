import { describe, expect, it } from 'vitest'
import {
  DOT_MM,
  LABEL_GUIDE_ATTR,
  LABEL_PRESETS,
  LABEL_SAFE_MARGIN_MM,
  MIN_MODULE_DOTS,
  QUIET_MODULES,
  SAMPLE_CODE_EAN13,
  SAMPLE_CODE_OWN,
  barcodeFit,
  encodeCode128,
  labelPage,
  labelPrintCss,
  labelSizeIssues,
  minLabelWidthFor,
  priceFontPt,
} from './labelLayout'

const size = (width_mm: number, height_mm: number) => ({ id: 'x', name: 'x', width_mm, height_mm })

describe('encodeCode128', () => {
  it('codifica el formato propio de 12 dígitos (101 módulos en subconjunto C)', () => {
    expect(encodeCode128(SAMPLE_CODE_OWN)?.length).toBe(101)
  })

  it('codifica un EAN-13 de fábrica como CODE128 (123 módulos)', () => {
    expect(encodeCode128(SAMPLE_CODE_EAN13)?.length).toBe(123)
  })

  it('rechaza vacío o caracteres fuera de ASCII imprimible', () => {
    expect(encodeCode128('')).toBeNull()
    expect(encodeCode128(null)).toBeNull()
    expect(encodeCode128('ñandú')).toBeNull()
  })
})

describe('barcodeFit — etiqueta de 40mm (36mm útiles) a 203 dpi', () => {
  it('un punto mide 25,4/203 mm', () => {
    expect(DOT_MM).toBeCloseTo(0.1251, 4)
  })

  it('el formato propio (12 dígitos) cabe con barras de 2 puntos enteros dentro de los 36mm', () => {
    const fit = barcodeFit(encodeCode128(SAMPLE_CODE_OWN)!, 40)
    expect(fit.fits).toBe(true)
    expect(fit.moduleDots).toBe(MIN_MODULE_DOTS)
    expect(fit.barsMm).toBeCloseTo(101 * 2 * DOT_MM, 5) // 25,3mm
    expect(fit.barsMm).toBeLessThanOrEqual(40 - 2 * LABEL_SAFE_MARGIN_MM)
    expect(fit.totalMm).toBeLessThanOrEqual(40) // con zona blanca: 30,3mm
  })

  it('un EAN-13 de fábrica también cabe (barras 30,8mm, con zona blanca 35,8mm)', () => {
    const fit = barcodeFit(encodeCode128(SAMPLE_CODE_EAN13)!, 40)
    expect(fit.fits).toBe(true)
    expect(fit.barsMm).toBeLessThanOrEqual(36)
    expect(fit.totalMm).toBeCloseTo((123 + 2 * QUIET_MODULES) * 2 * DOT_MM, 5)
  })

  it('3 puntos no cabe en 40mm (barras de 37,9mm > 36 útiles): se queda en 2', () => {
    expect(barcodeFit(encodeCode128(SAMPLE_CODE_OWN)!, 40).moduleDots).toBe(2)
  })

  it('un código alfanumérico largo no cabe: se reporta en vez de imprimir barras ilegibles', () => {
    const fit = barcodeFit(encodeCode128('CEL-A15-128-NEG')!, 40)
    expect(fit.fits).toBe(false)
    expect(fit.moduleDots).toBe(0)
  })
})

describe('labelPage — una etiqueta por página, tamaño exacto', () => {
  it('troquelado: hoja = ancho × alto de la etiqueta (ignora la separación)', () => {
    expect(labelPage(size(40, 30), 'die_cut', 3)).toEqual({ pageWidthMm: 40, pageHeightMm: 30 })
  })

  it('continuo: hoja = ancho × (alto + margen de corte)', () => {
    expect(labelPage(size(40, 30), 'continuous', 2)).toEqual({ pageWidthMm: 40, pageHeightMm: 32 })
  })

  it('el margen de corte se limita a 0..10mm', () => {
    expect(labelPage(size(40, 30), 'continuous', -5).pageHeightMm).toBe(30)
    expect(labelPage(size(40, 30), 'continuous', 50).pageHeightMm).toBe(40)
  })
})

describe('labelPrintCss', () => {
  it('@page del tamaño exacto (válido para Chrome, no "auto")', () => {
    const css = labelPrintCss('lbl', labelPage(size(40, 30), 'die_cut', 0))
    expect(css).toContain('size: 40mm 30mm')
    expect(css).not.toContain('auto;')
  })

  it('todo en negro y sin la guía de pantalla', () => {
    const css = labelPrintCss('lbl', labelPage(size(40, 30), 'die_cut', 0))
    expect(css).toContain('#lbl, #lbl * { color: #000 !important; }')
    expect(css).toContain(`#lbl [${LABEL_GUIDE_ATTR}] { outline: none !important; }`)
  })
})

describe('priceFontPt', () => {
  it('precio corto en 16pt', () => {
    expect(priceFontPt('$ 45.000', 36)).toBe(16)
  })

  it('precio largo se reduce para caber en 36mm, sin bajar de 10pt', () => {
    const pt = priceFontPt('$ 12.999.000', 36)
    expect(pt).toBeLessThan(16)
    expect(pt).toBeGreaterThanOrEqual(10)
    expect('$ 12.999.000'.length * 0.6 * pt * (25.4 / 72)).toBeLessThanOrEqual(36)
  })
})

describe('labelSizeIssues', () => {
  it('rechaza etiquetas más anchas que el máximo imprimible (48mm por defecto)', () => {
    expect(labelSizeIssues(size(50, 30), 48).some((i) => i.level === 'block')).toBe(true)
    expect(labelSizeIssues(size(40, 30), 48)).toEqual([])
  })

  it('demasiado angosta para el código propio → bloquea', () => {
    expect(minLabelWidthFor(SAMPLE_CODE_OWN)).toBeGreaterThan(29)
    expect(labelSizeIssues(size(28, 30), 40).some((i) => i.level === 'block')).toBe(true)
  })

  it('angosta para un EAN-13 pero apta para el propio → advierte', () => {
    const w = Math.ceil(minLabelWidthFor(SAMPLE_CODE_OWN))
    const issues = labelSizeIssues(size(w, 30), 40)
    expect(issues.some((i) => i.level === 'block')).toBe(false)
    expect(issues.some((i) => i.level === 'warn')).toBe(true)
  })

  it('alto: bloquea bajo 20mm y advierte bajo 25mm', () => {
    expect(labelSizeIssues(size(40, 18), 40).some((i) => i.level === 'block')).toBe(true)
    expect(labelSizeIssues(size(40, 20), 40).some((i) => i.level === 'warn')).toBe(true)
  })

  it('tamaños rápidos: 40×30, 40×40 y 40×50, todos sin avisos', () => {
    expect(LABEL_PRESETS.map((p) => p.name)).toEqual(['40×30', '40×40', '40×50'])
    for (const p of LABEL_PRESETS) {
      expect(labelSizeIssues(size(p.width_mm, p.height_mm), 48)).toEqual([])
    }
  })
})
