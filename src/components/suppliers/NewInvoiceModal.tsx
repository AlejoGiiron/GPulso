import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Search, Plus, Trash2, Info, PackagePlus, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSupplierList } from '@/hooks/useSuppliers'
import { usePurchaseVariantSearch } from '@/hooks/usePurchaseInvoices'
import { useCreateInvoice } from '@/hooks/useInvoiceMutations'
import { useCurrentShift } from '@/hooks/useCashShift'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { getActiveStoreId } from '@/hooks/useActiveStoreId'
import { fmtCOP } from '@/lib/formatters'
import { addDaysToDate, todayDateString } from '@/lib/invoices'
import { PAYMENT_METHOD_KEYS, PAYMENT_METHODS } from '@/lib/paymentMethods'
import SupplierModal from './SupplierModal'
import ProductModal from '@/components/products/ProductModal'
import VariantsPanel from '@/components/products/VariantsPanel'
import type { PaymentMethod, Product, Supplier } from '@/types/database.types'

interface NewInvoiceModalProps {
  onClose: () => void
  onCreated?: () => void
  defaultSupplierId?: string
}

interface ItemForm {
  key: string
  variant_id: string
  product_id: string
  product_name: string
  brand: string | null
  size: string | null
  color: string | null
  sku: string | null
  qty: number
  unit_cost: number
  update_cost: boolean
}

const LABEL =
  'mb-1.5 block text-[12px] font-semibold uppercase tracking-[.05em] text-[#737373]'
const INPUT =
  'h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none transition focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]'

// ── Aviso de producto duplicado ───────────────────────────────────────────────

interface DuplicateProductWarningProps {
  name: string
  matches: Product[]
  onUseExisting: (product: Product) => void
  onCreateAnyway: () => void
  onClose: () => void
}

function DuplicateProductWarning({
  name,
  matches,
  onUseExisting,
  onCreateAnyway,
  onClose,
}: DuplicateProductWarningProps) {
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[14px] bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle size={18} className="text-amber-700" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[#1a1a1a]">
              Ya existe un producto similar
            </h3>
            <p className="mt-0.5 text-[13px] text-[#737373]">
              Encontramos producto(s) parecidos a &ldquo;{name}&rdquo;. Usa el
              existente para no duplicar el catálogo; si le falta una variante o
              color, agrégalos al mismo producto.
            </p>
          </div>
        </div>

        <div className="mb-5 space-y-1.5">
          {matches.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-[#ebe9e6] bg-[#fafaf9] px-3 py-2"
            >
              <div className="min-w-0">
                {p.brand && (
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                    {p.brand}
                  </p>
                )}
                <p className="truncate text-sm font-medium text-[#1a1a1a]">
                  {p.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onUseExisting(p)}
                className="shrink-0 rounded-md border border-[#ebe9e6] bg-white px-2.5 py-1 text-[11px] font-medium text-[#06b6d4] hover:bg-[#f5f4f1]"
              >
                Usar este
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onCreateAnyway}
            className="h-9 flex-1 rounded-lg bg-[#06b6d4] text-sm font-semibold text-white hover:bg-[#0891b2]"
          >
            Crear de todas formas
          </button>
        </div>
      </div>
    </div>
  )
}

export default function NewInvoiceModal({
  onClose,
  onCreated,
  defaultSupplierId,
}: NewInvoiceModalProps) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)
  const { data: suppliers = [] } = useSupplierList({ isActive: true })
  const { data: currentShift } = useCurrentShift()
  const createInvoice = useCreateInvoice()

  // Header
  const [supplierId, setSupplierId] = useState(defaultSupplierId ?? '')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayDateString())
  const [dueDate, setDueDate] = useState('')
  const dueDateTouched = useRef(false)

  // Items
  const [items, setItems] = useState<ItemForm[]>([])
  const [search, setSearch] = useState('')
  const { data: results = [], isFetching } = usePurchaseVariantSearch(search)

  // On-the-fly product creation
  const [showProductModal, setShowProductModal] = useState(false)
  const [variantPanelProduct, setVariantPanelProduct] = useState<Product | null>(null)
  const newProductIds = useRef<Set<string>>(new Set())
  // Guard anti-duplicados: productos con nombre similar al término buscado.
  const [dupWarning, setDupWarning] = useState<{ name: string; matches: Product[] } | null>(null)
  const [checkingDup, setCheckingDup] = useState(false)
  // Variantes que ya existían al abrir VariantsPanel sobre un producto EXISTENTE;
  // se excluyen al re-agregar para no volcar todo el catálogo del producto a la
  // factura (solo las variantes nuevas creadas en la sesión).
  const preexistingVariantIds = useRef<Set<string>>(new Set())

  // Quick supplier
  const [showSupplierModal, setShowSupplierModal] = useState(false)

  // Totals
  const [tax, setTax] = useState('0')
  const [notes, setNotes] = useState('')

  // Initial payment
  const [withPayment, setWithPayment] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [payReference, setPayReference] = useState('')
  const [payNotes, setPayNotes] = useState('')

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId) ?? null,
    [suppliers, supplierId],
  )

  // Auto due date = invoice_date + payment_terms_days (hasta que se edite a mano)
  useEffect(() => {
    if (dueDateTouched.current) return
    if (selectedSupplier && invoiceDate) {
      setDueDate(addDaysToDate(invoiceDate, selectedSupplier.payment_terms_days))
    }
  }, [selectedSupplier, invoiceDate])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const subtotal = items.reduce((s, it) => s + it.qty * it.unit_cost, 0)
  const taxNum = Number(tax) || 0
  const total = subtotal + taxNum
  const payNum = Number(payAmount) || 0

  function addItem(opt: {
    variant_id: string
    product_id: string
    product_name: string
    brand: string | null
    size: string | null
    color: string | null
    sku: string | null
    unit_cost: number
    update_cost: boolean
  }) {
    setItems((prev) => {
      const existing = prev.find((i) => i.variant_id === opt.variant_id)
      if (existing) {
        return prev.map((i) =>
          i.variant_id === opt.variant_id ? { ...i, qty: i.qty + 1 } : i,
        )
      }
      return [
        ...prev,
        {
          key: crypto.randomUUID(),
          variant_id: opt.variant_id,
          product_id: opt.product_id,
          product_name: opt.product_name,
          brand: opt.brand,
          size: opt.size,
          color: opt.color,
          sku: opt.sku,
          qty: 1,
          unit_cost: opt.unit_cost,
          update_cost: opt.update_cost,
        },
      ]
    })
    setSearch('')
  }

  function updateItem(key: string, changes: Partial<ItemForm>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...changes } : i)))
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key))
  }

  // Al pulsar "Crear producto": precarga el término como nombre y, antes de
  // abrir el modal en blanco, busca productos con nombre similar para evitar
  // duplicados. Si hay coincidencias, muestra el aviso; si no, crea directo.
  async function handleCreateProductClick() {
    const name = search.trim()
    preexistingVariantIds.current = new Set()
    if (!name) {
      setShowProductModal(true)
      return
    }
    setCheckingDup(true)
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('store_id' as never, storeId)
        .ilike('name' as never, `%${name}%`)
        .order('name' as never)
        .limit(5)
      if (error) throw error
      const matches = (data ?? []) as unknown as Product[]
      if (matches.length > 0) {
        setDupWarning({ name, matches })
      } else {
        setShowProductModal(true)
      }
    } catch {
      toast.error('No se pudo verificar productos existentes')
      setShowProductModal(true)
    } finally {
      setCheckingDup(false)
    }
  }

  // "Usar existente": abre VariantsPanel sobre el producto ya creado para
  // agregar SOLO la variante (talla/color) que falte, sin duplicar el producto.
  async function handleUseExisting(product: Product) {
    setDupWarning(null)
    const { data, error } = await supabase
      .from('variants')
      .select('id')
      .eq('product_id' as never, product.id)
      .eq('store_id' as never, storeId)
      .eq('is_active' as never, true)
    preexistingVariantIds.current = new Set(
      error
        ? []
        : ((data ?? []) as unknown as { id: string }[]).map((v) => v.id),
    )
    setVariantPanelProduct(product)
  }

  // Tras crear/editar variantes, agrega como items SOLO las variantes nuevas
  // (las preexistentes de un producto ya catalogado se excluyen).
  async function handleVariantsPanelClose(product: Product) {
    setVariantPanelProduct(null)
    const skip = preexistingVariantIds.current
    const { data, error } = await supabase
      .from('variants')
      .select('id, size, color, sku, cost_price, price')
      .eq('product_id' as never, product.id)
      .eq('store_id' as never, storeId)
      .eq('is_active' as never, true)
    preexistingVariantIds.current = new Set()
    if (error) return
    const variants = (data ?? []) as unknown as Array<{
      id: string
      size: string | null
      color: string | null
      sku: string | null
      cost_price: number | null
      price: number
    }>
    for (const v of variants) {
      if (skip.has(v.id)) continue
      addItem({
        variant_id: v.id,
        product_id: product.id,
        product_name: product.name,
        brand: product.brand,
        size: v.size,
        color: v.color,
        sku: v.sku,
        unit_cost: v.cost_price != null ? Number(v.cost_price) : 0,
        // Variante nueva: tiene sentido fijar su costo desde esta factura.
        update_cost: true,
      })
    }
  }

  function handleSubmit() {
    createInvoice.mutate(
      {
        supplier_id: supplierId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        items: items.map((i) => ({
          variant_id: i.variant_id,
          product_id: i.product_id,
          qty: i.qty,
          unit_cost: i.unit_cost,
          subtotal: i.qty * i.unit_cost,
          update_cost: i.update_cost,
        })),
        tax: taxNum,
        notes,
        initial_payment:
          withPayment && payNum > 0
            ? {
                amount: payNum,
                method: payMethod,
                reference: payReference,
                notes: payNotes,
              }
            : undefined,
      },
      {
        onSuccess: () => {
          onCreated?.()
          onClose()
        },
      },
    )
  }

  const canSubmit =
    !!supplierId &&
    !!invoiceNumber.trim() &&
    !!invoiceDate &&
    items.length > 0 &&
    (!withPayment || (payNum > 0 && payNum <= total))

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.5)] backdrop-blur-[2px]"
        onClick={onClose}
      >
        <div
          className="mx-4 flex max-h-[92vh] w-full max-w-[760px] flex-col rounded-2xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between border-b border-[#f5f4f1] px-7 py-5">
            <div>
              <h2
                className="tracking-[-0.025em]"
                style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 22, fontWeight: 600 }}
              >
                Nueva factura de compra
              </h2>
              <p className="mt-1 text-sm text-[#737373]">
                Los ítems incrementan el stock automáticamente al guardar.
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] text-[#525252] hover:bg-[#ebe9e6]"
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-5">
            {/* Sección 1 — Encabezado */}
            <section className="space-y-4">
              <div>
                <label className={LABEL}>Proveedor *</label>
                <div className="flex gap-2">
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className={INPUT}
                  >
                    <option value="">Selecciona un proveedor…</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.nit ? ` · ${s.nit}` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowSupplierModal(true)}
                    className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-[#f8f7f5]"
                  >
                    <Plus size={13} /> Crear
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={LABEL}>N° factura *</label>
                  <input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="FC-001"
                    className={`${INPUT} font-mono`}
                  />
                </div>
                <div>
                  <label className={LABEL}>Fecha factura *</label>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>Vencimiento</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => {
                      dueDateTouched.current = true
                      setDueDate(e.target.value)
                    }}
                    className={INPUT}
                  />
                </div>
              </div>

              <div>
                <label className={LABEL}>Notas</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Opcional"
                  className={INPUT}
                />
              </div>
            </section>

            {/* Sección 2 — Items */}
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[#1a1a1a]">Ítems</h3>

              {/* Buscador */}
              <div className="relative">
                <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-3 py-2 focus-within:border-[#06b6d4] focus-within:shadow-[0_0_0_3px_#06b6d41a]">
                  <Search size={15} className="shrink-0 text-[#a8a29e]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por nombre, SKU o código de barras…"
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#a8a29e]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateProductClick()}
                    disabled={checkingDup}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#ebe9e6] bg-white px-2.5 py-1 text-[11px] font-medium text-[#06b6d4] hover:bg-[#f5f4f1] disabled:opacity-50"
                  >
                    <PackagePlus size={13} /> {checkingDup ? 'Verificando…' : 'Crear producto'}
                  </button>
                </div>

                {/* Resultados */}
                {search.trim().length >= 2 && (
                  <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-[#ebe9e6] bg-white shadow-lg">
                    {isFetching && (
                      <p className="px-3 py-3 text-xs text-[#a8a29e]">Buscando…</p>
                    )}
                    {!isFetching && results.length === 0 && (
                      <p className="px-3 py-3 text-xs text-[#a8a29e]">
                        Sin resultados. Usa “Crear producto” si no existe.
                      </p>
                    )}
                    {results.map((r) => {
                      const available = Math.max(0, r.stock_qty - r.reserved_qty)
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() =>
                            addItem({
                              variant_id: r.id,
                              product_id: r.product_id,
                              product_name: r.product_name,
                              brand: r.brand,
                              size: r.size,
                              color: r.color,
                              sku: r.sku,
                              unit_cost: r.cost_price ?? 0,
                              update_cost: false,
                            })
                          }
                          className="flex w-full items-center justify-between gap-3 border-b border-[#f5f4f1] px-3 py-2.5 text-left last:border-0 hover:bg-[#f8f7f5]"
                        >
                          <div className="min-w-0">
                            {r.brand && (
                              <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                                {r.brand}
                              </p>
                            )}
                            <p className="truncate text-sm font-medium text-[#1a1a1a]">
                              {r.product_name}
                            </p>
                            <p className="mt-0.5 text-[11px] text-[#a8a29e]">
                              {r.size ? `T.${r.size}` : ''}
                              {r.color ? ` · ${r.color}` : ''}
                              {r.sku ? ` · ${r.sku}` : ''} · disp. {available}
                            </p>
                            {r.barcode && (
                              <p className="mt-0.5 truncate font-mono text-[10px] text-[#a8a29e]">
                                {r.barcode}
                              </p>
                            )}
                          </div>
                          <span className="shrink-0 font-mono text-xs text-[#525252]">
                            {r.cost_price != null ? fmtCOP(r.cost_price) : 'sin costo'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Tabla de items */}
              {items.length > 0 ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-[#ebe9e6]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#fafaf9]">
                        {['Producto', 'Cant.', 'Costo unit.', 'Subtotal', 'Act. costo', ''].map(
                          (h, i) => (
                            <th
                              key={h || `a${i}`}
                              className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373] ${
                                i === 0 ? 'text-left' : 'text-right'
                              } ${i === 4 ? 'text-center' : ''}`}
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.key} className="border-t border-[#f5f4f1]">
                          <td className="px-3 py-2">
                            {it.brand && (
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                                {it.brand}
                              </p>
                            )}
                            <p className="font-medium text-[#1a1a1a]">{it.product_name}</p>
                            <p className="text-[11px] text-[#a8a29e]">
                              {it.size ? `T.${it.size}` : ''}
                              {it.color ? ` · ${it.color}` : ''}
                              {it.sku ? ` · ${it.sku}` : ''}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              min={1}
                              value={it.qty}
                              onChange={(e) =>
                                updateItem(it.key, {
                                  qty: Math.max(1, Number(e.target.value) || 1),
                                })
                              }
                              className="h-8 w-16 rounded-md border border-[#ebe9e6] px-2 text-right font-mono text-sm outline-none focus:border-[#06b6d4]"
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="relative inline-block">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[#a8a29e]">
                                $
                              </span>
                              <input
                                type="number"
                                min={0}
                                value={it.unit_cost}
                                onChange={(e) =>
                                  updateItem(it.key, {
                                    unit_cost: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                                className="h-8 w-28 rounded-md border border-[#ebe9e6] pl-5 pr-2 text-right font-mono text-sm outline-none focus:border-[#06b6d4]"
                              />
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-sm tabular-nums">
                            {fmtCOP(it.qty * it.unit_cost)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={it.update_cost}
                              onChange={(e) =>
                                updateItem(it.key, { update_cost: e.target.checked })
                              }
                              title="Actualiza el costo de la variante en el catálogo al guardar"
                              className="h-4 w-4 cursor-pointer rounded accent-cyan-500"
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeItem(it.key)}
                              className="grid h-7 w-7 place-items-center rounded-md border border-[#ebe9e6] text-[#a8a29e] hover:bg-[#f8f7f5] hover:text-red-500"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-[#d6d3d1] bg-[#fafaf9] px-4 py-6 text-center text-sm text-[#a8a29e]">
                  Busca y agrega productos, o crea uno nuevo.
                </div>
              )}
            </section>

            {/* Sección 3 — Totales */}
            <section className="rounded-xl border border-[#ebe9e6] bg-[#fafaf9] px-4 py-3">
              <div className="flex items-center justify-between py-1 text-sm">
                <span className="text-[#525252]">Subtotal</span>
                <span className="font-mono tabular-nums">{fmtCOP(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between py-1 text-sm">
                <label className="text-[#525252]">IVA / Impuesto</label>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[#a8a29e]">
                    $
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={tax}
                    onChange={(e) => setTax(e.target.value)}
                    className="h-8 w-32 rounded-md border border-[#ebe9e6] bg-white pl-5 pr-2 text-right font-mono text-sm outline-none focus:border-[#06b6d4]"
                  />
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-[#ebe9e6] pt-2">
                <span className="text-sm font-semibold text-[#1a1a1a]">Total</span>
                <span
                  className="font-mono text-xl font-semibold tabular-nums text-[#1a1a1a]"
                  style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
                >
                  {fmtCOP(total)}
                </span>
              </div>
            </section>

            {/* Sección 4 — Pago inicial */}
            <section className="rounded-xl border border-[#ebe9e6] px-4 py-3">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={withPayment}
                  onChange={(e) => setWithPayment(e.target.checked)}
                  className="h-4 w-4 cursor-pointer rounded accent-cyan-500"
                />
                <span className="text-sm font-medium text-[#1a1a1a]">
                  Registrar pago al crear
                </span>
              </label>

              {withPayment && (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL}>Monto</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#a8a29e]">
                          $
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={Math.round(total)}
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          placeholder="0"
                          className={`${INPUT} pl-7 font-mono`}
                        />
                      </div>
                      {payNum > total && (
                        <p className="mt-1 text-[11px] text-red-500">
                          No puede superar el total
                        </p>
                      )}
                    </div>
                    <div>
                      <label className={LABEL}>Método</label>
                      <select
                        value={payMethod}
                        onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                        className={INPUT}
                      >
                        {PAYMENT_METHOD_KEYS.map((key) => (
                          <option key={key} value={key}>
                            {PAYMENT_METHODS[key].label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {payMethod === 'cash' &&
                    (currentShift ? (
                      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] text-emerald-700">
                        <Info size={14} className="mt-0.5 shrink-0" />
                        Este pago afectará el cuadre de tu turno actual.
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 rounded-lg border border-[#ebe9e6] bg-[#f5f4f1] px-3 py-2.5 text-[12.5px] text-[#525252]">
                        <Info size={14} className="mt-0.5 shrink-0" />
                        Sin turno abierto: el pago no afectará caja.
                      </div>
                    ))}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL}>Referencia</label>
                      <input
                        value={payReference}
                        onChange={(e) => setPayReference(e.target.value)}
                        placeholder="Opcional"
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label className={LABEL}>Notas</label>
                      <input
                        value={payNotes}
                        onChange={(e) => setPayNotes(e.target.value)}
                        placeholder="Opcional"
                        className={INPUT}
                      />
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Footer */}
          <div className="flex shrink-0 gap-3 border-t border-[#f5f4f1] px-7 py-5">
            <button
              onClick={onClose}
              className="h-[42px] flex-1 rounded-lg border border-[#ebe9e6] text-sm font-medium text-[#404040] hover:bg-[#f8f7f5]"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={createInvoice.isPending || !canSubmit}
              className="h-[42px] flex-[2] rounded-lg bg-[#06b6d4] text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] transition hover:bg-[#0891b2] disabled:opacity-50"
            >
              {createInvoice.isPending ? 'Guardando…' : 'Guardar factura'}
            </button>
          </div>
        </div>
      </div>

      {/* Quick supplier */}
      {showSupplierModal && (
        <SupplierModal
          onClose={() => setShowSupplierModal(false)}
          onSaved={(s: Supplier) => setSupplierId(s.id)}
        />
      )}

      {/* Aviso de producto duplicado */}
      {dupWarning && (
        <DuplicateProductWarning
          name={dupWarning.name}
          matches={dupWarning.matches}
          onUseExisting={(p) => void handleUseExisting(p)}
          onCreateAnyway={() => {
            setDupWarning(null)
            setShowProductModal(true)
          }}
          onClose={() => setDupWarning(null)}
        />
      )}

      {/* Crear producto */}
      {showProductModal && (
        <ProductModal
          initialName={search.trim()}
          onClose={() => setShowProductModal(false)}
          onSaved={(p) => {
            setShowProductModal(false)
            newProductIds.current.add(p.id)
            preexistingVariantIds.current = new Set()
            setVariantPanelProduct(p)
          }}
        />
      )}

      {/* Crear variantes del producto nuevo */}
      {variantPanelProduct && (
        <VariantsPanel
          product={variantPanelProduct}
          onClose={() => void handleVariantsPanelClose(variantPanelProduct)}
        />
      )}
    </>
  )
}
