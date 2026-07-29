import { useState } from 'react'
import { Plus, Wrench, User, Clock, ChevronRight } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useRepairBoard } from '@/hooks/useRepairs'
import type { RepairBoardCard } from '@/hooks/useRepairs'
import { useAdvanceRepairStatus } from '@/hooks/useRepairMutations'
import { usePermissions } from '@/hooks/usePermissions'
import { fmtCOP } from '@/lib/formatters'
import {
  REPAIR_STATUS_META,
  REPAIR_AGE_WARN_DAYS,
  NEXT_STATUS,
  repairAgeLabel,
} from '@/lib/repairs'
import type { RepairStatus } from '@/types/database.types'
import { ReceptionModal } from '@/components/repairs/ReceptionModal'
import { RepairDetailModal } from '@/components/repairs/RepairDetailModal'
import { DeliverModal } from '@/components/repairs/DeliverModal'

export default function RepairsPage() {
  const { data: board, isLoading } = useRepairBoard()
  const { can } = usePermissions()
  const canCosts = can('reparaciones.ver_costos')
  const canSell = can('pos.usar')
  const advance = useAdvanceRepairStatus()

  // Vista de costos: quien puede ver costos arranca en "Técnico" (los ve) y puede
  // previsualizar lo que ve el "Vendedor" (solo precio). Quien no puede, no ve el
  // toggle y siempre está en modo vendedor.
  const [viewMode, setViewMode] = useState<'tecnico' | 'vendedor'>('tecnico')
  const showCosts = canCosts && viewMode === 'tecnico'

  const [showReception, setShowReception] = useState(false)
  const [deliverCard, setDeliverCard] = useState<RepairBoardCard | null>(null)
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
  const activeCount =
    (board?.recibido.length ?? 0) + (board?.en_reparacion.length ?? 0) + (board?.listo.length ?? 0)
  const readyCount = board?.listo.length ?? 0

  const handleMove = (card: RepairBoardCard) => {
    const next = NEXT_STATUS[card.status]
    if (!next) return
    if (next === 'listo' && card.precio === null) {
      toast('Define el precio para marcar como listo', { icon: '💲' })
      openDetail(card.id)
      return
    }
    advance.mutate({ id: card.id, status: next, from: card.status })
  }

  return (
    <div className="flex h-full flex-col">
      {/* Cabecera */}
      <div className="flex flex-shrink-0 items-start justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Wrench size={18} className="text-cyan-600" /> Órdenes de reparación
          </h1>
          <p className="text-xs text-gray-500">
            {activeCount} {activeCount === 1 ? 'orden activa' : 'órdenes activas'} · {readyCount}{' '}
            {readyCount === 1 ? 'lista para entregar' : 'listas para entregar'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canCosts && (
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs font-medium">
              {(['tecnico', 'vendedor'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
                  className={`rounded-md px-3 py-1 transition-colors ${
                    viewMode === m ? 'bg-slate-900 text-white' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {m === 'tecnico' ? 'Técnico' : 'Vendedor'}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setShowReception(true)} className="btn-primary inline-flex items-center gap-1.5">
            <Plus size={16} /> Recibir equipo
          </button>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex-1 overflow-x-auto bg-gray-50 p-4">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Cargando tablero…</div>
        ) : (
          <div className="grid min-w-[960px] grid-cols-4 gap-4">
            {cols.map((col) => (
              <Column
                key={col.key}
                status={col.key}
                cards={col.cards}
                showCosts={showCosts}
                canSell={canSell}
                onOpen={openDetail}
                onMove={handleMove}
                onDeliver={setDeliverCard}
              />
            ))}
          </div>
        )}
      </div>

      {showReception && <ReceptionModal onClose={() => setShowReception(false)} />}
      {detailId && <RepairDetailModal repairId={detailId} onClose={closeDetail} />}
      {deliverCard && (
        <DeliverModal
          repair={deliverCard}
          customerName={deliverCard.customer_name}
          onClose={() => setDeliverCard(null)}
          onDelivered={() => setDeliverCard(null)}
        />
      )}
    </div>
  )
}

function Column({
  status,
  cards,
  showCosts,
  canSell,
  onOpen,
  onMove,
  onDeliver,
}: {
  status: RepairStatus
  cards: RepairBoardCard[]
  showCosts: boolean
  canSell: boolean
  onOpen: (id: string) => void
  onMove: (card: RepairBoardCard) => void
  onDeliver: (card: RepairBoardCard) => void
}) {
  const meta = REPAIR_STATUS_META[status]
  const isDelivered = status === 'entregado'
  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
        <span className="text-sm font-semibold text-gray-700">{meta.label}</span>
        <span className="ml-1 rounded-full bg-gray-200/70 px-2 py-0.5 text-[11px] font-semibold text-gray-500">{cards.length}</span>
      </div>
      <div className="flex-1 space-y-2.5">
        {cards.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-[11px] text-gray-300">
            {isDelivered ? 'Sin entregas hoy' : 'Vacío'}
          </div>
        )}
        {cards.map((c) => (
          <RepairCard
            key={c.id}
            card={c}
            showCosts={showCosts}
            canSell={canSell}
            onOpen={onOpen}
            onMove={onMove}
            onDeliver={onDeliver}
          />
        ))}
        {isDelivered && cards.length > 0 && (
          <p className="pt-1 text-center text-[10px] text-gray-400">Solo entregas de hoy · el histórico está en Ventas</p>
        )}
      </div>
    </div>
  )
}

function RepairCard({
  card,
  showCosts,
  canSell,
  onOpen,
  onMove,
  onDeliver,
}: {
  card: RepairBoardCard
  showCosts: boolean
  canSell: boolean
  onOpen: (id: string) => void
  onMove: (card: RepairBoardCard) => void
  onDeliver: (card: RepairBoardCard) => void
}) {
  const meta = REPAIR_STATUS_META[card.status]
  const aged = card.status !== 'entregado' && card.days_open >= REPAIR_AGE_WARN_DAYS
  const canMove = card.status === 'recibido' || card.status === 'en_reparacion'
  const canDeliver = card.status === 'listo' && canSell

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div
      onClick={() => onOpen(card.id)}
      className={`cursor-pointer rounded-xl border border-l-4 border-gray-100 bg-white p-3 shadow-sm transition-shadow hover:shadow-md ${meta.border}`}
    >
      <div className="flex items-center justify-between">
        <span className={`font-mono text-xs font-bold ${meta.columnAccent}`}>#{card.order_number}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${aged ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
          <Clock size={9} /> {repairAgeLabel(card.days_open)}
        </span>
      </div>

      <div className="mt-1 truncate text-sm font-semibold text-gray-900">{card.marca} {card.modelo}</div>
      <div className="flex items-center gap-1 truncate text-[11px] text-gray-500">
        <User size={10} className="flex-shrink-0" />
        <span className="truncate">{card.customer_name}</span>
        {card.customer_phone && <span className="font-mono text-gray-400">· {card.customer_phone}</span>}
      </div>

      <div className="mt-2 rounded-lg bg-gray-50 px-2 py-1.5">
        <p className="line-clamp-2 text-[11px] text-gray-500">
          <span className="text-gray-400">Falla:</span> {card.falla_reportada}
        </p>
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[11px] text-gray-400">
          {showCosts ? (
            card.parts_cost > 0 ? (
              <>Repuestos <span className="font-mono font-semibold text-gray-700">{fmtCOP(card.parts_cost)}</span></>
            ) : '—'
          ) : card.precio != null ? (
            <>Cobrar <span className="font-mono font-semibold text-gray-700">{fmtCOP(card.precio)}</span></>
          ) : 'Sin precio'}
        </span>

        {canMove && (
          <button onClick={stop(() => onMove(card))} className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
            Mover <ChevronRight size={12} />
          </button>
        )}
        {canDeliver && (
          <button onClick={stop(() => onDeliver(card))} className="inline-flex items-center gap-0.5 rounded-lg bg-cyan-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-cyan-700">
            Entregar <ChevronRight size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
