import { describe, it, expect } from 'vitest'
import { splitCommission, quincenaRange } from './commissionCalc'

describe('splitCommission', () => {
  it('reparto 50/50 de $100.000', () => {
    expect(splitCommission(100_000, 0.5)).toEqual({ local: 50_000, worker: 50_000 })
  })

  it('reparto editable (30% trabajador)', () => {
    expect(splitCommission(100_000, 0.3)).toEqual({ local: 70_000, worker: 30_000 })
  })

  it('el local absorbe el redondeo → local + worker = total EXACTO', () => {
    // 33.333 * 3 no es entero; el reparto debe cuadrar igual.
    const s = splitCommission(100_000, 1 / 3)
    expect(s.local + s.worker).toBe(100_000)
    expect(s.worker).toBe(33_333)
    expect(s.local).toBe(66_667)
  })

  it('share fuera de rango se clampa (>1 → todo al trabajador; <0 → nada)', () => {
    expect(splitCommission(80_000, 2)).toEqual({ local: 0, worker: 80_000 })
    expect(splitCommission(80_000, -1)).toEqual({ local: 80_000, worker: 0 })
  })

  it('total negativo se trata como 0', () => {
    expect(splitCommission(-100, 0.5)).toEqual({ local: 0, worker: 0 })
  })
})

describe('quincenaRange', () => {
  it('primera quincena (día <= 15) → 01..15', () => {
    expect(quincenaRange('2026-07-08')).toEqual({ from: '2026-07-01', to: '2026-07-15' })
    expect(quincenaRange('2026-07-15')).toEqual({ from: '2026-07-01', to: '2026-07-15' })
  })

  it('segunda quincena (día >= 16) → 16..fin de mes', () => {
    expect(quincenaRange('2026-07-21')).toEqual({ from: '2026-07-16', to: '2026-07-31' })
  })

  it('fin de mes correcto en febrero (28) y bisiesto (29)', () => {
    expect(quincenaRange('2026-02-20')).toEqual({ from: '2026-02-16', to: '2026-02-28' })
    expect(quincenaRange('2024-02-20')).toEqual({ from: '2024-02-16', to: '2024-02-29' })
  })

  it('fin de mes correcto en abril (30)', () => {
    expect(quincenaRange('2026-04-30')).toEqual({ from: '2026-04-16', to: '2026-04-30' })
  })
})
