import { useEffect } from 'react'
import { X, CheckCircle, AlertTriangle } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { useCompleteLayaway } from '@/hooks/useLayawayMutations'
import type { LayawayDetailItem } from '@/hooks/useLayaways'

interface Props {
  layawayId: string
  layawayNumber: number
  customerName: string
  total: number
  items: LayawayDetailItem[]
  onClose: () => void
  onCompleted: () => void
}

export function CompleteLayawayModal({
  layawayId,
  layawayNumber,
  customerName,
  total,
  items,
  onClose,
  onCompleted,
}: Props) {
  const complete = useCompleteLayaway()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !complete.isPending) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [complete.isPending, onClose])

  function handleSubmit() {
    complete.mutate(
      { id: layawayId },
      { onSuccess: () => onCompleted() },
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={() => !complete.isPending && onClose()}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-md flex-col rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[#f5f4f1] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle size={18} className="text-emerald-700" />
            </div>
            <div>
              <h2
                style={{
                  fontFamily: 'Bricolage Grotesque, sans-serif',
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: '-0.025em',
                }}
              >
                Completar venta
              </h2>
              <p className="mt-0.5 text-[13px] text-[#737373]">
                #{layawayNumber} · {customerName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={complete.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6] disabled:opacity-50"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              Esto entregará los productos y descontará el stock. La acción no
              se puede deshacer.
            </span>
          </div>

          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Ítems a entregar
          </p>
          <div className="mb-4 overflow-hidden rounded-xl border border-[#ebe9e6]">
            {items.map((it) => (
              <div
                key={it.id}
                className="flex items-center justify-between border-b border-[#f5f4f1] px-4 py-2.5 last:border-0 text-sm"
              >
                <span className="text-[#1a1a1a]">
                  {it.product_name}{' '}
                  <span className="text-[#737373]">
                    {[it.size ? `V.${it.size}` : null, it.color]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="font-mono text-[#525252]">
                  ×{it.qty} · {fmtCOP(it.unit_price * it.qty)}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-baseline justify-between rounded-lg bg-[#fafaf9] px-4 py-3">
            <span className="text-sm font-medium text-[#737373]">Total venta</span>
            <span className="font-mono text-xl font-bold text-[#1a1a1a]">
              {fmtCOP(total)}
            </span>
          </div>
        </div>

        <div className="flex gap-3 border-t border-[#f5f4f1] px-6 py-4">
          <button
            onClick={onClose}
            disabled={complete.isPending}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={complete.isPending}
            className="h-10 flex-1 rounded-lg bg-emerald-600 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.3)] hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {complete.isPending ? 'Procesando…' : 'Completar venta'}
          </button>
        </div>
      </div>
    </div>
  )
}
