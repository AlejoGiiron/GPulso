import { useState } from 'react'
import { Tag } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { minFinalPrice } from '@/stores/cartStore'

interface ItemPriceFieldProps {
  // Precio de catálogo (referencia para el monto rebajado −$X).
  listPrice: number
  // Precio final actual (ya clampeado por el padre).
  unitPrice: number
  // Tope de rebaja por ítem en pesos (max_item_discount de la config).
  maxItemDiscount: number
  // Recibe el precio final tecleado; el PADRE clampa (store o clampItemPrice)
  // y la prop unitPrice refleja el valor ya clampeado.
  onCommit: (finalPrice: number) => void
}

/**
 * Bloque "Precio con descuento" por ítem, compartido entre el POS y el wizard
 * de separados. Deja CLARO que el campo rebaja el precio: etiqueta + monto
 * rebajado (−$X = catálogo − final, en verde) + campo editable con el final.
 * En cian cuando hay descuento real. Con tope 0 queda de solo lectura. Los
 * ítems "sin cargo" ($0) NO usan este bloque (el padre muestra el banner ámbar).
 *
 * Usa estado local solo mientras se edita para no clampear en cada tecla;
 * confirma en blur/Enter.
 */
export function ItemPriceField({
  listPrice,
  unitPrice,
  maxItemDiscount,
  onCommit,
}: ItemPriceFieldProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const priceLocked = maxItemDiscount <= 0
  const discounted = unitPrice < listPrice
  const discountAmt = Math.max(0, listPrice - unitPrice)

  const displayVal =
    editing !== null
      ? editing === ''
        ? ''
        : Number(editing).toLocaleString('es-CO')
      : unitPrice.toLocaleString('es-CO')

  function commit() {
    if (editing === null) return
    onCommit(Number(editing || '0'))
    setEditing(null)
  }

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
        discounted
          ? 'border-cyan-300/70 bg-cyan-50/70'
          : 'border-slate-200 bg-slate-50'
      }`}
    >
      <span
        className={`flex shrink-0 items-center gap-1.5 text-[12px] font-semibold ${
          discounted ? 'text-cyan-700' : 'text-slate-500'
        }`}
      >
        <Tag size={13} />
        Precio con descuento
      </span>

      <div className="flex items-center gap-2">
        {discounted && (
          <span className="font-mono text-[11px] font-bold text-emerald-600">
            −{fmtCOP(discountAmt)}
          </span>
        )}
        <div
          className={`flex h-8 items-center gap-1 rounded-md border bg-white px-2 ${
            priceLocked
              ? 'border-slate-200'
              : discounted
                ? 'border-cyan-300 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100'
                : 'border-slate-300 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100'
          }`}
        >
          <span className="font-mono text-[12px] text-slate-400">$</span>
          <input
            value={displayVal}
            onFocus={() => {
              if (!priceLocked) setEditing(String(unitPrice))
            }}
            onChange={(e) => setEditing(e.target.value.replace(/\D/g, ''))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            readOnly={priceLocked}
            inputMode="numeric"
            title={
              priceLocked
                ? 'Descuento por ítem deshabilitado (tope $0)'
                : `Mínimo ${fmtCOP(minFinalPrice(listPrice, maxItemDiscount))}`
            }
            className={`w-16 bg-transparent text-right font-mono text-[13px] font-semibold tabular-nums outline-none read-only:cursor-default read-only:text-slate-500 ${
              discounted ? 'text-cyan-700' : 'text-slate-900'
            }`}
          />
        </div>
      </div>
    </div>
  )
}
