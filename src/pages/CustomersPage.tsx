import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  CreditCard,
  ChevronRight,
  Edit2,
  X,
  Banknote,
  ArrowLeftRight,
  Smartphone,
  HandCoins,
  RotateCcw,
  ShoppingBag,
  FileText,
  User,
  Bookmark,
  Clock,
  CheckCircle,
  Ban,
  AlertTriangle,
} from 'lucide-react'
import { z } from 'zod'
import {
  useCustomerList,
  useCustomerProfile,
} from '@/hooks/useCustomers'
import {
  useCustomerLayaways,
  type CustomerLayawayRow,
} from '@/hooks/useLayaways'
import {
  useCreateCustomer,
  useUpdateCustomer,
} from '@/hooks/useCustomerMutations'
import { useCustomerUnits } from '@/hooks/useUnits'
import { usePermissions } from '@/hooks/usePermissions'
import UnitDetailModal from '@/components/inventory/UnitDetailModal'
import { fmtCOP } from '@/lib/formatters'
import type {
  CustomerListItem,
  CustomerProfile,
  CustomerOrder,
  CustomerReturn,
} from '@/hooks/useCustomers'
import type {
  PaymentMethod,
  OrderStatus,
  ReturnType,
  LayawayStatus,
} from '@/types/database.types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}

function fmtDateShort(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function fmtRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 7) return `Hace ${days} días`
  if (days < 30) return `Hace ${Math.floor(days / 7)} semanas`
  return fmtDate(iso)
}

// ── Validation schema ─────────────────────────────────────────────────────────

const customerSchema = z.object({
  full_name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  phone: z.string().min(7, 'Ingresa un teléfono válido (mín. 7 dígitos)'),
  email: z.string().email('Email inválido').or(z.literal('')),
  document_id: z.string(),
  notes: z.string(),
})

type FormValues = z.infer<typeof customerSchema>

// ── Badges ────────────────────────────────────────────────────────────────────

const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  completed: 'bg-emerald-50 border border-emerald-200 text-emerald-600',
  cancelled: 'bg-red-50 border border-red-200 text-red-600',
  returned: 'bg-amber-50 border border-amber-200 text-amber-600',
}
const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  completed: 'Completada',
  cancelled: 'Cancelada',
  returned: 'Devuelta',
}

function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ORDER_STATUS_STYLES[status]}`}
    >
      {ORDER_STATUS_LABEL[status]}
    </span>
  )
}

const RETURN_TYPE_LABEL: Record<ReturnType, string> = {
  return: 'Devolución',
  exchange: 'Cambio',
}

const RETURN_TYPE_STYLE: Record<ReturnType, string> = {
  return: 'bg-red-50 border border-red-200 text-red-600',
  exchange: 'bg-blue-50 border border-blue-200 text-blue-600',
}

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  addi: 'Addi',
  credit: 'Fiado',
}

const PAYMENT_ICON: Record<PaymentMethod, React.ReactNode> = {
  cash: <Banknote size={12} />,
  card: <CreditCard size={12} />,
  transfer: <ArrowLeftRight size={12} />,
  addi: <Smartphone size={12} />,
  credit: <HandCoins size={12} />,
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-16 w-16 text-xl' }
  return (
    <div
      className={`shrink-0 flex items-center justify-center rounded-full font-semibold text-white ${dims[size]}`}
      style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)' }}
    >
      {initials(name)}
    </div>
  )
}

// ── CustomerFormModal ─────────────────────────────────────────────────────────

type ModalMode = { type: 'new' } | { type: 'edit'; profile: CustomerProfile }

interface CustomerFormModalProps {
  mode: ModalMode
  onClose: () => void
}

function CustomerFormModal({ mode, onClose }: CustomerFormModalProps) {
  const initial = mode.type === 'edit' ? mode.profile : null
  const [form, setForm] = useState<FormValues>({
    full_name: initial?.full_name ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    document_id: initial?.document_id ?? '',
    notes: initial?.notes ?? '',
  })
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({})

  const createCustomer = useCreateCustomer()
  const updateCustomer = useUpdateCustomer()
  const isPending = createCustomer.isPending || updateCustomer.isPending

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const setField = useCallback(
    <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
      setForm((f) => ({ ...f, [key]: value }))
      setErrors((e) => ({ ...e, [key]: undefined }))
    },
    [],
  )

  const handleSubmit = () => {
    const result = customerSchema.safeParse(form)
    if (!result.success) {
      const errs: Partial<Record<keyof FormValues, string>> = {}
      for (const issue of result.error.issues) {
        errs[issue.path[0] as keyof FormValues] = issue.message
      }
      setErrors(errs)
      return
    }
    if (mode.type === 'new') {
      createCustomer.mutate(result.data, { onSuccess: onClose })
    } else {
      updateCustomer.mutate(
        { id: mode.profile.id, data: result.data },
        { onSuccess: onClose },
      )
    }
  }

  const title = mode.type === 'new' ? 'Nuevo cliente' : 'Editar cliente'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.5)] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-[520px] rounded-2xl bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2
              className="tracking-[-0.025em]"
              style={{
                fontFamily: 'Bricolage Grotesque, sans-serif',
                fontSize: 22,
                fontWeight: 600,
              }}
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-[#737373]">
              {mode.type === 'new'
                ? 'Registra el cliente para llevar historial de compras.'
                : 'Actualiza los datos del cliente.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] text-[#525252] hover:bg-[#ebe9e6]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          {/* Nombre */}
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Nombre completo *
            </label>
            <input
              value={form.full_name}
              onChange={(e) => setField('full_name', e.target.value)}
              placeholder="Ej. María González"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none transition focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]"
            />
            {errors.full_name && (
              <p className="mt-1 text-[11px] text-red-500">{errors.full_name}</p>
            )}
          </div>

          {/* Teléfono */}
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Teléfono *
            </label>
            <input
              value={form.phone}
              onChange={(e) => setField('phone', e.target.value)}
              placeholder="Ej. 3001234567"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none transition focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]"
            />
            {errors.phone && (
              <p className="mt-1 text-[11px] text-red-500">{errors.phone}</p>
            )}
          </div>

          {/* Email + Documento */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[.05em] text-[#737373]">
                Email
              </label>
              <input
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                placeholder="correo@ejemplo.com"
                className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none transition focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]"
              />
              {errors.email && (
                <p className="mt-1 text-[11px] text-red-500">{errors.email}</p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[.05em] text-[#737373]">
                Documento
              </label>
              <input
                value={form.document_id}
                onChange={(e) => setField('document_id', e.target.value)}
                placeholder="Cédula o pasaporte"
                className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none transition focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]"
              />
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Notas internas
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder="Información interna sobre este cliente…"
              rows={3}
              className="w-full rounded-lg border border-[#ebe9e6] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a] resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex gap-3 border-t border-[#f5f4f1] pt-5">
          <button
            onClick={onClose}
            className="h-[42px] flex-1 rounded-lg border border-[#ebe9e6] text-sm font-medium text-[#404040] hover:bg-[#f8f7f5]"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="h-[42px] flex-1 rounded-lg bg-[#06b6d4] text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] transition hover:bg-[#0891b2] disabled:opacity-50"
          >
            {isPending
              ? 'Guardando…'
              : mode.type === 'new'
                ? 'Crear cliente'
                : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── NotesEditor ───────────────────────────────────────────────────────────────

function NotesEditor({
  customerId,
  notes,
}: {
  customerId: string
  notes: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(notes ?? '')
  const originalRef = useRef(notes ?? '')
  const updateCustomer = useUpdateCustomer()

  useEffect(() => {
    setValue(notes ?? '')
    originalRef.current = notes ?? ''
  }, [notes])

  const handleBlur = () => {
    setEditing(false)
    if (value !== originalRef.current) {
      updateCustomer.mutate({ id: customerId, data: { notes: value } })
      originalRef.current = value
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setValue(originalRef.current)
      setEditing(false)
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <FileText size={13} className="text-[#a8a29e]" />
        <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
          Notas internas
        </p>
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="Escribe una nota sobre este cliente…"
          className="w-full rounded-lg border border-[#06b6d4] bg-white px-3 py-2.5 text-sm outline-none shadow-[0_0_0_3px_#06b6d41a] resize-none placeholder:text-[#a8a29e]"
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          className="min-h-[72px] cursor-text rounded-lg border border-[#ebe9e6] bg-[#fafaf9] px-3 py-2.5 text-sm text-[#525252] hover:border-[#d6d3d1] hover:bg-[#f5f4f1]"
        >
          {value || (
            <span className="text-[#a8a29e]">Clic para agregar una nota…</span>
          )}
        </div>
      )}
    </div>
  )
}

// ── OrderRow ──────────────────────────────────────────────────────────────────

function OrderRow({ order }: { order: CustomerOrder }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border-b border-[#f5f4f1] last:border-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-[#f8f7f5]"
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-[#a8a29e] transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <div className="flex flex-1 items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[#1a1a1a]">
              {fmtDateShort(order.created_at)}
            </p>
            <p className="mt-0.5 text-[11px] text-[#a8a29e]">
              {order.items.length} ítem{order.items.length !== 1 ? 's' : ''}{' '}
              ·{' '}
              <span className="inline-flex items-center gap-1">
                {PAYMENT_ICON[order.payment_method]}
                {PAYMENT_LABEL[order.payment_method]}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {order.has_returns && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                <RotateCcw size={9} /> Con devolución
              </span>
            )}
            <OrderStatusBadge status={order.status} />
            <span className="font-mono text-sm font-semibold text-[#1a1a1a] tabular-nums">
              {fmtCOP(order.total)}
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="bg-[#f8f7f5] px-5 pb-4">
          <div className="divide-y divide-[#f0efed]">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-[#525252]">
                  {item.product_name}
                  {item.size ? ` T.${item.size}` : ''}
                  {item.color ? ` · ${item.color}` : ''}
                  {' '}× {item.qty}
                </span>
                <span className="font-mono text-[#1a1a1a]">
                  {fmtCOP(item.unit_price * item.qty)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── ReturnRow ─────────────────────────────────────────────────────────────────

function ReturnRow({ ret }: { ret: CustomerReturn }) {
  return (
    <div className="flex items-center justify-between border-b border-[#f5f4f1] px-5 py-3.5 last:border-0">
      <div>
        <p className="text-sm font-medium text-[#1a1a1a]">
          {fmtDateShort(ret.created_at)}
        </p>
        <p className="mt-0.5 text-[11px] text-[#a8a29e]">
          Orden #{ret.original_order_id.slice(-6).toUpperCase()}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${RETURN_TYPE_STYLE[ret.type]}`}
        >
          {RETURN_TYPE_LABEL[ret.type]}
        </span>
        <span className="font-mono text-sm font-semibold text-[#1a1a1a] tabular-nums">
          {fmtCOP(ret.refund_total)}
        </span>
      </div>
    </div>
  )
}

// ── ProfileView ───────────────────────────────────────────────────────────────

type ProfileTab = 'orders' | 'returns' | 'layaways' | 'equipos'

// ── Layaways tab helpers ──────────────────────────────────────────────────────

const LAYAWAY_STATUS_META: Record<
  LayawayStatus,
  { label: string; classes: string; icon: React.ElementType }
> = {
  active:    { label: 'Activo',     classes: 'bg-cyan-50 border border-cyan-200 text-cyan-700',   icon: Clock },
  completed: { label: 'Completado', classes: 'bg-emerald-50 border border-emerald-200 text-emerald-700', icon: CheckCircle },
  cancelled: { label: 'Cancelado',  classes: 'bg-stone-50 border border-stone-200 text-stone-600',      icon: Ban },
  expired:   { label: 'Vencido',    classes: 'bg-red-50 border border-red-200 text-red-700',            icon: AlertTriangle },
}

function LayawayRow({ row }: { row: CustomerLayawayRow }) {
  const navigate = useNavigate()
  const meta = LAYAWAY_STATUS_META[row.status]
  const Icon = meta.icon
  const pct = row.total > 0
    ? Math.min(100, Math.round((row.paid_amount / row.total) * 100))
    : 0
  return (
    <button
      onClick={() => navigate(`/separados?id=${row.id}`)}
      className="flex w-full items-center gap-3 border-b border-[#f5f4f1] px-6 py-3 text-left transition-colors last:border-0 hover:bg-[#fafaf9]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-50 font-mono text-[11px] font-bold text-cyan-700">
        #{row.layaway_number}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-[#1a1a1a]">
            {fmtCOP(row.total)}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${meta.classes}`}
          >
            <Icon size={10} /> {meta.label}
          </span>
        </div>
        <p className="mt-0.5 text-[11.5px] text-[#737373]">
          {fmtDateShort(row.created_at)} · {row.items_count} ítem
          {row.items_count !== 1 ? 's' : ''} · vence{' '}
          {fmtDate(row.expires_at)}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f5f4f1]">
            <div
              className="h-full rounded-full bg-cyan-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-[11px] text-[#525252]">
            {fmtCOP(row.paid_amount)} / {fmtCOP(row.total)}
          </span>
        </div>
      </div>
      <ChevronRight size={14} className="shrink-0 text-[#a8a29e]" />
    </button>
  )
}

function LayawaysTabContent({ customerId }: { customerId: string }) {
  const { data: rows = [], isLoading } = useCustomerLayaways(customerId)

  if (isLoading) {
    return (
      <div className="space-y-px p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f5f4f1]">
          <Bookmark size={20} className="text-[#a8a29e]" />
        </div>
        <p className="text-sm text-[#737373]">Sin separados registrados</p>
      </div>
    )
  }

  return <div>{rows.map((row) => <LayawayRow key={row.id} row={row} />)}</div>
}

// E2 — equipos serializados que el cliente posee HOY (unidades vendidas y
// ligadas a sus órdenes). Cada uno abre su ficha (E1).
function EquiposTabContent({ customerId }: { customerId: string }) {
  const { data: units = [], isLoading } = useCustomerUnits(customerId)
  const { can } = usePermissions()
  const [detailUnitId, setDetailUnitId] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="space-y-px p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    )
  }
  if (units.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f5f4f1]">
          <Smartphone size={20} className="text-[#a8a29e]" />
        </div>
        <p className="text-sm text-[#737373]">Sin equipos comprados</p>
      </div>
    )
  }

  return (
    <div>
      {units.map((u) => {
        const label = u.variant_label ?? ''
        return (
          <button
            key={u.unit_id}
            onClick={() => setDetailUnitId(u.unit_id)}
            className="flex w-full items-center gap-3 border-b border-[#f5f4f1] px-6 py-3 text-left hover:bg-[#fafaf9]"
          >
            <Smartphone size={16} className="shrink-0 text-cyan-500" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[#1a1a1a]">
                {u.name}
                {label ? <span className="text-[#a8a29e]"> · {label}</span> : null}
              </p>
              <p className="font-mono text-[12px] text-cyan-700">{u.serial}</p>
            </div>
            <div className="ml-auto text-right text-[11px] text-[#a8a29e]">
              {u.order_number != null && <p>Orden #{u.order_number}</p>}
              {u.bought_at && <p>{fmtDateShort(u.bought_at)}</p>}
            </div>
          </button>
        )
      })}
      {detailUnitId && (
        <UnitDetailModal
          unitId={detailUnitId}
          canSeeCost={can('inventario.gestionar')}
          onClose={() => setDetailUnitId(null)}
        />
      )}
    </div>
  )
}

function ProfileView({
  profile,
  onEdit,
}: {
  profile: CustomerProfile
  onEdit: () => void
}) {
  const [tab, setTab] = useState<ProfileTab>('orders')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[#ebe9e6] bg-white px-6 py-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={profile.full_name} size="lg" />
            <div>
              <h2
                className="tracking-[-0.02em]"
                style={{
                  fontFamily: 'Bricolage Grotesque, sans-serif',
                  fontSize: 22,
                  fontWeight: 600,
                }}
              >
                {profile.full_name}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-[#737373]">
                {profile.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone size={12} className="text-[#a8a29e]" />
                    {profile.phone}
                  </span>
                )}
                {profile.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail size={12} className="text-[#a8a29e]" />
                    {profile.email}
                  </span>
                )}
                {profile.document_id && (
                  <span className="flex items-center gap-1.5">
                    <CreditCard size={12} className="text-[#a8a29e]" />
                    {profile.document_id}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onEdit}
            className="flex h-9 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-3.5 text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
          >
            <Edit2 size={13} /> Editar
          </button>
        </div>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            {
              label: 'Total gastado',
              value: fmtCOP(profile.total_spent),
              mono: true,
            },
            {
              label: 'Compras',
              value: profile.order_count.toString(),
              mono: false,
            },
            {
              label: 'Última visita',
              value: profile.last_visit ? fmtRelative(profile.last_visit) : '—',
              mono: false,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3"
            >
              <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
                {stat.label}
              </p>
              <p
                className={`mt-1 text-lg font-semibold leading-none tracking-[-0.02em] tabular-nums text-[#1a1a1a] ${stat.mono ? 'font-mono' : ''}`}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#ebe9e6] bg-white px-6">
        {(
          [
            { id: 'orders',    label: 'Compras',      icon: ShoppingBag, count: profile.orders.length  },
            { id: 'returns',   label: 'Devoluciones', icon: RotateCcw,   count: profile.returns.length },
            { id: 'layaways',  label: 'Separados',    icon: Bookmark,    count: null                    },
            { id: 'equipos',   label: 'Equipos',      icon: Smartphone,  count: null                    },
          ] as { id: ProfileTab; label: string; icon: React.ElementType; count: number | null }[]
        ).map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              tab === id
                ? 'border-[#06b6d4] text-[#06b6d4]'
                : 'border-transparent text-[#737373] hover:text-[#1a1a1a]'
            }`}
          >
            <Icon size={14} />
            {label}
            {count !== null && (
              <span
                className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  tab === id ? 'bg-[#06b6d41a] text-[#06b6d4]' : 'bg-[#f5f4f1] text-[#a8a29e]'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content + Notes */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'orders' && (
          <div className="rounded-none border-b border-[#ebe9e6] bg-white">
            {profile.orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f5f4f1]">
                  <ShoppingBag size={20} className="text-[#a8a29e]" />
                </div>
                <p className="text-sm text-[#737373]">Sin compras registradas</p>
              </div>
            ) : (
              profile.orders.map((order) => <OrderRow key={order.id} order={order} />)
            )}
          </div>
        )}

        {tab === 'returns' && (
          <div className="rounded-none border-b border-[#ebe9e6] bg-white">
            {profile.returns.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f5f4f1]">
                  <RotateCcw size={20} className="text-[#a8a29e]" />
                </div>
                <p className="text-sm text-[#737373]">Sin devoluciones registradas</p>
              </div>
            ) : (
              profile.returns.map((ret) => <ReturnRow key={ret.id} ret={ret} />)
            )}
          </div>
        )}

        {tab === 'layaways' && (
          <div className="rounded-none border-b border-[#ebe9e6] bg-white">
            <LayawaysTabContent customerId={profile.id} />
          </div>
        )}

        {tab === 'equipos' && (
          <div className="rounded-none border-b border-[#ebe9e6] bg-white">
            <EquiposTabContent customerId={profile.id} />
          </div>
        )}

        {/* Notes */}
        <div className="bg-white px-6 py-5">
          <NotesEditor customerId={profile.id} notes={profile.notes} />
        </div>
      </div>
    </div>
  )
}

// ── ProfileEmpty ──────────────────────────────────────────────────────────────

function ProfileEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f5f4f1]">
        <User size={24} className="text-[#a8a29e]" />
      </div>
      <div>
        <p className="text-sm font-medium text-[#525252]">Selecciona un cliente</p>
        <p className="mt-1 text-xs text-[#a8a29e]">
          Elige un cliente de la lista para ver su perfil e historial.
        </p>
      </div>
    </div>
  )
}

// ── CustomerListSkeleton ──────────────────────────────────────────────────────

function CustomerListSkeleton() {
  return (
    <div className="divide-y divide-[#f5f4f1]">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-32 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
          </div>
          <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

// ── CustomerListItemRow ───────────────────────────────────────────────────────

function CustomerListItemRow({
  customer,
  selected,
  onClick,
}: {
  customer: CustomerListItem
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#f8f7f5] ${
        selected ? 'bg-[#06b6d41a]' : ''
      }`}
    >
      <Avatar name={customer.full_name} size="md" />
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm font-medium ${selected ? 'text-[#06b6d4]' : 'text-[#1a1a1a]'}`}
        >
          {customer.full_name}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-[#a8a29e]">
          {customer.phone ?? 'Sin teléfono'}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-xs font-semibold tabular-nums text-[#525252]">
          {fmtCOP(customer.total_spent)}
        </p>
        {customer.last_visit && (
          <p className="mt-0.5 text-[10px] text-[#a8a29e]">
            {fmtRelative(customer.last_visit)}
          </p>
        )}
      </div>
    </button>
  )
}

// ── CustomersPage ─────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const [listQuery, setListQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalMode | null>(null)

  const { data: customers = [], isLoading } = useCustomerList(listQuery)
  const { data: profile, isLoading: profileLoading } = useCustomerProfile(selectedId)

  const handleEdit = useCallback(() => {
    if (profile) setModal({ type: 'edit', profile })
  }, [profile])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <header
        className="flex shrink-0 items-center justify-between border-b border-[#ebe9e6] px-6"
        style={{ height: 64, background: '#fdfcfb' }}
      >
        <h1
          className="tracking-[-0.02em]"
          style={{
            fontFamily: 'Bricolage Grotesque, sans-serif',
            fontSize: 20,
            fontWeight: 600,
          }}
        >
          Clientes
        </h1>
        <button
          onClick={() => setModal({ type: 'new' })}
          className="flex h-9 items-center gap-2 rounded-lg bg-[#06b6d4] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-[#0891b2]"
        >
          <Plus size={15} /> Nuevo cliente
        </button>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden" style={{ background: '#f8f7f5' }}>
        {/* Left panel — list */}
        <aside className="flex w-[35%] shrink-0 flex-col overflow-hidden border-r border-[#ebe9e6] bg-white">
          {/* Search */}
          <div className="border-b border-[#ebe9e6] px-4 py-3">
            <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-3 py-2 focus-within:border-[#06b6d4] focus-within:shadow-[0_0_0_3px_#06b6d41a]">
              <Search size={14} className="shrink-0 text-[#a8a29e]" />
              <input
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder="Nombre, teléfono o documento…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#a8a29e]"
              />
              {listQuery && (
                <button
                  onClick={() => setListQuery('')}
                  className="text-[#a8a29e] hover:text-[#525252]"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Count */}
          {!isLoading && (
            <div className="border-b border-[#f5f4f1] px-4 py-2">
              <p className="text-[11px] text-[#a8a29e]">
                {customers.length} {customers.length === 1 ? 'cliente' : 'clientes'}
                {listQuery ? ` · "${listQuery}"` : ''}
              </p>
            </div>
          )}

          {/* List */}
          <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-[#f5f4f1]">
            {isLoading ? (
              <CustomerListSkeleton />
            ) : customers.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 p-8 text-center h-full">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f5f4f1]">
                  {listQuery ? (
                    <Search size={20} className="text-[#a8a29e]" />
                  ) : (
                    <Users size={20} className="text-[#a8a29e]" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-[#525252]">
                    {listQuery ? 'Sin resultados' : 'Sin clientes aún'}
                  </p>
                  <p className="mt-1 text-[11px] text-[#a8a29e]">
                    {listQuery
                      ? `No se encontró ningún cliente para "${listQuery}".`
                      : 'Crea el primer cliente con el botón "Nuevo cliente".'}
                  </p>
                </div>
              </div>
            ) : (
              customers.map((c) => (
                <CustomerListItemRow
                  key={c.id}
                  customer={c}
                  selected={c.id === selectedId}
                  onClick={() => setSelectedId(c.id)}
                />
              ))
            )}
          </div>
        </aside>

        {/* Right panel — profile */}
        <main className="min-h-0 flex-1 overflow-hidden bg-white">
          {profileLoading && selectedId ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#06b6d4] border-t-transparent" />
            </div>
          ) : profile ? (
            <ProfileView key={profile.id} profile={profile} onEdit={handleEdit} />
          ) : (
            <ProfileEmpty />
          )}
        </main>
      </div>

      {/* Modal */}
      {modal && (
        <CustomerFormModal mode={modal} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
