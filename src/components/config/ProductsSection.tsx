import { useState, useEffect } from 'react'
import { Tag, GripVertical, Plus, Trash2, RefreshCw, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStoreConfig, useResolvedConfig } from '@/hooks/useConfig'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import { useAuth } from '@/hooks/useAuth'
import { getActiveStoreId } from '@/hooks/useActiveStoreId'
import { supabase } from '@/lib/supabase'
import { newSizeTypeId } from '@/lib/sizeTypes'
import type { StoreColorConfig, SizeTypeConfig } from '@/types/config.types'

// ─── Size types ─────────────────────────────────────────────────────────────

function SizeTypesManager({
  types,
  onChange,
  storeId,
}: {
  types: SizeTypeConfig[]
  onChange: (t: SizeTypeConfig[]) => void
  storeId: string
}) {
  const [newSizeInputs, setNewSizeInputs] = useState<Record<string, string>>({})
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  function updateLabel(idx: number, label: string) {
    onChange(types.map((t, i) => (i === idx ? { ...t, label } : t)))
  }

  function addSize(idx: number) {
    const t = types[idx]
    const v = (newSizeInputs[t.id] ?? '').trim()
    if (!v) return
    if (t.sizes.includes(v)) {
      toast.error(`La talla "${v}" ya existe en "${t.label}"`)
      return
    }
    onChange(types.map((x, i) => (i === idx ? { ...x, sizes: [...x.sizes, v] } : x)))
    setNewSizeInputs((s) => ({ ...s, [t.id]: '' }))
  }

  function removeSize(idx: number, sizeIdx: number) {
    onChange(
      types.map((t, i) =>
        i === idx ? { ...t, sizes: t.sizes.filter((_, j) => j !== sizeIdx) } : t,
      ),
    )
  }

  async function removeType(idx: number) {
    const t = types[idx]
    setDeletingId(t.id)
    try {
      const { count, error } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('store_id' as never, storeId)
        .eq('size_type' as never, t.id)
      if (error) throw error
      if ((count ?? 0) > 0) {
        toast.error(
          `No se puede eliminar "${t.label}": ${count} producto${count === 1 ? '' : 's'} lo usa${count === 1 ? '' : 'n'}`,
        )
        return
      }
      onChange(types.filter((_, i) => i !== idx))
      toast.success(`Tipo "${t.label}" eliminado`)
    } catch {
      toast.error('No se pudo verificar el uso del tipo de talla')
    } finally {
      setDeletingId(null)
    }
  }

  function addType() {
    onChange([...types, { id: newSizeTypeId(), label: 'Nuevo tipo', sizes: [] }])
  }

  function handleDrop(targetIdx: number) {
    if (draggedIdx === null || draggedIdx === targetIdx) {
      setDraggedIdx(null)
      setDragOverIdx(null)
      return
    }
    const next = [...types]
    const [moved] = next.splice(draggedIdx, 1)
    next.splice(targetIdx, 0, moved)
    onChange(next)
    setDraggedIdx(null)
    setDragOverIdx(null)
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
        Tipos de talla
      </p>
      <p className="mb-3 text-[11px] text-[#a8a29e]">
        Define los conjuntos de tallas disponibles al crear productos (ej. Pantalón
        Mujer). Arrastra para reordenar.
      </p>

      <div className="space-y-2">
        {types.map((t, idx) => (
          <div
            key={t.id}
            draggable
            onDragStart={() => setDraggedIdx(idx)}
            onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null) }}
            onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx) }}
            onDrop={(e) => { e.preventDefault(); handleDrop(idx) }}
            className={`rounded-xl border p-3 transition-colors ${
              draggedIdx === idx
                ? 'opacity-40'
                : dragOverIdx === idx
                ? 'border-cyan-300 bg-cyan-50'
                : 'border-[#ebe9e6] bg-white'
            }`}
          >
            {/* Label row */}
            <div className="mb-2.5 flex items-center gap-2">
              <span className="cursor-grab text-slate-300 active:cursor-grabbing">
                <GripVertical size={14} />
              </span>
              <input
                value={t.label}
                onChange={(e) => updateLabel(idx, e.target.value)}
                placeholder="Nombre del tipo"
                className="h-9 flex-1 rounded-lg border border-[#ebe9e6] px-3 text-sm font-medium outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
              />
              <button
                onClick={() => void removeType(idx)}
                disabled={deletingId === t.id}
                title="Eliminar tipo de talla"
                className="grid h-8 w-8 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-400 disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </div>

            {/* Sizes chips */}
            <div className="flex flex-wrap items-center gap-1.5 pl-6">
              {t.sizes.length === 0 ? (
                <span className="text-[11px] text-[#a8a29e]">
                  Sin tallas. Agrega abajo, o déjalo vacío para tallas libres.
                </span>
              ) : (
                t.sizes.map((size, sizeIdx) => (
                  <span
                    key={`${size}-${sizeIdx}`}
                    className="inline-flex items-center gap-1 rounded-[5px] bg-[#f5f4f1] px-2 py-1 text-xs font-semibold tabular-nums"
                  >
                    {size}
                    <button
                      onClick={() => removeSize(idx, sizeIdx)}
                      className="text-slate-400 hover:text-red-500"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Add size */}
            <div className="mt-2.5 flex gap-2 pl-6">
              <input
                value={newSizeInputs[t.id] ?? ''}
                onChange={(e) =>
                  setNewSizeInputs((s) => ({ ...s, [t.id]: e.target.value }))
                }
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSize(idx) } }}
                placeholder="Nueva talla"
                className="h-8 flex-1 rounded-lg border border-[#ebe9e6] px-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
              />
              <button
                onClick={() => addSize(idx)}
                disabled={!(newSizeInputs[t.id] ?? '').trim()}
                className="flex h-8 items-center gap-1 rounded-lg border border-[#ebe9e6] bg-white px-2.5 text-xs font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus size={12} />
                Talla
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addType}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-[#d6d3d1] py-2.5 text-sm font-medium text-cyan-500 hover:border-cyan-300 hover:bg-cyan-50"
      >
        <Plus size={14} />
        Nuevo tipo de talla
      </button>
    </div>
  )
}

// ─── Colors ───────────────────────────────────────────────────────────────────

function ColorList({
  colors,
  onChange,
}: {
  colors: StoreColorConfig[]
  onChange: (c: StoreColorConfig[]) => void
}) {
  const [newName, setNewName] = useState('')
  const [newHex, setNewHex] = useState('#06b6d4')

  function addColor() {
    const name = newName.trim()
    if (!name) return
    onChange([...colors, { name, hex: newHex }])
    setNewName('')
    setNewHex('#06b6d4')
  }

  function updateName(idx: number, name: string) {
    const next = colors.map((c, i) => (i === idx ? { ...c, name } : c))
    onChange(next)
  }

  function updateHex(idx: number, hex: string) {
    const next = colors.map((c, i) => (i === idx ? { ...c, hex } : c))
    onChange(next)
  }

  function removeColor(idx: number) {
    onChange(colors.filter((_, i) => i !== idx))
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
        Colores predefinidos
      </p>
      <div className="space-y-1">
        {colors.map((color, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-3 py-2"
          >
            <input
              type="color"
              value={color.hex}
              onChange={(e) => updateHex(idx, e.target.value)}
              className="h-7 w-7 cursor-pointer rounded-md border-0 bg-transparent p-0"
              title="Seleccionar color"
            />
            <span
              className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
              style={{ background: color.hex }}
            />
            <input
              value={color.name}
              onChange={(e) => updateName(idx, e.target.value)}
              className="flex-1 bg-transparent text-sm text-[#1a1a1a] outline-none"
            />
            <button
              onClick={() => removeColor(idx)}
              className="grid h-6 w-6 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-400"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      {/* Add */}
      <div className="mt-2 flex gap-2">
        <input
          type="color"
          value={newHex}
          onChange={(e) => setNewHex(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded-lg border border-[#ebe9e6] bg-white p-1"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addColor() }}
          placeholder="Nombre del color"
          className="h-9 flex-1 rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
        />
        <button
          onClick={addColor}
          disabled={!newName.trim()}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-40"
        >
          <Plus size={13} />
          Agregar
        </button>
      </div>
    </div>
  )
}

// ─── Brands ───────────────────────────────────────────────────────────────────

function BrandList({
  brands,
  onChange,
}: {
  brands: string[]
  onChange: (b: string[]) => void
}) {
  const [newBrand, setNewBrand] = useState('')

  function addBrand() {
    const v = newBrand.trim()
    if (!v) return
    if (brands.includes(v)) {
      toast.error(`La marca "${v}" ya existe`)
      return
    }
    onChange([...brands, v])
    setNewBrand('')
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
        Marcas frecuentes
      </p>
      {brands.length === 0 ? (
        <p className="mb-2 text-xs text-[#a8a29e]">Sin marcas. Agrégalas para usarlas en productos.</p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-2">
          {brands.map((brand, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 rounded-full border border-[#ebe9e6] bg-white px-3 py-1 text-xs font-medium text-[#525252]"
            >
              {brand}
              <button
                onClick={() => onChange(brands.filter((_, i) => i !== idx))}
                className="text-slate-300 hover:text-red-400"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={newBrand}
          onChange={(e) => setNewBrand(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addBrand() }}
          placeholder="Nombre de la marca"
          className="h-9 flex-1 rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
        />
        <button
          onClick={addBrand}
          disabled={!newBrand.trim()}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-40"
        >
          <Plus size={13} />
          Agregar
        </button>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ProductsSection() {
  const { profile } = useAuth()
  const { data: store, isLoading } = useStoreConfig()
  const config = useResolvedConfig()
  const { updateStoreConfig } = useConfigMutations()

  const [sizeTypes, setSizeTypes] = useState<SizeTypeConfig[]>([])
  const [colors, setColors] = useState<StoreColorConfig[]>([])
  const [brands, setBrands] = useState<string[]>([])
  const [returnDays, setReturnDays] = useState(30)
  // String de dígitos para el tope de descuento por ítem (formato de miles).
  const [maxItemDiscount, setMaxItemDiscount] = useState('0')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!store) return
    setSizeTypes(config.size_types)
    setColors(config.colors)
    setBrands(config.brands)
    setReturnDays(config.return_days_limit)
    setMaxItemDiscount(String(config.max_item_discount ?? 0))
  }, [store, config])

  const maxItemDiscountNum = Math.max(0, parseInt(maxItemDiscount || '0', 10) || 0)

  async function handleSave() {
    const cleaned = sizeTypes
      .map((t) => ({ ...t, label: t.label.trim() }))
      .filter((t) => t.label.length > 0)
    if (cleaned.length === 0) {
      toast.error('Debe existir al menos un tipo de talla')
      return
    }
    setSaving(true)
    try {
      await updateStoreConfig.mutateAsync({
        size_types: cleaned,
        colors,
        brands,
        return_days_limit: returnDays,
        max_item_discount: maxItemDiscountNum,
      })
      toast.success('Configuración de productos guardada')
    } catch {
      // toast shown by mutation
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-[14px] border border-[#ebe9e6] bg-white p-5">
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[14px] border border-[#ebe9e6] bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-100 text-cyan-600">
          <Tag size={15} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Configuración de productos</h2>
          <p className="text-xs text-[#737373]">Tallas, colores, marcas y devoluciones</p>
        </div>
      </div>

      {/* Body */}
      <div className="divide-y divide-[#f5f4f1]">
        <div className="px-5 py-5">
          <SizeTypesManager
            types={sizeTypes}
            onChange={setSizeTypes}
            storeId={getActiveStoreId(profile)}
          />
        </div>
        <div className="px-5 py-5">
          <ColorList colors={colors} onChange={setColors} />
        </div>
        <div className="px-5 py-5">
          <BrandList brands={brands} onChange={setBrands} />
        </div>
        <div className="px-5 py-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Días máximos para devolución
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={365}
              value={returnDays}
              onChange={(e) => setReturnDays(Math.max(1, parseInt(e.target.value) || 1))}
              className="h-10 w-24 rounded-lg border border-[#ebe9e6] px-3 text-sm tabular-nums outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
            <div className="flex items-center gap-1.5 text-xs text-[#737373]">
              <RefreshCw size={12} />
              días desde la compra
            </div>
          </div>
        </div>
        <div className="px-5 py-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Tope de descuento por ítem
          </p>
          <div className="flex h-10 w-44 items-center gap-1 rounded-lg border border-[#ebe9e6] bg-white px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
            <span className="text-sm font-medium text-[#a8a29e]">$</span>
            <input
              value={
                maxItemDiscountNum === 0
                  ? ''
                  : maxItemDiscountNum.toLocaleString('es-CO')
              }
              onChange={(e) =>
                setMaxItemDiscount(e.target.value.replace(/\D/g, ''))
              }
              inputMode="numeric"
              placeholder="0"
              className="w-full bg-transparent text-right font-mono text-sm tabular-nums outline-none"
            />
          </div>
          <p className="mt-1.5 text-[11px] text-[#a8a29e]">
            Rebaja máxima permitida por ítem al vender o crear separados. En $0,
            no se permite descuento. El vendedor no podrá bajar el precio de un
            producto por debajo de (precio − este tope).
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end border-t border-[#f5f4f1] px-5 py-4">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex h-9 items-center gap-2 rounded-lg bg-[#06b6d4] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95 disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
