import { format } from 'date-fns'
import { fmtCOP } from '@/lib/formatters'
import { unitStatusMeta } from '@/lib/unitStatus'
import type { UnitRow } from '@/hooks/useUnits'

interface UnitListProps {
  units: UnitRow[]
  /** Mostrar la columna de costo (permiso inventario.gestionar). */
  canSeeCost: boolean
  loading?: boolean
  emptyText?: string
  /** Si se pasa, cada fila abre la ficha de la unidad (E1). */
  onUnitClick?: (unitId: string) => void
}

// Lista de unidades serializadas: serial en JetBrains Mono, badge de estado,
// costo (según permiso), fecha de ingreso y origen (factura). Fase 2, C1/E.
export default function UnitList({
  units,
  canSeeCost,
  loading,
  emptyText,
  onUnitClick,
}: UnitListProps) {
  if (loading) {
    return <p className="px-4 py-3 text-xs text-[#a8a29e]">Cargando unidades…</p>
  }
  if (units.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-[#a8a29e]">
        {emptyText ?? 'Sin unidades registradas.'}
      </p>
    )
  }

  return (
    <div className="divide-y divide-[#f5f4f1]">
      {units.map((u) => {
        const meta = unitStatusMeta(u.status)
        const origin = u.purchase_invoice_items?.purchase_invoices?.invoice_number
        return (
          <div
            key={u.id}
            onClick={onUnitClick ? () => onUnitClick(u.id) : undefined}
            className={`flex items-center gap-3 px-4 py-2.5 ${
              onUnitClick ? 'cursor-pointer hover:bg-[#fafaf9]' : ''
            }`}
          >
            <span className="font-mono text-[13px] font-medium tracking-tight text-[#1a1a1a]">
              {u.serial}
            </span>
            {u.variant_label && (
              <span className="text-[11px] text-[#737373]">{u.variant_label}</span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            <div className="ml-auto flex items-center gap-4 text-[11px] text-[#a8a29e]">
              {canSeeCost && (
                <span className="font-mono tabular-nums text-[#525252]">
                  {u.cost != null ? fmtCOP(u.cost) : '—'}
                </span>
              )}
              <span title="Fecha de ingreso">
                {format(new Date(u.created_at), 'dd MMM yyyy')}
              </span>
              <span className="min-w-[70px] text-right">
                {origin ? `Fac. ${origin}` : u.notas ? 'Manual' : '—'}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
