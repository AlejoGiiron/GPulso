import { useState, useRef, type ChangeEvent, type FormEvent } from 'react'
import { X, Package } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCategories } from '@/hooks/useProducts'
import { useProductMutations } from '@/hooks/useProductMutations'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import { useResolvedConfig } from '@/hooks/useConfig'
import {
  useCreateEquipmentWithUnit,
  useSerializedTemplateSearch,
  useVariantLabelSuggestions,
  type SerializedTemplate,
} from '@/hooks/useEquipment'
import { DEFAULT_SIZE_TYPE_ID, findSizeType, isUniqueSizeType } from '@/lib/sizeTypes'
import { fmtCOP } from '@/lib/formatters'
import { supabase } from '@/lib/supabase'
import type { Product } from '@/types/database.types'

interface ProductModalProps {
  product?: Product | null
  // Nombre inicial sugerido al crear (ej. el término de búsqueda de la factura).
  initialName?: string
  // Puerta 1 (Productos): si viene, la búsqueda previa ofrece agregarle una unidad
  // a una plantilla serializada existente en vez de crear una nueva.
  onAddUnitToExisting?: (template: SerializedTemplate) => void
  onClose: () => void
  onSaved: (product: Product) => void
}

export default function ProductModal({ product, initialName, onAddUnitToExisting, onClose, onSaved }: ProductModalProps) {
  const { data: categories = [] } = useCategories()
  const { create, createSimple, update, uploadImage } = useProductMutations()
  const createEquipment = useCreateEquipmentWithUnit()
  const { data: labelSuggestions = [] } = useVariantLabelSuggestions()
  const config = useResolvedConfig()
  const sizeTypes = config.size_types
  const brands = config.brands
  const { updateStoreConfig } = useConfigMutations()

  const [name, setName] = useState(product?.name ?? initialName ?? '')
  const [brand, setBrand] = useState(product?.brand ?? '')
  const [categoryId, setCategoryId] = useState(product?.category_id ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [sizeType, setSizeType] = useState<string>(product?.size_type ?? DEFAULT_SIZE_TYPE_ID)
  // Fase 2: is_serialized se fija al CREAR (A1). Precio y stock inicial son del
  // flujo "Única en un paso" (Bloque B) — la variante única se crea por debajo.
  const [isSerialized, setIsSerialized] = useState(product?.is_serialized ?? false)
  const [price, setPrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [initialStock, setInitialStock] = useState('')

  // Fase C — plantilla serializada: precio sugerido + primera unidad.
  const [suggested, setSuggested] = useState('')
  const [serial, setSerial] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [unitLabel, setUnitLabel] = useState('')

  // Producto de variante "Única" al CREAR → formulario de un paso.
  const isUnique = isUniqueSizeType(sizeType)
  // Crear un EQUIPO serializado (plantilla + primera unidad, atómico vía RPC).
  const isSerializedCreate = !product && isSerialized
  const isSimpleCreate = !product && isUnique && !isSerialized

  // Búsqueda previa de plantillas serializadas (dedup): al escribir el nombre,
  // ofrecerlas antes de crear una nueva.
  const { data: templateMatches = [] } = useSerializedTemplateSearch(name, isSerializedCreate)

  // Si el producto tiene un tipo de talla que ya no existe en la config
  // (ej. fue eliminado o renombrado), lo agregamos como opción extra para
  // preservar la referencia al editar.
  const sizeTypeOptions =
    product?.size_type && !findSizeType(sizeTypes, product.size_type)
      ? [...sizeTypes, { id: product.size_type, label: product.size_type, sizes: [] }]
      : sizeTypes
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(product?.image_url ?? null)
  const [submitting, setSubmitting] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const isEdit = !!product

  // La marca escrita no está en las marcas frecuentes configuradas (comparación
  // case-insensitive) → ofrecer agregarla para reutilizarla en próximos productos.
  const trimmedBrand = brand.trim()
  const isNewBrand =
    trimmedBrand.length > 0 &&
    !brands.some((b) => b.toLowerCase() === trimmedBrand.toLowerCase())

  async function handleAddBrandToConfig() {
    try {
      await updateStoreConfig.mutateAsync({ brands: [...brands, trimmedBrand] })
      toast.success(`Marca "${trimmedBrand}" agregada a marcas frecuentes`)
    } catch {
      // toast de error ya lo muestra la mutación
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      // Upload image first (if new file selected)
      let finalImageUrl: string | null = product?.image_url ?? null
      if (imageFile) {
        const fileId = product?.id ?? crypto.randomUUID()
        const url = await uploadImage(imageFile, fileId)
        if (url) finalImageUrl = url
      }

      const payload = {
        name: name.trim(),
        brand: brand.trim() || null,
        category_id: categoryId || null,
        description: description.trim() || null,
        image_url: finalImageUrl,
        size_type: sizeType,
      }

      let saved: Product
      if (isEdit) {
        saved = await update.mutateAsync({ id: product.id, ...payload })
      } else if (isSerializedCreate) {
        // Puerta 1: plantilla + primera unidad, atómico vía RPC.
        const suggestedNum = Math.round(parseFloat(suggested) || 0)
        if (suggestedNum <= 0) {
          toast.error('El precio sugerido es obligatorio y debe ser mayor que 0')
          setSubmitting(false)
          return
        }
        if (!serial.trim()) {
          toast.error('El serial/IMEI de la primera unidad es obligatorio')
          setSubmitting(false)
          return
        }
        const res = await createEquipment.mutateAsync({
          name: name.trim(),
          brand: brand.trim() || null,
          category_id: categoryId || null,
          description: description.trim() || null,
          suggested_price: suggestedNum,
          serial,
          unit_cost: unitCost ? Math.round(parseFloat(unitCost)) : null,
          variant_label: unitLabel || null,
          unit_price: null,
        })
        // La RPC no maneja imagen; si se subió, se estampa aparte.
        if (finalImageUrl) {
          await supabase.from('products').update({ image_url: finalImageUrl } as never).eq('id' as never, res.product_id)
        }
        const { data: prod } = await supabase.from('products').select().eq('id' as never, res.product_id).single()
        saved = prod as unknown as Product
      } else if (isSimpleCreate) {
        const priceNum = Math.round(parseFloat(price) || 0)
        if (priceNum <= 0) {
          toast.error('Ingresa un precio de venta válido')
          setSubmitting(false)
          return
        }
        const res = await createSimple.mutateAsync({
          ...payload,
          is_serialized: isSerialized,
          price: priceNum,
          cost_price: costPrice ? Math.round(parseFloat(costPrice)) : null,
          initial_stock: Math.max(0, Math.round(parseFloat(initialStock) || 0)),
        })
        saved = res.product
      } else {
        saved = await create.mutateAsync({ ...payload, is_serialized: isSerialized })
      }

      onSaved(saved)
    } catch {
      // toast already shown by mutation onError
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[540px] max-h-[90vh] overflow-auto rounded-2xl bg-white p-7 shadow-2xl"
      >
        {/* Header */}
        <div className="mb-1 flex items-start justify-between">
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
            {isEdit ? 'Editar producto' : 'Nuevo producto'}
          </h2>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            <X size={14} />
          </button>
        </div>
        {!isEdit && !isUnique && (
          <p className="mb-5 text-sm text-slate-400">
            Las variantes (capacidad/color) se agregan después.
          </p>
        )}
        {isSimpleCreate && (
          <p className="mb-5 text-sm text-slate-400">
            Producto de variante única: captura precio y stock aquí mismo.
          </p>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* Image upload */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Imagen</label>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-slate-400 transition-colors hover:border-cyan-400 hover:text-cyan-500"
            >
              {imagePreview ? (
                <img
                  src={imagePreview}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <>
                  <Package size={22} />
                  <span className="text-[12.5px]">Click para subir o arrastrar imagen</span>
                  <span className="text-[11px] text-slate-300">PNG, JPG hasta 5 MB</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Nombre del producto
            </label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: iPhone 13 128GB"
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>

          {/* Brand + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Marca</label>
              <input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                list="product-brand-options"
                placeholder="Marca"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
              />
              <datalist id="product-brand-options">
                {brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              {isNewBrand && (
                <button
                  type="button"
                  onClick={() => void handleAddBrandToConfig()}
                  disabled={updateStoreConfig.isPending}
                  className="mt-1 text-[11px] font-medium text-cyan-500 hover:text-cyan-600 disabled:opacity-50"
                >
                  + Agregar “{trimmedBrand}” a marcas frecuentes
                </button>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Categoría</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
              >
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Size type (oculto para equipos serializados: usan variante ancla) */}
          {!isSerializedCreate && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Tipo de variante
            </label>
            <select
              value={sizeType}
              onChange={(e) => setSizeType(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              {sizeTypeOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">
              {isUnique
                ? 'Variante única: sin selector de variante en ventas ni inventario.'
                : 'Define qué valores de variante estarán disponibles al agregar variantes.'}
            </p>
          </div>
          )}

          {/* Serializado (se fija al crear) */}
          {!isEdit && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                type="checkbox"
                checked={isSerialized}
                onChange={(e) => setIsSerialized(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-cyan-500"
              />
              <span className="text-xs text-slate-600">
                <span className="block font-semibold text-slate-700">
                  Equipo serializado (IMEI/serial)
                </span>
                Cada unidad es única y rastreable. El stock se lleva por unidades,
                no por cantidad. No se puede cambiar luego de tener unidades o ventas.
              </span>
            </label>
          )}

          {/* Equipo serializado: dedup + sugerido + primera unidad */}
          {isSerializedCreate && (
            <>
              {templateMatches.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="mb-1.5 text-[12px] font-semibold text-amber-800">
                    Ya existe un equipo parecido — ¿es alguno de estos?
                  </p>
                  <div className="space-y-1">
                    {templateMatches.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onAddUnitToExisting?.(t)}
                        disabled={!onAddUnitToExisting}
                        className="flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-left text-[12.5px] hover:border-amber-400 disabled:cursor-default disabled:opacity-70"
                      >
                        <span className="font-medium text-slate-800">{t.name}</span>
                        {t.brand && <span className="text-[11px] text-slate-400">{t.brand}</span>}
                        {onAddUnitToExisting && (
                          <span className="ml-auto text-[11px] font-medium text-cyan-600">
                            Agregar unidad →
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-amber-700">
                    Agrégale la unidad a la ficha existente en vez de crear otro modelo.
                  </p>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">
                  Precio sugerido *
                </label>
                <input
                  inputMode="numeric"
                  value={suggested}
                  onChange={(e) => setSuggested(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="0"
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
                {suggested && (
                  <p className="mt-1 text-[11px] text-slate-400">{fmtCOP(parseFloat(suggested) || 0)}</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-[12px] font-semibold text-slate-700">Primera unidad</p>
                <div className="mb-2">
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Serial / IMEI *</label>
                  <input
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                    placeholder="Escanea o escribe el serial"
                    className="h-9 w-full rounded-lg border border-slate-200 px-2.5 font-mono text-sm outline-none focus:border-cyan-400"
                  />
                </div>
                <div className="mb-2">
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Variante (opcional)</label>
                  <input
                    value={unitLabel}
                    onChange={(e) => setUnitLabel(e.target.value)}
                    list="product-unit-label-options"
                    placeholder="Ej: 128GB Azul"
                    className="h-9 w-full rounded-lg border border-slate-200 px-2.5 text-sm outline-none focus:border-cyan-400"
                  />
                  <datalist id="product-unit-label-options">
                    {labelSuggestions.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Costo (opcional)</label>
                  <input
                    inputMode="numeric"
                    value={unitCost}
                    onChange={(e) => setUnitCost(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="0"
                    className="h-9 w-full rounded-lg border border-slate-200 px-2.5 text-sm tabular-nums outline-none focus:border-cyan-400"
                  />
                </div>
              </div>
            </>
          )}

          {/* Única en un paso: precio + stock inicial */}
          {isSimpleCreate && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">
                  Precio de venta *
                </label>
                <input
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="0"
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
                {price && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {fmtCOP(parseFloat(price) || 0)}
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">
                  Costo (opcional)
                </label>
                <input
                  inputMode="numeric"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="0"
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
              </div>
              <div className="col-span-2">
                {isSerialized ? (
                  <p className="rounded-lg bg-cyan-50 px-3 py-2 text-[11px] text-cyan-700">
                    Las unidades (IMEI/serial) se cargan desde Inventario o al recibir
                    la compra. El producto nace con 0 unidades.
                  </p>
                ) : (
                  <>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
                      Stock inicial
                    </label>
                    <input
                      inputMode="numeric"
                      value={initialStock}
                      onChange={(e) => setInitialStock(e.target.value.replace(/[^\d]/g, ''))}
                      placeholder="0"
                      className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Especificaciones, estado, detalles…"
              className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={
                submitting ||
                !name.trim() ||
                (isSimpleCreate && !price) ||
                (isSerializedCreate && (!suggested || !serial.trim()))
              }
              className="h-11 flex-[2] rounded-lg bg-cyan-500 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(6,182,212,0.35)] hover:bg-cyan-600 disabled:opacity-50"
            >
              {submitting
                ? 'Guardando…'
                : isEdit
                  ? 'Guardar cambios'
                  : isSerializedCreate
                    ? 'Crear equipo y primera unidad'
                    : isUnique
                      ? 'Crear producto'
                      : 'Crear y agregar variantes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
