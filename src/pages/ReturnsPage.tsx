import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search,
  X,
  RotateCcw,
  ArrowLeftRight,
  ChevronRight,
  ChevronLeft,
  Printer,
  CheckCircle,
  Banknote,
  Clock,
  Package,
  AlertTriangle,
  RefreshCw,
  Plus,
  ScanLine,
} from 'lucide-react'
import { differenceInDays } from 'date-fns'
import toast from 'react-hot-toast'
import { fmtCOP } from '@/lib/formatters'
import { getColorHex } from '@/lib/products'
import { isCreditReturnBlocked, creditBalance } from '@/lib/creditCalc'
import {
  useOrderSearch,
  useOrderDetail,
  useReturnHistory,
  useVariantSearch,
  useVariantByBarcode,
  type FoundOrder,
  type ReturnHistoryFilters,
  type ReturnHistoryRow,
  type ExchangeVariantOption,
} from '@/hooks/useReturns'
import { useBarcode } from '@/hooks/useBarcode'
import { resolveReturnScan } from '@/lib/barcodeMatch'
import { useCreateReturn, type ExchangeItemInput } from '@/hooks/useReturnMutations'
import {
  ADDI_RETURN_BLOCK_MSG,
  calculateExchangeAmounts,
  type ReturnLine,
  type ExchangeAmounts,
} from '@/lib/returnCalc'
import {
  addExchangeLine,
  setExchangeLineQty,
  removeExchangeLine,
  isAtStockCap,
  type ExchangeLine,
} from '@/lib/exchangeCart'
import { returnMovesCash } from '@/lib/shiftGuard'
import { useResolvedConfig } from '@/hooks/useConfig'
import { useRequireShift } from '@/hooks/useRequireShift'
import { ShiftRequiredNotice } from '@/components/cash/ShiftRequiredNotice'
import type { PaymentMethod, ReturnType, Return } from '@/types/database.types'

// ── Helpers de cálculo (Fase 1/2) ─────────────────────────────────────────────
// Convierte lo devuelto y los nuevos a ReturnLine[] para calculateExchangeAmounts.
function returnLinesFrom(
  order: FoundOrder,
  returnQtys: Record<string, number>,
): ReturnLine[] {
  return order.items
    .filter((i) => (returnQtys[i.variant_id] ?? 0) > 0)
    .map((i) => ({
      qty: returnQtys[i.variant_id] ?? 0,
      unit_price: i.unit_price,
      list_price: i.list_price,
    }))
}

function exchangeLinesFrom(items: ExchangeLine[]): ReturnLine[] {
  // El ítem nuevo va a catálogo pleno: unit_price = list_price.
  return items.map((e) => ({
    qty: e.qty,
    unit_price: e.list_price,
    list_price: e.list_price,
  }))
}

function exchangeSummary(
  order: FoundOrder,
  returnQtys: Record<string, number>,
  exchangeItems: ExchangeLine[],
): ExchangeAmounts {
  return calculateExchangeAmounts(
    returnLinesFrom(order, returnQtys),
    exchangeLinesFrom(exchangeItems),
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYMENT_METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Efectivo' },
  { id: 'card', label: 'Tarjeta' },
  { id: 'transfer', label: 'Transferencia' },
  { id: 'addi', label: 'Addi' },
]

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  addi: 'Addi',
  credit: 'Fiado',
}

// ── Stepper ───────────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'Buscar orden' },
  { n: 2, label: 'Ítems' },
  { n: 3, label: 'Tipo' },
  { n: 4, label: 'Confirmar' },
]

function StepperBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 border-b border-[#ebe9e6] px-6 py-4">
      {STEPS.map((s, idx) => (
        <div key={s.n} className="flex items-center">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors ${
                current >= s.n ? 'bg-cyan-600 text-white' : 'bg-[#f5f4f1] text-[#737373]'
              }`}
            >
              {current > s.n ? <CheckCircle size={12} /> : s.n}
            </div>
            <span
              className={`text-[12px] font-medium ${current >= s.n ? 'text-[#1a1a1a]' : 'text-[#737373]'}`}
            >
              {s.label}
            </span>
          </div>
          {idx < STEPS.length - 1 && (
            <ChevronRight size={14} className="mx-3 shrink-0 text-[#d6d3d1]" />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Step 1 — Buscar orden ─────────────────────────────────────────────────────

function Step1Search({
  onOrderSelected,
  returnDaysLimit,
}: {
  onOrderSelected: (o: FoundOrder) => void
  returnDaysLimit: number
}) {
  const [query, setQuery] = useState('')
  const { data: results = [], isLoading } = useOrderSearch(query)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: detail, isLoading: loadingDetail } = useOrderDetail(selectedId)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (!detail) return
    if (detail.payment_method === 'addi') {
      toast.error(ADDI_RETURN_BLOCK_MSG)
      setSelectedId(null)
      return
    }
    if (isCreditReturnBlocked(detail)) {
      toast.error(
        `No se puede devolver un fiado con saldo pendiente (${fmtCOP(
          creditBalance(detail.total, detail.paid_amount),
        )}). Este caso se gestiona manualmente.`,
      )
      setSelectedId(null)
      return
    }
    const age = differenceInDays(new Date(), new Date(detail.created_at))
    if (age > returnDaysLimit) {
      toast.error(`Esta orden tiene ${age} días. El límite es ${returnDaysLimit} días.`)
      setSelectedId(null)
      return
    }
    const allReturned = detail.items.length > 0 && detail.items.every((i) => i.qty_returned >= i.qty)
    if (allReturned) {
      toast.error('Todos los ítems de esta orden ya fueron devueltos.')
      setSelectedId(null)
      return
    }
    onOrderSelected(detail)
  }, [detail, onOrderSelected, returnDaysLimit])

  return (
    <div className="flex flex-col gap-5 p-6">
      <div>
        <p className="mb-1 text-sm font-semibold text-[#1a1a1a]">Buscar orden original</p>
        <p className="text-xs text-[#737373]">
          Ingresa el número de orden, nombre o teléfono del cliente.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3 transition-all focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
        <Search size={16} className="shrink-0 text-[#737373]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedId(null) }}
          placeholder="Ej: a1b2c3 o nombre del cliente…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#a8a29e]"
        />
        {query && (
          <button onClick={() => { setQuery(''); setSelectedId(null) }} className="text-[#737373] hover:text-[#1a1a1a]">
            <X size={14} />
          </button>
        )}
      </div>

      {query.length >= 1 && (
        <div className="overflow-hidden rounded-xl border border-[#ebe9e6]">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#737373]">
              <RefreshCw size={14} className="animate-spin" /> Buscando…
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
              <Package size={24} className="text-[#d6d3d1]" />
              <p className="text-sm text-[#737373]">
                No se encontraron ventas para "{query}"
              </p>
              <p className="text-xs text-[#a8a29e]">
                Busca por número de venta o nombre de cliente.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#f5f4f1]">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  disabled={loadingDetail && selectedId === r.id}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-[#f8f7f5] disabled:opacity-60"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cyan-100">
                    <span className="font-mono text-xl font-bold text-cyan-700">
                      #{r.order_number}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#1a1a1a]">
                      {r.customer ? r.customer.full_name : (
                        <span className="text-[#a8a29e]">Sin cliente</span>
                      )}
                    </p>
                    {r.customer?.phone && (
                      <p className="text-xs text-[#737373]">
                        {r.customer.phone}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-[#a8a29e]">
                      {new Date(r.created_at).toLocaleString('es-CO', {
                        timeZone: 'America/Bogota',
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                      {' · '}
                      {r.items_count} ítem{r.items_count !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm font-semibold text-[#1a1a1a]">
                      {fmtCOP(r.total)}
                    </p>
                    <p className="text-xs text-[#737373]">
                      {METHOD_LABEL[r.payment_method]}
                    </p>
                  </div>
                  {loadingDetail && selectedId === r.id && (
                    <RefreshCw size={13} className="shrink-0 animate-spin text-cyan-500" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Campo de escaneo reutilizable ─────────────────────────────────────────────
// Input siempre listo para el lector de código (que "teclea" el código + Enter).
// Combina la detección de ráfaga de useBarcode con un fallback de Enter manual
// (para probar tecleando en el lab). Se auto-enfoca al montar y cuando cambia
// `refocusKey`, para que el vendedor no tenga que clickear antes de escanear.
function ScanField({
  onScan,
  placeholder,
  refocusKey,
}: {
  onScan: (code: string) => void
  placeholder: string
  refocusKey?: unknown
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { handleKeyDown: barcodeKeyDown } = useBarcode(onScan)

  useEffect(() => {
    inputRef.current?.focus()
  }, [refocusKey])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const consumed = barcodeKeyDown(e)
    if (consumed) {
      setValue('')
      return
    }
    // Enter manual (tecleo lento) — intenta resolver el código escrito.
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault()
      onScan(value.trim())
      setValue('')
    }
  }

  return (
    <div className="flex items-center gap-2.5 rounded-xl border-2 border-dashed border-cyan-200 bg-cyan-50/60 px-4 py-2.5 transition-colors focus-within:border-cyan-400">
      <ScanLine size={16} className="shrink-0 text-cyan-500" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-cyan-400/80"
      />
    </div>
  )
}

// ── Step 2 — Seleccionar ítems ────────────────────────────────────────────────

interface Step2Props {
  order: FoundOrder
  returnQtys: Record<string, number>
  onQtyChange: (variantId: string, qty: number) => void
  onBack: () => void
  onNext: () => void
}

function Step2Items({ order, returnQtys, onQtyChange, onBack, onNext }: Step2Props) {
  const returnableItems = order.items.filter((i) => i.qty - i.qty_returned > 0)
  const totalSelected = Object.values(returnQtys).reduce((s, q) => s + q, 0)

  // Escaneo: cada escaneo suma 1 unidad del ítem, sin exceder lo comprado.
  const handleScan = useCallback(
    (code: string) => {
      const res = resolveReturnScan(order.items, returnQtys, code)
      switch (res.kind) {
        case 'not-found':
          toast.error('Este producto no está en esta venta')
          return
        case 'exhausted':
          toast.error(`${res.item.product_name}: ya fue devuelto por completo`)
          return
        case 'at-cap':
          toast.error(
            `${res.item.product_name}: ya marcaste las ${res.max} unidad${res.max !== 1 ? 'es' : ''} disponibles`,
          )
          return
        case 'increment': {
          onQtyChange(res.item.variant_id, res.nextQty)
          const detail = [
            res.item.size ? `T.${res.item.size}` : null,
            res.item.color,
          ]
            .filter(Boolean)
            .join(' · ')
          toast.success(
            `Devolver: ${res.item.product_name}${detail ? ` — ${detail}` : ''} (×${res.nextQty})`,
          )
        }
      }
    },
    [order.items, returnQtys, onQtyChange],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#ebe9e6] bg-[#fafaf9] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.05em] text-[#737373]">Orden original</p>
            <p className="mt-0.5 text-sm font-semibold text-[#1a1a1a]">
              #{order.order_number}
            </p>
          </div>
          <div className="text-right">
            {order.customer && (
              <p className="text-sm font-medium text-[#1a1a1a]">{order.customer.full_name}</p>
            )}
            <p className="text-xs text-[#737373]">
              {new Date(order.created_at).toLocaleDateString('es-CO', {
                timeZone: 'America/Bogota',
                dateStyle: 'medium',
              })}
              {' · '}
              {fmtCOP(order.total)}
            </p>
          </div>
        </div>
      </div>

      <div className="border-b border-[#ebe9e6] px-6 py-3">
        <ScanField
          onScan={handleScan}
          placeholder="Escanea el producto a devolver…"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="divide-y divide-[#f5f4f1]">
          {returnableItems.map((item) => {
            const maxQty = item.qty - item.qty_returned
            const currentQty = returnQtys[item.variant_id] ?? 0
            return (
              <div key={item.id} className="flex items-center gap-4 px-6 py-4">
                <div
                  className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_1.5px_rgba(0,0,0,0.12)]"
                  style={{ background: item.color ? getColorHex(item.color) : '#e2e8f0' }}
                />
                <div className="min-w-0 flex-1">
                  {item.brand && (
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                      {item.brand}
                    </p>
                  )}
                  <p className="truncate text-sm font-medium text-[#1a1a1a]">{item.product_name}</p>
                  <p className="text-xs text-[#737373]">
                    {[item.size ? `T.${item.size}` : null, item.color].filter(Boolean).join(' · ')}
                    {' · '}
                    {fmtCOP(item.unit_price)} c/u
                  </p>
                  {item.qty_returned > 0 && (
                    <p className="mt-0.5 text-[11px] text-amber-700">
                      Ya devueltos: {item.qty_returned} de {item.qty}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-[#737373]">Máx. {maxQty}</span>
                  <div className="flex h-8 items-center overflow-hidden rounded-lg border border-[#ebe9e6]">
                    <button
                      onClick={() => onQtyChange(item.variant_id, Math.max(0, currentQty - 1))}
                      className="flex h-full w-8 items-center justify-center text-[#525252] hover:bg-[#f5f4f1]"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={maxQty}
                      value={currentQty}
                      onChange={(e) =>
                        onQtyChange(
                          item.variant_id,
                          Math.min(maxQty, Math.max(0, Number(e.target.value) || 0)),
                        )
                      }
                      className="w-10 bg-transparent text-center text-sm font-semibold tabular-nums outline-none"
                    />
                    <button
                      onClick={() => onQtyChange(item.variant_id, Math.min(maxQty, currentQty + 1))}
                      className="flex h-full w-8 items-center justify-center text-[#525252] hover:bg-[#f5f4f1]"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[#ebe9e6] bg-[#fafaf9] px-6 py-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-4 py-2 text-sm font-medium text-[#525252] hover:bg-[#f5f4f1]"
        >
          <ChevronLeft size={14} /> Atrás
        </button>
        <button
          onClick={onNext}
          disabled={totalSelected === 0}
          className="flex items-center gap-2 rounded-lg bg-cyan-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(139,92,246,0.4)] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-cyan-700"
        >
          Continuar ({totalSelected} ítem{totalSelected !== 1 ? 's' : ''})
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Variant Picker Modal ──────────────────────────────────────────────────────

interface VariantPickerProps {
  excludeVariantId?: string
  onSelect: (v: ExchangeVariantOption) => void
  onClose: () => void
}

function VariantPickerModal({ excludeVariantId, onSelect, onClose }: VariantPickerProps) {
  const [query, setQuery] = useState('')
  const { data: variants = [], isLoading } = useVariantSearch(query)
  const filtered = variants.filter((v) => v.id !== excludeVariantId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.5)] p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-semibold text-[#1a1a1a]">Seleccionar variante</p>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg bg-[#f5f4f1] text-[#525252] hover:bg-[#ebe9e6]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-3 py-2.5">
          <Search size={14} className="text-[#737373]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Producto, variante, color o SKU…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#a8a29e]"
          />
        </div>

        <div className="max-h-64 overflow-y-auto divide-y divide-[#f5f4f1] rounded-xl border border-[#ebe9e6]">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-[#737373]">Buscando…</div>
          ) : query.length < 2 ? (
            <div className="py-8 text-center text-sm text-[#a8a29e]">Escribe para buscar variantes</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#737373]">Sin resultados</div>
          ) : (
            filtered.map((v) => (
              <button
                key={v.id}
                onClick={() => onSelect(v)}
                disabled={v.stock_qty === 0}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#f8f7f5] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <div
                  className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_1px_#d6d3d1]"
                  style={{ background: v.color ? getColorHex(v.color) : '#e2e8f0' }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#1a1a1a]">{v.product_name}</p>
                  <p className="text-xs text-[#737373]">
                    {[v.size ? `T.${v.size}` : null, v.color].filter(Boolean).join(' · ')}
                    {v.sku ? ` · ${v.sku}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm font-semibold text-[#1a1a1a]">{fmtCOP(v.price)}</p>
                  <p
                    className={`text-[11px] font-medium ${
                      v.stock_qty > 2
                        ? 'text-green-600'
                        : v.stock_qty > 0
                          ? 'text-amber-600'
                          : 'text-red-500'
                    }`}
                  >
                    {v.stock_qty > 0 ? `${v.stock_qty} disp.` : 'Sin stock'}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Step 3 — Elegir tipo ──────────────────────────────────────────────────────

// Desglose transparente en vivo del cambio (para que el cajero lo explique).
function ExchangeBreakdown({ a }: { a: ExchangeAmounts }) {
  const negativa = a.difference < 0
  return (
    <div className="space-y-1.5 rounded-xl border border-[#ebe9e6] bg-[#fafaf9] p-4 text-sm">
      <div className="flex justify-between text-[#525252]">
        <span>Crédito (lo pagado)</span>
        <span className="font-mono font-medium text-[#1a1a1a]">{fmtCOP(a.creditoPagado)}</span>
      </div>
      {a.descuentoTrasladado > 0 && (
        <div className="flex justify-between text-[#525252]">
          <span>Descuento trasladado</span>
          <span className="font-mono font-medium text-emerald-700">
            −{fmtCOP(a.descuentoTrasladado)}
          </span>
        </div>
      )}
      <div className="flex justify-between text-[#525252]">
        <span>Catálogo nuevo</span>
        <span className="font-mono font-medium text-[#1a1a1a]">{fmtCOP(a.catalogoNuevo)}</span>
      </div>
      <div
        className={`mt-1.5 flex items-center justify-between border-t pt-2 ${
          negativa ? 'border-red-200' : 'border-[#ebe9e6]'
        }`}
      >
        <span className="text-sm font-semibold text-[#1a1a1a]">
          {negativa ? 'Faltante' : a.difference > 0 ? 'A cobrar' : 'Diferencia'}
        </span>
        {negativa ? (
          <span className="font-mono text-base font-bold text-red-600">
            faltan {fmtCOP(a.shortfall)}
          </span>
        ) : (
          <span
            className={`font-mono text-base font-bold ${
              a.difference > 0 ? 'text-cyan-700' : 'text-[#a8a29e]'
            }`}
          >
            {a.difference > 0 ? fmtCOP(a.orderTotal) : 'Sin costo'}
          </span>
        )}
      </div>
      {negativa && (
        <div className="mt-1 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Un cambio no puede quedar a favor del cliente. Agrega productos por{' '}
            <span className="font-semibold">{fmtCOP(a.shortfall)}</span> más para
            poder confirmar.
          </span>
        </div>
      )}
    </div>
  )
}

interface Step3Props {
  order: FoundOrder
  returnQtys: Record<string, number>
  returnType: ReturnType
  onTypeChange: (t: ReturnType) => void
  refundMethod: PaymentMethod
  onRefundMethodChange: (m: PaymentMethod) => void
  notes: string
  onNotesChange: (n: string) => void
  exchangeItems: ExchangeLine[]
  onAddExchange: (v: ExchangeVariantOption) => void
  onUpdateExchangeQty: (variantId: string, qty: number) => void
  onRemoveExchange: (variantId: string) => void
  onBack: () => void
  onNext: () => void
}

function Step3Type({
  order,
  returnQtys,
  returnType,
  onTypeChange,
  refundMethod,
  onRefundMethodChange,
  notes,
  onNotesChange,
  exchangeItems,
  onAddExchange,
  onUpdateExchangeQty,
  onRemoveExchange,
  onBack,
  onNext,
}: Step3Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const lookupByBarcode = useVariantByBarcode()

  // Escaneo: busca la variante por barcode exacto y la agrega al cambio.
  const handleExchangeScan = useCallback(
    async (code: string) => {
      try {
        const v = await lookupByBarcode(code)
        if (!v) {
          toast.error(`Código no encontrado: ${code}`)
          return
        }
        const existing = exchangeItems.find((e) => e.variant_id === v.id)
        if (v.stock_qty <= 0 || (existing && existing.qty >= v.stock_qty)) {
          toast.error(`Sin más stock de ${v.product_name} (máx. ${v.stock_qty})`)
          return
        }
        onAddExchange(v)
        toast.success(`Cambio: ${v.product_name}`)
      } catch {
        toast.error('Error al buscar el código')
      }
    },
    [lookupByBarcode, exchangeItems, onAddExchange],
  )

  const selectedItems = order.items.filter((i) => (returnQtys[i.variant_id] ?? 0) > 0)

  const refundTotal = selectedItems.reduce(
    (sum, i) => sum + i.unit_price * (returnQtys[i.variant_id] ?? 0),
    0,
  )

  // Desglose en vivo del cambio (netea por totales; traslada el descuento).
  const summary = exchangeSummary(order, returnQtys, exchangeItems)

  // Fase 3 — Política "La Bodega no devuelve dinero en un cambio": se exige al
  // menos un producto nuevo Y que la diferencia no quede a favor del cliente
  // (shortfall === 0). Mientras falte por cubrir, no se puede avanzar.
  const canContinue =
    returnType === 'return' ||
    (exchangeItems.length > 0 && summary.shortfall === 0)

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="flex flex-col gap-6">
          {/* Type selector */}
          <div>
            <p className="mb-3 text-sm font-semibold text-[#1a1a1a]">Tipo de devolución</p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  {
                    id: 'return' as ReturnType,
                    icon: <Banknote size={20} />,
                    label: 'Devolución',
                    desc: 'Reembolso al cliente',
                  },
                  {
                    id: 'exchange' as ReturnType,
                    icon: <ArrowLeftRight size={20} />,
                    label: 'Cambio',
                    desc: 'Elige otra variante',
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => onTypeChange(opt.id)}
                  className={`rounded-xl border-2 p-4 text-left transition-all ${
                    returnType === opt.id
                      ? 'border-cyan-500 bg-cyan-50'
                      : 'border-[#ebe9e6] bg-white hover:border-[#d6d3d1]'
                  }`}
                >
                  <div className={returnType === opt.id ? 'text-cyan-600' : 'text-[#737373]'}>
                    {opt.icon}
                  </div>
                  <p
                    className={`mt-2 text-sm font-semibold ${returnType === opt.id ? 'text-cyan-700' : 'text-[#1a1a1a]'}`}
                  >
                    {opt.label}
                  </p>
                  <p className="mt-0.5 text-xs text-[#737373]">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Devolución: summary + method */}
          {returnType === 'return' && (
            <>
              <div className="rounded-xl border border-[#ebe9e6] p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[.05em] text-[#737373]">
                  Ítems a reembolsar
                </p>
                {selectedItems.map((i) => (
                  <div key={i.id} className="flex items-center justify-between py-1.5">
                    <span className="truncate text-sm text-[#1a1a1a]">
                      {i.brand ? (
                        <span className="font-semibold uppercase text-[#a8a29e]">{i.brand} </span>
                      ) : null}
                      {i.product_name}
                      {i.size ? ` T.${i.size}` : ''}
                      {i.color ? ` · ${i.color}` : ''}
                      {' ×'} {returnQtys[i.variant_id]}
                    </span>
                    <span className="ml-4 shrink-0 font-mono text-sm font-semibold text-[#1a1a1a]">
                      {fmtCOP(i.unit_price * (returnQtys[i.variant_id] ?? 0))}
                    </span>
                  </div>
                ))}
                <div className="mt-3 flex items-center justify-between border-t border-[#ebe9e6] pt-3">
                  <span className="text-sm font-semibold text-[#1a1a1a]">Total reembolso</span>
                  <span className="font-mono text-base font-bold text-green-700">{fmtCOP(refundTotal)}</span>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[.05em] text-[#737373]">
                  Método de reembolso
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => onRefundMethodChange(m.id)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        refundMethod === m.id
                          ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
                          : 'border-[#ebe9e6] bg-white text-[#525252] hover:border-[#d6d3d1]'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Cambio: crédito devuelto (referencia) + lista de productos nuevos */}
          {returnType === 'exchange' && (
            <>
              {/* Referencia del crédito: lo que se devuelve (solo lectura) */}
              <div className="rounded-xl border border-[#ebe9e6] p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[.05em] text-[#737373]">
                  Devuelve (crédito)
                </p>
                {selectedItems.map((i) => (
                  <div key={i.id} className="flex items-center justify-between py-1">
                    <span className="truncate text-sm text-[#525252]">
                      {i.product_name}
                      {i.size ? ` T.${i.size}` : ''}
                      {i.color ? ` · ${i.color}` : ''}
                      <span className="text-[#a8a29e]"> ×{returnQtys[i.variant_id]}</span>
                    </span>
                    <span className="ml-3 shrink-0 font-mono text-sm text-[#1a1a1a]">
                      {fmtCOP(i.unit_price * (returnQtys[i.variant_id] ?? 0))}
                    </span>
                  </div>
                ))}
              </div>

              {/* Productos nuevos: lista abierta, cantidades propias */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[.05em] text-[#737373]">
                    Productos nuevos
                  </p>
                  <button
                    onClick={() => setPickerOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700"
                  >
                    <Plus size={13} /> Agregar producto
                  </button>
                </div>

                <div className="mb-3">
                  <ScanField
                    onScan={handleExchangeScan}
                    placeholder="Escanea el producto nuevo del cambio…"
                    refocusKey={pickerOpen}
                  />
                </div>

                {exchangeItems.length === 0 ? (
                  <button
                    onClick={() => setPickerOpen(true)}
                    className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-[#d6d3d1] py-6 text-center hover:border-cyan-400 hover:bg-cyan-50"
                  >
                    <Package size={20} className="text-[#a8a29e]" />
                    <span className="text-xs font-medium text-cyan-600">
                      Agrega uno o varios productos para el cambio
                    </span>
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    {exchangeItems.map((e) => (
                      <div
                        key={e.variant_id}
                        className="flex items-center gap-3 rounded-xl border border-[#ebe9e6] p-3"
                      >
                        <div
                          className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_1px_#d6d3d1]"
                          style={{ background: e.color ? getColorHex(e.color) : '#e2e8f0' }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#1a1a1a]">
                            {e.product_name}
                            {e.size ? ` T.${e.size}` : ''}
                            {e.color ? ` · ${e.color}` : ''}
                          </p>
                          <p className="text-xs text-[#737373]">
                            {fmtCOP(e.list_price)} c/u · {e.stock_qty} disp.
                          </p>
                        </div>
                        <div className="flex h-8 shrink-0 items-center overflow-hidden rounded-lg border border-[#ebe9e6]">
                          <button
                            onClick={() => onUpdateExchangeQty(e.variant_id, e.qty - 1)}
                            className="flex h-full w-7 items-center justify-center text-[#525252] hover:bg-[#f5f4f1]"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={e.stock_qty}
                            value={e.qty}
                            onChange={(ev) =>
                              onUpdateExchangeQty(e.variant_id, Number(ev.target.value) || 1)
                            }
                            className="w-9 bg-transparent text-center text-sm font-semibold tabular-nums outline-none"
                          />
                          <button
                            onClick={() => onUpdateExchangeQty(e.variant_id, e.qty + 1)}
                            className="flex h-full w-7 items-center justify-center text-[#525252] hover:bg-[#f5f4f1]"
                          >
                            +
                          </button>
                        </div>
                        <span className="w-20 shrink-0 text-right font-mono text-sm font-semibold text-[#1a1a1a]">
                          {fmtCOP(e.list_price * e.qty)}
                        </span>
                        <button
                          onClick={() => onRemoveExchange(e.variant_id)}
                          className="shrink-0 text-[#a8a29e] hover:text-red-500"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Desglose en vivo */}
              <ExchangeBreakdown a={summary} />

              {/* Un cambio nunca reembolsa (la diferencia siempre es ≥ 0 por el
                  bloqueo). Solo se pide método cuando hay diferencia a cobrar. */}
              {summary.orderTotal > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[.05em] text-[#737373]">
                    Método de pago de la diferencia
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => onRefundMethodChange(m.id)}
                        className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          refundMethod === m.id
                            ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
                            : 'border-[#ebe9e6] bg-white text-[#525252] hover:border-[#d6d3d1]'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Notes */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[.05em] text-[#737373]">
              Notas (opcional)
            </p>
            <textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={2}
              placeholder="Motivo de la devolución…"
              className="w-full resize-none rounded-xl border border-[#ebe9e6] bg-white px-3 py-2.5 text-sm outline-none placeholder:text-[#a8a29e] focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[#ebe9e6] bg-[#fafaf9] px-6 py-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-4 py-2 text-sm font-medium text-[#525252] hover:bg-[#f5f4f1]"
        >
          <ChevronLeft size={14} /> Atrás
        </button>
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="flex items-center gap-2 rounded-lg bg-cyan-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(139,92,246,0.4)] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-cyan-700"
        >
          Ver resumen <ChevronRight size={14} />
        </button>
      </div>

      {pickerOpen && (
        <VariantPickerModal
          onSelect={(v) => { onAddExchange(v); setPickerOpen(false) }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

// ── Step 4 — Confirmar ────────────────────────────────────────────────────────

interface Step4Props {
  order: FoundOrder
  returnQtys: Record<string, number>
  returnType: ReturnType
  refundMethod: PaymentMethod
  notes: string
  exchangeItems: ExchangeLine[]
  isPending: boolean
  hasShift: boolean
  onBack: () => void
  onConfirm: () => void
}

function Step4Confirm({
  order,
  returnQtys,
  returnType,
  refundMethod,
  notes,
  exchangeItems,
  isPending,
  hasShift,
  onBack,
  onConfirm,
}: Step4Props) {
  const selectedItems = order.items.filter((i) => (returnQtys[i.variant_id] ?? 0) > 0)
  const refundTotal = selectedItems.reduce(
    (sum, i) => sum + i.unit_price * (returnQtys[i.variant_id] ?? 0),
    0,
  )
  const summary = exchangeSummary(order, returnQtys, exchangeItems)
  const priceDiff = summary.difference

  // ¿Esta operación MUEVE efectivo (reembolso en efectivo o diferencia cobrada)?
  // Misma decisión que el guard de la mutation (shiftGuard.returnMovesCash). Si
  // mueve caja y no hay turno abierto → bloquear. Una devolución no-efectivo o
  // un cambio del mismo valor no mueven el cajón → no se bloquean.
  const movesCash = returnMovesCash({
    type: returnType,
    refundMethod,
    returnedValue: refundTotal,
    exchangeRefundDue: summary.refundDue,
    exchangeCharge: summary.orderTotal,
  })
  const shiftBlocked = movesCash && !hasShift

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle size={15} className="text-amber-600" />
            </div>
            <p className="text-sm font-medium text-[#1a1a1a]">
              Revisa el resumen antes de confirmar.
            </p>
          </div>

          {shiftBlocked && (
            <ShiftRequiredNotice
              message={
                returnType === 'return'
                  ? 'Abre un turno de caja para registrar el reembolso en efectivo.'
                  : 'Abre un turno de caja para cobrar la diferencia del cambio.'
              }
            />
          )}

          {/* Returned items */}
          <div className="overflow-hidden rounded-xl border border-[#ebe9e6]">
            <div className="border-b border-[#f5f4f1] bg-[#fafaf9] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[.05em] text-[#737373]">
                Ítems devueltos
              </p>
            </div>
            {selectedItems.map((i) => (
              <div
                key={i.id}
                className="flex items-center gap-3 border-b border-[#f5f4f1] px-4 py-3 last:border-0"
              >
                <div
                  className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_1.5px_rgba(0,0,0,0.12)]"
                  style={{ background: i.color ? getColorHex(i.color) : '#e2e8f0' }}
                />
                <div className="min-w-0 flex-1">
                  {i.brand && (
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                      {i.brand}
                    </p>
                  )}
                  <p className="truncate text-sm font-medium text-[#1a1a1a]">
                    {i.product_name}
                    {i.size ? ` T.${i.size}` : ''}
                    {i.color ? ` · ${i.color}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-[#737373]">×{returnQtys[i.variant_id]}</span>
                <span className="shrink-0 font-mono text-sm font-semibold text-[#1a1a1a]">
                  {fmtCOP(i.unit_price * (returnQtys[i.variant_id] ?? 0))}
                </span>
              </div>
            ))}
          </div>

          {/* Exchange items */}
          {returnType === 'exchange' && (
            <div className="overflow-hidden rounded-xl border border-[#ebe9e6]">
              <div className="border-b border-[#f5f4f1] bg-[#fafaf9] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[.05em] text-[#737373]">
                  Ítems nuevos (cambio)
                </p>
              </div>
              {exchangeItems.map((e) => (
                <div
                  key={e.variant_id}
                  className="flex items-center gap-3 border-b border-[#f5f4f1] px-4 py-3 last:border-0"
                >
                  <div
                    className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_1.5px_rgba(0,0,0,0.12)]"
                    style={{ background: e.color ? getColorHex(e.color) : '#e2e8f0' }}
                  />
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-[#1a1a1a]">
                    {e.product_name}
                    {e.size ? ` T.${e.size}` : ''}
                    {e.color ? ` · ${e.color}` : ''}
                  </p>
                  <span className="shrink-0 text-xs text-[#737373]">×{e.qty}</span>
                  <span className="shrink-0 font-mono text-sm font-semibold text-[#1a1a1a]">
                    {fmtCOP(e.list_price * e.qty)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          <div className="space-y-2 rounded-xl border border-[#ebe9e6] p-4 text-sm">
            <div className="flex justify-between text-[#525252]">
              <span>Tipo</span>
              <span className="font-medium text-[#1a1a1a]">
                {returnType === 'return' ? 'Devolución' : 'Cambio'}
              </span>
            </div>
            {returnType === 'return' && (
              <div className="flex justify-between text-[#525252]">
                <span>Reembolso</span>
                <span className="font-mono font-semibold text-green-700">{fmtCOP(refundTotal)}</span>
              </div>
            )}
            {returnType === 'exchange' && priceDiff > 0 && (
              <div className="flex justify-between text-[#525252]">
                <span>A cobrar</span>
                <span className="font-mono font-semibold text-cyan-700">
                  {fmtCOP(summary.orderTotal)}
                </span>
              </div>
            )}
            {returnType === 'exchange' && priceDiff < 0 && (
              <div className="flex justify-between text-[#525252]">
                <span>Faltante para cubrir</span>
                <span className="font-mono font-semibold text-amber-700">
                  faltan {fmtCOP(summary.shortfall)}
                </span>
              </div>
            )}
            {/* Sin costo en un cambio no requiere método (no hay cobro ni reembolso). */}
            {(returnType === 'return' || priceDiff > 0) && (
              <div className="flex justify-between text-[#525252]">
                <span>{returnType === 'return' ? 'Método reembolso' : 'Método pago'}</span>
                <span className="font-medium text-[#1a1a1a]">{METHOD_LABEL[refundMethod]}</span>
              </div>
            )}
            {notes && (
              <div className="flex justify-between gap-4 text-[#525252]">
                <span className="shrink-0">Notas</span>
                <span className="text-right text-[#737373]">{notes}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[#ebe9e6] bg-[#fafaf9] px-6 py-4">
        <button
          onClick={onBack}
          disabled={isPending}
          className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-4 py-2 text-sm font-medium text-[#525252] hover:bg-[#f5f4f1] disabled:opacity-50"
        >
          <ChevronLeft size={14} /> Atrás
        </button>
        <button
          onClick={onConfirm}
          disabled={isPending || shiftBlocked}
          className="flex items-center gap-2 rounded-lg bg-cyan-600 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(139,92,246,0.4)] disabled:cursor-not-allowed disabled:opacity-60 hover:bg-cyan-700"
        >
          {isPending ? (
            <><RefreshCw size={14} className="animate-spin" /> Procesando…</>
          ) : (
            <><CheckCircle size={14} /> Confirmar devolución</>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Ticket Modal ──────────────────────────────────────────────────────────────

interface TicketProps {
  returnRecord: Return
  order: FoundOrder
  returnQtys: Record<string, number>
  returnType: ReturnType
  refundMethod: PaymentMethod
  exchangeItems: ExchangeLine[]
  onClose: () => void
}

function ReturnTicketModal({
  returnRecord,
  order,
  returnQtys,
  returnType,
  refundMethod,
  exchangeItems,
  onClose,
}: TicketProps) {
  const selectedItems = order.items.filter((i) => (returnQtys[i.variant_id] ?? 0) > 0)
  const refundTotal = selectedItems.reduce(
    (sum, i) => sum + i.unit_price * (returnQtys[i.variant_id] ?? 0),
    0,
  )
  const summary = exchangeSummary(order, returnQtys, exchangeItems)
  const priceDiff = summary.difference

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.5)] p-4 backdrop-blur-sm">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
        <div className="mb-4 text-center">
          <p className="text-base font-bold text-[#1a1a1a]">G-Pulso</p>
          <p className="text-xs text-[#737373]">
            {new Date(returnRecord.created_at).toLocaleString('es-CO', {
              timeZone: 'America/Bogota',
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </p>
          <p className="mt-1 text-xs text-[#a8a29e]">
            {returnType === 'return' ? 'Devolución' : 'Cambio'} #
            {returnRecord.id.slice(-6).toUpperCase()}
          </p>
          <p className="text-[11px] text-[#a8a29e]">
            Ref. orden #{order.order_number}
          </p>
        </div>

        <div className="mb-3 border-t border-dashed border-[#ebe9e6] pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#737373]">
            Ítems devueltos
          </p>
          {selectedItems.map((i) => (
            <div key={i.id} className="mb-1 flex justify-between text-xs">
              <span className="text-[#525252]">
                {i.brand ? (
                  <span className="font-semibold uppercase text-[#a8a29e]">{i.brand} </span>
                ) : null}
                {i.product_name}
                {i.size ? ` T.${i.size}` : ''}
                {i.color ? ` ${i.color}` : ''} × {returnQtys[i.variant_id]}
              </span>
              <span className="ml-2 shrink-0 font-mono text-[#1a1a1a]">
                {fmtCOP(i.unit_price * (returnQtys[i.variant_id] ?? 0))}
              </span>
            </div>
          ))}
        </div>

        {returnType === 'exchange' && (
          <div className="mb-3 border-t border-dashed border-[#ebe9e6] pt-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#737373]">
              Ítems nuevos
            </p>
            {exchangeItems.map((e) => (
              <div key={e.variant_id} className="mb-1 flex justify-between text-xs">
                <span className="text-[#525252]">
                  {e.product_name}
                  {e.size ? ` T.${e.size}` : ''}
                  {e.color ? ` ${e.color}` : ''} × {e.qty}
                </span>
                <span className="ml-2 shrink-0 font-mono text-[#1a1a1a]">
                  {fmtCOP(e.list_price * e.qty)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1 border-t border-dashed border-[#ebe9e6] pt-3 text-xs">
          {returnType === 'return' && (
            <div className="flex justify-between font-bold text-[#1a1a1a]">
              <span>Reembolso</span>
              <span className="font-mono">{fmtCOP(refundTotal)}</span>
            </div>
          )}
          {returnType === 'exchange' && priceDiff !== 0 && (
            <div
              className={`flex justify-between font-bold ${priceDiff > 0 ? 'text-cyan-700' : 'text-green-700'}`}
            >
              <span>{priceDiff > 0 ? 'Cobra cliente' : 'Devuelve tienda'}</span>
              <span className="font-mono">
                {fmtCOP(priceDiff > 0 ? summary.orderTotal : summary.refundDue)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-[#525252]">
            <span>{returnType === 'return' ? 'Método reembolso' : 'Método pago'}</span>
            <span>{METHOD_LABEL[refundMethod]}</span>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-[#a8a29e]">Gracias por su preferencia</p>

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => window.print()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#ebe9e6] py-2.5 text-sm font-medium text-[#525252] hover:bg-[#f5f4f1]"
          >
            <Printer size={14} /> Imprimir
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-cyan-600 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700"
          >
            Nueva devolución
          </button>
        </div>
      </div>
    </div>
  )
}

// ── History Panel ─────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: ReturnType }) {
  return type === 'return' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
      <RotateCcw size={9} /> Devolución
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-semibold text-cyan-800">
      <ArrowLeftRight size={9} /> Cambio
    </span>
  )
}

function HistoryRowItem({
  row,
  isExpanded,
  onToggle,
}: {
  row: ReturnHistoryRow
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[#f8f7f5]"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f5f4f1]">
          {row.type === 'return' ? (
            <RotateCcw size={14} className="text-[#737373]" />
          ) : (
            <ArrowLeftRight size={14} className="text-[#737373]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <TypeBadge type={row.type} />
          </div>
          <p className="text-xs text-[#737373]">
            Ord. #{row.original_order_number ?? '—'}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[#a8a29e]">
            <Clock size={9} />
            {new Date(row.created_at).toLocaleString('es-CO', {
              timeZone: 'America/Bogota',
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm font-semibold text-[#1a1a1a]">
            {fmtCOP(row.refund_total)}
          </p>
          <p className="text-[11px] text-[#737373]">
            {row.items_count} ítem{row.items_count !== 1 ? 's' : ''}
          </p>
        </div>
        <ChevronRight
          size={14}
          className={`shrink-0 text-[#a8a29e] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
      </button>
      {isExpanded && (
        <div className="border-t border-[#f5f4f1] bg-[#f8f7f5] px-5 py-3 text-xs">
          <p className="text-[#737373]">
            <span className="font-medium text-[#1a1a1a]">ID: </span>
            {row.id}
          </p>
          {row.notes && (
            <p className="mt-1 text-[#737373]">
              <span className="font-medium text-[#1a1a1a]">Notas: </span>
              {row.notes}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function HistoryPanel() {
  const [filters, setFilters] = useState<ReturnHistoryFilters>({
    type: 'all',
    dateFrom: '',
    dateTo: '',
  })
  const [expanded, setExpanded] = useState<string | null>(null)
  const { data: rows = [], isLoading } = useReturnHistory(filters)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#ebe9e6] bg-white">
      <div className="flex items-center justify-between border-b border-[#ebe9e6] px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-[#1a1a1a]">Historial</p>
          <p className="text-xs text-[#737373]">
            {rows.length} registro{rows.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-b border-[#ebe9e6] px-5 py-3">
        <div className="flex gap-2">
          {(['all', 'return', 'exchange'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilters((f) => ({ ...f, type: t }))}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filters.type === t
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-[#ebe9e6] bg-white text-[#525252] hover:border-[#d6d3d1]'
              }`}
            >
              {t === 'all' ? 'Todos' : t === 'return' ? 'Devolución' : 'Cambio'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            className="flex-1 rounded-lg border border-[#ebe9e6] px-2 py-1 text-xs outline-none focus:border-cyan-400"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
            className="flex-1 rounded-lg border border-[#ebe9e6] px-2 py-1 text-xs outline-none focus:border-cyan-400"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
              <RotateCcw size={24} className="text-slate-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#525252]">Sin devoluciones</p>
              <p className="mt-1 text-xs text-[#737373]">
                Las devoluciones registradas aparecerán aquí.
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[#f5f4f1]">
            {rows.map((row) => (
              <HistoryRowItem
                key={row.id}
                row={row}
                isExpanded={expanded === row.id}
                onToggle={() => setExpanded((p) => (p === row.id ? null : row.id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4

export default function ReturnsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [step, setStep] = useState<Step>(1)
  const [selectedOrder, setSelectedOrder] = useState<FoundOrder | null>(null)
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({})
  const [returnType, setReturnType] = useState<ReturnType>('return')
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')
  // Carrito de productos nuevos del cambio (lista abierta, qty propia).
  const [exchangeItems, setExchangeItems] = useState<ExchangeLine[]>([])
  const [completedReturn, setCompletedReturn] = useState<Return | null>(null)
  const preloadAttemptedRef = useRef<string | null>(null)

  const createReturn = useCreateReturn()
  const { hasShift } = useRequireShift()
  const config = useResolvedConfig()
  const returnDaysLimit = config.return_days_limit

  const preloadOrderId = searchParams.get('orderId')
  const shouldPreload =
    !!preloadOrderId &&
    preloadAttemptedRef.current !== preloadOrderId &&
    !selectedOrder
  const { data: preloadDetail } = useOrderDetail(
    shouldPreload ? preloadOrderId : null,
  )

  useEffect(() => {
    if (!shouldPreload || !preloadDetail || !preloadOrderId) return
    preloadAttemptedRef.current = preloadOrderId

    if (preloadDetail.payment_method === 'addi') {
      toast.error(ADDI_RETURN_BLOCK_MSG)
      setSearchParams({}, { replace: true })
      return
    }
    if (isCreditReturnBlocked(preloadDetail)) {
      toast.error(
        `No se puede devolver un fiado con saldo pendiente (${fmtCOP(
          creditBalance(preloadDetail.total, preloadDetail.paid_amount),
        )}). Este caso se gestiona manualmente.`,
      )
      setSearchParams({}, { replace: true })
      return
    }
    const age = differenceInDays(new Date(), new Date(preloadDetail.created_at))
    if (age > returnDaysLimit) {
      toast.error(
        `Esta orden tiene ${age} días. El límite es ${returnDaysLimit} días.`,
      )
      setSearchParams({}, { replace: true })
      return
    }
    const allReturned =
      preloadDetail.items.length > 0 &&
      preloadDetail.items.every((i) => i.qty_returned >= i.qty)
    if (allReturned) {
      toast.error('Todos los ítems de esta orden ya fueron devueltos.')
      setSearchParams({}, { replace: true })
      return
    }

    setSelectedOrder(preloadDetail)
    setReturnQtys({})
    setStep(2)
    setSearchParams({}, { replace: true })
  }, [
    shouldPreload,
    preloadDetail,
    preloadOrderId,
    returnDaysLimit,
    setSearchParams,
  ])

  const reset = useCallback(() => {
    setStep(1)
    setSelectedOrder(null)
    setReturnQtys({})
    setReturnType('return')
    setRefundMethod('cash')
    setNotes('')
    setExchangeItems([])
    setCompletedReturn(null)
    preloadAttemptedRef.current = null
  }, [])

  const handleOrderSelected = useCallback((order: FoundOrder) => {
    setSelectedOrder(order)
    setReturnQtys({})
    setStep(2)
  }, [])

  const handleQtyChange = useCallback((variantId: string, qty: number) => {
    setReturnQtys((prev) => ({ ...prev, [variantId]: qty }))
  }, [])

  const handleAddExchange = useCallback((v: ExchangeVariantOption) => {
    setExchangeItems((prev) => {
      if (isAtStockCap(prev, v)) {
        toast.error(`Sin más stock de ${v.product_name} (máx. ${v.stock_qty})`)
        return prev
      }
      return addExchangeLine(prev, v)
    })
  }, [])

  const handleUpdateExchangeQty = useCallback((variantId: string, qty: number) => {
    setExchangeItems((prev) => setExchangeLineQty(prev, variantId, qty))
  }, [])

  const handleRemoveExchange = useCallback((variantId: string) => {
    setExchangeItems((prev) => removeExchangeLine(prev, variantId))
  }, [])

  const handleConfirm = () => {
    if (!selectedOrder) return

    const selectedItems = selectedOrder.items.filter(
      (i) => (returnQtys[i.variant_id] ?? 0) > 0,
    )

    // Defensa en profundidad — Política "no devolver dinero en un cambio":
    // si la diferencia queda a favor del cliente, no se registra el cambio.
    // (Step3 ya bloquea la transición; esto cubre cualquier ruta directa.)
    if (returnType === 'exchange') {
      const summary = exchangeSummary(selectedOrder, returnQtys, exchangeItems)
      if (summary.shortfall > 0) {
        toast.error(
          `El cambio no puede quedar a favor del cliente. Agrega productos por al menos ${fmtCOP(summary.shortfall)} más para cubrir el saldo.`,
        )
        return
      }
    }

    const exchangeInput: ExchangeItemInput[] =
      returnType === 'exchange'
        ? exchangeItems.map((e) => ({
            variant_id: e.variant_id,
            product_id: e.product_id,
            qty: e.qty,
            // Ítem nuevo a catálogo: unit_price = list_price.
            unit_price: e.list_price,
            list_price: e.list_price,
          }))
        : []

    createReturn.mutate(
      {
        original_order_id: selectedOrder.id,
        original_order_number: selectedOrder.order_number,
        customer_id: selectedOrder.customer_id,
        type: returnType,
        returnItems: selectedItems.map((i) => ({
          variant_id: i.variant_id,
          qty: returnQtys[i.variant_id] ?? 0,
          // unit_price = lo pagado (crédito); list_price = catálogo (para
          // trasladar el descuento absoluto del original al cambio).
          unit_price: i.unit_price,
          list_price: i.list_price,
        })),
        exchangeItems: exchangeInput,
        refundMethod,
        notes,
      },
      { onSuccess: (ret) => setCompletedReturn(ret) },
    )
  }

  return (
    <div className="flex h-full gap-4 p-4">
      {/* Left — Stepper form */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#ebe9e6] bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#ebe9e6] bg-[#fdfcfb] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-100">
              <RotateCcw size={16} className="text-cyan-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1a1a1a]">Devoluciones y cambios</p>
              <p className="text-xs text-[#737373]">
                Límite: {returnDaysLimit} días desde la compra
              </p>
            </div>
          </div>
          {step > 1 && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 py-1.5 text-xs font-medium text-[#525252] hover:bg-[#f5f4f1]"
            >
              <X size={12} /> Cancelar
            </button>
          )}
        </div>

        <StepperBar current={step} />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {step === 1 && (
            <div className="flex-1 overflow-y-auto">
              <Step1Search onOrderSelected={handleOrderSelected} returnDaysLimit={returnDaysLimit} />
            </div>
          )}

          {step === 2 && selectedOrder && (
            <Step2Items
              order={selectedOrder}
              returnQtys={returnQtys}
              onQtyChange={handleQtyChange}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}

          {step === 3 && selectedOrder && (
            <Step3Type
              order={selectedOrder}
              returnQtys={returnQtys}
              returnType={returnType}
              onTypeChange={(t) => { setReturnType(t); setExchangeItems([]) }}
              refundMethod={refundMethod}
              onRefundMethodChange={setRefundMethod}
              notes={notes}
              onNotesChange={setNotes}
              exchangeItems={exchangeItems}
              onAddExchange={handleAddExchange}
              onUpdateExchangeQty={handleUpdateExchangeQty}
              onRemoveExchange={handleRemoveExchange}
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
            />
          )}

          {step === 4 && selectedOrder && (
            <Step4Confirm
              order={selectedOrder}
              returnQtys={returnQtys}
              returnType={returnType}
              refundMethod={refundMethod}
              notes={notes}
              exchangeItems={exchangeItems}
              isPending={createReturn.isPending}
              hasShift={hasShift}
              onBack={() => setStep(3)}
              onConfirm={handleConfirm}
            />
          )}
        </div>
      </section>

      {/* Right — History */}
      <section className="flex w-[360px] shrink-0 flex-col overflow-hidden">
        <HistoryPanel />
      </section>

      {/* Ticket */}
      {completedReturn && selectedOrder && (
        <ReturnTicketModal
          returnRecord={completedReturn}
          order={selectedOrder}
          returnQtys={returnQtys}
          returnType={returnType}
          refundMethod={refundMethod}
          exchangeItems={exchangeItems}
          onClose={reset}
        />
      )}
    </div>
  )
}
