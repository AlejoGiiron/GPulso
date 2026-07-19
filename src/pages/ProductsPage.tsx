import { useState, useEffect, useRef } from 'react'
import { Search, Plus, Package, Edit2, Layers } from 'lucide-react'
import { useProducts, useCategories } from '@/hooks/useProducts'
import { useVariants } from '@/hooks/useVariants'
import { useVariantMutations } from '@/hooks/useVariantMutations'
import ProductModal from '@/components/products/ProductModal'
import VariantsPanel from '@/components/products/VariantsPanel'
import { fmtCOP } from '@/lib/formatters'
import { getColorHex, sortSizes, stockState, priceRange } from '@/lib/products'
import { isUniqueSizeType } from '@/lib/sizeTypes'
import type { ProductWithDetails } from '@/hooks/useProducts'
import type { Product, Variant } from '@/types/database.types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StockBadge({ qty, minStock }: { qty: number; minStock: number }) {
  const state = stockState(qty, minStock)
  if (state === 'out')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Sin stock
      </span>
    )
  if (state === 'low')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Stock bajo
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Disponible
    </span>
  )
}

// ─── Product Hero ─────────────────────────────────────────────────────────────

interface ProductHeroProps {
  product: ProductWithDetails
  variants: Variant[]
  onEdit: () => void
  onManageVariants: () => void
}

function ProductHero({ product, variants, onEdit, onManageVariants }: ProductHeroProps) {
  const active = variants.filter((v) => v.is_active)
  const totalStock = active.reduce((s, v) => s + v.stock_qty, 0)
  const oos = active.filter((v) => v.stock_qty === 0).length
  const low = active.filter((v) => v.stock_qty > 0 && v.stock_qty <= v.min_stock).length

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex gap-5 p-6">
        {/* Image */}
        <div className="relative h-36 w-36 flex-shrink-0 overflow-hidden rounded-xl bg-slate-100">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
              <Package size={36} />
            </div>
          )}
          {product.brand && (
            <div className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              {product.brand}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {product.categories && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {product.categories.name}
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Activo
            </span>
          </div>
          {product.brand && (
            <p className="mb-0.5 text-[11px] font-medium uppercase tracking-widest text-slate-400">
              {product.brand}
            </p>
          )}
          <h2 className="mb-1.5 text-2xl font-semibold tracking-tight text-slate-900">
            {product.name}
          </h2>
          {product.description && (
            <p className="mb-4 max-w-xl text-sm leading-relaxed text-slate-500">
              {product.description}
            </p>
          )}

          {/* Stats */}
          <div className="flex gap-6">
            {[
              { label: 'Stock total', value: totalStock, tone: null },
              { label: 'Variantes', value: active.length, tone: null },
              { label: 'Stock bajo', value: low, tone: low > 0 ? '#ea580c' : null },
              { label: 'Sin stock', value: oos, tone: oos > 0 ? '#dc2626' : null },
            ].map(({ label, value, tone }) => (
              <div key={label}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  {label}
                </p>
                <p
                  className="font-mono text-2xl font-bold tabular-nums"
                  style={{ color: tone ?? '#1a1a1a' }}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 flex-col gap-2">
          <button
            onClick={onEdit}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <Edit2 size={13} />
            Editar
          </button>
          <button
            onClick={onManageVariants}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <Layers size={13} />
            Variantes
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Stock Matrix ─────────────────────────────────────────────────────────────

interface StockMatrixProps {
  variants: Variant[]
  editingId: string | null
  onEditStart: (id: string) => void
  onEditCommit: (id: string, qty: number) => void
}

function StockMatrix({ variants, editingId, onEditStart, onEditCommit }: StockMatrixProps) {
  const active = variants.filter((v) => v.is_active)
  const sizes = sortSizes([...new Set(active.map((v) => v.size).filter((s): s is string => s !== null))])
  const colors = [...new Set(active.map((v) => v.color).filter((c): c is string => c !== null))]

  function find(size: string, color: string) {
    return active.find((v) => v.size === size && v.color === color)
  }

  if (sizes.length === 0 && colors.length === 0) return null

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-slate-900">
            Matriz de inventario
          </h3>
          <p className="text-xs text-slate-400">Click en una celda para editar el stock</p>
        </div>
        <div className="flex gap-3 text-[11px] text-slate-500">
          {[
            { label: 'OK', bg: '#dcfce7', border: '#16a34a' },
            { label: 'Bajo', bg: '#fef3c7', border: '#d97706' },
            { label: 'Cero', bg: '#fee2e2', border: '#dc2626' },
          ].map(({ label, bg, border }) => (
            <span key={label} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: bg, border: `1px solid ${border}` }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto p-5">
        <table className="border-separate" style={{ borderSpacing: 4 }}>
          <thead>
            <tr>
              <th className="p-1.5" />
              {sizes.map((s) => (
                <th
                  key={s}
                  className="min-w-[64px] px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                >
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {colors.map((color) => (
              <tr key={color}>
                <td className="py-1.5 pr-3 text-left">
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-700">
                    <span
                      className="h-3.5 w-3.5 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.1)]"
                      style={{ background: getColorHex(color) }}
                    />
                    {color}
                  </span>
                </td>
                {sizes.map((size) => {
                  const v = find(size, color)
                  if (!v) {
                    return (
                      <td key={size} className="p-0">
                        <div className="flex h-14 w-16 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 text-slate-300">
                          —
                        </div>
                      </td>
                    )
                  }
                  const state = stockState(v.stock_qty, v.min_stock)
                  const bg = state === 'out' ? '#fee2e2' : state === 'low' ? '#fef3c7' : '#dcfce7'
                  const fg = state === 'out' ? '#b91c1c' : state === 'low' ? '#92400e' : '#166534'
                  const isEditing = editingId === v.id

                  return (
                    <td key={size} className="p-0">
                      <MatrixCell
                        variant={v}
                        bg={bg}
                        fg={fg}
                        isEditing={isEditing}
                        onEditStart={() => onEditStart(v.id)}
                        onEditCommit={(qty) => onEditCommit(v.id, qty)}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface MatrixCellProps {
  variant: Variant
  bg: string
  fg: string
  isEditing: boolean
  onEditStart: () => void
  onEditCommit: (qty: number) => void
}

function MatrixCell({ variant, bg, fg, isEditing, onEditStart, onEditCommit }: MatrixCellProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) inputRef.current?.focus()
  }, [isEditing])

  return (
    <div
      className="flex h-14 w-16 cursor-pointer flex-col items-center justify-center rounded-lg"
      style={{ background: bg, border: `1px solid ${fg}33` }}
      onClick={() => !isEditing && onEditStart()}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="number"
          defaultValue={variant.stock_qty}
          min="0"
          onBlur={(e) => onEditCommit(parseInt(e.target.value) || 0)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') onEditCommit(variant.stock_qty)
          }}
          className="w-12 rounded-md border-2 border-cyan-400 bg-white px-1 py-0.5 text-center text-sm font-bold outline-none"
          style={{ boxShadow: '0 0 0 3px rgba(139,92,246,0.15)' }}
        />
      ) : (
        <>
          <span
            className="font-mono text-lg font-bold leading-none tabular-nums"
            style={{ color: fg }}
          >
            {variant.stock_qty}
          </span>
          <span className="mt-0.5 text-[9px] font-medium" style={{ color: fg, opacity: 0.7 }}>
            {fmtCOP(variant.price).replace('$ ', '$')}
          </span>
        </>
      )}
    </div>
  )
}

// ─── Variants Table ───────────────────────────────────────────────────────────

interface VariantsTableProps {
  variants: Variant[]
  onManageVariants: () => void
}

function VariantsTable({ variants, onManageVariants }: VariantsTableProps) {
  const active = variants.filter((v) => v.is_active)

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-slate-900">
            Detalle de variantes
          </h3>
          <p className="text-xs text-slate-400">{active.length} variante{active.length !== 1 ? 's' : ''} activa{active.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={onManageVariants}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          <Plus size={12} />
          Nueva variante
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              {['Variante', 'Color', 'SKU', 'Código barras', 'Precio venta', 'Costo', 'Stock', 'Estado'].map((h) => (
                <th
                  key={h}
                  className={`border-b border-slate-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 ${
                    ['Precio venta', 'Costo', 'Stock'].includes(h) ? 'text-right' : 'text-left'
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.map((v) => (
              <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="px-4 py-3">
                  <span className="inline-flex h-6 min-w-[32px] items-center justify-center rounded-md bg-slate-100 px-2 text-xs font-semibold">
                    {v.size ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3.5 w-3.5 flex-shrink-0 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.1)]"
                      style={{ background: getColorHex(v.color ?? '') }}
                    />
                    {v.color ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{v.sku ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{v.barcode ?? '—'}</td>
                <td className="px-4 py-3 text-right font-mono text-sm">{fmtCOP(v.price)}</td>
                <td className="px-4 py-3 text-right font-mono text-sm text-slate-400">
                  {v.cost_price != null ? fmtCOP(v.cost_price) : '—'}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                  {v.stock_qty}
                </td>
                <td className="px-4 py-3">
                  <StockBadge qty={v.stock_qty} minStock={v.min_stock} />
                </td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">
                  Sin variantes activas.{' '}
                  <button onClick={onManageVariants} className="text-cyan-500 hover:underline">
                    Agregar variante
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { data: products = [], isLoading: isLoadingProducts } = useProducts()
  const { data: categories = [] } = useCategories()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [activeCatId, setActiveCatId] = useState<string | null>(null)
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [variantsPanelProduct, setVariantsPanelProduct] = useState<Product | null>(null)
  const [editingStockId, setEditingStockId] = useState<string | null>(null)

  // Auto-select first product on initial load
  useEffect(() => {
    if (products.length > 0 && !selectedId) {
      setSelectedId(products[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length])

  const { data: variants = [], isLoading: isLoadingVariants } = useVariants(selectedId ?? '')
  const { update: updateVariant } = useVariantMutations(selectedId ?? '')

  const selectedProduct = products.find((p) => p.id === selectedId)

  // Filtering
  const filtered = products.filter((p) => {
    if (activeCatId && p.category_id !== activeCatId) return false
    if (query) {
      const q = query.toLowerCase()
      const matchName = p.name.toLowerCase().includes(q)
      const matchBrand = (p.brand ?? '').toLowerCase().includes(q)
      const matchSku = p.variants.some(
        () => false // SKU search requires full variant data; handled via name/brand for now
      )
      return matchName || matchBrand || matchSku
    }
    return true
  })

  function handleStockEdit(variantId: string, qty: number) {
    setEditingStockId(null)
    updateVariant.mutate({ id: variantId, stock_qty: qty })
  }

  function handleProductSaved(product: Product) {
    setShowNewProduct(false)
    setEditingProduct(null)
    // Al crear un producto con variantes reales, abrir el panel para agregarlas.
    // Los de variante Única ya nacen con su variante (flujo de un paso) → no.
    if (!editingProduct && !isUniqueSizeType(product.size_type)) {
      setVariantsPanelProduct(product)
    }
    setSelectedId(product.id)
  }

  const totalVariants = products.reduce((s, p) => s + p.variants.length, 0)

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel: product list ─────────────────────────────── */}
      <aside className="flex w-80 flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        {/* Search + filters */}
        <div className="border-b border-slate-100 p-4">
          <div className="relative mb-3 flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
            <Search size={14} className="ml-3 flex-shrink-0 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o marca…"
              className="flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          {/* Category pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button
              onClick={() => setActiveCatId(null)}
              className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                activeCatId === null
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              Todas
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCatId(c.id)}
                className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                  activeCatId === c.id
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoadingProducts && (
            <p className="py-6 text-center text-sm text-slate-400">Cargando productos…</p>
          )}
          {!isLoadingProducts && filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">Sin resultados.</p>
          )}
          {filtered.map((p) => {
            const activeVariants = p.variants.filter((v) => v.is_active)
            const oos = activeVariants.filter((v) => v.stock_qty === 0).length
            const isSel = p.id === selectedId
            const range = priceRange(p.variants)
            const priceLabel = range
              ? range.min === range.max
                ? fmtCOP(range.min)
                : `${fmtCOP(range.min)} – ${fmtCOP(range.max)}`
              : null
            const description = p.description?.trim()
            return (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`mb-1 flex w-full items-center gap-2.5 rounded-xl p-2.5 text-left transition-all ${
                  isSel
                    ? 'border border-cyan-400 bg-white shadow-[0_0_0_3px_rgba(139,92,246,0.1)]'
                    : 'border border-transparent hover:bg-slate-50'
                }`}
              >
                {/* Thumbnail */}
                <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-300">
                      <Package size={16} />
                    </div>
                  )}
                </div>
                {/* Info */}
                <div className="min-w-0 flex-1">
                  {p.brand && (
                    <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {p.brand}
                    </p>
                  )}
                  <p className="truncate text-[13.5px] font-medium text-slate-900">{p.name}</p>
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-400">
                    <span>{activeVariants.length} var.</span>
                    {oos > 0 && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-slate-300" />
                        <span className="font-medium text-red-500">{oos} OOS</span>
                      </>
                    )}
                    {priceLabel && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-slate-300" />
                        <span className="font-mono tabular-nums text-slate-500">{priceLabel}</span>
                      </>
                    )}
                  </p>
                  {description && (
                    <p className="truncate text-[11px] text-slate-400">{description}</p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* ── Right panel: product detail ──────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Page header */}
        <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Catálogo</h1>
            <p className="text-xs text-slate-400">
              {products.length} productos · {totalVariants} variantes
            </p>
          </div>
          <button
            onClick={() => setShowNewProduct(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-cyan-500 px-4 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(139,92,246,0.35)] hover:bg-cyan-600"
          >
            <Plus size={14} />
            Nuevo producto
          </button>
        </div>

        {/* Detail area */}
        <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
          {!selectedProduct && !isLoadingProducts && (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Selecciona un producto de la lista.
            </div>
          )}

          {selectedProduct && (
            <div className="mx-auto max-w-4xl space-y-5">
              <ProductHero
                product={selectedProduct}
                variants={variants}
                onEdit={() => setEditingProduct(selectedProduct)}
                onManageVariants={() => setVariantsPanelProduct(selectedProduct)}
              />

              {isLoadingVariants ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">
                  Cargando variantes…
                </div>
              ) : (
                <>
                  <StockMatrix
                    variants={variants}
                    editingId={editingStockId}
                    onEditStart={(id) => setEditingStockId(id)}
                    onEditCommit={handleStockEdit}
                  />
                  <VariantsTable
                    variants={variants}
                    onManageVariants={() => setVariantsPanelProduct(selectedProduct)}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── Modals ──────────────────────────────────────────────── */}
      {(showNewProduct || editingProduct) && (
        <ProductModal
          product={editingProduct}
          onClose={() => {
            setShowNewProduct(false)
            setEditingProduct(null)
          }}
          onSaved={handleProductSaved}
        />
      )}

      {variantsPanelProduct && (
        <VariantsPanel
          product={variantsPanelProduct}
          onClose={() => setVariantsPanelProduct(null)}
        />
      )}
    </div>
  )
}
