import { describe, it, expect } from 'vitest'
import { resolveConfig } from './useConfig'
import { DEFAULT_LABEL_SIZES } from '@/lib/labelSizes'
import type { LabelSize } from '@/types/config.types'

describe('resolveConfig — migración de tamaños de etiqueta', () => {
  it('mapea label_format legacy a label_default_size_id (38x25)', () => {
    const c = resolveConfig({ label_format: '38x25' })
    expect(c.label_sizes).toEqual(DEFAULT_LABEL_SIZES)
    expect(c.label_default_size_id).toBe('38x25')
  })

  it('mapea label_format legacy 50x30 y 58x40', () => {
    expect(resolveConfig({ label_format: '50x30' }).label_default_size_id).toBe('50x30')
    expect(resolveConfig({ label_format: '58x40' }).label_default_size_id).toBe('58x40')
  })

  it('sin config de etiquetas → siembra los 3 base y default 38x25', () => {
    const c = resolveConfig({})
    expect(c.label_sizes).toEqual(DEFAULT_LABEL_SIZES)
    expect(c.label_default_size_id).toBe('38x25')
  })

  it('label_sizes: [] (array vacío) → siembra los 3 base (rama length > 0)', () => {
    const c = resolveConfig({ label_sizes: [] })
    expect(c.label_sizes).toEqual(DEFAULT_LABEL_SIZES)
    expect(c.label_default_size_id).toBe('38x25')
  })

  it('config null → defaults completos', () => {
    const c = resolveConfig(null)
    expect(c.label_sizes).toEqual(DEFAULT_LABEL_SIZES)
    expect(c.label_default_size_id).toBe('38x25')
  })

  it('label_sizes existente NO se pisa con los defaults', () => {
    const custom: LabelSize[] = [
      { id: 'ls_abc12345', name: 'Mini', width_mm: 40, height_mm: 30 },
    ]
    const c = resolveConfig({ label_sizes: custom, label_default_size_id: 'ls_abc12345' })
    expect(c.label_sizes).toEqual(custom)
    expect(c.label_default_size_id).toBe('ls_abc12345')
  })

  it('default inválido / id eliminado → cae al primer tamaño disponible', () => {
    const custom: LabelSize[] = [
      { id: 'ls_abc12345', name: 'Mini', width_mm: 40, height_mm: 30 },
    ]
    const c = resolveConfig({ label_sizes: custom, label_default_size_id: 'ghost' })
    expect(c.label_default_size_id).toBe('ls_abc12345')
  })

  it('label_format legacy que no existe en label_sizes custom → primer tamaño', () => {
    const custom: LabelSize[] = [
      { id: 'ls_abc12345', name: 'Mini', width_mm: 40, height_mm: 30 },
    ]
    const c = resolveConfig({ label_sizes: custom, label_format: '38x25' })
    expect(c.label_default_size_id).toBe('ls_abc12345')
  })
})

describe('resolveConfig — ancho de recibo (receipt_width_mm)', () => {
  it('sin configurar → 80mm (comportamiento histórico)', () => {
    expect(resolveConfig({}).receipt_width_mm).toBe(80)
    expect(resolveConfig(null).receipt_width_mm).toBe(80)
  })

  it('respeta 58 y 80', () => {
    expect(resolveConfig({ receipt_width_mm: 58 }).receipt_width_mm).toBe(58)
    expect(resolveConfig({ receipt_width_mm: 80 }).receipt_width_mm).toBe(80)
  })

  it('un valor inválido guardado en el jsonb cae a 80', () => {
    expect(resolveConfig({ receipt_width_mm: '58' }).receipt_width_mm).toBe(80)
    expect(resolveConfig({ receipt_width_mm: 72 }).receipt_width_mm).toBe(80)
  })
})
