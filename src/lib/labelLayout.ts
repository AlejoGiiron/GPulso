import JsBarcode from 'jsbarcode'
import type { LabelSize } from '@/types/config.types'

// Geometría de las etiquetas adhesivas para impresora térmica de etiquetas
// (203 dpi; ej. Goojprt PT-260 Label Maker, rollo de 40mm). Lógica pura: la usan
// la impresión, la vista previa y la validación de Configuración para que nunca
// diverjan.
//
// Una etiqueta = una página del TAMAÑO EXACTO de la etiqueta:
//   · Troquelado (caso principal): la impresora detecta el espacio entre
//     etiquetas; la hoja mide ancho × alto de la etiqueta.
//   · Continuo (alternativa): la hoja mide ancho × (alto + margen de corte).

// ── Impresora ────────────────────────────────────────────────────────────────

export const PRINTER_DPI = 203
/** Tamaño de un punto del cabezal (mm). */
export const DOT_MM = 25.4 / PRINTER_DPI

/**
 * Ancho máximo IMPRIMIBLE por defecto. Ficha del vendedor de la PT-260 Label
 * Maker: etiquetas de 20 a 50mm, "a maior largura imprimível é de 48 mm".
 */
export const DEFAULT_LABEL_MAX_WIDTH_MM = 48

/**
 * Margen lateral seguro: ni texto ni barras se acercan al borde (tolerancia de
 * posición de la etiqueta en el rollo y del cabezal). 40mm → 36mm útiles.
 * AFINAR AQUÍ tras la prueba física si la impresora corta un lado.
 */
export const LABEL_SAFE_MARGIN_MM = 2
export const LABEL_PADDING_Y_MM = 1.5

// ── Código de barras (CODE128, el formato que ya usan las variantes) ─────────

/** Barra mínima para lectores de mostrador: 2 puntos = 0,25mm. */
export const MIN_MODULE_DOTS = 2
/** Tope para no hacer barras innecesariamente anchas. */
export const MAX_MODULE_DOTS = 4
/** Zona blanca a cada lado (norma CODE128: ≥ 10 módulos). */
export const QUIET_MODULES = 10

/** Códigos de referencia para validar tamaños: el formato propio y un EAN-13 de fábrica. */
export const SAMPLE_CODE_OWN = '890480966848' // 12 dígitos (generateBarcode)
export const SAMPLE_CODE_EAN13 = '7702004003508' // 13 dígitos

/**
 * Patrón de módulos CODE128 ('1' = barra, '0' = espacio) con el mismo
 * codificador que JsBarcode. null si el código no es codificable.
 */
export function encodeCode128(code: string | null | undefined): string | null {
  const value = code?.trim() ?? ''
  if (!value || !/^[\x20-\x7e]+$/.test(value)) return null
  try {
    const data: { encodings?: { data: string }[] } = {}
    JsBarcode(data, value, { format: 'CODE128' })
    const bits = (data.encodings ?? []).map((e) => e.data).join('')
    return bits.length > 0 ? bits : null
  } catch {
    return null
  }
}

export interface BarcodeFit {
  /** Ancho de módulo en puntos enteros del cabezal (0 si no cabe). */
  moduleDots: number
  /** Ancho de las barras (mm). */
  barsMm: number
  /** Ancho con zonas blancas (mm). */
  totalMm: number
  /** true si cabe con barras de al menos MIN_MODULE_DOTS. */
  fits: boolean
}

/**
 * Mayor ancho de módulo en puntos ENTEROS tal que las barras queden dentro del
 * área útil (etiqueta − márgenes seguros) y barras + zona blanca dentro de la
 * etiqueta (la zona blanca puede ocupar el margen: también es blanco).
 */
export function barcodeFit(bits: string, labelWidthMm: number): BarcodeFit {
  const usefulDots = Math.floor((labelWidthMm - 2 * LABEL_SAFE_MARGIN_MM) / DOT_MM + 1e-9)
  const labelDots = Math.floor(labelWidthMm / DOT_MM + 1e-9)
  const byBars = Math.floor(usefulDots / bits.length)
  const byQuiet = Math.floor(labelDots / (bits.length + 2 * QUIET_MODULES))
  const dots = Math.min(MAX_MODULE_DOTS, byBars, byQuiet)
  const moduleDots = dots >= MIN_MODULE_DOTS ? dots : 0
  const shown = Math.max(moduleDots, MIN_MODULE_DOTS)
  return {
    moduleDots,
    barsMm: bits.length * shown * DOT_MM,
    totalMm: (bits.length + 2 * QUIET_MODULES) * shown * DOT_MM,
    fits: moduleDots >= MIN_MODULE_DOTS,
  }
}

/** Ancho mínimo de etiqueta (mm) para que un código quepa con barras de 2 puntos. */
export function minLabelWidthFor(code: string): number {
  const bits = encodeCode128(code)
  if (!bits) return Infinity
  const byBars = bits.length * MIN_MODULE_DOTS * DOT_MM + 2 * LABEL_SAFE_MARGIN_MM
  const byQuiet = (bits.length + 2 * QUIET_MODULES) * MIN_MODULE_DOTS * DOT_MM
  return Math.ceil(Math.max(byBars, byQuiet) * 10) / 10
}

// ── Página ───────────────────────────────────────────────────────────────────

export type LabelMedia = 'die_cut' | 'continuous'

export const LABEL_MEDIA: readonly LabelMedia[] = ['die_cut', 'continuous']
export const DEFAULT_LABEL_MEDIA: LabelMedia = 'die_cut'
/** Margen de corte por defecto entre etiquetas en rollo continuo. */
export const DEFAULT_CONTINUOUS_GAP_MM = 2
export const MAX_LABEL_GAP_MM = 10

export function isLabelMedia(v: unknown): v is LabelMedia {
  return v === 'continuous' || v === 'die_cut'
}

export interface LabelPage {
  pageWidthMm: number
  /** Troquelado: alto de la etiqueta. Continuo: alto + margen de corte. */
  pageHeightMm: number
}

export function labelPage(size: LabelSize, media: LabelMedia, gapMm: number): LabelPage {
  const gap = media === 'continuous' ? Math.min(MAX_LABEL_GAP_MM, Math.max(0, gapMm)) : 0
  return { pageWidthMm: size.width_mm, pageHeightMm: size.height_mm + gap }
}

/** Atributo de la guía punteada del área útil (solo pantalla). */
export const LABEL_GUIDE_ATTR = 'data-label-guide'

/**
 * CSS de impresión: aísla el contenedor, una página por etiqueta con la hoja
 * del tamaño exacto, todo en negro y sin la guía de pantalla.
 */
export function labelPrintCss(containerId: string, page: LabelPage): string {
  const id = `#${containerId}`
  return `
      @media print {
        body > * { visibility: hidden !important; }
        ${id},
        ${id} * { visibility: visible !important; }
        ${id} {
          display: block !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: ${page.pageWidthMm}mm !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
        }
        ${id}, ${id} * { color: #000 !important; }
        ${id} [${LABEL_GUIDE_ATTR}] { outline: none !important; }
        @page { margin: 0; size: ${page.pageWidthMm}mm ${page.pageHeightMm}mm; }
      }
    `
}

// ── Texto ────────────────────────────────────────────────────────────────────

const PT_MM = 25.4 / 72
/** Ancho medio de un carácter de fuente sans en negrita, en em. */
const CHAR_EM = 0.6

/** Precio en grande: 16pt, reducido solo si no cabe en el ancho útil (mín. 10pt). */
export function priceFontPt(text: string, usefulWidthMm: number, maxPt = 16, minPt = 10): number {
  const fit = usefulWidthMm / (Math.max(1, text.length) * CHAR_EM * PT_MM)
  return Math.max(minPt, Math.min(maxPt, Math.floor(fit * 2) / 2))
}

// ── Validación de tamaños ────────────────────────────────────────────────────

export const MIN_LABEL_HEIGHT_MM = 20
export const WARN_LABEL_HEIGHT_MM = 25

export interface LabelSizeIssue {
  level: 'block' | 'warn'
  msg: string
}

/**
 * Problemas de un tamaño: más ancho que lo que imprime el cabezal
 * (bloquea), angosto para el código propio de 12 dígitos (bloquea) o para un
 * EAN-13 de fábrica (advierte), y altos insuficientes.
 */
export function labelSizeIssues(size: LabelSize, maxWidthMm: number): LabelSizeIssue[] {
  const issues: LabelSizeIssue[] = []
  if (size.width_mm > maxWidthMm) {
    issues.push({ level: 'block', msg: `Ancho máximo ${maxWidthMm}mm: es lo que imprime el cabezal` })
  }
  const minOwn = minLabelWidthFor(SAMPLE_CODE_OWN)
  const minEan = minLabelWidthFor(SAMPLE_CODE_EAN13)
  if (size.width_mm < minOwn) {
    issues.push({ level: 'block', msg: `Ancho mínimo ${minOwn}mm para que el código se lea al primer intento` })
  } else if (size.width_mm < minEan) {
    issues.push({ level: 'warn', msg: `Menos de ${minEan}mm: un código de fábrica de 13 dígitos no cabe` })
  }
  if (size.height_mm < MIN_LABEL_HEIGHT_MM) {
    issues.push({ level: 'block', msg: `Alto mínimo ${MIN_LABEL_HEIGHT_MM}mm (nombre, precio y código)` })
  } else if (size.height_mm < WARN_LABEL_HEIGHT_MM) {
    issues.push({ level: 'warn', msg: `Con menos de ${WARN_LABEL_HEIGHT_MM}mm el nombre queda en un renglón y el código más bajo` })
  }
  return issues
}

// ── Tamaños rápidos (rollo de 40mm de ancho; el alto se mide en el rollo) ────

export interface LabelPreset {
  key: string
  name: string
  width_mm: number
  height_mm: number
}

export const LABEL_PRESETS: readonly LabelPreset[] = [
  { key: '40x30', name: '40×30', width_mm: 40, height_mm: 30 },
  { key: '40x40', name: '40×40', width_mm: 40, height_mm: 40 },
  { key: '40x50', name: '40×50', width_mm: 40, height_mm: 50 },
]
