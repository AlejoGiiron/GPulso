import { Plus, Trash2 } from 'lucide-react'
import { PAYMENT_METHOD_KEYS, PAYMENT_METHODS } from '@/lib/paymentMethods'
import { sumSplitLines, type SplitLine } from '@/lib/paymentSplit'
import type { PaymentMethod } from '@/types/database.types'

interface Props {
  lines: SplitLine[]
  onChange: (lines: SplitLine[]) => void
  enabledMethods: PaymentMethod[]
  // Monto de referencia para "Resto" y el default de una línea nueva: el total
  // exacto (venta) o el saldo pendiente (abono). El botón "Resto" completa una
  // línea con lo que falta para llegar a esta referencia.
  reference: number
}

// Editor de líneas método+monto, compartido por el POS (venta) y los modales de
// abono (separado/fiado). Controlado: el padre es dueño del estado `lines`.
// NO incluye recargo, vuelto ni el indicador de estado: esos son propios de
// cada contexto y viven en el padre.
export function PaymentSplitLines({
  lines,
  onChange,
  enabledMethods,
  reference,
}: Props) {
  const visibleMethods = PAYMENT_METHOD_KEYS.filter((m) =>
    enabledMethods.includes(m),
  )
  const usedMethods = new Set(lines.map((l) => l.method))
  const availableToAdd = visibleMethods.filter((m) => !usedMethods.has(m))
  const paid = sumSplitLines(lines)
  const remaining = Math.round((reference - paid) * 100) / 100

  const setMethod = (i: number, m: PaymentMethod) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, method: m } : l)))
  const setAmount = (i: number, amt: string) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, amount: amt } : l)))
  const removeLine = (i: number) =>
    onChange(lines.filter((_, idx) => idx !== i))
  const addLine = () => {
    const next = availableToAdd[0]
    if (!next) return
    // La línea nueva arranca con lo que falta para cuadrar (el caso típico:
    // "el resto en este método"). El cajero puede ajustarlo.
    onChange([...lines, { method: next, amount: String(Math.max(0, remaining)) }])
  }
  // Completa una línea con el faltante para llegar a la referencia (evita la
  // cuenta mental): rest_i = referencia − suma de las OTRAS líneas.
  const fillRest = (i: number) => {
    const amt = parseFloat(lines[i].amount) || 0
    const rest = Math.max(0, Math.round((remaining + amt) * 100) / 100)
    setAmount(i, String(rest))
  }

  return (
    <>
      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={line.method}
              onChange={(e) => setMethod(i, e.target.value as PaymentMethod)}
              className="rounded-xl border border-slate-200 px-2.5 py-2.5 text-sm font-medium text-slate-700 outline-none focus:border-cyan-500"
            >
              {visibleMethods
                .filter((m) => m === line.method || !usedMethods.has(m))
                .map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHODS[m].label}
                  </option>
                ))}
            </select>
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm font-semibold text-slate-400">
                $
              </span>
              <input
                type="number"
                min={0}
                value={line.amount}
                onChange={(e) => setAmount(i, e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-7 pr-3 font-mono text-sm font-semibold outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
              />
            </div>
            {Math.abs(remaining) >= 0.5 && (
              <button
                type="button"
                onClick={() => fillRest(i)}
                className="shrink-0 rounded-lg border border-slate-200 px-2 py-2 text-[11px] font-semibold text-slate-600 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
                title="Completar con lo que falta"
              >
                Resto
              </button>
            )}
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => removeLine(i)}
                className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500"
                aria-label="Quitar método"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>

      {availableToAdd.length > 0 && (
        <button
          type="button"
          onClick={addLine}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
        >
          <Plus size={14} /> Agregar método
        </button>
      )}
    </>
  )
}
