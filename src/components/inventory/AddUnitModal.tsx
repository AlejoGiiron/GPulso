import { useState, useRef, useEffect, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useUnitMutations } from '@/hooks/useUnitMutations'

interface AddUnitModalProps {
  variantId: string
  productName: string
  /** Precio/etiqueta de la variante para contexto (ej. "128GB · Azul" o el nombre). */
  variantLabel?: string
  onClose: () => void
}

// C2b — ingreso manual de una unidad suelta a una variante serializada.
export default function AddUnitModal({
  variantId,
  productName,
  variantLabel,
  onClose,
}: AddUnitModalProps) {
  const { addManualUnit } = useUnitMutations()
  const [serial, setSerial] = useState('')
  const [cost, setCost] = useState('')
  const [notas, setNotas] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!serial.trim()) return
    try {
      await addManualUnit.mutateAsync({
        variant_id: variantId,
        serial,
        cost: cost ? Math.round(parseFloat(cost)) : null,
        notas: notas || null,
      })
      onClose()
    } catch {
      // toast ya lo muestra la mutación (mensaje humano)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-1 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Agregar unidad</h2>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <X size={14} />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-400">
          {productName}
          {variantLabel ? ` · ${variantLabel}` : ''}
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Serial / IMEI *
            </label>
            <input
              ref={inputRef}
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="Escanea o escribe el serial"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Costo (opcional)
            </label>
            <input
              inputMode="numeric"
              value={cost}
              onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="0"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Nota (opcional)
            </label>
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Ej: ingreso de inventario inicial"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 flex-1 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={addManualUnit.isPending || !serial.trim()}
              className="h-10 flex-[2] rounded-lg bg-cyan-500 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              {addManualUnit.isPending ? 'Agregando…' : 'Agregar unidad'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
