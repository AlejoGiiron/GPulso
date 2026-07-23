import { useState, useMemo, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Search,
  X,
  ShoppingBag,
  TrendingUp,
  Receipt,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  Printer,
  ArrowLeftRight,
  CheckCircle,
  Ban,
  RefreshCw,
  Copy,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { fmtCOP } from '@/lib/formatters'
import { getColorHex } from '@/lib/products'
import { isCreditFullyPaid, creditBalance } from '@/lib/creditCalc'
import type { SaleKind } from '@/lib/salesHistoryCash'
import {
  useSalesHistory,
  useSalesSummary,
  useSaleDetail,
  PAGE_SIZE,
  type SalesHistoryFilters,
  type SalesHistoryRow,
  type SaleDetail,
} from '@/hooks/useSalesHistory'
import { useOrderItemUnits } from '@/hooks/useUnits'
import {
  DateRangeFilter,
  type DateRangeValue,
} from '@/components/ui/DateRangeFilter'
import { resolveDateRange, type DateRangePreset } from '@/lib/dateRange'
import type {
  OrderStatus,
  PaymentMethod,
} from '@/types/database.types'
import { useStoreConfig } from '@/hooks/useConfig'
import {
  SaleReceiptPrint,
  type SaleReceiptData,
} from '@/components/sales/SaleReceipt'

// ── Constantes ────────────────────────────────────────────────────────────────

// Grilla de la tabla: #, Fecha, Cliente, Ítems, Total, Entró ese día, Pago,
// Estado, chevron. Compartida por el encabezado y las filas para que no puedan
// desincronizarse al agregar o mover una columna.
const ROW_GRID =
  'grid-cols-[100px_150px_minmax(0,1fr)_56px_120px_120px_120px_110px_24px]'

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  addi: 'Addi',
  credit: 'Fiado',
}

const PAYMENT_OPTIONS: { id: PaymentMethod | 'all'; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'cash', label: 'Efectivo' },
  { id: 'card', label: 'Tarjeta' },
  { id: 'transfer', label: 'Transferencia' },
  { id: 'addi', label: 'Addi' },
]

const STATUS_OPTIONS: { id: OrderStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'completed', label: 'Completadas' },
  { id: 'returned', label: 'Devueltas' },
  { id: 'cancelled', label: 'Canceladas' },
]

// ── Badges ────────────────────────────────────────────────────────────────────

function PaymentBadge({ method }: { method: PaymentMethod }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f4f1] px-2.5 py-0.5 text-[11px] font-medium text-[#525252]">
      {PAYMENT_METHOD_LABEL[method]}
    </span>
  )
}

function StatusBadge({ status }: { status: OrderStatus }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-800">
        <CheckCircle size={10} /> Completada
      </span>
    )
  }
  if (status === 'returned') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900">
        <RotateCcw size={10} /> Devuelta
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-800">
      <Ban size={10} /> Cancelada
    </span>
  )
}

// ── Copyable helpers ──────────────────────────────────────────────────────────

async function copyToClipboard(value: string, label: string, displayValue?: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`Copiado: ${displayValue ?? value}`, { duration: 1500 })
  } catch {
    toast.error(`No se pudo copiar ${label}`)
  }
}

interface CopyableProps {
  value: string
  label: string
  displayValue?: string
  className?: string
  children: React.ReactNode
}

function CopyableCell({ value, label, displayValue, className, children }: CopyableProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        void copyToClipboard(value, label, displayValue)
      }}
      aria-label={`Copiar ${label}: ${displayValue ?? value}`}
      className={`group -mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-stone-100 ${className ?? ''}`}
    >
      <span className="min-w-0 truncate">{children}</span>
      <Copy
        size={12}
        className="shrink-0 text-[#a8a29e] opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  )
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  icon,
  tone = 'default',
  isLoading,
}: {
  label: string
  value: string
  icon: React.ReactNode
  tone?: 'default' | 'positive' | 'warn'
  isLoading?: boolean
}) {
  const toneColor =
    tone === 'positive'
      ? 'text-green-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : 'text-[#1a1a1a]'
  return (
    <div className="rounded-2xl border border-[#ebe9e6] bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
          {label}
        </p>
        <span className="text-[#a8a29e]">{icon}</span>
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${toneColor}`}>
        {isLoading ? (
          <span className="inline-block h-7 w-24 animate-pulse rounded-md bg-slate-100" />
        ) : (
          value
        )}
      </p>
    </div>
  )
}

// ── Sale Detail Drawer ────────────────────────────────────────────────────────

function SaleDetailRow({ detail }: { detail: SaleDetail }) {
  const navigate = useNavigate()
  const canReturn = detail.status !== 'cancelled'
  // E3 — IMEIs de las líneas serializadas de esta venta.
  const itemIds = useMemo(() => detail.items.map((i) => i.id), [detail.items])
  const { data: unitsByItem = {} } = useOrderItemUnits(itemIds)
  const { data: storeData } = useStoreConfig()
  const storeName =
    (storeData as unknown as { name?: string } | undefined)?.name ?? 'G-Pulso'
  const printedAtRef = useRef(new Date())

  const receiptData: SaleReceiptData = useMemo(
    () => ({
      order_number: detail.order_number,
      created_at: detail.created_at,
      subtotal: detail.subtotal,
      discount: detail.discount,
      surcharge: detail.surcharge,
      total: detail.total,
      payment_method: detail.payment_method,
      cash_received: detail.cash_received,
      payments: detail.payments,
      customer: detail.customer
        ? {
            full_name: detail.customer.full_name,
            phone: detail.customer.phone,
          }
        : null,
      items: detail.items.map((it) => ({
        variant_id: it.variant_id,
        product_name: it.product_name,
        brand: it.brand,
        size: it.size,
        color: it.color,
        // Serializado: etiqueta + IMEI de la(s) unidad(es) de esta línea (E3).
        variant_label: unitsByItem[it.id]?.variant_label ?? null,
        serial: (unitsByItem[it.id]?.serials ?? [])[0] ?? null,
        qty: it.qty,
        unit_price: it.unit_price,
        list_price: it.list_price,
      })),
    }),
    [detail, unitsByItem],
  )

  function handleReprint() {
    try {
      window.print()
    } catch {
      toast.error('No se pudo abrir el diálogo de impresión')
    }
  }

  return (
    <div className="border-t border-[#f5f4f1] bg-[#fafaf9] px-6 py-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
            Ítems vendidos
          </p>
          <div className="overflow-hidden rounded-xl border border-[#ebe9e6] bg-white">
            {detail.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 border-b border-[#f5f4f1] px-4 py-3 last:border-0"
              >
                <div
                  className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_1.5px_rgba(0,0,0,0.12)]"
                  style={{
                    background: item.color ? getColorHex(item.color) : '#e2e8f0',
                  }}
                />
                <div className="min-w-0 flex-1">
                  {item.brand && (
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                      {item.brand}
                    </p>
                  )}
                  <p className="truncate text-sm font-medium text-[#1a1a1a]">
                    {item.product_name}
                  </p>
                  <p className="text-xs text-[#737373]">
                    {[item.size, item.color, unitsByItem[item.id]?.variant_label]
                      .filter(Boolean)
                      .join(' · ')}
                    {(item.size || item.color || unitsByItem[item.id]?.variant_label) && ' · '}
                    {fmtCOP(item.unit_price)} c/u
                  </p>
                  {(unitsByItem[item.id]?.serials ?? []).map((serial) => (
                    <span
                      key={serial}
                      className="mt-0.5 mr-1 inline-block rounded bg-cyan-50 px-1.5 py-0.5 font-mono text-[11px] text-cyan-700"
                    >
                      IMEI {serial}
                    </span>
                  ))}
                </div>
                <span className="shrink-0 text-xs text-[#737373]">
                  ×{item.qty}
                </span>
                <span className="w-24 shrink-0 text-right font-mono text-sm font-semibold text-[#1a1a1a]">
                  {fmtCOP(item.unit_price * item.qty)}
                </span>
              </div>
            ))}
          </div>

          {detail.returns.length > 0 && (
            <>
              <p className="mb-3 mt-5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
                Devoluciones asociadas
              </p>
              <div className="overflow-hidden rounded-xl border border-[#ebe9e6] bg-white">
                {detail.returns.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 border-b border-[#f5f4f1] px-4 py-3 last:border-0"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50">
                      {r.type === 'return' ? (
                        <RotateCcw size={13} className="text-amber-700" />
                      ) : (
                        <ArrowLeftRight size={13} className="text-cyan-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#1a1a1a]">
                        {r.type === 'return' ? 'Devolución' : 'Cambio'} #
                        {r.id.slice(-6).toUpperCase()}
                      </p>
                      <p className="text-xs text-[#737373]">
                        {new Date(r.created_at).toLocaleString('es-CO', {
                          timeZone: 'America/Bogota',
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                        {' · '}
                        {r.items_count} ítem{r.items_count !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-semibold text-[#1a1a1a]">
                      {fmtCOP(r.refund_total)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-[#ebe9e6] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
                Resumen
              </p>
              <span className="font-mono text-sm font-semibold text-[#1a1a1a]">
                #{detail.order_number}
              </span>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-[#525252]">
                <span>Subtotal</span>
                <span className="font-mono">{fmtCOP(detail.subtotal)}</span>
              </div>
              {detail.discount > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Descuento</span>
                  <span className="font-mono">-{fmtCOP(detail.discount)}</span>
                </div>
              )}
              {detail.surcharge > 0 && (
                <div className="flex justify-between text-[#525252]">
                  <span>Recargo Addi</span>
                  <span className="font-mono">+{fmtCOP(detail.surcharge)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-[#f5f4f1] pt-1.5 font-semibold text-[#1a1a1a]">
                <span>Total</span>
                <span className="font-mono">{fmtCOP(detail.total)}</span>
              </div>
              <div className="flex justify-between text-[#525252]">
                <span>Pago</span>
                <span>{PAYMENT_METHOD_LABEL[detail.payment_method]}</span>
              </div>
              {detail.cash_received != null && (
                <>
                  <div className="flex justify-between text-[#525252]">
                    <span>Recibido</span>
                    <span className="font-mono">
                      {fmtCOP(detail.cash_received)}
                    </span>
                  </div>
                  {detail.cash_received > detail.total && (
                    <div className="flex justify-between text-[#525252]">
                      <span>Cambio</span>
                      <span className="font-mono">
                        {fmtCOP(detail.cash_received - detail.total)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {detail.customer && (
              <div className="mt-4 border-t border-[#f5f4f1] pt-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
                  Cliente
                </p>
                <p className="mt-1 text-sm font-medium text-[#1a1a1a]">
                  {detail.customer.full_name}
                </p>
                {detail.customer.phone && (
                  <p className="text-xs text-[#737373]">
                    {detail.customer.phone}
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 border-t border-[#f5f4f1] pt-3">
              <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
                UUID (soporte)
              </p>
              <div className="flex items-center justify-between gap-2">
                <code className="min-w-0 truncate font-mono text-[11px] text-[#737373]">
                  {detail.id}
                </code>
                <button
                  type="button"
                  onClick={() =>
                    void copyToClipboard(detail.id, 'UUID', detail.id)
                  }
                  aria-label={`Copiar UUID: ${detail.id}`}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-[#ebe9e6] bg-white px-2 py-1 text-[11px] font-medium text-[#525252] hover:bg-[#f5f4f1]"
                >
                  <Copy size={11} /> Copiar UUID
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={handleReprint}
              className="flex h-9 items-center justify-center gap-2 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1]"
            >
              <Printer size={13} /> Reimprimir ticket
            </button>
            {canReturn && (
              <button
                onClick={() => navigate(`/devoluciones?orderId=${detail.id}`)}
                className="flex h-9 items-center justify-center gap-2 rounded-lg bg-cyan-600 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700"
              >
                <RotateCcw size={13} /> Iniciar devolución
              </button>
            )}
          </div>
        </div>
      </div>

      <SaleReceiptPrint
        sale={receiptData}
        storeName={storeName}
        printedAt={printedAtRef.current}
      />
    </div>
  )
}

function SaleDetailLoader({ orderId }: { orderId: string }) {
  const { data, isLoading, error } = useSaleDetail(orderId)

  if (isLoading) {
    return (
      <div className="border-t border-[#f5f4f1] bg-[#fafaf9] px-6 py-6">
        <div className="flex items-center gap-2 text-sm text-[#737373]">
          <RefreshCw size={13} className="animate-spin" /> Cargando detalle…
        </div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="border-t border-[#f5f4f1] bg-[#fafaf9] px-6 py-6">
        <p className="text-sm text-red-600">
          No se pudo cargar el detalle de la venta.
        </p>
      </div>
    )
  }

  return <SaleDetailRow detail={data} />
}

// ── Sales Row ─────────────────────────────────────────────────────────────────

// Por qué el total de la fila no es el dinero que entró al cajón. Se muestra al
// pasar el mouse sobre la línea; el badge de la columna Pago da el titular.
const ENTERED_HINT: Record<SaleKind, string> = {
  layaway:
    'Viene de un separado: solo entró el pago de cierre. El resto se abonó otros días.',
  credit:
    'Venta fiada: el cliente quedó debiendo. Ese dinero no entró a la caja este día.',
  direct: '',
}

// Dinero real que entró el día de la venta, en su propia columna al lado del
// Total: leído en paralelo, "185.000 → 40.000" cuenta la historia solo. Se
// muestra SOLO cuando difiere del total; en una venta directa entró el total y
// un número repetido sería ruido, así que va un guion.
function EnteredTodayCell({ row }: { row: SalesHistoryRow }) {
  if (!row.show_entered_line) {
    return (
      <span
        className="font-mono text-sm text-[#d6d3d1]"
        title="Entró el total de la venta"
      >
        —
      </span>
    )
  }
  return (
    <span
      className="font-mono text-sm font-semibold tabular-nums text-[#1a1a1a]"
      title={ENTERED_HINT[row.kind]}
    >
      {fmtCOP(row.entered_today)}
    </span>
  )
}

function SalesRow({
  row,
  isExpanded,
  onToggle,
}: {
  row: SalesHistoryRow
  isExpanded: boolean
  onToggle: () => void
}) {
  const orderLabel = `#${row.order_number}`
  const totalLabel = fmtCOP(row.total)

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className={`grid w-full cursor-pointer ${ROW_GRID} items-center gap-3 border-b border-[#f5f4f1] px-6 py-3 text-left transition-colors hover:bg-[#f8f7f5]`}
      >
        <CopyableCell
          value={orderLabel}
          label="número de venta"
          displayValue={orderLabel}
          className="font-mono text-sm font-semibold text-[#1a1a1a]"
        >
          {orderLabel}
        </CopyableCell>
        <span className="text-xs text-[#525252]">
          {new Date(row.created_at).toLocaleString('es-CO', {
            timeZone: 'America/Bogota',
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </span>
        {row.customer_name ? (
          <CopyableCell
            value={row.customer_name}
            label="cliente"
            className="text-sm text-[#1a1a1a]"
          >
            {row.customer_name}
          </CopyableCell>
        ) : (
          <span className="text-sm text-[#a8a29e]">Sin cliente</span>
        )}
        <span className="text-xs tabular-nums text-[#525252]">
          {row.items_count}
        </span>
        <CopyableCell
          value={String(row.total)}
          label="total"
          displayValue={totalLabel}
          className="font-mono text-sm font-semibold tabular-nums text-[#1a1a1a]"
        >
          {totalLabel}
        </CopyableCell>
        <EnteredTodayCell row={row} />
        {/* Chips apilados: el método arriba y el tipo/saldo debajo. En línea se
            pisaban entre sí y la columna quedaba ilegible. */}
        <span className="flex flex-col items-start gap-1">
          <PaymentBadge method={row.payment_method} />
          {/* Separado: el PaymentBadge muestra el método del pago de CIERRE, así
              que sin este chip la fila parecería una venta directa. */}
          {row.kind === 'layaway' && (
            <span
              className="inline-flex items-center rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold text-cyan-700"
              title={
                row.layaway_number != null
                  ? `Separado #${row.layaway_number}`
                  : 'Viene de un separado'
              }
            >
              Separado
            </span>
          )}
          {/* Fiado: el PaymentBadge ya dice "Fiado" (método 'credit'); este chip
              agrega el saldo, que es lo que no se ve en el cajón. */}
          {row.is_credit &&
            (isCreditFullyPaid(row.total, row.paid_amount) ? (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                Pagado
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                Debe {fmtCOP(creditBalance(row.total, row.paid_amount))}
              </span>
            ))}
        </span>
        <span>
          <StatusBadge status={row.status} />
        </span>
        <ChevronRight
          size={14}
          className={`text-[#a8a29e] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
      </div>
      {isExpanded && <SaleDetailLoader orderId={row.id} />}
    </>
  )
}

// ── Filters Bar ───────────────────────────────────────────────────────────────

interface FiltersProps {
  filters: SalesHistoryFilters
  setFilters: React.Dispatch<React.SetStateAction<SalesHistoryFilters>>
  preset: DateRangePreset
  onDateChange: (next: DateRangeValue) => void
}

function FiltersBar({ filters, setFilters, preset, onDateChange }: FiltersProps) {
  return (
    <div className="rounded-2xl border border-[#ebe9e6] bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-3 py-2 transition-all focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
          <Search size={15} className="shrink-0 text-[#737373]" />
          <input
            value={filters.query}
            onChange={(e) =>
              setFilters((f) => ({ ...f, query: e.target.value, page: 0 }))
            }
            placeholder="Buscar #orden o nombre del cliente…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#a8a29e]"
          />
          {filters.query && (
            <button
              onClick={() =>
                setFilters((f) => ({ ...f, query: '', page: 0 }))
              }
              className="text-[#737373] hover:text-[#1a1a1a]"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <DateRangeFilter
          preset={preset}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          onChange={onDateChange}
        />

        <select
          value={filters.paymentMethod}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              paymentMethod: e.target.value as PaymentMethod | 'all',
              page: 0,
            }))
          }
          className="h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 pr-8 text-sm text-[#525252] outline-none focus:border-cyan-400"
        >
          {PAYMENT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={filters.status}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              status: e.target.value as OrderStatus | 'all',
              page: 0,
            }))
          }
          className="h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 pr-8 text-sm text-[#525252] outline-none focus:border-cyan-400"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SalesHistoryPage() {
  // Default: HOY (fase 2). El summary usa los mismos filtros → también hoy.
  const [preset, setPreset] = useState<DateRangePreset>('today')
  const [filters, setFilters] = useState<SalesHistoryFilters>(() => ({
    query: '',
    ...resolveDateRange('today'),
    paymentMethod: 'all',
    status: 'all',
    page: 0,
  }))
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const handleDateChange = useCallback((next: DateRangeValue) => {
    setPreset(next.preset)
    setFilters((f) => ({
      ...f,
      dateFrom: next.dateFrom,
      dateTo: next.dateTo,
      page: 0,
    }))
  }, [])

  const { data: listData, isLoading: listLoading } = useSalesHistory(filters)
  const { data: summary, isLoading: summaryLoading } = useSalesSummary(filters)

  const rows = listData?.rows ?? []
  const totalCount = listData?.totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const headerSubtitle = useMemo(() => {
    if (!filters.dateFrom && !filters.dateTo) return 'Todas las fechas'
    if (filters.dateFrom && filters.dateTo)
      return `${filters.dateFrom} → ${filters.dateTo}`
    return filters.dateFrom || filters.dateTo
  }, [filters.dateFrom, filters.dateTo])

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between rounded-2xl border border-[#ebe9e6] bg-[#fdfcfb] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-100">
            <Receipt size={17} className="text-cyan-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1a1a1a]">
              Historial de ventas
            </p>
            <p className="text-xs text-[#737373]">{headerSubtitle}</p>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Total ventas"
          value={fmtCOP(summary?.totalRevenue ?? 0)}
          icon={<TrendingUp size={15} />}
          tone="positive"
          isLoading={summaryLoading}
        />
        <SummaryCard
          label="Órdenes"
          value={String(summary?.orderCount ?? 0)}
          icon={<Receipt size={15} />}
          isLoading={summaryLoading}
        />
        <SummaryCard
          label="Devoluciones"
          value={String(summary?.returnsCount ?? 0)}
          icon={<RotateCcw size={15} />}
          tone="warn"
          isLoading={summaryLoading}
        />
      </div>

      {/* Filters */}
      <FiltersBar
        filters={filters}
        setFilters={setFilters}
        preset={preset}
        onDateChange={handleDateChange}
      />

      {/* Table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#ebe9e6] bg-white">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* El encabezado va DENTRO del contenedor que scrollea, no fuera: si
              queda fuera, la barra de scroll angosta solo a las filas y la
              columna Cliente (1fr) se come la diferencia → de Ítems en adelante
              los títulos dejan de caer sobre su columna. Compartiendo el mismo
              ancho no pueden desalinearse. Sticky para que siga visible. */}
          <div
            className={`sticky top-0 z-10 grid ${ROW_GRID} gap-3 border-b border-[#ebe9e6] bg-[#fafaf9] px-6 py-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]`}
          >
            <span>#</span>
            <span>Fecha</span>
            <span>Cliente</span>
            <span>Ítems</span>
            <span>Total</span>
            <span title="Dinero que entró a la caja el día de esta venta">
              Entró ese día
            </span>
            <span>Pago</span>
            <span>Estado</span>
            <span />
          </div>

          {listLoading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-lg bg-slate-100"
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                <ShoppingBag size={24} className="text-slate-300" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#525252]">
                  Aún no hay ventas registradas
                </p>
                <p className="mt-1 text-xs text-[#737373]">
                  Las ventas confirmadas aparecerán aquí.
                </p>
              </div>
              <Link
                to="/ventas"
                className="mt-2 flex h-9 items-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700"
              >
                <ShoppingBag size={13} /> Ir al POS
              </Link>
            </div>
          ) : (
            rows.map((row) => (
              <SalesRow
                key={row.id}
                row={row}
                isExpanded={expandedId === row.id}
                onToggle={() =>
                  setExpandedId((p) => (p === row.id ? null : row.id))
                }
              />
            ))
          )}
        </div>

        {/* Pagination */}
        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-[#ebe9e6] bg-[#fafaf9] px-6 py-3 text-xs text-[#525252]">
            <span>
              Página {filters.page + 1} de {totalPages} · {totalCount} venta
              {totalCount !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={filters.page === 0}
                onClick={() =>
                  setFilters((f) => ({ ...f, page: Math.max(0, f.page - 1) }))
                }
                className="flex h-8 items-center gap-1 rounded-lg border border-[#ebe9e6] bg-white px-3 font-medium text-[#525252] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#f5f4f1]"
              >
                <ChevronLeft size={13} /> Anterior
              </button>
              <button
                disabled={filters.page >= totalPages - 1}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    page: Math.min(totalPages - 1, f.page + 1),
                  }))
                }
                className="flex h-8 items-center gap-1 rounded-lg border border-[#ebe9e6] bg-white px-3 font-medium text-[#525252] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#f5f4f1]"
              >
                Siguiente <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
