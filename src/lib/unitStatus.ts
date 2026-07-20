import type { UnitStatus } from '@/types/database.types'

// Meta de presentación de los estados de unidad (Fase 2). Colores del design
// system: disponible = emerald (listo para vender), reservada = cyan (marca,
// separado), vendida = slate (cerrada).
export interface UnitStatusMeta {
  label: string
  /** Clases Tailwind para el badge (fondo + texto). */
  badge: string
  dot: string
}

export const UNIT_STATUS_META: Record<UnitStatus, UnitStatusMeta> = {
  disponible: {
    label: 'Disponible',
    badge: 'bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
  },
  reservada: {
    label: 'Reservada',
    badge: 'bg-cyan-50 text-cyan-700',
    dot: 'bg-cyan-500',
  },
  vendida: {
    label: 'Vendida',
    badge: 'bg-slate-100 text-slate-600',
    dot: 'bg-slate-400',
  },
}

export function unitStatusMeta(status: UnitStatus): UnitStatusMeta {
  return UNIT_STATUS_META[status]
}
