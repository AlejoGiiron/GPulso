import type { LabelSize } from '@/types/config.types'

// Catálogo por defecto de tamaños de etiqueta. Los tamaños viven en
// stores.config.label_sizes y se gestionan desde Configuración → Etiquetas;
// esta lista solo se usa como seed cuando la tienda no tiene tamaños.
//
// Default: 40×30, el rollo de la PT-260 Label Maker (40mm). La geometría de
// impresión (una etiqueta por página, código en puntos enteros) está en
// labelLayout.ts.
//
// Nota: los ids legacy '38x25' / '50x30' / '58x40' (antiguo label_format de
// G-Mura) ya no existen en el seed; una config vieja con label_format cae al
// predeterminado.
export const DEFAULT_LABEL_SIZES: LabelSize[] = [
  { id: '40x30', name: '40×30', width_mm: 40, height_mm: 30 },
]

export const DEFAULT_LABEL_SIZE_ID = '40x30'

// Resuelve un tamaño por id. Devuelve undefined si no existe (ej. un default
// que apunta a un tamaño ya eliminado).
export function findLabelSize(
  sizes: LabelSize[],
  id: string | null | undefined,
): LabelSize | undefined {
  if (!id) return undefined
  return sizes.find((s) => s.id === id)
}

// Genera un id estable y opaco para un tamaño nuevo. Los tamaños se referencian
// por id (label_default_size_id), por lo que nunca debe cambiar al renombrar.
export function newLabelSizeId(): string {
  return `ls_${crypto.randomUUID().slice(0, 8)}`
}
