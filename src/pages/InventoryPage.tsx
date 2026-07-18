import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  Package,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  Search,
  Download,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  ScanLine,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { useStockLevels, useStockMovements, useStoreProfiles, MOV_PAGE_SIZE } from '@/hooks/useInventory'
import type { MovementFilters, VariantRow } from '@/hooks/useInventory'
import { useInventoryMutations } from '@/hooks/useInventoryMutations'
import { usePermissions } from '@/hooks/usePermissions'
import { useCategories } from '@/hooks/useProducts'
import { useDebounce } from '@/hooks/useDebounce'
import { useBarcode } from '@/hooks/useBarcode'
import { findByBarcode } from '@/lib/barcodeMatch'
import { fmtCOP } from '@/lib/formatters'
import { getColorHex } from '@/lib/products'
import type { StockMovementType } from '@/types/database.types'

type StockStateValue = 'out' | 'low' | 'ok'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StockBadge({ state }: { state: StockStateValue }) {
  if (state === 'out')
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-600">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Sin disponible
      </span>
    )
  if (state === 'low')
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Stock bajo
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Normal
    </span>
  )
}

const MOV_TYPE_LABELS: Record<StockMovementType, string> = {
  sale: 'Venta',
  return: 'Devolución',
  adjustment: 'Ajuste',
  purchase: 'Compra',
}

function MovTypeBadge({ type }: { type: StockMovementType }) {
  const label = MOV_TYPE_LABELS[type]
  const styles: Record<StockMovementType, string> = {
    sale:       'bg-red-50 text-red-600 border border-red-200',
    return:     'bg-emerald-50 text-emerald-600 border border-emerald-200',
    adjustment: 'bg-blue-50 text-blue-600 border border-blue-200',
    purchase:   'bg-cyan-50 text-cyan-600 border border-cyan-200',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles[type]}`}>
      {label}
    </span>
  )
}

// ─── MiniStat card ────────────────────────────────────────────────────────────

type CardTone = 'normal' | 'red' | 'yellow' | 'green'

interface SummaryCardProps {
  label: string
  value: string | number
  icon: React.ElementType
  tone?: CardTone
  mono?: boolean
}

function SummaryCard({ label, value, icon: Icon, tone = 'normal', mono }: SummaryCardProps) {
  const iconStyles: Record<CardTone, string> = {
    normal: 'bg-cyan-50 text-cyan-500',
    red:    'bg-red-50 text-red-500',
    yellow: 'bg-amber-50 text-amber-500',
    green:  'bg-emerald-50 text-emerald-500',
  }
  const valueColors: Record<CardTone, string> = {
    normal: '#1a1a1a',
    red:    '#dc2626',
    yellow: '#d97706',
    green:  '#059669',
  }
  return (
    <div className="rounded-2xl border border-[#ebe9e6] bg-white p-5">
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconStyles[tone]}`}>
          <Icon size={20} />
        </div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
          {label}
        </p>
      </div>
      <p
        className={`leading-none tracking-[-0.025em] tabular-nums ${
          mono ? 'font-mono text-[22px] font-semibold' : 'text-[28px] font-bold'
        }`}
        style={{
          fontFamily: mono ? undefined : "'Bricolage Grotesque', sans-serif",
          color: valueColors[tone],
        }}
      >
        {value}
      </p>
    </div>
  )
}

// ─── Adjust Modal ─────────────────────────────────────────────────────────────

const ADJUST_TYPES = [
  'Ingreso de mercancía',
  'Ajuste por conteo',
  'Merma',
  'Otro',
] as const

interface AdjustModalProps {
  open: boolean
  onClose: () => void
}

function AdjustModal({ open, onClose }: AdjustModalProps) {
  const [variantSearch, setVariantSearch] = useState('')
  const [selectedVariant, setSelectedVariant] = useState<VariantRow | null>(null)
  const [tipo, setTipo] = useState<string>('Ingreso de mercancía')
  const [qty, setQty] = useState<string>('')
  const [motivo, setMotivo] = useState('')

  const debouncedSearch = useDebounce(variantSearch)
  const { data: allVariants = [] } = useStockLevels()
  const { adjustStock } = useInventoryMutations()

  const searchInputRef = useRef<HTMLInputElement>(null)
  const qtyInputRef = useRef<HTMLInputElement>(null)

  // Escaneo: busca la variante por barcode exacto, la selecciona y salta a la
  // cantidad. El lector "teclea" el código + Enter (ver useBarcode).
  const handleScan = useCallback(
    (code: string) => {
      const match = findByBarcode(allVariants, code)
      if (!match) {
        toast.error(`Código no encontrado: ${code}`)
        return
      }
      setSelectedVariant(match)
      setVariantSearch('')
    },
    [allVariants],
  )

  const { handleKeyDown: barcodeKeyDown } = useBarcode(handleScan)

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const consumed = barcodeKeyDown(e)
    if (consumed) {
      setVariantSearch('')
      return
    }
    // Enter manual (tecleo lento) — intenta resolver el código escrito.
    if (e.key === 'Enter' && variantSearch.trim()) {
      e.preventDefault()
      handleScan(variantSearch.trim())
    }
  }

  // Foco listo sin clickear: al seleccionar variante saltar a la cantidad; al
  // limpiar la selección volver al buscador para seguir escaneando.
  useEffect(() => {
    if (selectedVariant) qtyInputRef.current?.focus()
    else if (open) searchInputRef.current?.focus()
  }, [selectedVariant, open])

  const searchResults = useMemo(() => {
    if (!debouncedSearch.trim()) return []
    const q = debouncedSearch.toLowerCase()
    return allVariants
      .filter(
        (v) =>
          v.products.name.toLowerCase().includes(q) ||
          v.sku?.toLowerCase().includes(q) ||
          v.barcode?.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [allVariants, debouncedSearch])

  function reset() {
    setVariantSearch('')
    setSelectedVariant(null)
    setTipo('Ingreso de mercancía')
    setQty('')
    setMotivo('')
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleSubmit() {
    if (!selectedVariant || !motivo.trim()) return
    const qtyNum = Number(qty)
    if (qtyNum === 0) return

    const notes = tipo !== 'Otro' ? `[${tipo}] ${motivo.trim()}` : motivo.trim()

    adjustStock.mutate(
      { variantId: selectedVariant.id, qty: qtyNum, type: 'adjustment', notes },
      { onSuccess: handleClose },
    )
  }

  if (!open) return null

  const qtyNum = Number(qty)
  const canSubmit =
    !!selectedVariant && motivo.trim().length > 0 && qty !== '' && qtyNum !== 0

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={handleClose}
    >
      <div
        className="max-h-[90vh] w-[540px] overflow-auto rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#f5f4f1] px-7 py-6">
          <div>
            <h2
              className="tracking-[-0.025em]"
              style={{
                fontFamily: 'Bricolage Grotesque, sans-serif',
                fontSize: 22,
                fontWeight: 600,
                color: '#1a1a1a',
              }}
            >
              Ajuste manual de stock
            </h2>
            <p className="mt-0.5 text-[13px] text-[#737373]">
              Registra una entrada, salida o corrección de inventario.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        <div className="space-y-5 px-7 py-6">
          {/* Variant search / selected card */}
          {!selectedVariant ? (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
                Buscar variante
              </label>
              <div className="relative">
                <ScanLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-500" />
                <input
                  ref={searchInputRef}
                  autoFocus
                  className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white pl-9 pr-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]"
                  placeholder="Escanea o busca por nombre, SKU o código…"
                  value={variantSearch}
                  onChange={(e) => setVariantSearch(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
              </div>
              {searchResults.length > 0 && (
                <div className="mt-1.5 max-h-52 overflow-y-auto rounded-lg border border-[#ebe9e6] bg-white shadow-sm">
                  {searchResults.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        setSelectedVariant(v)
                        setVariantSearch('')
                      }}
                      className="flex w-full items-center gap-3 border-b border-[#f5f4f1] px-4 py-3 text-left last:border-0 hover:bg-[#f8f7f5]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#1a1a1a]">
                          {v.products.name}
                        </p>
                        <p className="text-xs text-[#737373]">
                          {[v.size && `T.${v.size}`, v.color].filter(Boolean).join(' · ')}
                          {v.sku ? ` · ${v.sku}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-[#525252]">
                        {v.stock_qty} uds
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Selected variant card */
            <div className="flex items-center justify-between rounded-xl border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3">
              <div className="flex items-center gap-3">
                {selectedVariant.color && (
                  <span
                    className="h-5 w-5 shrink-0 rounded-full"
                    style={{
                      background: getColorHex(selectedVariant.color),
                      boxShadow: '0 0 0 1.5px #d6d3d1',
                    }}
                  />
                )}
                <div>
                  <p className="text-sm font-semibold text-[#1a1a1a]">
                    {selectedVariant.products.name}
                  </p>
                  <p className="text-xs text-[#737373]">
                    {[
                      selectedVariant.size && `Talla ${selectedVariant.size}`,
                      selectedVariant.color,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-[.05em] text-[#a8a29e]">
                    Stock actual
                  </p>
                  <p
                    className="text-[28px] font-bold tabular-nums leading-none"
                    style={{ fontFamily: 'Bricolage Grotesque, sans-serif', color: '#1a1a1a' }}
                  >
                    {selectedVariant.stock_qty}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedVariant(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[#ebe9e6] bg-white hover:bg-[#f5f4f1]"
                >
                  <X size={12} className="text-[#525252]" />
                </button>
              </div>
            </div>
          )}

          {/* Tipo */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Tipo de ajuste
            </label>
            <select
              className="h-10 w-full appearance-none rounded-lg border border-[#ebe9e6] bg-white px-3 pr-8 text-sm outline-none transition-[border-color,box-shadow] focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
            >
              {ADJUST_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Cantidad */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Cantidad{' '}
              <span className="font-normal normal-case text-[#a8a29e]">
                (positivo = entrada · negativo = salida)
              </span>
            </label>
            <input
              ref={qtyInputRef}
              type="number"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 font-mono text-sm outline-none transition-[border-color,box-shadow] focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]"
              placeholder="Ej: 10 o -5"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            {selectedVariant && qty !== '' && qtyNum !== 0 && (
              <p className="mt-1.5 text-xs text-[#737373]">
                Stock resultante:{' '}
                <span
                  className="font-mono font-semibold"
                  style={{
                    color: selectedVariant.stock_qty + qtyNum < 0 ? '#dc2626' : '#059669',
                  }}
                >
                  {selectedVariant.stock_qty + qtyNum}
                </span>
              </p>
            )}
          </div>

          {/* Motivo */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Motivo <span className="font-bold text-red-400">*</span>
            </label>
            <textarea
              className="w-full resize-y rounded-lg border border-[#ebe9e6] bg-white px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]"
              rows={3}
              placeholder="Describe el motivo del ajuste..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-[#f5f4f1] px-7 py-5">
          <button
            onClick={handleClose}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || adjustStock.isPending}
            className="h-10 flex-1 rounded-lg bg-[#06b6d4] text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {adjustStock.isPending ? 'Guardando…' : 'Confirmar ajuste'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'stock' | 'movimientos'

const TABS: { id: Tab; label: string }[] = [
  { id: 'stock', label: 'Inventario' },
  { id: 'movimientos', label: 'Movimientos' },
]

export default function InventoryPage() {
  const { can } = usePermissions()
  const [tab, setTab] = useState<Tab>('stock')
  const [showAdjustModal, setShowAdjustModal] = useState(false)

  // Stock tab filters
  const [categoryFilter, setCategoryFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'out' | 'low' | 'ok' | 'reserved'>(
    'all',
  )
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)

  // Movements tab filters
  const [movFilters, setMovFilters] = useState<MovementFilters>({
    type: 'all',
    dateFrom: '',
    dateTo: '',
  })
  const [movPage, setMovPage] = useState(0)

  // Data
  const { data: allVariants = [], isLoading: loadingStock } = useStockLevels()
  const { data: movData, isLoading: loadingMov } = useStockMovements(movFilters, movPage)
  const { data: profiles = [] } = useStoreProfiles()
  const { data: categories = [] } = useCategories()

  const profileMap = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p.full_name])),
    [profiles],
  )

  // Derived summary stats (siempre sobre el dataset completo, sin filtros).
  // "Sin disponible" y "Stock bajo" usan available (stock - reservado), no
  // stock_qty físico, para reflejar lo realmente vendible.
  const outOfStock = allVariants.filter((v) => v.available === 0).length
  const lowStock = allVariants.filter(
    (v) => v.available > 0 && v.available <= v.min_stock,
  ).length
  const reservedCount = allVariants.filter((v) => v.reserved_qty > 0).length
  // El valor de inventario se calcula sobre el stock físico real (las unidades
  // reservadas siguen siendo capital inmovilizado de la tienda).
  const totalValue = allVariants.reduce(
    (sum, v) => sum + v.stock_qty * (v.cost_price ?? 0),
    0,
  )

  // Unique brands from data
  const brands = useMemo(() => {
    const seen = new Set<string>()
    allVariants.forEach((v) => {
      if (v.products.brand) seen.add(v.products.brand)
    })
    return [...seen].sort()
  }, [allVariants])

  // Filtered variants for table
  const filtered = useMemo(() => {
    return allVariants.filter((v) => {
      if (categoryFilter && v.products.category_id !== categoryFilter) return false
      if (brandFilter && v.products.brand !== brandFilter) return false
      if (statusFilter === 'reserved') {
        if (v.reserved_qty <= 0) return false
      } else if (statusFilter !== 'all') {
        if (v.stock_state !== statusFilter) return false
      }
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase()
        const matchName = v.products.name.toLowerCase().includes(q)
        const matchSku = v.sku?.toLowerCase().includes(q)
        const matchBarcode = v.barcode?.toLowerCase().includes(q)
        if (!matchName && !matchSku && !matchBarcode) return false
      }
      return true
    })
  }, [allVariants, categoryFilter, brandFilter, statusFilter, debouncedSearch])

  // Excel export
  async function exportExcel() {
    const { Workbook } = await import('exceljs')
    const wb = new Workbook()
    const ws = wb.addWorksheet('Inventario')

    ws.columns = [
      { header: 'Producto', key: 'product', width: 32 },
      { header: 'Marca', key: 'brand', width: 18 },
      { header: 'Talla', key: 'size', width: 10 },
      { header: 'Color', key: 'color', width: 16 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Código de barras', key: 'barcode', width: 22 },
      { header: 'Total físico', key: 'stock_qty', width: 14 },
      { header: 'Reservado', key: 'reserved_qty', width: 14 },
      { header: 'Disponible', key: 'available', width: 14 },
      { header: 'Stock mínimo', key: 'min_stock', width: 14 },
      { header: 'Estado', key: 'status', width: 16 },
      { header: 'Precio costo', key: 'cost_price', width: 18 },
      { header: 'Precio venta', key: 'price', width: 18 },
    ]

    const headerRow = ws.getRow(1)
    headerRow.font = { bold: true, size: 11 }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF5F4F1' },
    }

    allVariants.forEach((v) => {
      const state = v.stock_state
      const row = ws.addRow({
        product: v.products.name,
        brand: v.products.brand ?? '',
        size: v.size ?? '',
        color: v.color ?? '',
        sku: v.sku ?? '',
        barcode: v.barcode ?? '',
        stock_qty: v.stock_qty,
        reserved_qty: v.reserved_qty,
        available: v.available,
        min_stock: v.min_stock,
        status:
          state === 'out' ? 'Sin disponible' : state === 'low' ? 'Stock bajo' : 'Normal',
        cost_price: v.cost_price ?? 0,
        price: v.price,
      })

      if (state === 'out') {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
        })
      } else if (state === 'low') {
        row.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
        })
      }
    })

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gpulso_inventario_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Pagination
  const movRows = movData?.rows ?? []
  const movTotal = movData?.total ?? 0
  const totalPages = Math.ceil(movTotal / MOV_PAGE_SIZE)

  const selectClass =
    'h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm text-[#525252] outline-none focus:border-[#06b6d4] focus:shadow-[0_0_0_3px_#06b6d41a] transition-[border-color,box-shadow]'

  return (
    <>
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between border-b border-[#ebe9e6] px-6"
        style={{ height: 64, background: '#fdfcfb' }}
      >
        <div className="flex items-center gap-5">
          <h1
            className="tracking-[-0.02em]"
            style={{
              fontFamily: 'Bricolage Grotesque, sans-serif',
              fontSize: 20,
              fontWeight: 600,
              color: '#1a1a1a',
            }}
          >
            Inventario
          </h1>

          {/* Tab pills */}
          <div className="flex items-center gap-0.5 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-white text-[#1a1a1a] shadow-sm'
                    : 'text-[#737373] hover:text-[#525252]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {can('inventario.gestionar') && (
          <button
            onClick={() => setShowAdjustModal(true)}
            className="flex h-9 items-center gap-2 rounded-lg bg-[#06b6d4] px-4 text-[13.5px] font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95"
          >
            <Plus size={15} />
            Ajuste manual
          </button>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="space-y-5 p-6" style={{ background: '#f8f7f5', minHeight: 'calc(100vh - 128px)' }}>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <SummaryCard
            label="Total variantes"
            value={allVariants.length}
            icon={Package}
            tone="normal"
          />
          <SummaryCard
            label="Sin disponible"
            value={outOfStock}
            icon={AlertCircle}
            tone={outOfStock > 0 ? 'red' : 'green'}
          />
          <SummaryCard
            label="Stock bajo"
            value={lowStock}
            icon={AlertTriangle}
            tone={lowStock > 0 ? 'yellow' : 'green'}
          />
          <SummaryCard
            label="Con reservas"
            value={reservedCount}
            icon={Package}
            tone={reservedCount > 0 ? 'normal' : 'green'}
          />
          <SummaryCard
            label="Valor inventario"
            value={fmtCOP(totalValue)}
            icon={TrendingUp}
            mono
          />
        </div>

        {/* ── Stock tab ──────────────────────────────────────────────────────── */}
        {tab === 'stock' && (
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">

            {/* Filter bar — search first, then selects, then export */}
            <div className="flex flex-wrap items-center gap-3 border-b border-[#f5f4f1] px-5 py-3">
              {/* Search (flex-1) */}
              <div className="relative min-w-[180px] flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a8a29e]" />
                <input
                  className="h-9 w-full rounded-lg border border-[#ebe9e6] bg-white pl-9 pr-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-[#06b6d4] focus:shadow-[0_0_0_3px_#06b6d41a] placeholder:text-[#a8a29e]"
                  placeholder="Nombre, SKU o código de barras…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <select
                className={selectClass}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">Todas las categorías</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <select
                className={selectClass}
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
              >
                <option value="">Todas las marcas</option>
                {brands.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>

              <select
                className={selectClass}
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(
                    e.target.value as 'all' | 'out' | 'low' | 'ok' | 'reserved',
                  )
                }
              >
                <option value="all">Todos los estados</option>
                <option value="out">Sin disponible</option>
                <option value="low">Stock bajo</option>
                <option value="ok">Normal</option>
                <option value="reserved">Con reservas</option>
              </select>

              <button
                onClick={exportExcel}
                className="flex h-9 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-4 text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
              >
                <Download size={14} />
                Exportar Excel
              </button>
            </div>

            {/* Table */}
            {loadingStock ? (
              <div className="space-y-px p-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
                  <Package size={22} className="text-slate-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">
                    {allVariants.length === 0
                      ? 'No hay variantes registradas'
                      : 'Sin resultados para los filtros aplicados'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {allVariants.length === 0
                      ? 'Crea productos y variantes en el módulo de Productos.'
                      : 'Intenta con otros filtros o limpia la búsqueda.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-[#ebe9e6] bg-stone-50">
                      {[
                        { label: 'Producto', align: 'left' },
                        { label: 'Marca', align: 'left' },
                        { label: 'Variante', align: 'left' },
                        { label: 'SKU', align: 'left' },
                        { label: 'Código de barras', align: 'left' },
                        { label: 'Total', align: 'right' },
                        { label: 'Reservado', align: 'right' },
                        { label: 'Disponible', align: 'right' },
                        { label: 'Mín.', align: 'right' },
                        { label: 'Estado', align: 'left' },
                      ].map((h) => (
                        <th
                          key={h.label}
                          className={`whitespace-nowrap px-4 py-3 text-${h.align} text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]`}
                        >
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((v) => {
                      const state = v.stock_state
                      return (
                        <tr
                          key={v.id}
                          className={`border-b border-[#f5f4f1] last:border-0 ${
                            state === 'out'
                              ? 'bg-red-50/30'
                              : state === 'low'
                                ? 'bg-amber-50/30'
                                : ''
                          }`}
                        >
                          <td className="px-4 py-3">
                            <span className="text-sm font-medium text-[#1a1a1a]">
                              {v.products.name}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-[#525252]">
                            {v.products.brand ?? <span className="text-[#a8a29e]">—</span>}
                          </td>
                          {/* Talla + color en una sola columna "Variante" */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {v.size && (
                                <span className="inline-flex h-6 min-w-[32px] items-center justify-center rounded-[5px] bg-[#f5f4f1] px-2 text-xs font-semibold tabular-nums">
                                  {v.size}
                                </span>
                              )}
                              {v.color && (
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="h-3.5 w-3.5 rounded-full"
                                    style={{
                                      background: getColorHex(v.color),
                                      boxShadow: '0 0 0 1px #d6d3d1',
                                    }}
                                  />
                                  <span className="text-sm capitalize text-[#525252]">{v.color}</span>
                                </div>
                              )}
                              {!v.size && !v.color && (
                                <span className="text-[#a8a29e]">—</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-[#525252]">
                            {v.sku ?? <span className="text-[#a8a29e]">—</span>}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-[#525252]">
                            {v.barcode ?? <span className="text-[#a8a29e]">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[#525252]">
                            {v.stock_qty}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono text-sm tabular-nums ${
                              v.reserved_qty > 0 ? 'text-cyan-600' : 'text-[#a8a29e]'
                            }`}
                          >
                            {v.reserved_qty > 0 ? v.reserved_qty : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums text-[#1a1a1a]">
                            {v.available}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-[#737373]">
                            {v.min_stock}
                          </td>
                          <td className="px-4 py-3">
                            <StockBadge state={state} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {filtered.length > 0 && (
              <div className="border-t border-[#f5f4f1] px-5 py-3">
                <p className="text-xs text-[#a8a29e]">
                  {filtered.length} de {allVariants.length} variantes
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Movimientos tab ─────────────────────────────────────────────────── */}
        {tab === 'movimientos' && (
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 border-b border-[#f5f4f1] px-5 py-3">
              <select
                className={selectClass}
                value={movFilters.type}
                onChange={(e) => {
                  setMovFilters((f) => ({ ...f, type: e.target.value as StockMovementType | 'all' }))
                  setMovPage(0)
                }}
              >
                <option value="all">Todos los tipos</option>
                <option value="sale">Venta</option>
                <option value="return">Devolución</option>
                <option value="adjustment">Ajuste</option>
                <option value="purchase">Compra</option>
              </select>

              <div className="flex items-center gap-2">
                <label className="text-xs text-[#737373]">Desde</label>
                <input
                  type="date"
                  className={selectClass}
                  value={movFilters.dateFrom}
                  onChange={(e) => {
                    setMovFilters((f) => ({ ...f, dateFrom: e.target.value }))
                    setMovPage(0)
                  }}
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs text-[#737373]">Hasta</label>
                <input
                  type="date"
                  className={selectClass}
                  value={movFilters.dateTo}
                  onChange={(e) => {
                    setMovFilters((f) => ({ ...f, dateTo: e.target.value }))
                    setMovPage(0)
                  }}
                />
              </div>

              {(movFilters.type !== 'all' || movFilters.dateFrom || movFilters.dateTo) && (
                <button
                  onClick={() => {
                    setMovFilters({ type: 'all', dateFrom: '', dateTo: '' })
                    setMovPage(0)
                  }}
                  className="flex items-center gap-1.5 text-xs text-[#06b6d4] hover:underline"
                >
                  <X size={11} /> Limpiar filtros
                </button>
              )}
            </div>

            {/* Table */}
            {loadingMov ? (
              <div className="space-y-px p-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : movRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
                  <TrendingUp size={22} className="text-slate-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Sin movimientos registrados</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Los movimientos se crean al vender, devolver o ajustar stock.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-[#ebe9e6] bg-stone-50">
                      {['Fecha / hora', 'Tipo', 'Producto', 'Variante', 'Cantidad', 'Usuario', 'Referencia'].map(
                        (h) => (
                          <th
                            key={h}
                            className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {movRows.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-[#f5f4f1] last:border-0 hover:bg-[#fafaf9]"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-[#737373]">
                          {fmtDateTime(m.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <MovTypeBadge type={m.type} />
                        </td>
                        <td className="px-4 py-3 text-sm text-[#1a1a1a]">
                          {m.variants?.products?.name ?? '—'}
                        </td>
                        {/* Talla + color combinados */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {m.variants?.size && (
                              <span className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-[5px] bg-[#f5f4f1] px-1.5 text-xs font-semibold">
                                {m.variants.size}
                              </span>
                            )}
                            {m.variants?.color && (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="h-3 w-3 rounded-full"
                                  style={{
                                    background: getColorHex(m.variants.color),
                                    boxShadow: '0 0 0 1px #d6d3d1',
                                  }}
                                />
                                <span className="text-xs capitalize text-[#525252]">
                                  {m.variants.color}
                                </span>
                              </div>
                            )}
                            {!m.variants?.size && !m.variants?.color && (
                              <span className="text-[#a8a29e]">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-mono text-sm font-semibold tabular-nums ${
                              m.qty >= 0 ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {m.qty >= 0 ? `+${m.qty}` : m.qty}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-[#525252]">
                          {profileMap[m.created_by] ?? (
                            <span className="font-mono text-xs text-[#a8a29e]">
                              {m.created_by.slice(0, 8)}…
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {m.reference_id ? (
                            <span className="font-mono text-xs text-[#737373]">
                              {m.reference_id.slice(0, 8)}…
                            </span>
                          ) : m.notes ? (
                            <span
                              className="block max-w-[180px] truncate text-xs text-[#737373]"
                              title={m.notes}
                            >
                              {m.notes}
                            </span>
                          ) : (
                            <span className="text-[#a8a29e]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {movTotal > MOV_PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-[#f5f4f1] px-5 py-3">
                <p className="text-xs text-[#a8a29e]">
                  {movPage * MOV_PAGE_SIZE + 1}–
                  {Math.min((movPage + 1) * MOV_PAGE_SIZE, movTotal)} de {movTotal} movimientos
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setMovPage((p) => p - 1)}
                    disabled={movPage === 0}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#ebe9e6] bg-white text-[#525252] disabled:opacity-40 hover:bg-[#f8f7f5]"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs text-[#737373]">
                    {movPage + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setMovPage((p) => p + 1)}
                    disabled={movPage >= totalPages - 1}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#ebe9e6] bg-white text-[#525252] disabled:opacity-40 hover:bg-[#f8f7f5]"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <AdjustModal open={showAdjustModal} onClose={() => setShowAdjustModal(false)} />
    </>
  )
}
