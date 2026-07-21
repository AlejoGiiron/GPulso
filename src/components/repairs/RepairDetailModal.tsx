import { useState } from 'react'
import {
  Eye,
  EyeOff,
  Lock,
  Plus,
  Trash2,
  ArrowRight,
  Package,
  ShoppingBag,
  Wrench,
  Check,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useRepairDetail } from '@/hooks/useRepairs'
import {
  useAdvanceRepairStatus,
  useUpdateRepair,
  useRemoveRepairPart,
} from '@/hooks/useRepairMutations'
import { usePermissions } from '@/hooks/usePermissions'
import { fmtCOP } from '@/lib/formatters'
import {
  REPAIR_STATUS_META,
  NEXT_STATUS,
  CHECKLIST_DANOS,
  CHECKLIST_VERIFICACIONES,
  daysSince,
} from '@/lib/repairs'
import type { RepairDetailPart } from '@/hooks/useRepairs'
import { ModalShell } from './ReceptionModal'
import { AddPartModal } from './AddPartModal'
import { DeliverModal } from './DeliverModal'

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

export function RepairDetailModal({ repairId, onClose }: { repairId: string; onClose: () => void }) {
  const { data: repair, isLoading } = useRepairDetail(repairId)
  const { can } = usePermissions()
  const canCosts = can('reparaciones.ver_costos')
  // Cobrar la entrega ES vender: solo quien tiene pos.usar (el Técnico no).
  const canSell = can('pos.usar')
  const advance = useAdvanceRepairStatus()
  const update = useUpdateRepair()
  const removePart = useRemoveRepairPart()

  const [showPassword, setShowPassword] = useState(false)
  const [editingPrice, setEditingPrice] = useState(false)
  const [priceInput, setPriceInput] = useState('')
  const [showAddPart, setShowAddPart] = useState(false)
  const [showDeliver, setShowDeliver] = useState(false)

  if (isLoading || !repair) {
    return (
      <ModalShell title="Reparación" onClose={onClose}>
        <div className="flex-1 p-8 text-center text-sm text-gray-400">Cargando…</div>
      </ModalShell>
    )
  }

  const meta = REPAIR_STATUS_META[repair.status]
  const next = NEXT_STATUS[repair.status]
  const isDelivered = repair.status === 'entregado'
  // El precio lo ve/edita quien ve costos; el vendedor solo lo ve en 'listo'.
  const showPrice = canCosts || repair.status === 'listo'
  const margin = repair.precio != null ? repair.precio - repair.parts_cost : null

  const savePrice = async () => {
    const val = Math.max(0, Math.round(Number(priceInput) || 0))
    await update.mutateAsync({ id: repair.id, patch: { precio: val } })
    setEditingPrice(false)
    toast.success('Precio actualizado')
  }

  const doAdvance = async () => {
    if (!next) return
    if (next === 'listo' && repair.precio === null) {
      return toast.error('Define el precio antes de marcar como listo')
    }
    await advance.mutateAsync({ id: repair.id, status: next })
  }

  return (
    <ModalShell title={`Reparación #${repair.order_number}`} onClose={onClose}>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {/* Cabecera: estado + cliente */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold text-gray-900">{repair.customer_name}</div>
            <div className="text-xs text-gray-500">{repair.customer_phone ?? 'Sin teléfono'}</div>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${meta.badge}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
        </div>

        {/* Equipo */}
        <Card>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Wrench size={15} className="text-cyan-600" />
            {repair.marca} {repair.modelo}
            {repair.color && <span className="text-xs font-normal text-gray-400">· {repair.color}</span>}
          </div>
          <Row label="IMEI / Serial"><span className="font-mono">{repair.imei_serial || '—'}</span></Row>
          <Row label="Recibido">
            {fmtDateTime(repair.created_at)} · hace {daysSince(repair.created_at)} d
          </Row>
          {repair.received_by_name && <Row label="Por">{repair.received_by_name}</Row>}
        </Card>

        {/* Falla + checklist */}
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Falla reportada</div>
          <p className="mt-1 text-sm text-gray-800">{repair.falla_reportada}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <ChecklistView title="Daños" tone="amber" items={CHECKLIST_DANOS} values={repair.checklist.danos} />
            <ChecklistView title="Verificaciones" tone="emerald" items={CHECKLIST_VERIFICACIONES} values={repair.checklist.verificaciones} />
          </div>
          {repair.accesorios && <Row label="Accesorios">{repair.accesorios}</Row>}
          {repair.observaciones && <Row label="Observaciones">{repair.observaciones}</Row>}
        </Card>

        {/* Contraseña confidencial */}
        {repair.password_equipo && (
          <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <Lock size={13} /> Contraseña del equipo
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-amber-900">
                {showPassword ? repair.password_equipo : '••••••'}
              </span>
              <button onClick={() => setShowPassword((v) => !v)} className="text-amber-700 hover:text-amber-900">
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        )}

        {/* Precio */}
        {showPrice && (
          <Card>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Precio a cobrar</span>
              {canCosts && !isDelivered && !editingPrice && (
                <button onClick={() => { setEditingPrice(true); setPriceInput(repair.precio?.toString() ?? '') }} className="text-xs font-medium text-cyan-700 hover:underline">
                  {repair.precio == null ? 'Definir' : 'Editar'}
                </button>
              )}
            </div>
            {editingPrice ? (
              <div className="mt-2 flex items-center gap-2">
                <input value={priceInput} onChange={(e) => setPriceInput(e.target.value.replace(/[^\d]/g, ''))} className="inp font-mono" inputMode="numeric" autoFocus />
                <button onClick={savePrice} className="btn-primary py-2">Guardar</button>
              </div>
            ) : (
              <div className="mt-1 font-mono text-2xl font-bold text-gray-900">
                {repair.precio == null ? <span className="text-base text-gray-400">Sin definir</span> : fmtCOP(repair.precio)}
              </div>
            )}
          </Card>
        )}

        {/* Repuestos (solo ver_costos) */}
        {canCosts && (
          <Card>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Repuestos</span>
              {!isDelivered && (
                <button onClick={() => setShowAddPart(true)} className="inline-flex items-center gap-1 text-xs font-medium text-cyan-700 hover:underline">
                  <Plus size={13} /> Agregar
                </button>
              )}
            </div>
            {repair.parts.length === 0 ? (
              <div className="mt-2 text-xs text-gray-400">Sin repuestos cargados.</div>
            ) : (
              <div className="mt-2 space-y-1.5">
                {repair.parts.map((p) => (
                  <PartRow key={p.id} part={p} canRemove={!isDelivered} onRemove={() => removePart.mutate(p.id)} />
                ))}
              </div>
            )}
            <div className="mt-3 border-t border-gray-100 pt-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Costo repuestos</span><span className="font-mono font-semibold text-gray-800">{fmtCOP(repair.parts_cost)}</span></div>
              {margin != null && (
                <div className="flex justify-between"><span className="text-gray-500">Margen</span><span className={`font-mono font-semibold ${margin >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtCOP(margin)}</span></div>
              )}
            </div>
          </Card>
        )}

        {/* Historial de estados */}
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Historial</div>
          <ol className="mt-2 space-y-2">
            {repair.history.map((h) => {
              const hm = REPAIR_STATUS_META[h.status]
              return (
                <li key={h.id} className="flex items-center gap-2 text-sm">
                  <span className={`h-2 w-2 rounded-full ${hm.dot}`} />
                  <span className="font-medium text-gray-700">{hm.label}</span>
                  <span className="ml-auto text-xs text-gray-400">{fmtDateTime(h.created_at)}{h.changed_by_name ? ` · ${h.changed_by_name}` : ''}</span>
                </li>
              )
            })}
          </ol>
        </Card>
      </div>

      {/* Acciones */}
      {!isDelivered && (
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-5 py-3.5">
          {next ? (
            <button onClick={doAdvance} disabled={advance.isPending} className="btn-secondary inline-flex items-center gap-1.5 disabled:opacity-40">
              Pasar a {REPAIR_STATUS_META[next].label} <ArrowRight size={14} />
            </button>
          ) : <span />}

          {repair.status === 'listo' && canSell && (
            <button onClick={() => setShowDeliver(true)} className="btn-primary inline-flex items-center gap-1.5">
              <Check size={15} /> Entregar y cobrar
            </button>
          )}
        </div>
      )}

      {showAddPart && <AddPartModal repairId={repair.id} onClose={() => setShowAddPart(false)} />}
      {showDeliver && (
        <DeliverModal
          repair={repair}
          customerName={repair.customer_name}
          onClose={() => setShowDeliver(false)}
          onDelivered={onClose}
        />
      )}
    </ModalShell>
  )
}

// ── Subcomponentes ─────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">{children}</div>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-1.5 flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right text-gray-800">{children}</span>
    </div>
  )
}

function ChecklistView({
  title, tone, items, values,
}: {
  title: string
  tone: 'amber' | 'emerald'
  items: { key: string; label: string }[]
  values: Record<string, boolean> | undefined
}) {
  const marked = items.filter((it) => values?.[it.key])
  const color = tone === 'amber' ? 'text-amber-700' : 'text-emerald-700'
  return (
    <div>
      <div className={`text-[11px] font-semibold ${color}`}>{title}</div>
      {marked.length === 0 ? (
        <div className="text-[11px] text-gray-400">— ninguno</div>
      ) : (
        <ul className="mt-0.5 space-y-0.5">
          {marked.map((it) => <li key={it.key} className="text-xs text-gray-700">• {it.label}</li>)}
        </ul>
      )}
    </div>
  )
}

function PartRow({ part, canRemove, onRemove }: { part: RepairDetailPart; canRemove: boolean; onRemove: () => void }) {
  const Icon = part.source === 'inventario' ? Package : ShoppingBag
  const label =
    part.source === 'inventario'
      ? [part.product_name, part.variant_label].filter(Boolean).join(' · ') || part.descripcion || 'Repuesto'
      : part.descripcion || 'Compra externa'
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon size={13} className="text-gray-400" />
      <span className="text-gray-800">{label}</span>
      {part.source === 'inventario' && part.qty != null && <span className="text-xs text-gray-400">×{part.qty}</span>}
      <span className="ml-auto font-mono text-gray-700">{fmtCOP(part.costo)}</span>
      {canRemove && (
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
      )}
    </div>
  )
}
