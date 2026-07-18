import { useEffect, useState } from 'react'
import { X, Info } from 'lucide-react'
import { useRegisterPayment } from '@/hooks/useInvoiceMutations'
import { useCurrentShift } from '@/hooks/useCashShift'
import { PAYMENT_METHOD_KEYS, PAYMENT_METHODS } from '@/lib/paymentMethods'
import { fmtCOP } from '@/lib/formatters'
import { todayDateString } from '@/lib/invoices'
import type { PaymentMethod } from '@/types/database.types'

interface PaymentModalProps {
  invoiceId: string
  invoiceNumber: string
  pendingAmount: number
  onClose: () => void
  onPaid?: () => void
}

const LABEL =
  'mb-1.5 block text-[12px] font-semibold uppercase tracking-[.05em] text-[#737373]'
const INPUT =
  'h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none transition focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]'

export default function PaymentModal({
  invoiceId,
  invoiceNumber,
  pendingAmount,
  onClose,
  onPaid,
}: PaymentModalProps) {
  const { data: currentShift } = useCurrentShift()
  const registerPayment = useRegisterPayment()

  const [amount, setAmount] = useState<string>(String(Math.round(pendingAmount)))
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [paymentDate, setPaymentDate] = useState(todayDateString())
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const numericAmount = Number(amount) || 0
  const hasOpenShift = !!currentShift
  const isCash = method === 'cash'

  function handleSubmit() {
    registerPayment.mutate(
      {
        invoice_id: invoiceId,
        amount: numericAmount,
        method,
        reference,
        notes,
        payment_date: paymentDate,
      },
      {
        onSuccess: () => {
          onPaid?.()
          onClose()
        },
      },
    )
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.5)] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[90vh] w-full max-w-[440px] flex-col rounded-2xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-[#f5f4f1] px-6 py-5">
          <h2
            className="tracking-[-0.025em]"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 20, fontWeight: 600 }}
          >
            Registrar pago — Factura {invoiceNumber}
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] text-[#525252] hover:bg-[#ebe9e6]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* Saldo pendiente */}
          <div className="rounded-xl border border-[#ebe9e6] bg-[#fafaf9] px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
              Saldo pendiente
            </p>
            <p className="mt-0.5 font-mono text-2xl font-semibold tabular-nums text-red-600">
              {fmtCOP(pendingAmount)}
            </p>
          </div>

          {/* Monto */}
          <div>
            <label className={LABEL}>Monto del pago</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#a8a29e]">
                $
              </span>
              <input
                type="number"
                min={0}
                max={Math.round(pendingAmount)}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${INPUT} pl-7 font-mono`}
              />
            </div>
            <button
              type="button"
              onClick={() => setAmount(String(Math.round(pendingAmount)))}
              className="mt-1.5 rounded-md border border-[#ebe9e6] bg-white px-2.5 py-1 text-[11px] font-medium text-[#525252] hover:bg-[#f8f7f5]"
            >
              Pagar saldo completo
            </button>
          </div>

          {/* Método */}
          <div>
            <label className={LABEL}>Método de pago</label>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHOD_KEYS.map((key) => {
                const meta = PAYMENT_METHODS[key]
                const Icon = meta.icon
                const active = method === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMethod(key)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                      active
                        ? 'border-[#06b6d4] bg-[#06b6d41a] text-[#1a1a1a]'
                        : 'border-[#ebe9e6] bg-white text-[#525252] hover:bg-[#f8f7f5]'
                    }`}
                  >
                    <Icon size={15} style={{ color: meta.hex }} />
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Aviso de caja para efectivo */}
          {isCash &&
            (hasOpenShift ? (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] text-emerald-700">
                <Info size={14} className="mt-0.5 shrink-0" />
                Este pago en efectivo afectará el cuadre de tu turno actual.
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-[#ebe9e6] bg-[#f5f4f1] px-3 py-2.5 text-[12.5px] text-[#525252]">
                <Info size={14} className="mt-0.5 shrink-0" />
                Sin turno abierto: el pago no afectará el cuadre de caja.
              </div>
            ))}

          {/* Fecha */}
          <div>
            <label className={LABEL}>Fecha del pago</label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className={INPUT}
            />
          </div>

          {/* Referencia */}
          <div>
            <label className={LABEL}>Referencia</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="N° transferencia, últimos 4 de tarjeta…"
              className={INPUT}
            />
          </div>

          {/* Notas */}
          <div>
            <label className={LABEL}>Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Opcional"
              className="w-full resize-none rounded-lg border border-[#ebe9e6] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-3 border-t border-[#f5f4f1] px-6 py-5">
          <button
            onClick={onClose}
            className="h-[42px] flex-1 rounded-lg border border-[#ebe9e6] text-sm font-medium text-[#404040] hover:bg-[#f8f7f5]"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={
              registerPayment.isPending ||
              numericAmount <= 0 ||
              numericAmount > Math.round(pendingAmount)
            }
            className="h-[42px] flex-1 rounded-lg bg-[#06b6d4] text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] transition hover:bg-[#0891b2] disabled:opacity-50"
          >
            {registerPayment.isPending ? 'Registrando…' : 'Confirmar pago'}
          </button>
        </div>
      </div>
    </div>
  )
}
