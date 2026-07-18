import { useState, useRef, type ChangeEvent, type FormEvent } from 'react'
import { X, Package } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCategories } from '@/hooks/useProducts'
import { useProductMutations } from '@/hooks/useProductMutations'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import { useResolvedConfig } from '@/hooks/useConfig'
import { DEFAULT_SIZE_TYPE_ID, findSizeType } from '@/lib/sizeTypes'
import type { Product } from '@/types/database.types'

interface ProductModalProps {
  product?: Product | null
  // Nombre inicial sugerido al crear (ej. el término de búsqueda de la factura).
  initialName?: string
  onClose: () => void
  onSaved: (product: Product) => void
}

export default function ProductModal({ product, initialName, onClose, onSaved }: ProductModalProps) {
  const { data: categories = [] } = useCategories()
  const { create, update, uploadImage } = useProductMutations()
  const config = useResolvedConfig()
  const sizeTypes = config.size_types
  const brands = config.brands
  const { updateStoreConfig } = useConfigMutations()

  const [name, setName] = useState(product?.name ?? initialName ?? '')
  const [brand, setBrand] = useState(product?.brand ?? '')
  const [categoryId, setCategoryId] = useState(product?.category_id ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [sizeType, setSizeType] = useState<string>(product?.size_type ?? DEFAULT_SIZE_TYPE_ID)

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

      const saved = isEdit
        ? await update.mutateAsync({ id: product.id, ...payload })
        : await create.mutateAsync(payload)

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
        {!isEdit && (
          <p className="mb-5 text-sm text-slate-400">
            Las variantes (talla y color) se agregan después.
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
              placeholder="Ej: Camiseta Básica Algodón"
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

          {/* Size type */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">
              Tipo de talla
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
              Define qué tallas estarán disponibles al agregar variantes.
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Material, corte, detalles…"
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
              disabled={submitting || !name.trim()}
              className="h-11 flex-[2] rounded-lg bg-cyan-500 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(139,92,246,0.35)] hover:bg-cyan-600 disabled:opacity-50"
            >
              {submitting
                ? 'Guardando…'
                : isEdit
                  ? 'Guardar cambios'
                  : 'Crear y agregar variantes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
