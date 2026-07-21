import { useState } from 'react'
import { Search, Package, ShoppingBag } from 'lucide-react'
import toast from 'react-hot-toast'
import { usePurchaseVariantSearch } from '@/hooks/usePurchaseInvoices'
import { useAddRepairPart } from '@/hooks/useRepairMutations'
import { fmtCOP } from '@/lib/formatters'
import type { RepairPartSource } from '@/types/database.types'
import { ModalShell, Footer } from './ReceptionModal'

interface SelectedVariant {
  id: string
  label: string
  cost_price: number | null
  stock_qty: number
}

export function AddPartModal({ repairId, onClose }: { repairId: string; onClose: () => void }) {
  const add = useAddRepairPart()
  const [source, setSource] = useState<RepairPartSource>('inventario')

  // Inventario
  const [search, setSearch] = useState('')
  const { data: results = [], isFetching } = usePurchaseVariantSearch(search)
  const [selected, setSelected] = useState<SelectedVariant | null>(null)
  const [qty, setQty] = useState('1')

  // Compra externa
  const [descripcion, setDescripcion] = useState('')
  const [costo, setCosto] = useState('')

  const qtyNum = Math.max(1, Math.round(Number(qty) || 1))
  const estimatedCost = selected ? (selected.cost_price ?? 0) * qtyNum : 0

  const canSubmit =
    !add.isPending &&
    (source === 'inventario'
      ? !!selected && qtyNum > 0
      : descripcion.trim().length > 0 && Number(costo) >= 0 && costo.trim() !== '')

  const handleSubmit = async () => {
    if (source === 'inventario') {
      if (!selected) return toast.error('Selecciona el repuesto del inventario')
      await add.mutateAsync({
        repairId,
        source: 'inventario',
        variant_id: selected.id,
        qty: qtyNum,
        descripcion: selected.label,
        costo: null,
      })
    } else {
      if (!descripcion.trim()) return toast.error('Describe el repuesto')
      await add.mutateAsync({
        repairId,
        source: 'compra_externa',
        variant_id: null,
        qty: null,
        descripcion: descripcion.trim(),
        costo: Math.max(0, Math.round(Number(costo))),
      })
    }
    onClose()
  }

  return (
    <ModalShell title="Agregar repuesto" onClose={onClose}>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {/* Fuente */}
        <div className="grid grid-cols-2 gap-2">
          <SourceBtn active={source === 'inventario'} onClick={() => setSource('inventario')} icon={Package} label="Del inventario" hint="Descuenta stock" />
          <SourceBtn active={source === 'compra_externa'} onClick={() => setSource('compra_externa')} icon={ShoppingBag} label="Compra externa" hint="Comprado al momento" />
        </div>

        {source === 'inventario' ? (
          <div>
            {selected ? (
              <div className="flex items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{selected.label}</div>
                  <div className="text-xs text-gray-500">
                    Stock {selected.stock_qty} · costo unit. {fmtCOP(selected.cost_price ?? 0)}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-xs font-medium text-cyan-700 hover:underline">Cambiar</button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar repuesto por nombre, SKU o código…" className="inp pl-9" autoFocus />
                </div>
                {search.trim().length >= 2 && (
                  <div className="mt-1.5 max-h-52 overflow-y-auto rounded-lg border border-gray-100">
                    {isFetching && <div className="px-3 py-2 text-xs text-gray-400">Buscando…</div>}
                    {!isFetching && results.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">Sin resultados</div>}
                    {results.map((v) => {
                      const label = [v.product_name, v.size, v.color].filter(Boolean).join(' · ')
                      return (
                        <button
                          key={v.id}
                          onClick={() => setSelected({ id: v.id, label, cost_price: v.cost_price, stock_qty: v.stock_qty })}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          <span className="font-medium text-gray-800">{label}</span>
                          <span className="text-xs text-gray-400">Stock {v.stock_qty}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {selected && (
              <div className="mt-3 flex items-center gap-3">
                <label className="text-xs font-medium text-gray-500">Cantidad</label>
                <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} className="inp w-24 font-mono" inputMode="numeric" />
                <span className="ml-auto text-sm text-gray-500">
                  Costo: <span className="font-mono font-semibold text-gray-800">{fmtCOP(estimatedCost)}</span>
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-500">Descripción *</span>
              <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="inp" placeholder="Flex de carga, batería genérica…" autoFocus />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-gray-500">Costo *</span>
              <input value={costo} onChange={(e) => setCosto(e.target.value.replace(/[^\d]/g, ''))} className="inp font-mono" placeholder="0" inputMode="numeric" />
            </label>
          </div>
        )}
      </div>

      <Footer>
        <button onClick={onClose} className="btn-secondary">Cancelar</button>
        <button onClick={handleSubmit} disabled={!canSubmit} className="btn-primary disabled:opacity-40">
          {add.isPending ? 'Agregando…' : 'Agregar repuesto'}
        </button>
      </Footer>
    </ModalShell>
  )
}

function SourceBtn({
  active,
  onClick,
  icon: Icon,
  label,
  hint,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Package
  label: string
  hint: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
        active ? 'border-cyan-400 bg-cyan-50' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <Icon size={16} className={active ? 'text-cyan-600' : 'text-gray-400'} />
      <span className="text-sm font-semibold text-gray-800">{label}</span>
      <span className="text-[11px] text-gray-400">{hint}</span>
    </button>
  )
}
