// Dominio del taller de reparaciones (Fase 3): metadatos de estado, catálogo del
// checklist de recepción y helpers puros (días transcurridos, costo de repuestos).
import type { RepairStatus, RepairPart } from '@/types/database.types'
import { bogotaDayOf, todayInBogota } from './dateRange'

// Estados que se muestran como columnas del kanban (entregado va aparte: solo
// las de hoy + link a historial).
export const KANBAN_STATUSES: RepairStatus[] = ['recibido', 'en_reparacion', 'listo']

// Transición lineal permitida (para el botón "avanzar"). 'entregado' NO está
// acá: la entrega se hace SOLO por deliver_repair (cobro), nunca por UPDATE.
export const NEXT_STATUS: Partial<Record<RepairStatus, RepairStatus>> = {
  recibido: 'en_reparacion',
  en_reparacion: 'listo',
}

export interface RepairStatusMeta {
  label: string
  /** Punto de color (kanban card / badge). */
  dot: string
  /** Badge pill completo. */
  badge: string
  /** Acento de la cabecera de columna. */
  columnAccent: string
}

export const REPAIR_STATUS_META: Record<RepairStatus, RepairStatusMeta> = {
  recibido: {
    label: 'Recibido',
    dot: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-600 border border-slate-200',
    columnAccent: 'text-slate-600',
  },
  en_reparacion: {
    label: 'En reparación',
    dot: 'bg-cyan-500',
    badge: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
    columnAccent: 'text-cyan-700',
  },
  listo: {
    label: 'Listo',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    columnAccent: 'text-emerald-700',
  },
  entregado: {
    label: 'Entregado',
    dot: 'bg-slate-300',
    badge: 'bg-slate-50 text-slate-500 border border-slate-200',
    columnAccent: 'text-slate-500',
  },
}

// ── Checklist de recepción — DOS semánticas ─────────────────────────────────
export interface ChecklistItem {
  key: string
  label: string
}

// Daños del equipo al recibirlo (se pintan en ámbar).
export const CHECKLIST_DANOS: ChecklistItem[] = [
  { key: 'pantalla_rota', label: 'Pantalla rota' },
  { key: 'rayones', label: 'Rayones' },
  { key: 'golpes', label: 'Golpes' },
  { key: 'mojado', label: 'Mojado / humedad' },
]

// Verificaciones de funcionamiento (se pintan en verde).
export const CHECKLIST_VERIFICACIONES: ChecklistItem[] = [
  { key: 'enciende', label: 'Enciende' },
  { key: 'botones_ok', label: 'Botones OK' },
  { key: 'camara_ok', label: 'Cámara OK' },
]

// Días transcurridos desde la recepción, en días CIVILES de Bogotá (no horas).
export function daysSince(isoDate: string, now: Date = new Date()): number {
  const from = bogotaDayOf(new Date(isoDate))
  const to = todayInBogota(now)
  const [ya, ma, da] = from.split('-').map(Number)
  const [yb, mb, db] = to.split('-').map(Number)
  const t0 = Date.UTC(ya, ma - 1, da)
  const t1 = Date.UTC(yb, mb - 1, db)
  return Math.max(0, Math.round((t1 - t0) / 86_400_000))
}

// A partir de estos días una orden abierta se marca en ámbar (equipo estancado).
export const REPAIR_AGE_WARN_DAYS = 6

// Costo total de repuestos de una orden (margen = precio − este total).
export function repairPartsCost(parts: Pick<RepairPart, 'costo'>[]): number {
  return parts.reduce((sum, p) => sum + Number(p.costo ?? 0), 0)
}
