import { useMemo, useState } from 'react'
import { X, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { fmtCOP } from '@/lib/formatters'
import { todayInBogota } from '@/lib/dateRange'
import { splitCommission } from '@/lib/commissionCalc'
import { useResolvedConfig } from '@/hooks/useConfig'
import { useCustomerSearch } from '@/hooks/useCustomers'
import {
  useStoreWorkers,
  useRegisterCommission,
} from '@/hooks/useCreditCommissions'
import type { CommissionMethod, Customer } from '@/types/database.types'

interface Props {
  onClose: () => void
}

export function NewCommissionModal({ onClose }: Props) {
  const config = useResolvedConfig()
  const { data: workers = [] } = useStoreWorkers()
  const register = useRegisterCommission()

  const [workerId, setWorkerId] = useState('')
  const [metodo, setMetodo] = useState<CommissionMethod>('efectivo')
  const [total, setTotal] = useState(String(config.commission_default_amount))
  // Reparto: el usuario edita el monto del trabajador; el local es el resto.
  // Inicial = split por la fracción configurada.
  const initialWorker = useMemo(
    () =>
      splitCommission(
        config.commission_default_amount,
        config.commission_worker_share,
      ).worker,
    [config.commission_default_amount, config.commission_worker_share],
  )
  const [workerAmount, setWorkerAmount] = useState(String(initialWorker))
  const [fecha, setFecha] = useState(todayInBogota())
  const [notas, setNotas] = useState('')

  // Cliente opcional.
  const [customerQuery, setCustomerQuery] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const { data: matches = [] } = useCustomerSearch(customer ? '' : customerQuery)

  const totalNum = Math.max(0, parseInt(total || '0', 10) || 0)
  const workerNum = Math.max(0, parseInt(workerAmount || '0', 10) || 0)
  const localNum = totalNum - workerNum
  const repartoValido = workerNum <= totalNum

  // Al cambiar el total, re-reparte por la fracción configurada (comodidad).
  function onTotalChange(v: string) {
    const clean = v.replace(/\D/g, '')
    setTotal(clean)
    const n = parseInt(clean || '0', 10) || 0
    setWorkerAmount(String(splitCommission(n, config.commission_worker_share).worker))
  }

  function applyMax() {
    setWorkerAmount(String(totalNum))
  }

  async function handleSubmit() {
    if (!workerId) {
      toast.error('Selecciona el trabajador que gestionó el crédito')
      return
    }
    if (totalNum <= 0) {
      toast.error('El monto total debe ser mayor que 0')
      return
    }
    if (!repartoValido) {
      toast.error('La parte del trabajador no puede superar el total')
      return
    }
    try {
      await register.mutateAsync({
        worker_id: workerId,
        metodo,
        monto_total: totalNum,
        monto_local: localNum,
        monto_trabajador: workerNum,
        customer_id: customer?.id ?? null,
        fecha,
        notas: notas.trim() || null,
      })
      onClose()
    } catch {
      // toast en la mutación
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[#f5f4f1] px-6 py-4">
          <h2 className="text-base font-semibold text-[#1a1a1a]">Registrar comisión</h2>
          <button onClick={onClose} className="rounded-md p-1 text-[#a8a29e] hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* Trabajador */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Trabajador que gestionó el crédito
            </label>
            <select
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              <option value="">Selecciona…</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Método */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">Método</label>
            <div className="flex gap-1.5">
              {(['efectivo', 'consignacion'] as const).map((m) => {
                const active = metodo === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMetodo(m)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'border-cyan-600 bg-cyan-600 text-white'
                        : 'border-[#ebe9e6] bg-white text-[#525252] hover:border-cyan-300 hover:bg-cyan-50'
                    }`}
                  >
                    {m === 'efectivo' ? 'Efectivo' : 'Consignación'}
                  </button>
                )
              })}
            </div>
            {metodo === 'efectivo' && (
              <p className="mt-1.5 text-[11px] text-cyan-700">
                Entra al cajón: requiere turno abierto y suma al cuadre.
              </p>
            )}
            {metodo === 'consignacion' && (
              <p className="mt-1.5 text-[11px] text-[#a8a29e]">
                A la cuenta: no toca la caja del turno.
              </p>
            )}
          </div>

          {/* Monto total */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Monto total de la comisión
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
              <span className="text-xs text-[#a8a29e]">$</span>
              <input
                value={total}
                onChange={(e) => onTotalChange(e.target.value)}
                inputMode="numeric"
                className="h-10 flex-1 bg-transparent font-mono text-sm outline-none"
              />
            </div>
          </div>

          {/* Reparto */}
          <div className="rounded-xl bg-[#fafaf9] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[#525252]">Reparto</span>
              <button
                type="button"
                onClick={applyMax}
                className="text-[11px] font-medium text-cyan-700 hover:underline"
              >
                Todo al trabajador
              </button>
            </div>
            <label className="mb-1 block text-[11px] text-[#737373]">Parte del trabajador</label>
            <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
              <span className="text-xs text-[#a8a29e]">$</span>
              <input
                value={workerAmount}
                onChange={(e) => setWorkerAmount(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className="h-10 flex-1 bg-transparent font-mono text-sm outline-none"
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[13px]">
              <span className="text-[#737373]">Queda para el local</span>
              <span
                className={`font-mono font-semibold ${
                  repartoValido ? 'text-[#1a1a1a]' : 'text-red-600'
                }`}
              >
                {repartoValido ? fmtCOP(localNum) : 'excede el total'}
              </span>
            </div>
          </div>

          {/* Cliente opcional */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Cliente <span className="text-[#a8a29e]">(opcional)</span>
            </label>
            {customer ? (
              <div className="flex items-center justify-between rounded-lg border border-[#ebe9e6] px-3 py-2">
                <span className="text-sm text-[#1a1a1a]">
                  {customer.full_name}
                  {customer.phone ? ` · ${customer.phone}` : ''}
                </span>
                <button
                  onClick={() => {
                    setCustomer(null)
                    setCustomerQuery('')
                  }}
                  className="text-[11px] font-medium text-[#737373] hover:underline"
                >
                  Quitar
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
                  <Search size={14} className="text-[#a8a29e]" />
                  <input
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    placeholder="Buscar por nombre o teléfono"
                    className="h-10 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
                {matches.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-[#ebe9e6] bg-white shadow-lg">
                    {matches.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setCustomer(c)
                          setCustomerQuery('')
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-cyan-50"
                      >
                        {c.full_name}
                        {c.phone ? (
                          <span className="text-[#a8a29e]"> · {c.phone}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fecha + notas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#525252]">Fecha</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Notas <span className="text-[#a8a29e]">(opcional)</span>
            </label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value.slice(0, 200))}
              rows={2}
              className="w-full resize-none rounded-lg border border-[#ebe9e6] px-3 py-2 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 gap-3 border-t border-[#f5f4f1] px-6 py-4">
          <button
            onClick={onClose}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={register.isPending || !repartoValido}
            className="h-10 flex-1 rounded-lg bg-cyan-600 text-sm font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {register.isPending ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
