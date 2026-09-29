import { describe, it, expect } from 'vitest'
import { resolveConfig } from './useConfig'
import { DEFAULT_LABEL_SIZES } from '@/lib/labelSizes'
import type { LabelSize } from '@/types/config.types'

describe('resolveConfig — migración de tamaños de etiqueta', () => {
  it('label_format legacy de G-Mura (38x25/50x30/58x40) ya no existe en el seed → cae al default 40x30', () => {
    for (const legacy of ['38x25', '50x30', '58x40'] as const) {
      const c = resolveConfig({ label_format: legacy })
      expect(c.label_sizes).toEqual(DEFAULT_LABEL_SIZES)
      expect(c.label_default_size_id).toBe('40x30')
    }
  })

  it('sin config de etiquetas → siembra 40×30 y lo deja por defecto', () => {
    const c = resolveConfig({})
    expect(c.label_sizes).toEqual(DEFAULT_LABEL_SIZES)
    expect(c.label_default_size_id).toBe('40x30')
  })

  it('label_sizes: [] (array vacío) → siembra el default (rama length > 0)', () => {
    const c = resolveConfig({ label_sizes: [] })
    expect(c.label_sizes).toEqual(DEFAULT_LABEL_SIZES)
    expect(c.label_default_size_id).toBe('40x30')
  })

  it('config null → defaults completos', () => {
    const c = resolveConfig(null)
    expect(c.label_sizes).toEqual(DEFAULT_LABEL_SIZES)
    expect(c.label_default_size_id).toBe('40x30')
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

describe('resolveConfig — impresión de etiquetas', () => {
  it('defaults: nombre, precio y código; variante, marca y SKU apagados', () => {
    expect(resolveConfig({}).label_fields).toEqual({
      name: true,
      price: true,
      size_color: false,
      brand: false,
      sku: false,
    })
  })

  it('campos guardados se respetan y los que faltan toman el default', () => {
    const f = resolveConfig({ label_fields: { size_color: true } }).label_fields
    expect(f.size_color).toBe(true)
    expect(f.name).toBe(true)
    expect(f.price).toBe(true)
  })

  it('rollo troquelado por defecto; inválido → troquelado', () => {
    expect(resolveConfig({}).label_media).toBe('die_cut')
    expect(resolveConfig({ label_media: 'continuous' }).label_media).toBe('continuous')
    expect(resolveConfig({ label_media: 'rollo' }).label_media).toBe('die_cut')
  })

  it('margen de corte: default 2mm, limitado a 0..10', () => {
    expect(resolveConfig({}).label_gap_mm).toBe(2)
    expect(resolveConfig({ label_gap_mm: 3 }).label_gap_mm).toBe(3)
    expect(resolveConfig({ label_gap_mm: 99 }).label_gap_mm).toBe(10)
    expect(resolveConfig({ label_gap_mm: 'x' }).label_gap_mm).toBe(2)
  })

  it('ancho máximo imprimible: default 48mm; valores absurdos caen al default', () => {
    expect(resolveConfig({}).label_max_width_mm).toBe(48)
    expect(resolveConfig({ label_max_width_mm: 40 }).label_max_width_mm).toBe(40)
    expect(resolveConfig({ label_max_width_mm: 5 }).label_max_width_mm).toBe(48)
  })
})
