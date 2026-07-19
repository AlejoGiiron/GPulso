import { useEffect, useState } from 'react'
import { X, HandCoins, Wallet, Split } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { useAddCreditPayment } from '@/hooks/useCreditMutations'
import { useResolvedConfig } from '@/hooks/useConfig'
import { useRequireShift } from '@/hooks/useRequireShift'
import { ShiftRequiredNotice } from '@/components/cash/ShiftRequiredNotice'
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_KEYS,
  migrateLegacyPaymentMethods,
} from '@/lib/paymentMethods'
import { PaymentSplitLines } from '@/components/pos/PaymentSplitLines'
import { sumSplitLines, type SplitLine } from '@/lib/paymentSplit'
import type { PaymentLine } from '@/lib/orderPayments'
import type { PaymentMethod } from '@/types/database.types'

interface Props {
  order: { id: string; order_number: number; total: number; paid_amount: number }
  onClose: () => void
  onDone: () => void
}

function parseCOP(value: string): number {
  const digits = value.replace(/\D/g, '')
  return digits ? parseInt(digits, 10) : 0
}

export function AddCreditPaymentModal({ order, onClose, onDone }: Props) {
  const config = useResolvedConfig()
  const enabledMethods = migrateLegacyPaymentMethods(config.payment_methods)
  const visibleMethods = PAYMENT_METHOD_KEYS.filter((m) =>
    enabledMethods.includes(m),
  )

  const balance = Math.max(0, order.total - order.paid_amount)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>(
    enabledMethods.includes('cash') ? 'cash' : (enabledMethods[0] ?? 'cash'),
  )
  // Modo DIVIDIR (mixto): el abono se reparte en varias líneas método+monto.
  const [splitMode, setSplitMode] = useState(false)
  const [lines, setLines] = useState<SplitLine[]>([])

  const addPayment = useAddCreditPayment()
  const parsed = parseCOP(amount)

  // El abono de cartera ENTRA a la caja → exige turno abierto (los abonos de
  // fiado por la app nunca son históricos, así que aplica sin excepción).
  const { hasShift } = useRequireShift()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !addPayment.isPending) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, addPayment.isPending])

  const splitPaid = sumSplitLines(lines)
  const abonoTotal = splitMode ? splitPaid : parsed
  const overBalance = abonoTotal > balance + 0.5
  const splitAmountsOk =
    !splitMode || (lines.length > 0 && lines.every((l) => (parseFloat(l.amount) || 0) > 0))
  const canSubmit =
    abonoTotal > 0 && !overBalance && splitAmountsOk && !addPayment.isPending && hasShift

  const enterSplit = () => {
    setLines([{ method, amount: amount || '' }])
    setSplitMode(true)
  }

  function handleSubmit() {
    if (!canSubmit) return
    const payments: PaymentLine[] = splitMode
      ? lines.map((l) => ({
          method: l.method,
          amount: Math.round((parseFloat(l.amount) || 0) * 100) / 100,
        }))
      : [{ method, amount: parsed }]
    addPayment.mutate(
      { order_id: order.id, payments },
      { onSuccess: () => onDone() },
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={() => !addPayment.isPending && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#f5f4f1] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
              <HandCoins size={18} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold text-[#1a1a1a]">
                Registrar abono
              </h2>
              <p className="mt-0.5 text-[12px] text-[#737373]">
                Fiado #{order.order_number}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={addPayment.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6] disabled:opacity-50"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-6 py-5">
          {!hasShift && (
            <ShiftRequiredNotice message="Abre un turno de caja para registrar este abono." />
          )}
          {/* Resumen del saldo */}
          <div className="rounded-xl border border-[#ebe9e6] bg-[#fafaf9] px-4 py-3 text-sm">
            <div className="flex justify-between text-[#525252]">
              <span>Total</span>
              <span className="font-mono">{fmtCOP(order.total)}</span>
            </div>
            <div className="flex justify-between text-[#525252]">
              <span>Pagado</span>
              <span className="font-mono">{fmtCOP(order.paid_amount)}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between border-t border-[#ebe9e6] pt-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
                Saldo
              </span>
              <span className="font-mono text-lg font-bold text-amber-700">
                {fmtCOP(balance)}
              </span>
            </div>
          </div>

          {!splitMode ? (
            <>
              {/* Monto */}
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
                  Monto del abono
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
                  <span className="text-sm text-[#737373]">$</span>
                  <input
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                    placeholder="0"
                    inputMode="numeric"
                    className="h-10 flex-1 bg-transparent font-mono text-base outline-none"
                  />
                  <span className="text-xs text-[#a8a29e]">COP</span>
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setAmount(String(balance))}
                    className="rounded-lg border border-[#ebe9e6] bg-white px-2.5 py-1 text-xs font-semibold text-[#525252] hover:border-cyan-300 hover:bg-cyan-50"
                  >
                    Saldo completo ({fmtCOP(balance)})
                  </button>
                </div>
                {parsed > balance && (
                  <p className="mt-1.5 text-[11px] text-red-600">
                    El abono no puede superar el saldo.
                  </p>
                )}
              </div>

              {/* Método */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
                    Método de pago
                  </label>
                  {visibleMethods.length > 1 && (
                    <button
                      type="button"
                      onClick={enterSplit}
                      className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-cyan-700"
                    >
                      <Split size={12} /> Dividir
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {visibleMethods.map((id) => {
                    const meta = PAYMENT_METHODS[id]
                    const Icon = meta.icon
                    const active = method === id
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setMethod(id)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                          active
                            ? 'border-cyan-600 bg-cyan-50 text-cyan-700'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <Icon size={15} style={{ color: active ? undefined : meta.hex }} />
                        {meta.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Modo dividir */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
                    Dividir abono
                  </label>
                  <button
                    type="button"
                    onClick={() => setSplitMode(false)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-cyan-700"
                  >
                    ← Un solo método
                  </button>
                </div>
                <PaymentSplitLines
                  lines={lines}
                  onChange={setLines}
                  enabledMethods={enabledMethods}
                  reference={balance}
                />
                <div className="mt-3 flex items-center justify-between rounded-xl border border-[#ebe9e6] bg-[#fafaf9] px-4 py-2.5 text-sm">
                  <span className="text-[#737373]">Total abono</span>
                  <span
                    className={`font-mono font-semibold ${
                      overBalance ? 'text-red-600' : 'text-[#1a1a1a]'
                    }`}
                  >
                    {fmtCOP(abonoTotal)}
                  </span>
                </div>
                {overBalance && (
                  <p className="mt-1.5 text-[11px] text-red-600">
                    El abono no puede superar el saldo ({fmtCOP(balance)}).
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-[#f5f4f1] px-6 py-4">
          <button
            onClick={onClose}
            disabled={addPayment.isPending}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-600 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Wallet size={14} />
            {addPayment.isPending ? 'Registrando…' : 'Registrar abono'}
          </button>
        </div>
      </div>
    </div>
  )
}
