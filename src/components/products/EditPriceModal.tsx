import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useVariantMutations } from '@/hooks/useVariantMutations'
import { fmtCOP } from '@/lib/formatters'
import type { Variant } from '@/types/database.types'

interface EditPriceModalProps {
  productName: string
  variant: Variant
  onClose: () => void
}

// Precio y costo de un producto de variante Única (accesorios). Su variante es
// invisible y no tiene panel de variantes: esta es la vía para editar su precio.
export default function EditPriceModal({ productName, variant, onClose }: EditPriceModalProps) {
  const { update } = useVariantMutations(variant.product_id)
  const [price, setPrice] = useState(String(variant.price))
  const [costPrice, setCostPrice] = useState(variant.cost_price != null ? String(variant.cost_price) : '')

  const priceNum = Math.round(parseFloat(price) || 0)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (priceNum <= 0) {
      toast.error('Ingresa un precio de venta válido')
      return
    }
    try {
      await update.mutateAsync({
        id: variant.id,
        price: priceNum,
        cost_price: costPrice.trim() !== '' ? Math.round(parseFloat(costPrice) || 0) : null,
      })
      toast.success(`Precio actualizado a ${fmtCOP(priceNum)}`)
      onClose()
    } catch {
      // toast de error ya lo muestra la mutación
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-[420px] rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">Editar precio</h2>
            <p className="mt-0.5 text-sm text-slate-400">{productName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Precio venta (COP)
            </label>
            <input
              type="number"
              min="0"
              step="1000"
              autoFocus
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 px-2.5 font-mono text-sm outline-none focus:border-cyan-400"
            />
            {priceNum > 0 && (
              <p className="mt-1 font-mono text-xs text-slate-400">{fmtCOP(priceNum)}</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Precio costo (COP)
            </label>
            <input
              type="number"
              min="0"
              step="1000"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              placeholder="Opcional"
              className="h-10 w-full rounded-lg border border-slate-200 px-2.5 font-mono text-sm outline-none focus:border-cyan-400"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={update.isPending || priceNum <= 0}
            className="h-9 rounded-lg bg-cyan-500 px-4 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
          >
            {update.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
