import { useEffect, useMemo, useState } from 'react'
import { X, Printer, Ban, CreditCard } from 'lucide-react'
import toast from 'react-hot-toast'
import { useInvoiceDetail } from '@/hooks/usePurchaseInvoices'
import { useCancelInvoice } from '@/hooks/useInvoiceMutations'
import { fmtCOP } from '@/lib/formatters'
import {
  INVOICE_STATUS_META,
  fmtInvoiceDate,
} from '@/lib/invoices'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import PaymentModal from './PaymentModal'

interface InvoiceDetailModalProps {
  invoiceId: string
  onClose: () => void
}

const PRINT_STYLE_ID = 'invoice-print-style'

// Inyecta @media print una sola vez para aislar el resumen al imprimir.
function useInvoicePrintStyle(elementId: string) {
  useEffect(() => {
    if (document.getElementById(PRINT_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = PRINT_STYLE_ID
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #${elementId}, #${elementId} * { visibility: visible !important; }
        #${elementId} {
          position: absolute; left: 0; top: 0; width: 100%;
          padding: 24px; background: #fff;
        }
      }
    `
    document.head.appendChild(style)
    return () => {
      document.getElementById(PRINT_STYLE_ID)?.remove()
    }
  }, [elementId])
}

export default function InvoiceDetailModal({
  invoiceId,
  onClose,
}: InvoiceDetailModalProps) {
  const { data, isLoading } = useInvoiceDetail(invoiceId)
  const cancelInvoice = useCancelInvoice()
  const [showPayment, setShowPayment] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const printId = useMemo(() => `invoice-print-${invoiceId}`, [invoiceId])
  useInvoicePrintStyle(printId)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  function handlePrint() {
    try {
      window.print()
    } catch {
      toast.error('No se pudo abrir el diálogo de impresión')
    }
  }

  function handleCancel() {
    cancelInvoice.mutate(
      { id: invoiceId, reason: cancelReason },
      {
        onSuccess: () => {
          setShowCancel(false)
          onClose()
        },
      },
    )
  }

  const meta = data ? INVOICE_STATUS_META[data.invoice.status] : null
  const StatusIcon = meta?.icon
  const pct =
    data && data.invoice.total > 0
      ? Math.min(100, Math.round((data.invoice.paid_amount / data.invoice.total) * 100))
      : 0
  const canPay =
    data && (data.invoice.status === 'pending' || data.invoice.status === 'partial')
  const canCancel =
    data &&
    data.invoice.status === 'pending' &&
    data.invoice.paid_amount === 0 &&
    data.items.length === 0

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.5)] backdrop-blur-[2px]"
        onClick={onClose}
      >
        <div
          className="mx-4 flex max-h-[90vh] w-full max-w-[640px] flex-col rounded-2xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between border-b border-[#f5f4f1] px-7 py-5">
            <div>
              <div className="flex items-center gap-2.5">
                <h2
                  className="tracking-[-0.025em]"
                  style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 22, fontWeight: 600 }}
                >
                  Factura {data?.invoice.invoice_number ?? '…'}
                </h2>
                {meta && StatusIcon && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.classes}`}
                  >
                    <StatusIcon size={11} /> {meta.label}
                  </span>
                )}
              </div>
              {data && (
                <p className="mt-1 text-sm text-[#737373]">
                  {data.supplier_name} · {fmtInvoiceDate(data.invoice.invoice_date)}
                  {data.invoice.due_date
                    ? ` · vence ${fmtInvoiceDate(data.invoice.due_date)}`
                    : ''}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] text-[#525252] hover:bg-[#ebe9e6]"
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
            {isLoading || !data ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : (
              <div id={printId} className="space-y-5">
                {/* Items */}
                <div className="overflow-hidden rounded-xl border border-[#ebe9e6]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#fafaf9]">
                        {['Producto', 'Cant.', 'Costo', 'Subtotal'].map((h, i) => (
                          <th
                            key={h}
                            className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373] ${
                              i === 0 ? 'text-left' : 'text-right'
                            }`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((it) => (
                        <tr key={it.id} className="border-t border-[#f5f4f1]">
                          <td className="px-3 py-2">
                            {it.brand && (
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                                {it.brand}
                              </p>
                            )}
                            <p className="font-medium text-[#1a1a1a]">{it.product_name}</p>
                            <p className="text-[11px] text-[#a8a29e]">
                              {it.size ? `V.${it.size}` : ''}
                              {it.color ? ` · ${it.color}` : ''}
                              {it.sku ? ` · ${it.sku}` : ''}
                              {it.update_cost ? ' · costo actualizado' : ''}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {it.qty}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {fmtCOP(it.unit_cost)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {fmtCOP(it.subtotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totales */}
                <div className="rounded-xl border border-[#ebe9e6] bg-[#fafaf9] px-4 py-3">
                  <div className="flex items-center justify-between py-0.5 text-sm">
                    <span className="text-[#525252]">Subtotal</span>
                    <span className="font-mono tabular-nums">
                      {fmtCOP(data.invoice.subtotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-0.5 text-sm">
                    <span className="text-[#525252]">IVA / Impuesto</span>
                    <span className="font-mono tabular-nums">{fmtCOP(data.invoice.tax)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between border-t border-[#ebe9e6] pt-2">
                    <span className="text-sm font-semibold text-[#1a1a1a]">Total</span>
                    <span className="font-mono text-lg font-semibold tabular-nums">
                      {fmtCOP(data.invoice.total)}
                    </span>
                  </div>
                </div>

                {/* Progreso de pago */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
                      Pagado {pct}%
                    </span>
                    <span className="font-mono text-[#525252]">
                      {fmtCOP(data.invoice.paid_amount)} / {fmtCOP(data.invoice.total)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#f5f4f1]">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {data.pending_amount > 0 && (
                    <div className="mt-3 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                      <span className="text-sm font-medium text-red-700">
                        Saldo pendiente
                      </span>
                      <span className="font-mono text-base font-semibold tabular-nums text-red-700">
                        {fmtCOP(data.pending_amount)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Pagos realizados */}
                <div>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
                    Pagos realizados
                  </h3>
                  {data.payments.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-[#d6d3d1] bg-[#fafaf9] px-3 py-3 text-center text-xs text-[#a8a29e]">
                      Aún no hay pagos registrados.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-[#ebe9e6]">
                      {data.payments.map((p) => {
                        const pm = PAYMENT_METHODS[p.payment_method]
                        const Icon = pm.icon
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between border-b border-[#f5f4f1] px-3 py-2.5 text-sm last:border-0"
                          >
                            <div className="flex items-center gap-2">
                              <Icon size={14} style={{ color: pm.hex }} />
                              <div>
                                <p className="text-[#1a1a1a]">
                                  {pm.label}
                                  {p.reference ? ` · ${p.reference}` : ''}
                                </p>
                                <p className="text-[11px] text-[#a8a29e]">
                                  {fmtInvoiceDate(p.payment_date)} · {p.created_by_name}
                                </p>
                              </div>
                            </div>
                            <span className="font-mono text-sm font-semibold tabular-nums">
                              {fmtCOP(p.amount)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {data.invoice.notes && (
                  <p className="text-xs text-[#737373]">
                    <span className="font-semibold">Notas:</span> {data.invoice.notes}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer acciones */}
          {data && (
            <div className="flex shrink-0 flex-wrap gap-2 border-t border-[#f5f4f1] px-7 py-4">
              <button
                onClick={handlePrint}
                className="flex h-10 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-4 text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
              >
                <Printer size={14} /> Imprimir resumen
              </button>
              {canCancel && (
                <button
                  onClick={() => setShowCancel(true)}
                  className="flex h-10 items-center gap-2 rounded-lg border border-red-200 bg-white px-4 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  <Ban size={14} /> Cancelar factura
                </button>
              )}
              {canPay && (
                <button
                  onClick={() => setShowPayment(true)}
                  className="ml-auto flex h-10 items-center gap-2 rounded-lg bg-[#06b6d4] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-[#0891b2]"
                >
                  <CreditCard size={15} /> Registrar pago
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal de pago */}
      {showPayment && data && (
        <PaymentModal
          invoiceId={invoiceId}
          invoiceNumber={data.invoice.invoice_number}
          pendingAmount={data.pending_amount}
          onClose={() => setShowPayment(false)}
        />
      )}

      {/* Confirmación de cancelación */}
      {showCancel && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,23,42,0.5)] backdrop-blur-[2px]"
          onClick={() => setShowCancel(false)}
        >
          <div
            className="mx-4 w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[#1a1a1a]">Cancelar factura</h3>
            <p className="mt-1 text-sm text-[#737373]">
              Esta acción marca la factura como cancelada. No revierte stock
              automáticamente.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder="Motivo de la cancelación…"
              className="mt-4 w-full resize-none rounded-lg border border-[#ebe9e6] px-3 py-2.5 text-sm outline-none focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]"
            />
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setShowCancel(false)}
                className="h-10 flex-1 rounded-lg border border-[#ebe9e6] text-sm font-medium text-[#404040] hover:bg-[#f8f7f5]"
              >
                Volver
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelInvoice.isPending}
                className="h-10 flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelInvoice.isPending ? 'Cancelando…' : 'Cancelar factura'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
