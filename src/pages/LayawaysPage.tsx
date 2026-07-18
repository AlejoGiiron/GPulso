import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Bookmark,
  Plus,
  Search,
  X,
  Clock,
  CheckCircle,
  AlertTriangle,
  Ban,
  ChevronRight,
  ChevronLeft,
  Printer,
  ExternalLink,
  Wallet,
  User,
  Copy,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { fmtCOP } from '@/lib/formatters'
import { getColorHex } from '@/lib/products'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import { useStoreConfig } from '@/hooks/useConfig'
import { useResolvedOrgConfig } from '@/hooks/useOrg'
import {
  useLayawayList,
  useLayawayDetail,
  useLayawayStatusCounts,
  LAYAWAY_PAGE_SIZE,
  type LayawayListFilters,
  type LayawayListRow,
  type LayawayDetail,
  type LayawayStatusFilter,
} from '@/hooks/useLayaways'
import { useExpireOverdueLayaways } from '@/hooks/useLayawayMutations'
import { NewLayawayModal } from '@/components/layaways/NewLayawayModal'
import { AddPaymentModal } from '@/components/layaways/AddPaymentModal'
import { CompleteLayawayModal } from '@/components/layaways/CompleteLayawayModal'
import { CancelLayawayModal } from '@/components/layaways/CancelLayawayModal'
import { usePermissions } from '@/hooks/usePermissions'
import { LayawayReceiptPrint } from '@/components/layaways/LayawayReceipt'
import type { LayawayStatus } from '@/types/database.types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

function fmtDateOnly(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

function copyToClipboard(value: string, label: string) {
  navigator.clipboard
    .writeText(value)
    .then(() => toast.success(`Copiado: ${label}`, { duration: 1500 }))
    .catch(() => toast.error(`No se pudo copiar ${label}`))
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS: { id: LayawayStatusFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'active', label: 'Activos' },
  { id: 'expiring_soon', label: 'Próximos a vencer' },
  { id: 'completed', label: 'Completados' },
  { id: 'cancelled', label: 'Cancelados' },
  { id: 'expired', label: 'Vencidos' },
]

// ── Badge de status ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: LayawayStatus }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-[10.5px] font-semibold text-cyan-800">
        <Clock size={9} /> Activo
      </span>
    )
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10.5px] font-semibold text-green-800">
        <CheckCircle size={9} /> Completado
      </span>
    )
  }
  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10.5px] font-semibold text-red-800">
        <Ban size={9} /> Cancelado
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-900">
      <AlertTriangle size={9} /> Vencido
    </span>
  )
}

// ── Días restantes con color ──────────────────────────────────────────────────

function daysColor(days: number): { color: string; bg: string; label: string } {
  if (days < 0) {
    return {
      color: '#b91c1c',
      bg: '#fee2e2',
      label: `Vencido hace ${Math.abs(days)}d`,
    }
  }
  if (days < 1) {
    return { color: '#b91c1c', bg: '#fee2e2', label: 'Vence hoy' }
  }
  if (days <= 7) {
    return { color: '#92400e', bg: '#fef3c7', label: `Vence en ${days}d` }
  }
  return { color: '#166534', bg: '#dcfce7', label: `Vence en ${days}d` }
}

// ── Card en la lista ──────────────────────────────────────────────────────────

function LayawayListCard({
  row,
  active,
  onClick,
}: {
  row: LayawayListRow
  active: boolean
  onClick: () => void
}) {
  const d = daysColor(row.days_until_expiry)
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border p-3 text-left transition-all ${
        active
          ? 'border-cyan-500 bg-cyan-50/40 shadow-[0_0_0_3px_rgba(139,92,246,0.1)]'
          : 'border-[#ebe9e6] bg-white hover:border-cyan-300'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-bold text-cyan-700"
          style={{ background: '#cffafe' }}
        >
          #{row.layaway_number}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-[13.5px] font-semibold text-[#1a1a1a]">
              {row.customer_name}
            </p>
            <StatusBadge status={row.status} />
          </div>
          <p className="mt-0.5 text-[11.5px] text-[#525252]">
            <span className="font-mono font-semibold text-[#1a1a1a]">
              {fmtCOP(row.total)}
            </span>{' '}
            ·{' '}
            <span className="text-[#737373]">
              {fmtCOP(row.paid_amount)} pagado
            </span>
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#f5f4f1]">
            <div
              className="h-full rounded-full bg-cyan-500"
              style={{ width: `${row.paid_percent}%` }}
            />
          </div>
          {row.status === 'active' && (
            <span
              className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ color: d.color, background: d.bg }}
            >
              <Clock size={9} />
              {d.label}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ── Sidebar de detalle ────────────────────────────────────────────────────────

function DetailHeader({ layaway }: { layaway: LayawayDetail }) {
  const navigate = useNavigate()
  const d = daysColor(
    Math.floor(
      (new Date(layaway.expires_at).getTime() - Date.now()) / 86_400_000,
    ),
  )

  return (
    <div className="border-b border-[#ebe9e6] bg-white px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                copyToClipboard(
                  `#${layaway.layaway_number}`,
                  `#${layaway.layaway_number}`,
                )
              }
              className="group inline-flex items-center gap-1.5 rounded px-1 font-mono text-2xl font-bold text-[#1a1a1a] hover:bg-[#f5f4f1]"
              style={{
                fontFamily: 'Bricolage Grotesque, sans-serif',
                letterSpacing: '-0.025em',
              }}
            >
              #{layaway.layaway_number}
              <Copy size={13} className="text-[#a8a29e] opacity-0 group-hover:opacity-100" />
            </button>
            <StatusBadge status={layaway.status} />
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <User size={13} className="text-[#737373]" />
            <span className="font-medium text-[#1a1a1a]">
              {layaway.customer_name}
            </span>
            {layaway.customer_phone && (
              <span className="text-[#737373]">· {layaway.customer_phone}</span>
            )}
            <button
              onClick={() => navigate('/clientes')}
              className="ml-1 text-[11px] font-medium text-cyan-600 hover:underline"
            >
              Ver perfil
            </button>
          </div>
          <p className="mt-1 text-[11.5px] text-[#737373]">
            Creado {fmtDateTime(layaway.created_at)}
            {layaway.created_by_name && ` · por ${layaway.created_by_name}`}
          </p>
        </div>
        {layaway.status === 'active' && (
          <div
            className="rounded-lg px-3 py-2 text-right"
            style={{ background: d.bg, color: d.color }}
          >
            <p className="text-[10.5px] font-semibold uppercase tracking-wider">
              {d.label}
            </p>
            <p className="mt-0.5 text-xs font-medium">
              {fmtDateOnly(layaway.expires_at)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function ProgressCard({ layaway }: { layaway: LayawayDetail }) {
  return (
    <div className="rounded-xl border border-[#ebe9e6] bg-white p-5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
        Progreso
      </p>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#f5f4f1]">
        <div
          className="h-full rounded-full bg-cyan-500"
          style={{
            width: `${layaway.total > 0 ? Math.min(100, Math.round((layaway.paid_amount / layaway.total) * 100)) : 0}%`,
          }}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] text-[#737373]">Pagado</p>
          <p className="font-mono text-base font-semibold text-emerald-700">
            {fmtCOP(layaway.paid_amount)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#737373]">de</p>
          <p className="font-mono text-base font-semibold text-[#1a1a1a]">
            {fmtCOP(layaway.total)}
          </p>
        </div>
      </div>
      {layaway.balance_pending > 0 && (
        <div className="mt-3 flex items-baseline justify-between rounded-lg bg-cyan-50 px-3 py-2">
          <span className="text-[11.5px] font-medium text-cyan-700">
            Saldo pendiente
          </span>
          <span className="font-mono text-base font-bold text-cyan-800">
            {fmtCOP(layaway.balance_pending)}
          </span>
        </div>
      )}
    </div>
  )
}

function ItemsCard({ items }: { items: LayawayDetail['items'] }) {
  const total = items.reduce((s, it) => s + it.qty * it.unit_price, 0)
  return (
    <div className="overflow-hidden rounded-xl border border-[#ebe9e6] bg-white">
      <div className="border-b border-[#f5f4f1] px-4 py-2.5">
        <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
          Ítems
        </p>
      </div>
      <div className="divide-y divide-[#f5f4f1]">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 px-4 py-3">
            <div
              className="h-4 w-4 shrink-0 rounded-full"
              style={{
                background: it.color ? getColorHex(it.color) : '#e2e8f0',
                boxShadow: '0 0 0 1.5px rgba(0,0,0,0.12)',
              }}
            />
            <div className="min-w-0 flex-1">
              {it.brand && (
                <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-[#a8a29e]">
                  {it.brand}
                </p>
              )}
              <p className="truncate text-sm font-medium text-[#1a1a1a]">
                {it.product_name}
              </p>
              <p className="text-[11.5px] text-[#737373]">
                {[it.size ? `T.${it.size}` : null, it.color]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                · {fmtCOP(it.unit_price)} c/u
              </p>
            </div>
            <span className="text-xs text-[#737373]">×{it.qty}</span>
            <span className="w-24 text-right font-mono text-sm font-semibold text-[#1a1a1a]">
              {fmtCOP(it.qty * it.unit_price)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-[#ebe9e6] bg-[#fafaf9] px-4 py-3">
        <span className="text-xs font-medium text-[#737373]">Total</span>
        <span className="font-mono text-base font-bold text-[#1a1a1a]">
          {fmtCOP(total)}
        </span>
      </div>
    </div>
  )
}

function PaymentsCard({ payments }: { payments: LayawayDetail['payments'] }) {
  const total = payments.reduce((s, p) => s + p.amount, 0)
  return (
    <div className="overflow-hidden rounded-xl border border-[#ebe9e6] bg-white">
      <div className="border-b border-[#f5f4f1] px-4 py-2.5">
        <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
          Historial de abonos
        </p>
      </div>
      {payments.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-[#a8a29e]">
          Aún no hay abonos registrados.
        </p>
      ) : (
        <div className="divide-y divide-[#f5f4f1]">
          {payments.map((p) => {
            const meta = PAYMENT_METHODS[p.payment_method]
            const Icon = meta.icon
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#fafaf9]">
                  <Icon size={13} style={{ color: meta.hex }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-[#1a1a1a]">
                    {meta.label}
                    {p.is_historical && (
                      <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                        Histórico
                      </span>
                    )}
                    {p.created_by_name && (
                      <span className="ml-1 text-[11px] text-[#737373]">
                        · {p.created_by_name}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-[#737373]">
                    {fmtDateTime(p.created_at)}
                    {p.notes && (
                      <span className="ml-1">· {p.notes}</span>
                    )}
                  </p>
                </div>
                <span className="font-mono text-sm font-semibold text-[#1a1a1a]">
                  {fmtCOP(p.amount)}
                </span>
              </div>
            )
          })}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-[#ebe9e6] bg-[#fafaf9] px-4 py-3">
        <span className="text-xs font-medium text-[#737373]">Total abonado</span>
        <span className="font-mono text-base font-bold text-[#1a1a1a]">
          {fmtCOP(total)}
        </span>
      </div>
    </div>
  )
}

// ── Acciones ──────────────────────────────────────────────────────────────────

function DetailActions({
  layaway,
  onPay,
  onComplete,
  onCancel,
  onReprint,
}: {
  layaway: LayawayDetail
  onPay: () => void
  onComplete: () => void
  onCancel: () => void
  onReprint: () => void
}) {
  const navigate = useNavigate()
  const { can } = usePermissions()

  if (layaway.status === 'active') {
    const canComplete = layaway.balance_pending <= 0
    return (
      <div className="flex flex-wrap gap-2 border-t border-[#ebe9e6] bg-white px-6 py-4">
        <button
          onClick={onPay}
          className="flex h-10 items-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700"
        >
          <Wallet size={14} /> Registrar abono
        </button>
        <button
          onClick={onComplete}
          disabled={!canComplete}
          className="flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCircle size={14} /> Completar venta
        </button>
        <button
          onClick={onReprint}
          className="ml-auto flex h-10 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm font-medium text-[#525252] hover:bg-[#f5f4f1]"
        >
          <Printer size={13} /> Imprimir
        </button>
        {can('separados.eliminar') && (
          <button
            onClick={onCancel}
            className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <Ban size={13} /> Cancelar separado
          </button>
        )}
      </div>
    )
  }

  if (layaway.status === 'completed') {
    return (
      <div className="flex flex-wrap gap-2 border-t border-[#ebe9e6] bg-white px-6 py-4">
        {layaway.converted_order_id && can('historial.ver') && (
          <button
            onClick={() =>
              navigate(
                `/ventas/historial?orderId=${layaway.converted_order_id}`,
              )
            }
            className="flex h-10 items-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700"
          >
            <ExternalLink size={14} /> Ver orden generada
          </button>
        )}
        <button
          onClick={onReprint}
          className="flex h-10 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-4 text-sm font-medium text-[#525252] hover:bg-[#f5f4f1]"
        >
          <Printer size={14} /> Reimprimir ticket
        </button>
      </div>
    )
  }

  // cancelled / expired — solo info
  return (
    <div className="flex flex-wrap items-start gap-2 border-t border-[#ebe9e6] bg-white px-6 py-4">
      {layaway.status === 'cancelled' && layaway.cancellation_reason && (
        <div className="w-full rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
          <span className="font-semibold">Motivo:</span>{' '}
          {layaway.cancellation_reason}
        </div>
      )}
      {layaway.paid_amount > 0 && (
        <div className="w-full rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          Abonos por <strong>{fmtCOP(layaway.paid_amount)}</strong> no fueron
          reembolsados automáticamente.
        </div>
      )}
      <button
        onClick={onReprint}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm font-medium text-[#525252] hover:bg-[#f5f4f1]"
      >
        <Printer size={13} /> Imprimir
      </button>
    </div>
  )
}

// ── Panel de detalle completo ─────────────────────────────────────────────────

function DetailPanel({
  selectedId,
  onPay,
  onComplete,
  onCancel,
  onReprint,
}: {
  selectedId: string | null
  onPay: () => void
  onComplete: () => void
  onCancel: () => void
  onReprint: (layaway: LayawayDetail) => void
}) {
  const { data: layaway, isLoading } = useLayawayDetail(selectedId)

  if (!selectedId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f5f4f1]">
          <Bookmark size={24} className="text-[#a8a29e]" />
        </div>
        <div>
          <p className="text-sm font-medium text-[#525252]">
            Selecciona un separado
          </p>
          <p className="mt-1 text-xs text-[#737373]">
            Verás los ítems, los abonos y las acciones disponibles.
          </p>
        </div>
      </div>
    )
  }

  if (isLoading || !layaway) {
    return (
      <div className="flex h-full flex-col gap-3 p-6">
        <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <DetailHeader layaway={layaway} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <ProgressCard layaway={layaway} />
        <ItemsCard items={layaway.items} />
        <PaymentsCard payments={layaway.payments} />
        {layaway.notes && (
          <div className="rounded-xl border border-[#ebe9e6] bg-white p-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
              Notas
            </p>
            <p className="mt-1 text-sm text-[#525252]">{layaway.notes}</p>
          </div>
        )}
      </div>
      <DetailActions
        layaway={layaway}
        onPay={onPay}
        onComplete={onComplete}
        onCancel={onCancel}
        onReprint={() => onReprint(layaway)}
      />
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function LayawaysPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialIdFromUrl = searchParams.get('id')

  const [filters, setFilters] = useState<LayawayListFilters>({
    status: 'all',
    search: '',
    page: 0,
  })
  const [selectedId, setSelectedId] = useState<string | null>(initialIdFromUrl)

  // Si el id viene en la URL (ej.: desde Reportes o la campana del header),
  // consumirlo y limpiar el query param para no re-aplicarlo después.
  useEffect(() => {
    if (initialIdFromUrl) {
      setSelectedId(initialIdFromUrl)
      const next = new URLSearchParams(searchParams)
      next.delete('id')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIdFromUrl])
  const [showNew, setShowNew] = useState(false)
  const [showPay, setShowPay] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [reprintLayaway, setReprintLayaway] = useState<LayawayDetail | null>(null)
  const printedAtRef = useRef(new Date())

  const { data: storeData } = useStoreConfig()
  const storeName =
    (storeData as unknown as { name?: string } | undefined)?.name ?? 'G-Pulso'
  const orgConfig = useResolvedOrgConfig()

  const { data: list, isLoading } = useLayawayList(filters)
  const { data: counts } = useLayawayStatusCounts()
  const { data: selectedDetail } = useLayawayDetail(selectedId)
  const expireMutation = useExpireOverdueLayaways()

  // Auto-expirar separados vencidos al entrar en la página (una vez por mount).
  const expiredRanRef = useRef(false)
  useEffect(() => {
    if (expiredRanRef.current) return
    expiredRanRef.current = true
    expireMutation.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = list?.rows ?? []
  const totalCount = list?.totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / LAYAWAY_PAGE_SIZE))

  const countMap = useMemo(
    () =>
      counts ?? {
        all: 0,
        active: 0,
        expiring_soon: 0,
        completed: 0,
        cancelled: 0,
        expired: 0,
      },
    [counts],
  )

  function handleReprint(layaway: LayawayDetail) {
    setReprintLayaway(layaway)
    printedAtRef.current = new Date()
    // Esperar un tick para que el render del Print container suceda
    requestAnimationFrame(() => {
      const cleanup = () => {
        window.removeEventListener('afterprint', cleanup)
        setReprintLayaway(null)
      }
      window.addEventListener('afterprint', cleanup)
      window.print()
      setTimeout(() => {
        window.removeEventListener('afterprint', cleanup)
        setReprintLayaway(null)
      }, 60_000)
    })
  }

  return (
    <div className="flex h-full gap-4 p-4">
      {/* Panel izquierdo */}
      <section className="flex w-[35%] min-w-[340px] flex-col overflow-hidden rounded-2xl border border-[#ebe9e6] bg-white">
        {/* Header lista */}
        <div className="border-b border-[#ebe9e6] px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p
                style={{
                  fontFamily: 'Bricolage Grotesque, sans-serif',
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: '-0.025em',
                  color: '#1a1a1a',
                }}
              >
                Separados
              </p>
              <p className="text-[11.5px] text-[#737373]">
                {totalCount} en total
              </p>
            </div>
            <button
              onClick={() => setShowNew(true)}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700"
            >
              <Plus size={14} /> Nuevo
            </button>
          </div>

          {/* Tabs */}
          <div className="-mx-1 mt-3 flex flex-wrap gap-1">
            {TABS.map((t) => {
              const count = countMap[t.id]
              const active = filters.status === t.id
              return (
                <button
                  key={t.id}
                  onClick={() =>
                    setFilters((f) => ({ ...f, status: t.id, page: 0 }))
                  }
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-[#ebe9e6] bg-white text-[#525252] hover:border-slate-400'
                  }`}
                >
                  {t.label}
                  <span
                    className={`rounded-full px-1.5 text-[10px] tabular-nums ${
                      active
                        ? 'bg-white/20'
                        : 'bg-[#f5f4f1] text-[#525252]'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Search */}
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-3 py-2 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
            <Search size={15} className="shrink-0 text-[#737373]" />
            <input
              value={filters.search}
              onChange={(e) =>
                setFilters((f) => ({ ...f, search: e.target.value, page: 0 }))
              }
              placeholder="Buscar #N o cliente…"
              className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-[#a8a29e]"
            />
            {filters.search && (
              <button
                onClick={() =>
                  setFilters((f) => ({ ...f, search: '', page: 0 }))
                }
                className="text-[#737373]"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Lista */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl bg-slate-100"
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f5f4f1]">
                <Bookmark size={20} className="text-[#a8a29e]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#525252]">
                  No hay separados en esta vista
                </p>
                <p className="mt-1 text-xs text-[#737373]">
                  Crea uno desde el botón Nuevo o ajusta los filtros.
                </p>
              </div>
              <button
                onClick={() => setShowNew(true)}
                className="mt-1 flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-sm font-semibold text-white hover:bg-cyan-700"
              >
                <Plus size={13} /> Nuevo separado
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((row) => (
                <LayawayListCard
                  key={row.id}
                  row={row}
                  active={row.id === selectedId}
                  onClick={() => setSelectedId(row.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Paginación */}
        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-[#ebe9e6] bg-[#fafaf9] px-3 py-2 text-[11px] text-[#525252]">
            <span>
              Página {filters.page + 1} / {totalPages}
            </span>
            <div className="flex gap-1">
              <button
                disabled={filters.page === 0}
                onClick={() =>
                  setFilters((f) => ({ ...f, page: Math.max(0, f.page - 1) }))
                }
                className="flex h-7 items-center gap-1 rounded-lg border border-[#ebe9e6] bg-white px-2 disabled:opacity-40 hover:bg-[#f5f4f1]"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                disabled={filters.page >= totalPages - 1}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    page: Math.min(totalPages - 1, f.page + 1),
                  }))
                }
                className="flex h-7 items-center gap-1 rounded-lg border border-[#ebe9e6] bg-white px-2 disabled:opacity-40 hover:bg-[#f5f4f1]"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Panel derecho */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#ebe9e6] bg-white">
        <DetailPanel
          selectedId={selectedId}
          onPay={() => setShowPay(true)}
          onComplete={() => setShowComplete(true)}
          onCancel={() => setShowCancel(true)}
          onReprint={handleReprint}
        />
      </section>

      {/* Modales */}
      {showNew && (
        <NewLayawayModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false)
            setSelectedId(id)
          }}
        />
      )}

      {showPay && selectedDetail && (
        <AddPaymentModal
          layawayId={selectedDetail.id}
          layawayNumber={selectedDetail.layaway_number}
          customerName={selectedDetail.customer_name}
          balancePending={selectedDetail.balance_pending}
          onClose={() => setShowPay(false)}
          onPayed={() => setShowPay(false)}
          onCompleted={() => setShowPay(false)}
        />
      )}

      {showComplete && selectedDetail && (
        <CompleteLayawayModal
          layawayId={selectedDetail.id}
          layawayNumber={selectedDetail.layaway_number}
          customerName={selectedDetail.customer_name}
          total={selectedDetail.total}
          items={selectedDetail.items}
          onClose={() => setShowComplete(false)}
          onCompleted={() => setShowComplete(false)}
        />
      )}

      {showCancel && selectedDetail && (
        <CancelLayawayModal
          layawayId={selectedDetail.id}
          layawayNumber={selectedDetail.layaway_number}
          customerName={selectedDetail.customer_name}
          paidAmount={selectedDetail.paid_amount}
          onClose={() => setShowCancel(false)}
          onCancelled={() => setShowCancel(false)}
        />
      )}

      {reprintLayaway && (
        <LayawayReceiptPrint
          layaway={reprintLayaway}
          storeName={storeName}
          printedAt={printedAtRef.current}
          terms={orgConfig.layaway_terms}
        />
      )}
    </div>
  )
}
