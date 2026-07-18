import { useEffect, useState } from 'react'
import { X, Wallet, Split } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import {
  useAddLayawayPayment,
  useCompleteLayaway,
} from '@/hooks/useLayawayMutations'
import { PAYMENT_METHODS, PAYMENT_METHOD_KEYS } from '@/lib/paymentMethods'
import { useResolvedConfig } from '@/hooks/useConfig'
import { useRequireShift } from '@/hooks/useRequireShift'
import { ShiftRequiredNotice } from '@/components/cash/ShiftRequiredNotice'
import { migrateLegacyPaymentMethods } from '@/lib/paymentMethods'
import { PaymentSplitLines } from '@/components/pos/PaymentSplitLines'
import { sumSplitLines, type SplitLine } from '@/lib/paymentSplit'
import type { PaymentLine } from '@/lib/orderPayments'
import type { PaymentMethod } from '@/types/database.types'

interface Props {
  layawayId: string
  layawayNumber: number
  customerName: string
  balancePending: number
  onClose: () => void
  onPayed: () => void
  onCompleted: () => void
}

function parseCOP(value: string): number {
  const digits = value.replace(/\D/g, '')
  if (!digits) return 0
  return parseInt(digits, 10)
}

export function AddPaymentModal({
  layawayId,
  layawayNumber,
  customerName,
  balancePending,
  onClose,
  onPayed,
  onCompleted,
}: Props) {
  const config = useResolvedConfig()
  const enabledMethods = migrateLegacyPaymentMethods(config.payment_methods)
  const visibleMethods = PAYMENT_METHOD_KEYS.filter((m) =>
    enabledMethods.includes(m),
  )

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>(
    enabledMethods.includes('cash') ? 'cash' : (enabledMethods[0] ?? 'cash'),
  )
  const [notes, setNotes] = useState('')
  const [completeOnPayoff, setCompleteOnPayoff] = useState(true)
  // Modo DIVIDIR (mixto): el abono se reparte en varias líneas método+monto.
  const [splitMode, setSplitMode] = useState(false)
  const [lines, setLines] = useState<SplitLine[]>([])

  const addPayment = useAddLayawayPayment()
  const completeLayaway = useCompleteLayaway()
  const pending = addPayment.isPending || completeLayaway.isPending

  // Abonar/completar un separado ENTRA a la caja → exige turno abierto. Sin él,
  // el botón queda deshabilitado y se muestra el aviso (no hay caso histórico
  // por esta vía: el histórico solo existe al CREAR el separado).
  const { hasShift } = useRequireShift()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, pending])

  const parsed = parseCOP(amount)
  const splitPaid = sumSplitLines(lines)
  const abonoTotal = splitMode ? splitPaid : parsed
  const overBalance = abonoTotal > balancePending + 0.5
  const willPayoff =
    Math.abs(abonoTotal - balancePending) < 0.5 && abonoTotal > 0
  const splitAmountsOk =
    !splitMode ||
    (lines.length > 0 && lines.every((l) => (parseFloat(l.amount) || 0) > 0))
  const canSubmit =
    abonoTotal > 0 &&
    !overBalance &&
    splitAmountsOk &&
    visibleMethods.length > 0 &&
    hasShift

  const enterSplit = () => {
    setLines([{ method, amount: amount || '' }])
    setSplitMode(true)
  }

  function handleSubmit() {
    if (!canSubmit) return
    const trimmedNotes = notes.trim() || undefined
    const payments: PaymentLine[] = splitMode
      ? lines.map((l) => ({
          method: l.method,
          amount: Math.round((parseFloat(l.amount) || 0) * 100) / 100,
        }))
      : [{ method, amount: parsed }]

    if (willPayoff && completeOnPayoff) {
      completeLayaway.mutate(
        {
          id: layawayId,
          final_payment: { payments, notes: trimmedNotes },
        },
        { onSuccess: () => onCompleted() },
      )
      return
    }

    addPayment.mutate(
      { layaway_id: layawayId, payments, notes: trimmedNotes },
      { onSuccess: () => onPayed() },
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={() => !pending && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky */}
        <div className="flex flex-shrink-0 items-start justify-between border-b border-[#f5f4f1] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-100">
              <Wallet size={18} className="text-cyan-600" />
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
                Registrar abono
              </h2>
              <p className="mt-0.5 text-[13px] text-[#737373]">
                #{layawayNumber} · {customerName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={pending}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6] disabled:opacity-50"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!hasShift && (
            <div className="mb-5">
              <ShiftRequiredNotice message="Abre un turno de caja para registrar este abono." />
            </div>
          )}
          <div className="mb-5 rounded-lg border border-[#ebe9e6] bg-[#fafaf9] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Saldo pendiente
            </p>
            <p className="mt-0.5 font-mono text-2xl font-bold text-[#1a1a1a]">
              {fmtCOP(balancePending)}
            </p>
          </div>

          {!splitMode ? (
            <>
              <div className="mb-4">
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
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAmount(String(balancePending))}
                    className="rounded-lg border border-[#ebe9e6] bg-white px-2.5 py-1 text-xs font-semibold text-[#525252] hover:border-cyan-300 hover:bg-cyan-50"
                  >
                    Saldo completo ({fmtCOP(balancePending)})
                  </button>
                </div>
                {parsed > balancePending && (
                  <p className="mt-1.5 text-[11px] text-red-600">
                    El abono no puede superar el saldo pendiente.
                  </p>
                )}
              </div>

              <div className="mb-4">
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
            <div className="mb-4">
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
                reference={balancePending}
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
                  El abono no puede superar el saldo ({fmtCOP(balancePending)}).
                </p>
              )}
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Notas (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 200))}
              rows={2}
              placeholder="Detalles del abono…"
              className="w-full resize-none rounded-lg border border-[#ebe9e6] px-3 py-2 text-sm outline-none placeholder:text-[#a8a29e] focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>

          {willPayoff && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-[12.5px] text-cyan-900">
              <input
                type="checkbox"
                checked={completeOnPayoff}
                onChange={(e) => setCompleteOnPayoff(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-cyan-600"
              />
              <span>
                <strong>Completar venta con este pago.</strong> Al confirmar se
                creará la orden, se descontará el stock y se entregarán los
                productos al cliente.
              </span>
            </label>
          )}
        </div>

        {/* Footer sticky */}
        <div className="flex flex-shrink-0 gap-3 border-t border-[#f5f4f1] px-6 py-4">
          <button
            onClick={onClose}
            disabled={pending}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || pending}
            className="h-10 flex-1 rounded-lg bg-cyan-600 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? 'Procesando…'
              : willPayoff && completeOnPayoff
                ? 'Cobrar y completar'
                : 'Registrar abono'}
          </button>
        </div>
      </div>
    </div>
  )
}
