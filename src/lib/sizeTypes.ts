import type { SizeTypeConfig } from '@/types/config.types'

// Catálogo por defecto de "tipos de variante" (heredado de G-Mura como "tipos
// de talla"; en G-Pulso son los conjuntos de valores de variante de un producto
// de tecnología: capacidad, RAM, etc.). Los tipos viven en
// stores.config.size_types y son gestionables desde Configuración. Esta lista
// solo se usa como fallback/seed cuando la tienda aún no tiene tipos
// configurados.
//
// FASE 2 (próximamente): sobre estas variantes se montará la capa de UNIDADES
// serializadas (IMEI/serial). Hoy la variante sigue siendo capacidad+color.
export const DEFAULT_SIZE_TYPES: SizeTypeConfig[] = [
  { id: 'unique', label: 'Única', sizes: ['Única'] },
  { id: 'capacity', label: 'Capacidad', sizes: ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'] },
  { id: 'ram', label: 'RAM', sizes: ['4GB', '6GB', '8GB', '12GB', '16GB', '32GB'] },
  { id: 'custom', label: 'Personalizada', sizes: [] },
]

export const DEFAULT_SIZE_TYPE_ID = 'unique'
export const CUSTOM_SIZE_TYPE_ID = 'custom'

// Resuelve el tipo de talla configurado a partir de su id. Devuelve undefined
// si el id no existe en la lista (ej. productos legacy con un tipo eliminado).
export function findSizeType(
  types: SizeTypeConfig[],
  id: string | null | undefined,
): SizeTypeConfig | undefined {
  if (!id) return undefined
  return types.find((t) => t.id === id)
}

// Un tipo se trata como "personalizado" (input libre de talla) cuando es el
// tipo custom, cuando no existe en la config, o cuando no define tallas.
export function isCustomSizeType(
  types: SizeTypeConfig[],
  id: string | null | undefined,
): boolean {
  if (id === CUSTOM_SIZE_TYPE_ID) return true
  const found = findSizeType(types, id)
  return !found || found.sizes.length === 0
}

// Genera un id estable y opaco para un tipo de talla nuevo. Los productos
// referencian el tipo por id, por lo que nunca debe cambiar al renombrar.
export function newSizeTypeId(): string {
  return `st_${crypto.randomUUID().slice(0, 8)}`
}
