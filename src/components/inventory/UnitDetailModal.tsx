import { useEffect } from 'react'
import { X, PackagePlus, ShoppingCart, Undo2, Smartphone } from 'lucide-react'
import { format } from 'date-fns'
import { fmtCOP } from '@/lib/formatters'
import { unitStatusMeta } from '@/lib/unitStatus'
import { useUnitDetail } from '@/hooks/useUnits'
import type { UnitTimelineEvent } from '@/hooks/useUnits'

interface UnitDetailModalProps {
  unitId: string
  canSeeCost: boolean
  onClose: () => void
}

const EVENT_ICON = {
  ingreso: PackagePlus,
  venta: ShoppingCart,
  devolucion: Undo2,
} as const
const EVENT_COLOR = {
  ingreso: 'text-slate-400',
  venta: 'text-cyan-500',
  devolucion: 'text-amber-500',
} as const

// E1 — ficha de una unidad: identidad, estado, costo, origen y línea de tiempo
// (ingreso → venta → devolución → reventa), reconstruida de stock_movements/orders.
export default function UnitDetailModal({ unitId, canSeeCost, onClose }: UnitDetailModalProps) {
  const { data: unit, isLoading } = useUnitDetail(unitId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const variantLabel = unit ? [unit.size, unit.color].filter(Boolean).join(' · ') : ''

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[500px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Smartphone size={18} className="text-cyan-500" />
            <div>
              <h2 className="font-mono text-[15px] font-semibold text-slate-900">
                {unit?.serial ?? '…'}
              </h2>
              <p className="text-xs text-slate-400">
                {unit ? `${unit.name}${variantLabel ? ` · ${variantLabel}` : ''}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {isLoading || !unit ? (
            <p className="py-6 text-center text-sm text-slate-400">Cargando ficha…</p>
          ) : (
            <>
              {/* Resumen */}
              <div className="mb-5 grid grid-cols-2 gap-3">
                <Field label="Estado">
                  {(() => {
                    const meta = unitStatusMeta(unit.status)
                    return (
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium ${meta.badge}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    )
                  })()}
                </Field>
                {canSeeCost && (
                  <Field label="Costo">
                    <span className="font-mono text-sm text-slate-700">
                      {unit.cost != null ? fmtCOP(unit.cost) : '—'}
                    </span>
                  </Field>
                )}
                <Field label="Origen">
                  <span className="text-sm text-slate-700">{unit.origin ?? '—'}</span>
                </Field>
              </div>

              {/* Línea de tiempo */}
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-slate-400">
                Línea de tiempo
              </p>
              <div className="space-y-0">
                {unit.events.map((ev, i) => (
                  <TimelineRow key={i} ev={ev} last={i === unit.events.length - 1} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[.05em] text-slate-400">{label}</p>
      {children}
    </div>
  )
}

function TimelineRow({ ev, last }: { ev: UnitTimelineEvent; last: boolean }) {
  const Icon = EVENT_ICON[ev.kind]
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-50 ${EVENT_COLOR[ev.kind]}`}>
          <Icon size={14} />
        </span>
        {!last && <span className="my-0.5 w-px flex-1 bg-slate-200" />}
      </div>
      <div className="pb-4 pt-0.5">
        <p className="text-[13px] font-semibold text-slate-800">{ev.label}</p>
        {ev.detail && <p className="text-[12px] text-slate-500">{ev.detail}</p>}
        <p className="text-[11px] text-slate-400">
          {format(new Date(ev.at), "dd MMM yyyy · HH:mm")}
        </p>
      </div>
    </div>
  )
}
