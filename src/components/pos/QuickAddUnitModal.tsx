import { useState, useMemo } from 'react'
import { X, Search, PackagePlus, Smartphone } from 'lucide-react'
import toast from 'react-hot-toast'
import { usePOSProducts } from '@/hooks/usePOSSearch'
import type { POSProduct, POSVariant } from '@/hooks/usePOSSearch'
import { useUnitMutations } from '@/hooks/useUnitMutations'
import { fmtCOP } from '@/lib/formatters'
import type { UnitForSale } from '@/hooks/useUnits'
import ProductModal from '@/components/products/ProductModal'

interface QuickAddUnitModalProps {
  initialSerial: string
  onClose: () => void
  onAdded: (unit: UnitForSale) => void
}

// D6 — ingreso rápido: "compré UN equipo hoy, lo vendo hoy". IMEI desconocido →
// registrar la unidad (ruta C2b) y dejarla en el carrito. Requiere
// inventario.gestionar (lo impone la RLS de units + la UI que abre este modal).
export default function QuickAddUnitModal({
  initialSerial,
  onClose,
  onAdded,
}: QuickAddUnitModalProps) {
  const { data: products = [] } = usePOSProducts()
  const { addManualUnit } = useUnitMutations()

  const [term, setTerm] = useState('')
  const [product, setProduct] = useState<POSProduct | null>(null)
  const [variantId, setVariantId] = useState<string>('')
  const [serial, setSerial] = useState(initialSerial)
  const [cost, setCost] = useState('')
  const [price, setPrice] = useState('')
  const [showProductModal, setShowProductModal] = useState(false)

  // Solo productos serializados (D6 es exclusivo de equipos).
  const serialized = useMemo(
    () => products.filter((p) => p.is_serialized),
    [products],
  )
  const results = useMemo(() => {
    const t = term.trim().toLowerCase()
    if (!t) return serialized.slice(0, 20)
    return serialized.filter(
      (p) => p.name.toLowerCase().includes(t) || (p.brand ?? '').toLowerCase().includes(t),
    )
  }, [serialized, term])

  const variant: POSVariant | null =
    product?.variants.find((v) => v.id === variantId) ?? product?.variants[0] ?? null

  function pickProduct(p: POSProduct) {
    setProduct(p)
    const v = p.variants[0]
    setVariantId(v?.id ?? '')
    if (v && v.price > 0 && !price) setPrice(String(v.price))
  }

  async function handleConfirm() {
    if (!product || !variant) {
      toast.error('Elige el producto')
      return
    }
    if (!serial.trim()) {
      toast.error('Falta el serial')
      return
    }
    const priceNum = Math.round(parseFloat(price) || 0)
    if (priceNum <= 0) {
      toast.error('Ingresa el precio de venta')
      return
    }
    try {
      const created = await addManualUnit.mutateAsync({
        variant_id: variant.id,
        serial,
        cost: cost ? Math.round(parseFloat(cost)) : null,
        notas: 'Ingreso rápido desde POS',
      })
      const unitId = (created as { id: string }).id
      // Se agrega al carrito con el precio de ESTA venta (list = unit, sin
      // descuento; no hay catálogo previo para un ingreso rápido).
      onAdded({
        unit_id: unitId,
        serial: serial.trim(),
        variant_id: variant.id,
        product_id: product.id,
        name: product.name,
        brand: product.brand,
        // Fase C capturará variant_label en este modal; por ahora sin etiqueta.
        variant_label: null,
        price: priceNum,
        status: 'disponible',
      })
      onClose()
    } catch {
      // toast humano ya salió desde la mutación (dup, etc.)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-[520px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Registrar y vender</h2>
            <p className="text-sm text-slate-400">
              IMEI no encontrado — regístralo y va directo al carrito.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {/* Producto */}
          {!product ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Producto</label>
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 px-3">
                <Search size={15} className="text-slate-400" />
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Buscar equipo serializado…"
                  className="h-9 flex-1 bg-transparent text-sm outline-none"
                  autoFocus
                />
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {results.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pickProduct(p)}
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-cyan-300 hover:bg-cyan-50"
                  >
                    <Smartphone size={14} className="text-cyan-500" />
                    <span className="font-medium text-slate-800">{p.name}</span>
                    {p.brand && <span className="text-xs text-slate-400">{p.brand}</span>}
                  </button>
                ))}
                {results.length === 0 && (
                  <p className="px-1 py-3 text-center text-xs text-slate-400">
                    Sin equipos serializados que coincidan.
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowProductModal(true)}
                className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-cyan-600 hover:text-cyan-700"
              >
                <PackagePlus size={14} />
                Crear producto nuevo
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-slate-800">{product.name}</p>
                {product.brand && <p className="text-[11px] text-slate-500">{product.brand}</p>}
              </div>
              <button
                onClick={() => setProduct(null)}
                className="text-[12px] font-medium text-cyan-600 hover:underline"
              >
                Cambiar
              </button>
            </div>
          )}

          {/* Variante (si hay más de una) */}
          {product && product.variants.length > 1 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Variante</label>
              <select
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400"
              >
                {product.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {[v.size, v.color].filter(Boolean).join(' · ') || 'Única'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Serial / costo / precio */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Serial / IMEI *</label>
            <input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none focus:border-cyan-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Costo (hoy)</label>
              <input
                inputMode="numeric"
                value={cost}
                onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-cyan-400"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">
                Precio de venta *
              </label>
              <input
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-cyan-400"
              />
              {price && <p className="mt-1 text-[11px] text-slate-400">{fmtCOP(parseFloat(price) || 0)}</p>}
            </div>
          </div>
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-5 py-4">
          <button
            onClick={onClose}
            className="h-10 flex-1 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={addManualUnit.isPending || !product || !serial.trim() || !price}
            className="h-10 flex-[2] rounded-lg bg-cyan-500 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
          >
            {addManualUnit.isPending ? 'Registrando…' : 'Registrar y agregar al carrito'}
          </button>
        </div>
      </div>

      {showProductModal && (
        <ProductModal
          onClose={() => setShowProductModal(false)}
          onSaved={() => {
            // El producto nuevo aparece en la búsqueda al refrescar; el usuario
            // lo elige. (Reusa el flujo Única de un paso del Bloque B.)
            setShowProductModal(false)
            toast.success('Producto creado — búscalo y elígelo')
          }}
        />
      )}
    </div>
  )
}
