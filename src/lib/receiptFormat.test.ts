import { describe, expect, it } from 'vitest'
import { fmtReceiptDateTime, fmtReceiptLongDate, fmtReceiptTime } from './receiptFormat'

// 2026-09-29T00:07:00Z = 28 de septiembre, 19:07 en Bogotá (UTC-5).
const LATE_NIGHT_UTC = '2026-09-29T00:07:00Z'

describe('formatos de comprobante (hora de Bogotá)', () => {
  it('fecha y hora usan el día civil de Bogotá, no el de UTC', () => {
    const s = fmtReceiptDateTime(LATE_NIGHT_UTC)
    expect(s).toContain('28/09/2026')
    expect(s).toContain('19:07')
  })

  it('hora sola en 24h', () => {
    expect(fmtReceiptTime(LATE_NIGHT_UTC)).toBe('19:07')
  })

  it('fecha larga con el mes en letras', () => {
    expect(fmtReceiptLongDate(LATE_NIGHT_UTC)).toBe('28 de septiembre de 2026')
  })

  it('acepta Date además de string', () => {
    expect(fmtReceiptTime(new Date(LATE_NIGHT_UTC))).toBe('19:07')
  })
})
