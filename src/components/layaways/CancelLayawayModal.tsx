import { useEffect, useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { useCancelLayaway } from '@/hooks/useLayawayMutations'

interface Props {
  layawayId: string
  layawayNumber: number
  customerName: string
  paidAmount: number
  onClose: () => void
  onCancelled: () => void
}

export function CancelLayawayModal({
  layawayId,
  layawayNumber,
  customerName,
  paidAmount,
  onClose,
  onCancelled,
}: Props) {
  const [reason, setReason] = useState('')
  const cancel = useCancelLayaway()
  const valid = reason.trim().length >= 5

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !cancel.isPending) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [cancel.isPending, onClose])

  function handleSubmit() {
    if (!valid) return
    cancel.mutate(
      { id: layawayId, cancellation_reason: reason },
      { onSuccess: onCancelled },
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={() => !cancel.isPending && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky */}
        <div className="flex flex-shrink-0 items-start justify-between border-b border-[#f5f4f1] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle size={18} className="text-red-600" />
            </div>
            <div>
              <h2
                style={{
                  fontFamily: 'Bricolage Grotesque, sans-serif',
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: '-0.025em',
                  color: '#1a1a1a',
                }}
              >
                Cancelar separado
              </h2>
              <p className="mt-0.5 text-[13px] text-[#737373]">
                #{layawayNumber} · {customerName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={cancel.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6] disabled:opacity-50"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900">
            El stock reservado se liberará automáticamente.
          </div>

          {paidAmount > 0 && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[12.5px] text-red-900">
              Los abonos por <strong>{fmtCOP(paidAmount)}</strong> NO se
              reembolsan automáticamente. Si el cliente reclama el dinero, el
              reembolso debe gestionarse manualmente.
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Motivo de cancelación
            </label>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 300))}
              placeholder="Ej.: el cliente no volvió tras 30 días…"
              rows={3}
              className="w-full resize-none rounded-lg border border-[#ebe9e6] px-3 py-2 text-sm outline-none placeholder:text-[#a8a29e] focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
            <p className="mt-1 text-[10px] text-[#a8a29e]">
              Mínimo 5 caracteres · {reason.length}/300
            </p>
          </div>
        </div>

        {/* Footer sticky */}
        <div className="flex flex-shrink-0 gap-3 border-t border-[#f5f4f1] px-6 py-4">
          <button
            onClick={onClose}
            disabled={cancel.isPending}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:opacity-50"
          >
            Volver
          </button>
          <button
            onClick={handleSubmit}
            disabled={!valid || cancel.isPending}
            className="h-10 flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(220,38,38,0.3)] hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancel.isPending ? 'Cancelando…' : 'Cancelar separado'}
          </button>
        </div>
      </div>
    </div>
  )
}
