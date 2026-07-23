import { useState, useMemo } from 'react'
import { X, Search, PackagePlus, Smartphone, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import { usePOSProducts } from '@/hooks/usePOSSearch'
import type { POSProduct } from '@/hooks/usePOSSearch'
import { useUnitMutations } from '@/hooks/useUnitMutations'
import { useCreateEquipmentWithUnit, useVariantLabelSuggestions } from '@/hooks/useEquipment'
import { fmtCOP } from '@/lib/formatters'
import type { UnitForSale } from '@/hooks/useUnits'

interface QuickAddUnitModalProps {
  initialSerial: string
  onClose: () => void
  onAdded: (unit: UnitForSale) => void
}

// Puerta 1 (POS): se escaneó un IMEI que no existe. PRIMERO se ofrecen plantillas
// serializadas existentes ("¿Es este? → agregar unidad") para no crear un segundo
// modelo duplicado; crear un equipo NUEVO (plantilla + primera unidad, atómico vía
// RPC) es el camino secundario. En ambos casos la unidad va al carrito.
export default function QuickAddUnitModal({
  initialSerial,
  onClose,
  onAdded,
}: QuickAddUnitModalProps) {
  const { data: products = [] } = usePOSProducts()
  const { addManualUnit } = useUnitMutations()
  const createEquipment = useCreateEquipmentWithUnit()
  const { data: labelSuggestions = [] } = useVariantLabelSuggestions()

  const [mode, setMode] = useState<'pick' | 'new'>('pick')
  const [term, setTerm] = useState('')
  const [picked, setPicked] = useState<POSProduct | null>(null)

  // Campos comunes de la unidad.
  const [serial, setSerial] = useState(initialSerial)
  const [variantLabel, setVariantLabel] = useState('')
  const [cost, setCost] = useState('')
  const [price, setPrice] = useState('')

  // Campos de "crear equipo nuevo".
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [suggested, setSuggested] = useState('')

  const serialized = useMemo(() => products.filter((p) => p.is_serialized), [products])
  const results = useMemo(() => {
    const t = term.trim().toLowerCase()
    if (!t) return serialized.slice(0, 12)
    return serialized.filter(
      (p) => p.name.toLowerCase().includes(t) || (p.brand ?? '').toLowerCase().includes(t),
    )
  }, [serialized, term])

  const busy = addManualUnit.isPending || createEquipment.isPending

  function pickTemplate(p: POSProduct) {
    setPicked(p)
    // Semilla del precio de venta = sugerido de la plantilla.
    if (p.suggested_price && p.suggested_price > 0) setPrice(String(p.suggested_price))
  }

  // Puerta 3 desde el POS: agrega una unidad a una plantilla YA existente.
  async function handleAddToExisting() {
    if (!picked) return
    const anchor = picked.variants[0]
    if (!anchor) {
      toast.error('El equipo no tiene variante base')
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
        variant_id: anchor.id,
        serial,
        cost: cost ? Math.round(parseFloat(cost)) : null,
        price: priceNum,
        variant_label: variantLabel || null,
        notas: 'Ingreso rápido desde POS',
      })
      onAdded({
        unit_id: (created as { id: string }).id,
        serial: serial.trim(),
        variant_id: anchor.id,
        product_id: picked.id,
        name: picked.name,
        brand: picked.brand,
        variant_label: variantLabel.trim() || null,
        price: priceNum,
        status: 'disponible',
      })
      onClose()
    } catch {
      // toast humano ya salió desde la mutación (dup, etc.)
    }
  }

  // Puerta 1: crea plantilla + primera unidad (RPC atómica) y va al carrito.
  async function handleCreateNew() {
    if (!name.trim()) {
      toast.error('Ingresa el nombre del equipo')
      return
    }
    const suggestedNum = Math.round(parseFloat(suggested) || 0)
    if (suggestedNum <= 0) {
      toast.error('El precio sugerido es obligatorio')
      return
    }
    if (!serial.trim()) {
      toast.error('Falta el serial')
      return
    }
    try {
      const res = await createEquipment.mutateAsync({
        name,
        brand: brand.trim() || null,
        category_id: null,
        description: null,
        suggested_price: suggestedNum,
        serial,
        unit_cost: cost ? Math.round(parseFloat(cost)) : null,
        variant_label: variantLabel || null,
        // La unidad arranca sin precio propio → resuelve al sugerido al leer.
        unit_price: null,
      })
      onAdded({
        unit_id: res.unit_id,
        serial: serial.trim(),
        variant_id: res.variant_id,
        product_id: res.product_id,
        name: name.trim(),
        brand: brand.trim() || null,
        variant_label: variantLabel.trim() || null,
        price: suggestedNum,
        status: 'disponible',
      })
      onClose()
    } catch {
      // toast humano ya salió desde la mutación (nombre/serial duplicado, etc.)
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
              IMEI no encontrado — elige el equipo o crea uno nuevo.
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
          {/* Serial (siempre) */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Serial / IMEI *</label>
            <input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm outline-none focus:border-cyan-400"
            />
          </div>

          {/* PICK: sin plantilla elegida y no creando → buscar existentes */}
          {mode === 'pick' && !picked && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">
                ¿Es alguno de estos equipos?
              </label>
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 px-3">
                <Search size={15} className="text-slate-400" />
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Buscar equipo por nombre o marca…"
                  className="h-9 flex-1 bg-transparent text-sm outline-none"
                  autoFocus
                />
              </div>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {results.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pickTemplate(p)}
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-cyan-300 hover:bg-cyan-50"
                  >
                    <Smartphone size={14} className="text-cyan-500" />
                    <span className="font-medium text-slate-800">{p.name}</span>
                    {p.brand && <span className="text-xs text-slate-400">{p.brand}</span>}
                    {p.suggested_price != null && (
                      <span className="ml-auto font-mono text-[12px] text-slate-500">
                        {fmtCOP(p.suggested_price)}
                      </span>
                    )}
                  </button>
                ))}
                {results.length === 0 && (
                  <p className="px-1 py-3 text-center text-xs text-slate-400">
                    Sin equipos que coincidan.
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setMode('new')
                  setName(term)
                }}
                className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-cyan-600 hover:text-cyan-700"
              >
                <PackagePlus size={14} />
                Crear equipo nuevo
              </button>
            </div>
          )}

          {/* PICK: plantilla elegida → datos de la unidad */}
          {mode === 'pick' && picked && (
            <>
              <div className="flex items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{picked.name}</p>
                  {picked.brand && <p className="text-[11px] text-slate-500">{picked.brand}</p>}
                </div>
                <button
                  onClick={() => setPicked(null)}
                  className="text-[12px] font-medium text-cyan-600 hover:underline"
                >
                  Cambiar
                </button>
              </div>
              <UnitFields
                variantLabel={variantLabel}
                setVariantLabel={setVariantLabel}
                cost={cost}
                setCost={setCost}
                price={price}
                setPrice={setPrice}
                labelSuggestions={labelSuggestions}
              />
            </>
          )}

          {/* NEW: crear equipo nuevo */}
          {mode === 'new' && (
            <>
              <button
                onClick={() => setMode('pick')}
                className="flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-slate-700"
              >
                <ArrowLeft size={13} /> Volver a elegir equipo
              </button>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Nombre del equipo *</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej: iPhone 13 128GB"
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Marca</label>
                  <input
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="Marca"
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Precio sugerido *</label>
                  <input
                    inputMode="numeric"
                    value={suggested}
                    onChange={(e) => setSuggested(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="0"
                    className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-cyan-400"
                  />
                </div>
              </div>
              <UnitFields
                variantLabel={variantLabel}
                setVariantLabel={setVariantLabel}
                cost={cost}
                setCost={setCost}
                price={price}
                setPrice={setPrice}
                labelSuggestions={labelSuggestions}
                hidePrice
              />
            </>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-5 py-4">
          <button
            onClick={onClose}
            className="h-10 flex-1 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          {mode === 'pick' && picked && (
            <button
              onClick={() => void handleAddToExisting()}
              disabled={busy || !serial.trim() || !price}
              className="h-10 flex-[2] rounded-lg bg-cyan-500 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              {busy ? 'Registrando…' : 'Registrar y agregar al carrito'}
            </button>
          )}
          {mode === 'new' && (
            <button
              onClick={() => void handleCreateNew()}
              disabled={busy || !name.trim() || !suggested || !serial.trim()}
              className="h-10 flex-[2] rounded-lg bg-cyan-500 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              {busy ? 'Creando…' : 'Crear equipo y agregar al carrito'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Campos de la unidad reutilizados por ambos modos.
function UnitFields({
  variantLabel,
  setVariantLabel,
  cost,
  setCost,
  price,
  setPrice,
  labelSuggestions,
  hidePrice = false,
}: {
  variantLabel: string
  setVariantLabel: (v: string) => void
  cost: string
  setCost: (v: string) => void
  price: string
  setPrice: (v: string) => void
  labelSuggestions: string[]
  hidePrice?: boolean
}) {
  return (
    <>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-600">Variante (opcional)</label>
        <input
          value={variantLabel}
          onChange={(e) => setVariantLabel(e.target.value)}
          list="quick-unit-label-options"
          placeholder="Ej: 128GB Azul"
          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400"
        />
        <datalist id="quick-unit-label-options">
          {labelSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
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
        {!hidePrice && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Precio de venta *</label>
            <input
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))}
              placeholder="0"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-cyan-400"
            />
            {price && <p className="mt-1 text-[11px] text-slate-400">{fmtCOP(parseFloat(price) || 0)}</p>}
          </div>
        )}
      </div>
    </>
  )
}
