import { useState, useEffect, useRef } from 'react'
import {
  CreditCard,
  Plus,
  Trash2,
  Upload,
  AlertTriangle,
  Receipt,
  Bookmark,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useStoreConfig, useResolvedConfig } from '@/hooks/useConfig'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_KEYS,
  migrateLegacyPaymentMethods,
} from '@/lib/paymentMethods'
import { useExpenseCountByReason } from '@/hooks/useCashExpenses'
import type { PaymentMethod } from '@/types/database.types'
import type { LayawayInitialPaymentMode } from '@/types/config.types'

const MAX_LAYAWAY_DAYS = 180

// ── Confirm delete reason modal ───────────────────────────────────────────────

interface ConfirmDeleteReasonProps {
  reason: string
  onConfirm: () => void
  onClose: () => void
}

function ConfirmDeleteReasonModal({
  reason,
  onConfirm,
  onClose,
}: ConfirmDeleteReasonProps) {
  const { data: count = 0, isLoading } = useExpenseCountByReason(reason)
  const hasUsage = count > 0

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[14px] bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle size={18} className="text-amber-700" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[#1a1a1a]">
              Eliminar motivo
            </h3>
            <p className="text-xs text-[#737373]">"{reason}"</p>
          </div>
        </div>

        {isLoading ? (
          <div className="mb-5 h-12 animate-pulse rounded-lg bg-slate-100" />
        ) : hasUsage ? (
          <p className="mb-5 text-sm text-[#525252]">
            Este motivo está asociado a{' '}
            <span className="font-semibold text-[#1a1a1a]">
              {count} gasto{count !== 1 ? 's' : ''}
            </span>{' '}
            del historial. Los gastos previos no se modifican, pero ya no podrás
            seleccionarlo en nuevos registros.
          </p>
        ) : (
          <p className="mb-5 text-sm text-[#525252]">
            Este motivo no tiene gastos asociados. Se eliminará de la lista
            disponible para nuevos registros.
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="h-9 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1]"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="h-9 flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main section ──────────────────────────────────────────────────────────────

export default function CajaSection() {
  const { data: store, isLoading } = useStoreConfig()
  const config = useResolvedConfig()
  const { updateStoreConfig, uploadPaymentQR } = useConfigMutations()
  const fileRef = useRef<HTMLInputElement>(null)

  const [reasons, setReasons] = useState<string[]>([])
  const [newReason, setNewReason] = useState('')
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [paymentQrUrl, setPaymentQrUrl] = useState<string | null>(null)
  const [expenseReasons, setExpenseReasons] = useState<string[]>([])
  const [newExpenseReason, setNewExpenseReason] = useState('')
  const [deletingExpenseReason, setDeletingExpenseReason] = useState<string | null>(null)
  const [layawayInitialMode, setLayawayInitialMode] =
    useState<LayawayInitialPaymentMode>('none')
  const [layawayInitialValue, setLayawayInitialValue] = useState('')
  const [layawayDefaultDays, setLayawayDefaultDays] = useState('')
  const [commissionAmount, setCommissionAmount] = useState('')
  const [commissionWorkerPct, setCommissionWorkerPct] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!store) return
    setReasons(config.adjustment_reasons)
    setPaymentMethods(migrateLegacyPaymentMethods(config.payment_methods))
    setPaymentQrUrl(config.payment_qr_url)
    setExpenseReasons(config.expense_reasons)
    setLayawayInitialMode(config.layaway_initial_payment_mode)
    setLayawayInitialValue(String(config.layaway_initial_payment_value ?? 0))
    setLayawayDefaultDays(String(config.layaway_default_days ?? 90))
    setCommissionAmount(String(config.commission_default_amount ?? 100000))
    setCommissionWorkerPct(
      String(Math.round((config.commission_worker_share ?? 0.5) * 100)),
    )
  }, [store, config])

  function addReason() {
    const v = newReason.trim()
    if (!v) return
    if (reasons.includes(v)) {
      toast.error('Ese motivo ya existe')
      return
    }
    setReasons([...reasons, v])
    setNewReason('')
  }

  function addExpenseReason() {
    const v = newExpenseReason.trim()
    if (!v) return
    const lower = v.toLowerCase()
    if (expenseReasons.some((r) => r.toLowerCase() === lower)) {
      toast.error('Ese motivo ya existe')
      return
    }
    setExpenseReasons([...expenseReasons, v])
    setNewExpenseReason('')
  }

  function removeExpenseReason(reason: string) {
    if (expenseReasons.length <= 2) {
      toast.error('Debes mantener al menos 2 motivos de egreso')
      return
    }
    setDeletingExpenseReason(reason)
  }

  function confirmRemoveExpenseReason() {
    if (!deletingExpenseReason) return
    setExpenseReasons(expenseReasons.filter((r) => r !== deletingExpenseReason))
    setDeletingExpenseReason(null)
  }

  function togglePayment(value: PaymentMethod) {
    setPaymentMethods((prev) =>
      prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value],
    )
  }

  async function handlePaymentQR(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('El archivo debe ser una imagen')
      return
    }
    try {
      const url = await uploadPaymentQR.mutateAsync(file)
      setPaymentQrUrl(url)
      await updateStoreConfig.mutateAsync({ payment_qr_url: url })
      toast.success('QR de pagos actualizado')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleSave() {
    const initialValue = Math.max(0, parseInt(layawayInitialValue || '0', 10) || 0)
    const daysParsed = Math.max(
      1,
      Math.min(
        MAX_LAYAWAY_DAYS,
        parseInt(layawayDefaultDays || '0', 10) || 0,
      ),
    )

    if (layawayInitialMode === 'percent' && initialValue > 100) {
      toast.error('El porcentaje de abono inicial no puede superar 100')
      return
    }

    const commAmount = Math.max(0, parseInt(commissionAmount || '0', 10) || 0)
    if (commAmount <= 0) {
      toast.error('El monto por defecto de la comisión debe ser mayor que 0')
      return
    }
    const workerPct = Math.max(
      0,
      Math.min(100, parseInt(commissionWorkerPct || '0', 10) || 0),
    )

    setSaving(true)
    try {
      await updateStoreConfig.mutateAsync({
        adjustment_reasons: reasons,
        payment_methods: paymentMethods,
        expense_reasons: expenseReasons,
        layaway_initial_payment_mode: layawayInitialMode,
        layaway_initial_payment_value: initialValue,
        layaway_default_days: daysParsed,
        commission_default_amount: commAmount,
        commission_worker_share: workerPct / 100,
      })
      toast.success('Configuración de caja guardada')
    } catch {
      // toast shown by mutation
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-[14px] border border-[#ebe9e6] bg-white p-5">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[14px] border border-[#ebe9e6] bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-100 text-cyan-600">
          <CreditCard size={15} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Configuración de caja</h2>
          <p className="text-xs text-[#737373]">Ajustes, métodos de pago, gastos y QR para pagos</p>
        </div>
      </div>

      <div className="divide-y divide-[#f5f4f1]">
        {/* Adjustment reasons */}
        <div className="px-5 py-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Motivos de ajuste de inventario
          </p>
          <div className="space-y-1">
            {reasons.map((reason, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-3 py-2"
              >
                <span className="flex-1 text-sm text-[#1a1a1a]">{reason}</span>
                <button
                  onClick={() => setReasons(reasons.filter((_, i) => i !== idx))}
                  className="grid h-6 w-6 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addReason() }}
              placeholder="Nuevo motivo"
              className="h-9 flex-1 rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
            <button
              onClick={addReason}
              disabled={!newReason.trim()}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-40"
            >
              <Plus size={13} />
              Agregar
            </button>
          </div>
        </div>

        {/* Payment methods */}
        <div className="px-5 py-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Métodos de pago habilitados
          </p>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHOD_KEYS.map((value) => {
              const meta = PAYMENT_METHODS[value]
              const Icon = meta.icon
              const checked = paymentMethods.includes(value)
              return (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    checked
                      ? 'border-cyan-300 bg-cyan-50'
                      : 'border-[#ebe9e6] bg-white hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePayment(value)}
                    className="h-4 w-4 accent-cyan-500"
                  />
                  <Icon size={14} style={{ color: meta.hex }} />
                  <span className="text-sm font-medium text-[#1a1a1a]">{meta.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Expense reasons */}
        <div className="px-5 py-5">
          <div className="mb-3 flex items-center gap-2">
            <Receipt size={13} className="text-[#737373]" />
            <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Motivos de egreso
            </p>
          </div>
          <div className="space-y-1">
            {expenseReasons.map((reason) => (
              <div
                key={reason}
                className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-3 py-2"
              >
                <span className="flex-1 text-sm text-[#1a1a1a]">{reason}</span>
                <button
                  onClick={() => removeExpenseReason(reason)}
                  className="grid h-6 w-6 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-400"
                  aria-label={`Eliminar motivo ${reason}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={newExpenseReason}
              onChange={(e) => setNewExpenseReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addExpenseReason() }}
              placeholder="Nuevo motivo de egreso"
              className="h-9 flex-1 rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
            <button
              onClick={addExpenseReason}
              disabled={!newExpenseReason.trim()}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-40"
            >
              <Plus size={13} />
              Agregar
            </button>
          </div>
        </div>

        {/* Layaways / Separados */}
        <div className="px-5 py-5">
          <div className="mb-3 flex items-center gap-2">
            <Bookmark size={13} className="text-[#737373]" />
            <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Separados
            </p>
          </div>

          {/* Modo de abono inicial */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Modo de abono inicial
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(['none', 'fixed', 'percent'] as const).map((mode) => {
                const active = layawayInitialMode === mode
                const label =
                  mode === 'none'
                    ? 'Ninguno'
                    : mode === 'fixed'
                      ? 'Monto fijo'
                      : 'Porcentaje'
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setLayawayInitialMode(mode)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'border-cyan-600 bg-cyan-600 text-white'
                        : 'border-[#ebe9e6] bg-white text-[#525252] hover:border-cyan-300 hover:bg-cyan-50'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {layawayInitialMode !== 'none' && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
                <input
                  value={layawayInitialValue}
                  onChange={(e) =>
                    setLayawayInitialValue(e.target.value.replace(/\D/g, ''))
                  }
                  placeholder="0"
                  inputMode="numeric"
                  className="h-9 flex-1 bg-transparent font-mono text-sm outline-none"
                />
                <span className="text-xs text-[#a8a29e]">
                  {layawayInitialMode === 'percent' ? '%' : 'COP'}
                </span>
              </div>
            )}
            <p className="mt-1 text-[11px] text-[#a8a29e]">
              Cobro mínimo al crear el separado. 0 = no exige abono inicial.
            </p>
          </div>

          {/* Días vencimiento */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Días de vencimiento por defecto
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
              <input
                value={layawayDefaultDays}
                onChange={(e) =>
                  setLayawayDefaultDays(e.target.value.replace(/\D/g, ''))
                }
                placeholder="90"
                inputMode="numeric"
                className="h-9 flex-1 bg-transparent font-mono text-sm outline-none"
              />
              <span className="text-xs text-[#a8a29e]">días</span>
            </div>
            <p className="mt-1 text-[11px] text-[#a8a29e]">
              Plazo máximo desde la fecha de creación. Máximo {MAX_LAYAWAY_DAYS}{' '}
              días.
            </p>
          </div>
        </div>

        {/* Comisiones por crédito (Fase 4) */}
        <div className="px-5 py-5">
          <div className="mb-3 flex items-center gap-2">
            <CreditCard size={13} className="text-[#737373]" />
            <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Comisiones por crédito
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Monto por defecto */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#525252]">
                Monto por defecto
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
                <span className="text-xs text-[#a8a29e]">$</span>
                <input
                  value={commissionAmount}
                  onChange={(e) =>
                    setCommissionAmount(e.target.value.replace(/\D/g, ''))
                  }
                  placeholder="100000"
                  inputMode="numeric"
                  className="h-9 flex-1 bg-transparent font-mono text-sm outline-none"
                />
                <span className="text-xs text-[#a8a29e]">COP</span>
              </div>
              <p className="mt-1 text-[11px] text-[#a8a29e]">
                Se puede cambiar al registrar cada comisión.
              </p>
            </div>

            {/* Reparto al trabajador */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#525252]">
                Parte del trabajador
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
                <input
                  value={commissionWorkerPct}
                  onChange={(e) =>
                    setCommissionWorkerPct(e.target.value.replace(/\D/g, ''))
                  }
                  placeholder="50"
                  inputMode="numeric"
                  className="h-9 flex-1 bg-transparent font-mono text-sm outline-none"
                />
                <span className="text-xs text-[#a8a29e]">%</span>
              </div>
              <p className="mt-1 text-[11px] text-[#a8a29e]">
                Por defecto 50%. El local recibe el resto.
              </p>
            </div>
          </div>
        </div>

        {/* Payment QR (sirve para Transferencia) */}
        {paymentMethods.includes('transfer') && (
          <div className="px-5 py-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              QR para pagos
            </p>
            <div className="flex items-start gap-4">
              {paymentQrUrl ? (
                <img
                  src={paymentQrUrl}
                  alt="QR para pagos"
                  className="h-24 w-24 rounded-lg border border-[#ebe9e6] object-contain"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-lg border-[1.5px] border-dashed border-[#d6d3d1] bg-[#fafaf9] text-[#a8a29e]">
                  <Upload size={20} />
                </div>
              )}
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handlePaymentQR(e)}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadPaymentQR.isPending}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-50"
                >
                  <Upload size={12} />
                  {paymentQrUrl ? 'Cambiar QR' : 'Subir QR'}
                </button>
                <p className="mt-1.5 text-[11px] text-[#a8a29e]">
                  Se muestra al cobrar con Transferencia
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end border-t border-[#f5f4f1] px-5 py-4">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex h-9 items-center gap-2 rounded-lg bg-[#06b6d4] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95 disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      {deletingExpenseReason && (
        <ConfirmDeleteReasonModal
          reason={deletingExpenseReason}
          onConfirm={confirmRemoveExpenseReason}
          onClose={() => setDeletingExpenseReason(null)}
        />
      )}
    </div>
  )
}
