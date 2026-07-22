import { useMemo, useState } from 'react'
import { X, Plus, AlertTriangle, Edit2, ToggleRight, Printer } from 'lucide-react'
import { useVariants } from '@/hooks/useVariants'
import { useVariantMutations } from '@/hooks/useVariantMutations'
import LabelPrintModal from '@/components/products/LabelPrintModal'
import { fmtCOP } from '@/lib/formatters'
import { generateBarcode, getColorHex } from '@/lib/products'
import { useResolvedConfig } from '@/hooks/useConfig'
import { findSizeType, isCustomSizeType } from '@/lib/sizeTypes'
import type { Product, Variant } from '@/types/database.types'
import toast from 'react-hot-toast'

interface VariantFormData {
  size: string
  color: string
  sku: string
  barcode: string
  price: string
  cost_price: string
  stock_qty: string
  min_stock: string
}

function buildEmptyForm(defaultSize: string): VariantFormData {
  return {
    size: defaultSize,
    color: '',
    sku: '',
    barcode: '',
    price: '',
    cost_price: '',
    stock_qty: '0',
    min_stock: '0',
  }
}

function variantToForm(v: Variant): VariantFormData {
  return {
    size: v.size ?? '',
    color: v.color ?? '',
    sku: v.sku ?? '',
    barcode: v.barcode ?? '',
    price: String(v.price),
    cost_price: v.cost_price != null ? String(v.cost_price) : '',
    stock_qty: String(v.stock_qty),
    min_stock: String(v.min_stock),
  }
}

interface VariantsPanelProps {
  product: Product
  onClose: () => void
}

export default function VariantsPanel({ product, onClose }: VariantsPanelProps) {
  const { data: variants = [], isLoading } = useVariants(product.id)
  const { create, update, toggleActive } = useVariantMutations(product.id)
  const sizeTypes = useResolvedConfig().size_types

  const catalogSizes = useMemo<readonly string[]>(
    () => findSizeType(sizeTypes, product.size_type)?.sizes ?? [],
    [sizeTypes, product.size_type],
  )
  const isCustomSizes = isCustomSizeType(sizeTypes, product.size_type)
  const defaultSize = catalogSizes[0] ?? ''
  const emptyForm = useMemo(() => buildEmptyForm(defaultSize), [defaultSize])

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<VariantFormData>(emptyForm)
  const [submitting, setSubmitting] = useState(false)

  // Label printing state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [labelVariants, setLabelVariants] = useState<Variant[] | null>(null)

  // Si el size del form actual no está en el catálogo (ej: variante vieja
  // de otro size_type), lo incluimos como opción para preservarlo al editar.
  const sizeOptions = useMemo(() => {
    if (isCustomSizes) return catalogSizes
    if (form.size && !catalogSizes.includes(form.size)) {
      return [...catalogSizes, form.size]
    }
    return catalogSizes
  }, [catalogSizes, isCustomSizes, form.size])

  function openAdd() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  function openEdit(v: Variant) {
    setEditingId(v.id)
    setForm(variantToForm(v))
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
  }

  function setField<K extends keyof VariantFormData>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit() {
    if (!form.color.trim() && !form.size) {
      toast.error('Ingresa al menos variante o color')
      return
    }
    setSubmitting(true)
    try {
      const barcode = form.barcode.trim() || (editingId ? null : generateBarcode())
      const price = parseFloat(form.price) || 0
      const costPrice = form.cost_price.trim() !== '' ? parseFloat(form.cost_price) : null
      const stockQty = parseInt(form.stock_qty) || 0
      const minStock = parseInt(form.min_stock) || 0

      if (editingId) {
        // El stock NO se edita aquí: se mueve por compra / ajuste / venta /
        // apertura (con rastro). Editar la variante solo cambia sus atributos.
        await update.mutateAsync({
          id: editingId,
          size: form.size || null,
          color: form.color.trim() || null,
          sku: form.sku.trim() || null,
          ...(barcode !== null && { barcode }),
          price,
          cost_price: costPrice,
          min_stock: minStock,
        })
        toast.success('Variante actualizada')
      } else {
        await create.mutateAsync({
          product_id: product.id,
          size: form.size || null,
          color: form.color.trim() || null,
          sku: form.sku.trim() || null,
          barcode,
          price,
          cost_price: costPrice,
          stock_qty: stockQty,
          min_stock: minStock,
        })
      }
      setShowForm(false)
      setEditingId(null)
    } catch {
      // error toast shown by mutation
    } finally {
      setSubmitting(false)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openLabelModal(vs: Variant[]) {
    if (vs.length === 0) return
    setLabelVariants(vs)
  }

  const activeVariants = variants.filter((v) => v.is_active)
  const inactiveVariants = variants.filter((v) => !v.is_active)
  const selectedVariants = activeVariants.filter((v) => selectedIds.has(v.id))

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex h-[90vh] w-[760px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Gestionar variantes
              </h2>
              <p className="mt-0.5 text-sm text-slate-400">
                {product.name} · {activeVariants.length} activa
                {activeVariants.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedVariants.length > 1 && (
                <button
                  onClick={() => openLabelModal(selectedVariants)}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-[#f8f7f5]"
                >
                  <Printer size={12} />
                  Etiquetas seleccionadas ({selectedVariants.length})
                </button>
              )}
              <button
                onClick={onClose}
                className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            {/* Variant form */}
            {showForm && (
              <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
                <h3 className="mb-4 text-sm font-semibold text-slate-700">
                  {editingId ? 'Editar variante' : 'Nueva variante'}
                </h3>
                <div className="space-y-3">
                  {/* Row 1: size + color + SKU */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Variante
                      </label>
                      {isCustomSizes ? (
                        <input
                          value={form.size}
                          onChange={(e) => setField('size', e.target.value)}
                          placeholder="Variante libre"
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-cyan-400"
                        />
                      ) : (
                        <select
                          value={form.size}
                          onChange={(e) => setField('size', e.target.value)}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-cyan-400"
                        >
                          {sizeOptions.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Color
                      </label>
                      <input
                        value={form.color}
                        onChange={(e) => setField('color', e.target.value)}
                        placeholder="Negro, Rojo…"
                        className="h-9 w-full rounded-lg border border-slate-200 px-2.5 text-sm outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        SKU
                      </label>
                      <input
                        value={form.sku}
                        onChange={(e) => setField('sku', e.target.value)}
                        placeholder="Opcional"
                        className="h-9 w-full rounded-lg border border-slate-200 px-2.5 text-sm outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>

                  {/* Barcode */}
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Código de barras
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={form.barcode}
                        onChange={(e) => setField('barcode', e.target.value)}
                        placeholder="Dejar vacío para generar automáticamente"
                        className="h-9 flex-1 rounded-lg border border-slate-200 px-2.5 font-mono text-sm outline-none focus:border-cyan-400"
                      />
                      <button
                        type="button"
                        onClick={() => setField('barcode', generateBarcode())}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Generar
                      </button>
                    </div>
                  </div>

                  {/* Prices */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Precio venta (COP)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1000"
                        value={form.price}
                        onChange={(e) => setField('price', e.target.value)}
                        placeholder="0"
                        className="h-9 w-full rounded-lg border border-slate-200 px-2.5 font-mono text-sm outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Precio costo (COP)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1000"
                        value={form.cost_price}
                        onChange={(e) => setField('cost_price', e.target.value)}
                        placeholder="Opcional"
                        className="h-9 w-full rounded-lg border border-slate-200 px-2.5 font-mono text-sm outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>

                  {/* Stock */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        {editingId ? 'Stock actual' : 'Stock inicial'}
                      </label>
                      {editingId ? (
                        <>
                          <div className="flex h-9 w-full items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 font-mono text-sm text-slate-500">
                            {form.stock_qty}
                          </div>
                          <p className="mt-1 text-[10.5px] leading-tight text-slate-400">
                            El stock se ajusta desde Inventario → Ajuste manual (o
                            por compra). No se edita a mano aquí.
                          </p>
                        </>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          value={form.stock_qty}
                          onChange={(e) => setField('stock_qty', e.target.value)}
                          className="h-9 w-full rounded-lg border border-slate-200 px-2.5 font-mono text-sm outline-none focus:border-cyan-400"
                        />
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Stock mínimo
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={form.min_stock}
                        onChange={(e) => setField('min_stock', e.target.value)}
                        className="h-9 w-full rounded-lg border border-slate-200 px-2.5 font-mono text-sm outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>

                  {/* Form actions */}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={cancelForm}
                      className="h-9 flex-1 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSubmit()}
                      disabled={submitting}
                      className="h-9 flex-[2] rounded-lg bg-cyan-500 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
                    >
                      {submitting ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear variante'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Add button */}
            {!showForm && (
              <div className="px-6 pt-5">
                <button
                  onClick={openAdd}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 text-sm font-medium text-cyan-500 hover:border-cyan-300 hover:bg-cyan-50"
                >
                  <Plus size={14} />
                  Nueva variante
                </button>
              </div>
            )}

            {isLoading && (
              <div className="px-6 py-8 text-center text-sm text-slate-400">
                Cargando variantes…
              </div>
            )}

            {/* Active variants table */}
            {activeVariants.length > 0 && (
              <div className="px-6 pb-2 pt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="w-8 pb-2.5 text-left" />
                      {[
                        { label: 'Variante', align: 'left' },
                        { label: 'Color', align: 'left' },
                        { label: 'SKU', align: 'left' },
                        { label: 'Precio', align: 'right' },
                        { label: 'Total', align: 'right' },
                        { label: 'Reservado', align: 'right' },
                        { label: 'Disponible', align: 'right' },
                        { label: '', align: 'right' },
                      ].map((h) => (
                        <th
                          key={h.label || '_actions'}
                          className={`pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 text-${h.align}`}
                        >
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeVariants.map((v) => {
                      const reserved = v.reserved_qty ?? 0
                      const available = Math.max(0, v.stock_qty - reserved)
                      const isLow = available > 0 && available <= v.min_stock
                      const isOut = available === 0
                      const allReserved = isOut && v.stock_qty > 0
                      const isSelected = selectedIds.has(v.id)
                      return (
                        <tr
                          key={v.id}
                          className={`border-b border-slate-50 ${isSelected ? 'bg-cyan-50/40' : ''}`}
                        >
                          {/* Checkbox */}
                          <td className="py-2.5 pr-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(v.id)}
                              className="h-4 w-4 cursor-pointer rounded accent-cyan-500"
                            />
                          </td>
                          <td className="py-2.5">
                            <span className="inline-flex h-6 min-w-[32px] items-center justify-center rounded-md bg-slate-100 px-2 text-xs font-semibold">
                              {v.size ?? '—'}
                            </span>
                          </td>
                          <td className="py-2.5">
                            <span className="flex items-center gap-1.5 text-sm">
                              <span
                                className="h-3.5 w-3.5 flex-shrink-0 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.1)]"
                                style={{ background: getColorHex(v.color ?? '') }}
                              />
                              {v.color ?? '—'}
                            </span>
                          </td>
                          <td className="py-2.5 font-mono text-xs text-slate-500">
                            {v.sku ?? '—'}
                          </td>
                          <td className="py-2.5 text-right font-mono text-sm">
                            {fmtCOP(v.price)}
                          </td>
                          <td className="py-2.5 text-right font-mono text-sm tabular-nums text-slate-500">
                            {v.stock_qty}
                          </td>
                          <td
                            className={`py-2.5 text-right font-mono text-sm tabular-nums ${
                              reserved > 0 ? 'text-cyan-600' : 'text-slate-300'
                            }`}
                          >
                            {reserved > 0 ? reserved : '—'}
                          </td>
                          <td className="py-2.5 text-right">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                allReserved
                                  ? 'bg-red-50 text-red-700'
                                  : isOut
                                    ? 'bg-red-50 text-red-700'
                                    : isLow
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-emerald-50 text-emerald-700'
                              }`}
                              title={
                                allReserved
                                  ? `Total ${v.stock_qty}, todo reservado en separados`
                                  : undefined
                              }
                            >
                              {(isOut || isLow) && <AlertTriangle size={10} />}
                              {allReserved ? 'Sin disponible' : available}
                            </span>
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="flex justify-end gap-1">
                              {/* Etiqueta */}
                              <button
                                onClick={() => openLabelModal([v])}
                                title="Imprimir etiqueta"
                                className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-cyan-500"
                              >
                                <Printer size={12} />
                              </button>
                              <button
                                onClick={() => openEdit(v)}
                                title="Editar variante"
                                className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={() =>
                                  void toggleActive.mutateAsync({ id: v.id, isActive: v.is_active })
                                }
                                title="Desactivar variante"
                                className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-red-500"
                              >
                                <ToggleRight size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Inactive variants */}
            {inactiveVariants.length > 0 && (
              <div className="px-6 py-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Inactivas ({inactiveVariants.length})
                </p>
                <div className="space-y-1">
                  {inactiveVariants.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                    >
                      <span className="text-sm text-slate-400">
                        {v.size ?? '—'} · {v.color ?? '—'}
                        {v.sku && ` · ${v.sku}`}
                      </span>
                      <button
                        onClick={() =>
                          void toggleActive.mutateAsync({ id: v.id, isActive: v.is_active })
                        }
                        className="text-xs font-medium text-cyan-500 hover:text-cyan-700"
                      >
                        Activar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!isLoading && variants.length === 0 && !showForm && (
              <div className="px-6 py-10 text-center">
                <p className="text-sm text-slate-400">
                  Sin variantes todavía. Agrega la primera con el botón de arriba.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 px-6 py-4">
            <button
              onClick={onClose}
              className="h-10 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Listo
            </button>
          </div>
        </div>
      </div>

      {/* Label print modal */}
      {labelVariants && (
        <LabelPrintModal
          productName={product.name}
          brand={product.brand}
          variants={labelVariants}
          onClose={() => setLabelVariants(null)}
        />
      )}
    </>
  )
}
