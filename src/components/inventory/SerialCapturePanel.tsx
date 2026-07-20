import { useState, useRef, useEffect, type KeyboardEvent, type ClipboardEvent } from 'react'
import { X, Check, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { getActiveStoreId } from '@/hooks/useActiveStoreId'
import { useUnitMutations, humanizeUnitError } from '@/hooks/useUnitMutations'

interface SerialCapturePanelProps {
  invoiceItemId: string
  productName: string
  variantLabel?: string
  qty: number
  /** Seriales ya recibidos de esta línea (solo lectura). */
  existingSerials: string[]
  onClose: () => void
  onDone: () => void
}

// C2a — captura de seriales en ráfaga para una línea de factura. Recepción
// parcial ≤N: confirmar desde 1 serial. Un solo input siempre enfocado;
// escanear→enter agrega. Dup en-sesión (Set) y en-BD (chequeo al agregar).
export default function SerialCapturePanel({
  invoiceItemId,
  productName,
  variantLabel,
  qty,
  existingSerials,
  onClose,
  onDone,
}: SerialCapturePanelProps) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)
  const { receiveSerials } = useUnitMutations()

  const [captured, setCaptured] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [confirmingPartial, setConfirmingPartial] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const alreadyReceived = existingSerials.length
  const remaining = qty - alreadyReceived - captured.length // cupos libres
  const totalCaptured = alreadyReceived + captured.length
  const isPartial = totalCaptured < qty
  const existingSet = new Set(existingSerials.map((s) => s.toLowerCase()))

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function alreadyInList(serial: string): boolean {
    const lower = serial.toLowerCase()
    return existingSet.has(lower) || captured.some((c) => c.toLowerCase() === lower)
  }

  async function existsInDb(serial: string): Promise<boolean> {
    const { data } = await supabase
      .from('units')
      .select('id')
      .eq('store_id' as never, storeId)
      .eq('serial' as never, serial)
      .maybeSingle()
    return !!data
  }

  async function tryAdd(raw: string) {
    const serial = raw.trim()
    if (!serial) return
    setError(null)
    if (alreadyInList(serial)) {
      setError(`"${serial}" ya está en la lista.`)
      return
    }
    if (remaining <= 0) {
      setError(`Ya alcanzaste la cantidad de la línea (${qty}).`)
      return
    }
    setChecking(true)
    try {
      if (await existsInDb(serial)) {
        setError(`"${serial}" ya existe en inventario.`)
        return
      }
      setCaptured((prev) => [...prev, serial])
      setInput('')
    } finally {
      setChecking(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void tryAdd(input)
    }
  }

  // Pegar lista multilínea → dedup en-sesión y respeta el cupo. Los dups en-BD
  // los atrapa la RPC al confirmar (mapeados a mensaje humano).
  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!/[\n\r\t,;]/.test(text)) return // pegado simple → deja el flujo normal
    e.preventDefault()
    const parts = text
      .split(/[\n\r\t,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    setError(null)
    setCaptured((prev) => {
      const next = [...prev]
      const seen = new Set(next.map((s) => s.toLowerCase()))
      let free = qty - alreadyReceived - next.length
      for (const p of parts) {
        const lower = p.toLowerCase()
        if (free <= 0) break
        if (existingSet.has(lower) || seen.has(lower)) continue
        next.push(p)
        seen.add(lower)
        free--
      }
      return next
    })
    setInput('')
  }

  function editChip(idx: number) {
    // Mover el chip de vuelta al input para corregirlo (lo saca de la lista).
    setInput(captured[idx])
    setCaptured((prev) => prev.filter((_, i) => i !== idx))
    inputRef.current?.focus()
  }
  function removeChip(idx: number) {
    setCaptured((prev) => prev.filter((_, i) => i !== idx))
  }

  async function doConfirm() {
    try {
      await receiveSerials.mutateAsync({ invoiceItemId, serials: captured })
      toast.success(
        `${captured.length} unidad${captured.length === 1 ? '' : 'es'} recibida${captured.length === 1 ? '' : 's'}` +
          (isPartial ? ` · quedan ${qty - totalCaptured} por recibir` : ''),
      )
      onDone()
    } catch (err) {
      // Dup en-BD u otro choque: mensaje humano, se conserva la lista para editar.
      setError(humanizeUnitError(err))
      setConfirmingPartial(false)
    }
  }

  function handleConfirmClick() {
    if (captured.length === 0) return
    if (isPartial && !confirmingPartial) {
      setConfirmingPartial(true)
      return
    }
    void doConfirm()
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-[560px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Capturar seriales</h2>
            <p className="text-sm text-slate-400">
              {productName}
              {variantLabel ? ` · ${variantLabel}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <X size={14} />
          </button>
        </div>

        {/* Contador */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-[#fafaf9] px-6 py-3">
          <span className="text-sm font-medium text-slate-700">
            {totalCaptured} de {qty}
            {isPartial && (
              <span className="text-slate-400"> — faltan {qty - totalCaptured}</span>
            )}
          </span>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-cyan-500 transition-all"
              style={{ width: `${Math.min(100, (totalCaptured / qty) * 100)}%` }}
            />
          </div>
        </div>

        {/* Input */}
        <div className="px-6 pt-4">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={remaining <= 0}
            placeholder={
              remaining <= 0 ? 'Cantidad completa' : 'Escanea o escribe un serial y Enter…'
            }
            className="h-11 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-50"
          />
          {error && (
            <div className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-red-500">
              <AlertTriangle size={13} />
              {error}
            </div>
          )}
          {checking && <p className="mt-2 text-[11px] text-slate-400">Verificando…</p>}
        </div>

        {/* Lista capturada + ya recibidos */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {existingSerials.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-slate-400">
                Ya recibidos ({existingSerials.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {existingSerials.map((s) => (
                  <span
                    key={s}
                    className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[12px] text-slate-500"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-slate-400">
            Capturados ahora ({captured.length})
          </p>
          {captured.length === 0 ? (
            <p className="text-xs text-slate-400">Escanea el primer serial.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {captured.map((s, i) => (
                <span
                  key={`${s}-${i}`}
                  className="inline-flex items-center gap-1 rounded-md border border-cyan-200 bg-cyan-50 py-1 pl-2 pr-1 font-mono text-[12px] text-cyan-800"
                >
                  <button onClick={() => editChip(i)} title="Editar" className="hover:underline">
                    {s}
                  </button>
                  <button
                    onClick={() => removeChip(i)}
                    title="Quitar"
                    className="grid h-4 w-4 place-items-center rounded text-cyan-500 hover:bg-cyan-100"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-6 py-4">
          {confirmingPartial && (
            <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
              Quedan {qty - totalCaptured} por recibir. ¿Confirmar recepción parcial?
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="h-10 flex-1 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirmClick}
              disabled={captured.length === 0 || receiveSerials.isPending}
              className="flex h-10 flex-[2] items-center justify-center gap-1.5 rounded-lg bg-cyan-500 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              <Check size={15} />
              {receiveSerials.isPending
                ? 'Guardando…'
                : confirmingPartial
                  ? 'Sí, confirmar parcial'
                  : isPartial && captured.length > 0
                    ? `Confirmar ${captured.length} (parcial)`
                    : `Confirmar ${captured.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
