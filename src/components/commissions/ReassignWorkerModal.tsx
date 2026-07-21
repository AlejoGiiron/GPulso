import { useState } from 'react'
import { UserCog, X } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import {
  useStoreWorkers,
  useReassignCommissionWorker,
  type CommissionRow,
} from '@/hooks/useCreditCommissions'

interface Props {
  commission: CommissionRow
  onClose: () => void
}

export function ReassignWorkerModal({ commission, onClose }: Props) {
  const { data: workers = [] } = useStoreWorkers()
  const reassign = useReassignCommissionWorker()
  const [newWorker, setNewWorker] = useState('')

  async function handleReassign() {
    if (!newWorker || newWorker === commission.worker_id) return
    try {
      await reassign.mutateAsync({ id: commission.id, newWorkerId: newWorker })
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
            <UserCog size={17} className="text-amber-600" />
            Reasignar trabajador
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-[#a8a29e] hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-[#525252]">
            Comisión de {fmtCOP(commission.monto_total)} ({commission.fecha}),
            hoy asignada a <span className="font-medium">{commission.worker_name}</span>.
          </p>
          <p className="mt-1 text-[12px] text-[#a8a29e]">
            Cambiar el beneficiario no toca la caja (la plata entró igual): solo
            cambia a quién se le paga en la quincena. Queda registrada la
            reasignación.
          </p>
          <label className="mb-1.5 mt-4 block text-xs font-medium text-[#525252]">
            Nuevo trabajador
          </label>
          <select
            value={newWorker}
            onChange={(e) => setNewWorker(e.target.value)}
            className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
          >
            <option value="">Selecciona…</option>
            {workers
              .filter((w) => w.id !== commission.worker_id)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}
                </option>
              ))}
          </select>
        </div>
        <div className="flex gap-3 border-t border-[#f5f4f1] px-6 py-4">
          <button
            onClick={onClose}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleReassign()}
            disabled={reassign.isPending || !newWorker}
            className="h-10 flex-1 rounded-lg bg-amber-600 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reassign.isPending ? 'Reasignando…' : 'Reasignar'}
          </button>
        </div>
      </div>
    </div>
  )
}
