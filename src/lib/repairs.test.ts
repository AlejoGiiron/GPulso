import { describe, it, expect } from 'vitest'
import {
  daysSince,
  repairPartsCost,
  KANBAN_STATUSES,
  NEXT_STATUS,
  REPAIR_STATUS_META,
} from './repairs'

describe('repairs — daysSince', () => {
  it('cuenta en días CIVILES de Bogotá, no en horas', () => {
    // Recibido 2026-07-18 23:00 Bogotá (= 2026-07-19 04:00 UTC). Hoy 2026-07-20
    // Bogotá → 2 días civiles (18→19→20), aunque en horas sean ~45h.
    const now = new Date('2026-07-20T12:00:00-05:00')
    expect(daysSince('2026-07-19T04:00:00Z', now)).toBe(2)
  })

  it('mismo día civil → 0', () => {
    const now = new Date('2026-07-20T20:00:00-05:00')
    expect(daysSince('2026-07-20T09:00:00-05:00', now)).toBe(0)
  })

  it('nunca es negativo', () => {
    const now = new Date('2026-07-20T00:00:00-05:00')
    expect(daysSince('2026-07-25T00:00:00-05:00', now)).toBe(0)
  })
})

describe('repairs — repairPartsCost', () => {
  it('suma los costos de los repuestos', () => {
    expect(repairPartsCost([{ costo: 10000 }, { costo: 12000 }, { costo: 0 }])).toBe(22000)
  })
  it('lista vacía → 0', () => {
    expect(repairPartsCost([])).toBe(0)
  })
})

describe('repairs — flujo de estados', () => {
  it('el kanban muestra los 3 estados abiertos (entregado va aparte)', () => {
    expect(KANBAN_STATUSES).toEqual(['recibido', 'en_reparacion', 'listo'])
    expect(KANBAN_STATUSES).not.toContain('entregado')
  })

  it('la transición lineal no permite avanzar A entregado (eso lo hace deliver_repair)', () => {
    expect(NEXT_STATUS.recibido).toBe('en_reparacion')
    expect(NEXT_STATUS.en_reparacion).toBe('listo')
    expect(NEXT_STATUS.listo).toBeUndefined()
    expect(NEXT_STATUS.entregado).toBeUndefined()
  })

  it('todos los estados tienen metadatos visuales', () => {
    for (const s of ['recibido', 'en_reparacion', 'listo', 'entregado'] as const) {
      expect(REPAIR_STATUS_META[s].label).toBeTruthy()
    }
  })
})
