import { describe, it, expect } from 'vitest'
import {
  splitCommission,
  quincenaRange,
  summarizeByWorker,
  sumActive,
  type CommissionAggInput,
} from './commissionCalc'

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

describe('summarizeByWorker / sumActive — las ANULADAS no cuentan', () => {
  const row = (
    worker_id: string,
    monto: number,
    reversed_at: string | null = null,
  ): CommissionAggInput => ({
    worker_id,
    worker_name: `W-${worker_id}`,
    monto_total: monto,
    monto_local: monto / 2,
    monto_trabajador: monto / 2,
    reversed_at,
  })

  it('agrupa por trabajador y suma la parte del trabajador', () => {
    const r = summarizeByWorker([row('a', 100_000), row('a', 100_000), row('b', 100_000)])
    expect(r.find((x) => x.worker_id === 'a')).toMatchObject({
      count: 2,
      totalWorker: 100_000,
      totalCommission: 200_000,
    })
    expect(r.find((x) => x.worker_id === 'b')?.totalWorker).toBe(50_000)
  })

  it('una comisión ANULADA no suma en el reporte quincenal', () => {
    const activo = summarizeByWorker([row('a', 100_000), row('a', 100_000)])
    const conAnulada = summarizeByWorker([
      row('a', 100_000),
      row('a', 100_000, '2026-07-21T10:00:00Z'), // anulada
    ])
    expect(activo.find((x) => x.worker_id === 'a')?.totalWorker).toBe(100_000)
    // La anulada NO se paga: total del worker baja a una sola comisión.
    expect(conAnulada.find((x) => x.worker_id === 'a')).toMatchObject({
      count: 1,
      totalWorker: 50_000,
    })
  })

  it('un trabajador con TODAS sus comisiones anuladas desaparece del reporte', () => {
    const r = summarizeByWorker([row('a', 100_000, '2026-07-21T10:00:00Z')])
    expect(r).toEqual([])
  })

  it('sumActive excluye anuladas del total del período', () => {
    const s = sumActive([
      row('a', 100_000),
      row('b', 100_000, '2026-07-21T10:00:00Z'), // anulada
    ])
    expect(s.total).toBe(100_000)
    expect(s.worker).toBe(50_000)
  })
})
