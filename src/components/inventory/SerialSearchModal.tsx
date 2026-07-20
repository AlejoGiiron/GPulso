import { useState, useRef, useEffect } from 'react'
import { X, ScanLine } from 'lucide-react'
import { useUnitBySerial } from '@/hooks/useUnits'
import { useDebounce } from '@/hooks/useDebounce'
import UnitList from './UnitList'
import UnitDetailModal from './UnitDetailModal'

interface SerialSearchModalProps {
  canSeeCost: boolean
  onClose: () => void
}

// C3 — búsqueda global por serial: pegar/escanear un serial encuentra la unidad
// en cualquier estado y muestra su ficha básica (producto, estado, costo, origen).
// La ficha completa con timeline es del Bloque E.
export default function SerialSearchModal({ canSeeCost, onClose }: SerialSearchModalProps) {
  const [term, setTerm] = useState('')
  const debounced = useDebounce(term, 300)
  const { data: unit, isFetching } = useUnitBySerial(debounced)
  const [detailUnitId, setDetailUnitId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const searched = debounced.trim().length >= 3
  const variantLabel = unit
    ? [unit.variants?.size, unit.variants?.color].filter(Boolean).join(' · ')
    : ''

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-24 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <ScanLine size={18} className="text-cyan-500" />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Escanea o pega un serial / IMEI…"
            className="h-9 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans placeholder:text-slate-400"
          />
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {!searched && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">
              Ingresa al menos 3 caracteres del serial.
            </p>
          )}
          {searched && isFetching && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Buscando…</p>
          )}
          {searched && !isFetching && !unit && (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              No se encontró ninguna unidad con ese serial.
            </p>
          )}
          {searched && !isFetching && unit && (
            <div>
              <div className="px-4 pt-3">
                <p className="text-sm font-semibold text-slate-900">
                  {unit.variants?.products.name}
                </p>
                {(unit.variants?.products.brand || variantLabel) && (
                  <p className="text-xs text-slate-400">
                    {[unit.variants?.products.brand, variantLabel].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <UnitList
                units={[unit]}
                canSeeCost={canSeeCost}
                onUnitClick={setDetailUnitId}
              />
              <p className="px-4 pb-3 text-[11px] text-slate-400">
                Toca la unidad para ver su ficha e historial.
              </p>
            </div>
          )}
        </div>
      </div>

      {detailUnitId && (
        <UnitDetailModal
          unitId={detailUnitId}
          canSeeCost={canSeeCost}
          onClose={() => setDetailUnitId(null)}
        />
      )}
    </div>
  )
}
