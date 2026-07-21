import { Ban, X } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { useReverseCommission, type CommissionRow } from '@/hooks/useCreditCommissions'

interface Props {
  commission: CommissionRow
  onClose: () => void
}

export function ReverseCommissionModal({ commission, onClose }: Props) {
  const reverse = useReverseCommission()
  const afectaCuadre = commission.metodo === 'efectivo'

  async function handleReverse() {
    try {
      await reverse.mutateAsync(commission)
      onClose()
    } catch {
      // toast en la mutación
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#f5f4f1] px-6 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[#1a1a1a]">
            <Ban size={17} className="text-red-600" />
            Anular comisión
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-[#a8a29e] hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-[#525252]">
            Se anulará la comisión de {fmtCOP(commission.monto_total)} de{' '}
            <span className="font-medium">{commission.worker_name}</span> ({commission.fecha}).
            Queda registrada como anulada (no se borra) y deja de contar en el
            reporte quincenal.
          </p>
          {afectaCuadre && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-[13px] text-amber-800 ring-1 ring-inset ring-amber-200">
              Es en efectivo del turno abierto: al anularla, el efectivo esperado
              del turno baja {fmtCOP(commission.monto_total)}.
            </div>
          )}
        </div>
        <div className="flex gap-3 border-t border-[#f5f4f1] px-6 py-4">
          <button
            onClick={onClose}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleReverse()}
            disabled={reverse.isPending}
            className="h-10 flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {reverse.isPending ? 'Anulando…' : 'Anular'}
          </button>
        </div>
      </div>
    </div>
  )
}
