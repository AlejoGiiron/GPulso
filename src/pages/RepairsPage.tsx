import { useState } from 'react'
import { Plus, Wrench, Phone } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useRepairBoard } from '@/hooks/useRepairs'
import type { RepairBoardCard } from '@/hooks/useRepairs'
import { usePermissions } from '@/hooks/usePermissions'
import { fmtCOP } from '@/lib/formatters'
import { REPAIR_STATUS_META, REPAIR_AGE_WARN_DAYS } from '@/lib/repairs'
import type { RepairStatus } from '@/types/database.types'
import { ReceptionModal } from '@/components/repairs/ReceptionModal'
import { RepairDetailModal } from '@/components/repairs/RepairDetailModal'

export default function RepairsPage() {
  const { data: board, isLoading } = useRepairBoard()
  const { can } = usePermissions()
  const canCosts = can('reparaciones.ver_costos')
  const [showReception, setShowReception] = useState(false)
  const [params, setParams] = useSearchParams()
  const detailId = params.get('id')

  const openDetail = (id: string) => setParams({ id }, { replace: false })
  const closeDetail = () => setParams({}, { replace: true })

  const cols: { key: RepairStatus; cards: RepairBoardCard[] }[] = [
    { key: 'recibido', cards: board?.recibido ?? [] },
    { key: 'en_reparacion', cards: board?.en_reparacion ?? [] },
    { key: 'listo', cards: board?.listo ?? [] },
    { key: 'entregado', cards: board?.entregado_hoy ?? [] },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Cabecera */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Wrench size={18} className="text-cyan-600" /> Taller de reparaciones
          </h1>
          <p className="text-xs text-gray-500">Tablero por estado. Toca una tarjeta para ver el detalle.</p>
        </div>
        <button onClick={() => setShowReception(true)} className="btn-primary inline-flex items-center gap-1.5">
          <Plus size={16} /> Recibir equipo
        </button>
      </div>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto bg-gray-50 p-4">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Cargando tablero…</div>
        ) : (
          <div className="grid min-w-[900px] grid-cols-4 gap-4">
            {cols.map((col) => (
              <Column key={col.key} status={col.key} cards={col.cards} canCosts={canCosts} onOpen={openDetail} />
            ))}
          </div>
        )}
      </div>

      {showReception && (
        <ReceptionModal
          onClose={() => setShowReception(false)}
          onCreated={() => {/* el tablero se refresca por invalidación */}}
        />
      )}
      {detailId && <RepairDetailModal repairId={detailId} onClose={closeDetail} />}
    </div>
  )
}

function Column({
  status,
  cards,
  canCosts,
  onOpen,
}: {
  status: RepairStatus
  cards: RepairBoardCard[]
  canCosts: boolean
  onOpen: (id: string) => void
}) {
  const meta = REPAIR_STATUS_META[status]
  const isDelivered = status === 'entregado'
  return (
    <div className="flex flex-col rounded-xl bg-white/60">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className={`flex items-center gap-1.5 text-sm font-semibold ${meta.columnAccent}`}>
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">{cards.length}</span>
      </div>
      <div className="flex-1 space-y-2 px-2 pb-2">
        {cards.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-[11px] text-gray-300">
            {isDelivered ? 'Sin entregas hoy' : 'Vacío'}
          </div>
        )}
        {cards.map((c) => (
          <RepairCard key={c.id} card={c} canCosts={canCosts} onOpen={onOpen} />
        ))}
        {isDelivered && (
          <p className="pt-1 text-center text-[10px] text-gray-400">Solo entregas de hoy · el histórico está en Ventas</p>
        )}
      </div>
    </div>
  )
}

function RepairCard({ card, canCosts, onOpen }: { card: RepairBoardCard; canCosts: boolean; onOpen: (id: string) => void }) {
  const aged = card.status !== 'entregado' && card.days_open >= REPAIR_AGE_WARN_DAYS
  return (
    <button
      onClick={() => onOpen(card.id)}
      className="w-full rounded-lg border border-gray-100 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs font-bold text-gray-900">#{card.order_number}</span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${aged ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
          {card.days_open} d
        </span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-gray-800">{card.customer_name}</div>
      {card.customer_phone && (
        <div className="flex items-center gap-1 text-[11px] text-gray-400">
          <Phone size={10} /> {card.customer_phone}
        </div>
      )}
      <div className="mt-1 truncate text-xs text-gray-600">{card.marca} {card.modelo}</div>
      <div className="mt-0.5 line-clamp-2 text-[11px] text-gray-400">{card.falla_reportada}</div>

      <div className="mt-2 border-t border-gray-50 pt-1.5 text-right">
        {canCosts ? (
          <span className="text-[11px] text-gray-400">
            Repuestos <span className="font-mono font-semibold text-gray-700">{fmtCOP(card.parts_cost)}</span>
          </span>
        ) : (
          <span className="text-[11px] text-gray-400">
            {card.precio != null ? (
              <>Cobrar <span className="font-mono font-semibold text-gray-700">{fmtCOP(card.precio)}</span></>
            ) : 'Precio sin definir'}
          </span>
        )}
      </div>
    </button>
  )
}
