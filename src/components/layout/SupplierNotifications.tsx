import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, CheckCircle2, X, AlertTriangle } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { fmtInvoiceDate, daysUntilDue } from '@/lib/invoices'
import { usePendingInvoices } from '@/hooks/usePurchaseInvoices'

const URGENT_DAYS = 3

/**
 * Campana de facturas de proveedor por pagar. Solo admin. Muestra facturas
 * pending/partial vencidas o que vencen en ≤ 3 días, con badge rojo + dropdown
 * navegable hacia la pestaña de cuentas por pagar.
 */
export function SupplierNotifications() {
  const navigate = useNavigate()
  const { data: invoices = [] } = usePendingInvoices()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Vencidas o por vencer en ≤ URGENT_DAYS días; más urgentes primero.
  const urgent = useMemo(() => {
    return invoices
      .map((inv) => ({
        inv,
        until: daysUntilDue(inv.due_date),
      }))
      .filter(
        ({ inv, until }) =>
          inv.days_overdue != null || (until != null && until <= URGENT_DAYS),
      )
      .sort((a, b) => (b.inv.days_overdue ?? -1) - (a.inv.days_overdue ?? -1))
  }, [invoices])

  const count = urgent.length

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Facturas por pagar${count > 0 ? ` (${count} urgentes)` : ''}`}
        className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
          count > 0
            ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
            : 'border-stone-200 bg-white text-gray-500 hover:bg-stone-50'
        }`}
      >
        <FileText size={14} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[340px] overflow-hidden rounded-xl border border-[#ebe9e6] bg-white shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
          <div className="flex items-center justify-between border-b border-[#f5f4f1] px-4 py-3">
            <p className="text-sm font-semibold text-[#1a1a1a]">Facturas por pagar</p>
            <button
              onClick={() => setOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[#737373] hover:bg-[#f5f4f1]"
              aria-label="Cerrar"
            >
              <X size={13} />
            </button>
          </div>

          {urgent.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 size={16} className="text-emerald-500" />
              </div>
              <p className="text-xs text-[#737373]">
                Sin facturas vencidas ni próximas a vencer.
              </p>
            </div>
          ) : (
            <div className="max-h-[360px] overflow-y-auto">
              {urgent.map(({ inv, until }) => {
                const overdue = inv.days_overdue != null
                const dayColor = overdue
                  ? 'text-red-600'
                  : (until ?? 99) < 1
                    ? 'text-red-600'
                    : 'text-amber-600'
                const dayLabel = overdue
                  ? `Vencida ${inv.days_overdue}d`
                  : until === 0
                    ? 'Vence hoy'
                    : `${until} día${until !== 1 ? 's' : ''}`
                return (
                  <button
                    key={inv.id}
                    onClick={() => {
                      setOpen(false)
                      navigate('/proveedores?tab=payables')
                    }}
                    className="flex w-full items-start gap-3 border-b border-[#f5f4f1] px-4 py-3 text-left transition-colors last:border-0 hover:bg-[#fafaf9]"
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        overdue ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                      }`}
                    >
                      {overdue ? <AlertTriangle size={15} /> : <FileText size={15} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#1a1a1a]">
                        {inv.supplier_name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#737373]">
                        Factura {inv.invoice_number}
                        {inv.due_date ? ` · vence ${fmtInvoiceDate(inv.due_date)}` : ''}
                      </p>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className={`text-[11px] font-semibold ${dayColor}`}>
                          {dayLabel}
                        </span>
                        <span className="font-mono text-[11.5px] font-semibold text-[#1a1a1a]">
                          {fmtCOP(inv.pending_amount)}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          <button
            onClick={() => {
              setOpen(false)
              navigate('/proveedores?tab=payables')
            }}
            className="block w-full border-t border-[#f5f4f1] bg-[#fafaf9] px-4 py-2.5 text-center text-xs font-medium text-cyan-600 hover:bg-[#f5f4f1]"
          >
            Ver cuentas por pagar
          </button>
        </div>
      )}
    </div>
  )
}
