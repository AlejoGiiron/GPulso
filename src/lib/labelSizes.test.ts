import { describe, it, expect } from 'vitest'
import { findLabelSize, newLabelSizeId, DEFAULT_LABEL_SIZES, DEFAULT_LABEL_SIZE_ID } from './labelSizes'

describe('DEFAULT_LABEL_SIZES', () => {
  it('el default es 40×30 (rollo de 40mm de la label maker)', () => {
    const d = findLabelSize(DEFAULT_LABEL_SIZES, DEFAULT_LABEL_SIZE_ID)
    expect(d).toMatchObject({ width_mm: 40, height_mm: 30 })
  })
})

describe('findLabelSize', () => {
  it('encuentra un tamaño existente por id', () => {
    expect(findLabelSize(DEFAULT_LABEL_SIZES, '40x30')?.name).toBe('40×30')
  })

  it('devuelve undefined si el id no existe', () => {
    expect(findLabelSize(DEFAULT_LABEL_SIZES, 'ghost')).toBeUndefined()
  })

  it('devuelve undefined con id null/undefined', () => {
    expect(findLabelSize(DEFAULT_LABEL_SIZES, null)).toBeUndefined()
    expect(findLabelSize(DEFAULT_LABEL_SIZES, undefined)).toBeUndefined()
  })
})

describe('newLabelSizeId', () => {
  it('genera un id opaco con formato ls_ + 8 hex', () => {
    expect(newLabelSizeId()).toMatch(/^ls_[0-9a-f]{8}$/)
  })

  it('genera ids distintos en llamadas sucesivas', () => {
    expect(newLabelSizeId()).not.toBe(newLabelSizeId())
  })
})
