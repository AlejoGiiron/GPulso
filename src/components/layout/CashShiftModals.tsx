import { useEffect, useRef, useState } from 'react'
import { X, Wallet, Banknote, Receipt, Printer } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { useCashShiftMutations } from '@/hooks/useCashShiftMutations'
import { useRegisterExpense } from '@/hooks/useCashExpenseMutations'
import { useResolvedConfig } from '@/hooks/useConfig'
import { useShiftClosing } from '@/hooks/useShiftClosing'
import {
  CashShiftReceipt,
  CashShiftReceiptPrint,
} from '@/components/cash/CashShiftReceipt'
import type { CashShift } from '@/types/database.types'

function parseCOP(value: string): number {
  const digits = value.replace(/\D/g, '')
  if (!digits) return 0
  return parseInt(digits, 10)
}

// ─── Modal: Abrir turno ───────────────────────────────────────────────────────

interface OpenShiftModalProps {
  onClose: () => void
}

export function OpenShiftModal({ onClose }: OpenShiftModalProps) {
  const { openShift } = useCashShiftMutations()
  const [amount, setAmount] = useState('')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !openShift.isPending) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, openShift.isPending])

  const parsed = parseCOP(amount)

  function handleSubmit() {
    openShift.mutate(parsed, { onSuccess: onClose })
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={() => !openShift.isPending && onClose()}
    >
      <div
        className="w-full max-w-md rounded-[14px] bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
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
                Abrir turno de caja
              </h2>
              <p className="mt-0.5 text-[13px] text-[#737373]">
                Registra el monto inicial en efectivo.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={openShift.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6] disabled:opacity-50"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Monto inicial en caja
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
            <span className="text-sm text-[#737373]">$</span>
            <input
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="0"
              inputMode="numeric"
              className="h-10 flex-1 bg-transparent font-mono text-base outline-none"
            />
            <span className="text-xs text-[#a8a29e]">COP</span>
          </div>
          {parsed > 0 && (
            <p className="mt-1.5 text-xs text-[#737373]">{fmtCOP(parsed)}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={openShift.isPending}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={openShift.isPending}
            className="h-10 flex-1 rounded-lg bg-cyan-600 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700 disabled:cursor-wait disabled:opacity-70"
          >
            {openShift.isPending ? 'Abriendo…' : 'Abrir turno'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Registrar gasto ───────────────────────────────────────────────────

interface ExpenseModalProps {
  onClose: () => void
}

export function ExpenseModal({ onClose }: ExpenseModalProps) {
  const config = useResolvedConfig()
  const reasons = config.expense_reasons
  const registerExpense = useRegisterExpense()

  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState<string>(reasons[0] ?? '')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!reason && reasons.length > 0) setReason(reasons[0])
  }, [reasons, reason])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !registerExpense.isPending) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, registerExpense.isPending])

  const parsed = parseCOP(amount)
  const canSubmit = parsed > 0 && !!reason

  function handleSubmit() {
    if (!canSubmit) return
    registerExpense.mutate(
      { amount: parsed, reason, notes },
      {
        onSuccess: () => {
          setAmount('')
          setNotes('')
          onClose()
        },
      },
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={() => !registerExpense.isPending && onClose()}
    >
      <div
        className="w-full max-w-md rounded-[14px] bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-100">
              <Receipt size={18} className="text-cyan-600" />
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
                Registrar gasto
              </h2>
              <p className="mt-0.5 text-[13px] text-[#737373]">
                Egreso de efectivo del turno actual.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={registerExpense.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6] disabled:opacity-50"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        {/* Monto */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Monto
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
            <span className="text-sm text-[#737373]">$</span>
            <input
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && handleSubmit()}
              placeholder="0"
              inputMode="numeric"
              className="h-10 flex-1 bg-transparent font-mono text-base outline-none"
            />
            <span className="text-xs text-[#a8a29e]">COP</span>
          </div>
          {parsed > 0 && (
            <p className="mt-1.5 text-xs text-[#737373]">{fmtCOP(parsed)}</p>
          )}
        </div>

        {/* Motivo (pills) */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Motivo
          </label>
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((r) => {
              const active = r === reason
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-cyan-600 bg-cyan-600 text-white'
                      : 'border-[#ebe9e6] bg-white text-[#525252] hover:border-cyan-300 hover:bg-cyan-50'
                  }`}
                >
                  {r}
                </button>
              )
            })}
          </div>
        </div>

        {/* Notas */}
        <div className="mb-5">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Notas (opcional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 200))}
            rows={2}
            placeholder="Detalles adicionales…"
            className="w-full resize-none rounded-lg border border-[#ebe9e6] px-3 py-2 text-sm outline-none placeholder:text-[#a8a29e] focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
          />
          <p className="mt-1 text-[10px] text-[#a8a29e]">
            {notes.length}/200
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={registerExpense.isPending}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || registerExpense.isPending}
            className="h-10 flex-1 rounded-lg bg-cyan-600 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {registerExpense.isPending ? 'Registrando…' : 'Registrar gasto'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal: Cerrar turno (con preview imprimible) ─────────────────────────────

interface CloseShiftModalProps {
  shift: CashShift
  onClose: () => void
}

export function CloseShiftModal({ shift, onClose }: CloseShiftModalProps) {
  const { closeShift } = useCashShiftMutations()
  const { data: closing, isLoading } = useShiftClosing(shift.id)
  const [contado, setContado] = useState('')
  const printedAtRef = useRef(new Date())

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeShift.isPending) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, closeShift.isPending])

  const real = parseCOP(contado)
  const hasInput = contado.length > 0
  const expected = closing?.expectedCash ?? 0
  const overdraft = closing?.overdraft ?? 0
  // Lógica B: la diferencia descuenta el sobregiro para que un egreso que vacía
  // la caja se lea como faltante y no como sobrante.
  const diff = real - expected - overdraft

  async function doClose(): Promise<boolean> {
    return new Promise((resolve) => {
      closeShift.mutate(
        { shift_id: shift.id, closing_amount: real },
        {
          onSuccess: () => resolve(true),
          onError: () => resolve(false),
        },
      )
    })
  }

  async function handlePrintAndClose() {
    const ok = await doClose()
    if (!ok) return
    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup)
      onClose()
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
    // Fallback por si el navegador no dispara afterprint (raro pero pasa)
    setTimeout(() => {
      window.removeEventListener('afterprint', cleanup)
      onClose()
    }, 60_000)
  }

  async function handleCloseOnly() {
    const ok = await doClose()
    if (ok) onClose()
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 grid place-items-center p-4"
        style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
        onClick={() => !closeShift.isPending && onClose()}
      >
        <div
          className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between border-b border-[#f5f4f1] px-7 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                <Banknote size={18} className="text-amber-700" />
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
                  Cerrar turno
                </h2>
                <p className="mt-0.5 text-[13px] text-[#737373]">
                  Revisa el cuadre y opcionalmente imprime el cierre.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={closeShift.isPending}
              className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6] disabled:opacity-50"
            >
              <X size={14} className="text-[#525252]" />
            </button>
          </div>

          {/* Input contado */}
          <div className="border-b border-[#f5f4f1] px-7 py-5">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Monto real contado
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
              <span className="text-sm text-[#737373]">$</span>
              <input
                autoFocus
                value={contado}
                onChange={(e) => setContado(e.target.value.replace(/\D/g, ''))}
                placeholder="0"
                inputMode="numeric"
                className="h-10 flex-1 bg-transparent font-mono text-base outline-none"
              />
              <span className="text-xs text-[#a8a29e]">COP</span>
            </div>
            {hasInput && closing && (
              <div
                className={`mt-3 flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  diff === 0
                    ? 'border-green-200 bg-green-50 text-green-800'
                    : diff > 0
                      ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
                      : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                <span className="font-medium">
                  {diff === 0 ? 'Cuadra exacto' : diff > 0 ? 'Sobrante' : 'Faltante'}
                </span>
                <span className="font-mono font-bold">
                  {diff >= 0 ? `+${fmtCOP(diff)}` : fmtCOP(diff)}
                </span>
              </div>
            )}
          </div>

          {/* Preview del recibo */}
          <div className="flex-1 overflow-y-auto bg-[#fafaf9] px-7 py-5">
            <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
              Vista previa del cuadre
            </p>
            {isLoading || !closing ? (
              <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
            ) : (
              <div className="mx-auto w-fit rounded-xl border border-[#ebe9e6] bg-white shadow-sm">
                <CashShiftReceipt
                  shift={closing.shift}
                  expenses={closing.expenses}
                  salesByMethod={closing.salesByMethod}
                  totalSales={closing.totalSales}
                  cashSales={closing.cashSales}
                  totalExpenses={closing.totalExpenses}
                  expectedCash={closing.expectedCash}
                  overdraft={closing.overdraft}
                  orderCount={closing.orderCount}
                  countedCash={real}
                  difference={diff}
                  storeName={closing.storeName}
                  userName={closing.userName}
                  printedAt={printedAtRef.current}
                  layawayPayments={closing.layawayPayments}
                  layawayPaymentsTotal={closing.layawayPaymentsTotal}
                  creditPayments={closing.creditPayments}
                  creditPaymentsTotal={closing.creditPaymentsTotal}
                  regularSalesTotal={closing.regularSalesTotal}
                  returnsIncome={closing.returnsIncome}
                  returnsExpense={closing.returnsExpense}
                  commissionsIncome={closing.commissionsIncome}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 border-t border-[#f5f4f1] px-7 py-5">
            <button
              onClick={handleCloseOnly}
              disabled={closeShift.isPending || !hasInput}
              className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {closeShift.isPending ? 'Cerrando…' : 'Cerrar sin imprimir'}
            </button>
            <button
              onClick={handlePrintAndClose}
              disabled={closeShift.isPending || !hasInput}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-600 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer size={14} />
              Imprimir y cerrar
            </button>
          </div>
        </div>
      </div>

      {/* Contenedor de impresión (oculto en pantalla, visible en print) */}
      {closing && (
        <CashShiftReceiptPrint
          shift={closing.shift}
          expenses={closing.expenses}
          salesByMethod={closing.salesByMethod}
          totalSales={closing.totalSales}
          cashSales={closing.cashSales}
          totalExpenses={closing.totalExpenses}
          expectedCash={closing.expectedCash}
          overdraft={closing.overdraft}
          orderCount={closing.orderCount}
          countedCash={real}
          difference={diff}
          storeName={closing.storeName}
          userName={closing.userName}
          printedAt={printedAtRef.current}
          layawayPayments={closing.layawayPayments}
          layawayPaymentsTotal={closing.layawayPaymentsTotal}
          creditPayments={closing.creditPayments}
          creditPaymentsTotal={closing.creditPaymentsTotal}
          regularSalesTotal={closing.regularSalesTotal}
          returnsIncome={closing.returnsIncome}
          returnsExpense={closing.returnsExpense}
          commissionsIncome={closing.commissionsIncome}
        />
      )}
    </>
  )
}

