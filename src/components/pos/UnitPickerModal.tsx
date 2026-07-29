import { useState, useRef, useEffect, useMemo } from 'react'
import { X, Search, Smartphone } from 'lucide-react'
import { useUnitsForVariants } from '@/hooks/useUnits'
import type { UnitForSale } from '@/hooks/useUnits'
import { unitStatusMeta } from '@/lib/unitStatus'
import type { POSProduct } from '@/hooks/usePOSSearch'

interface UnitPickerModalProps {
  product: POSProduct
  onPick: (unit: UnitForSale) => void
  onClose: () => void
}

// D2 — camino secundario: tocar la card de un producto serializado abre este
// selector de unidades. Búsqueda por serial parcial; las no disponibles quedan
// deshabilitadas; selección única.
export default function UnitPickerModal({ product, onPick, onClose }: UnitPickerModalProps) {
  const variantIds = useMemo(() => product.variants.map((v) => v.id), [product])
  const { data: units = [], isLoading } = useUnitsForVariants(variantIds)
  const [term, setTerm] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase()
    if (!t) return units
    return units.filter((u) => u.serial.toLowerCase().includes(t))
  }, [units, term])

  const available = filtered.filter((u) => u.status === 'disponible')

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[520px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Elegir unidad</h2>
            <p className="text-sm text-slate-400">
              {product.name} · {available.length} disponible{available.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <X size={14} />
          </button>
        </div>

        <div className="border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3">
            <Search size={15} className="text-slate-400" />
            <input
              ref={inputRef}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar por serial…"
              className="h-9 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <p className="px-2 py-6 text-center text-xs text-slate-400">Cargando unidades…</p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-slate-500">
              {units.length === 0 ? 'Este producto no tiene unidades.' : 'Sin coincidencias.'}
            </p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((u) => {
                const meta = unitStatusMeta(u.status)
                const pickable = u.status === 'disponible'
                const label = u.variant_label ?? ''
                return (
                  <button
                    key={u.unit_id}
                    disabled={!pickable}
                    onClick={() => pickable && onPick(u)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left ${
                      pickable
                        ? 'border-slate-200 bg-white hover:border-cyan-300 hover:bg-cyan-50'
                        : 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-60'
                    }`}
                  >
                    <Smartphone size={15} className="shrink-0 text-cyan-500" />
                    <span className="font-mono text-[13px] font-medium text-slate-900">
                      {u.serial}
                    </span>
                    {label && <span className="text-[12px] text-slate-400">{label}</span>}
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}
                    >
                      {meta.label}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
