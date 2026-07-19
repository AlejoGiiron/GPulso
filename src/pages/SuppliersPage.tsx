import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Truck,
  Building2,
  Plus,
  Search,
  X,
  Edit2,
  FileText,
  CreditCard,
  AlertTriangle,
  Power,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import {
  useSupplierList,
  useSupplierDetail,
  type SupplierListItem,
  type SupplierInvoiceRow,
} from '@/hooks/useSuppliers'
import {
  useInvoiceList,
  usePendingInvoices,
  type InvoiceListRow,
} from '@/hooks/usePurchaseInvoices'
import { useSupplierBalances } from '@/hooks/useReports'
import { useToggleSupplierActive } from '@/hooks/useSupplierMutations'
import { fmtCOP } from '@/lib/formatters'
import {
  INVOICE_STATUS_META,
  fmtInvoiceDate,
  daysUntilDue,
} from '@/lib/invoices'
import type { InvoiceStatus, Supplier } from '@/types/database.types'
import SupplierModal from '@/components/suppliers/SupplierModal'
import NewInvoiceModal from '@/components/suppliers/NewInvoiceModal'
import InvoiceDetailModal from '@/components/suppliers/InvoiceDetailModal'
import PaymentModal from '@/components/suppliers/PaymentModal'

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const dims = { md: 'h-10 w-10 text-sm', lg: 'h-16 w-16 text-xl' }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dims[size]}`}
      style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)' }}
    >
      {initials(name) || <Building2 size={size === 'lg' ? 24 : 16} />}
    </div>
  )
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const meta = INVOICE_STATUS_META[status]
  const Icon = meta.icon
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.classes}`}
    >
      <Icon size={11} /> {meta.label}
    </span>
  )
}

type Tab = 'suppliers' | 'invoices' | 'payables'

interface PaymentTarget {
  id: string
  number: string
  pending: number
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
  const [searchParams] = useSearchParams()
  const supplierParam = searchParams.get('supplier')
  const tabParam = searchParams.get('tab')

  const [tab, setTab] = useState<Tab>(() => {
    if (tabParam === 'payables' || tabParam === 'invoices' || tabParam === 'suppliers') {
      return tabParam
    }
    return supplierParam ? 'suppliers' : 'suppliers'
  })

  // Modales compartidos
  const [supplierModal, setSupplierModal] = useState<
    { mode: 'new' } | { mode: 'edit'; supplier: Supplier } | null
  >(null)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<PaymentTarget | null>(null)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header + tabs */}
      <header
        className="flex shrink-0 items-center justify-between border-b border-[#ebe9e6] px-6"
        style={{ height: 64, background: '#fdfcfb' }}
      >
        <div className="flex items-center gap-5">
          <h1
            className="flex items-center gap-2 tracking-[-0.02em]"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 20, fontWeight: 600 }}
          >
            <Truck size={20} className="text-[#06b6d4]" /> Compras
          </h1>
          <nav className="flex items-center gap-1">
            {(
              [
                { id: 'suppliers', label: 'Proveedores' },
                { id: 'invoices', label: 'Facturas' },
                { id: 'payables', label: 'Cuentas por pagar' },
              ] as { id: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  tab === t.id
                    ? 'bg-[#06b6d41a] text-[#06b6d4]'
                    : 'text-[#737373] hover:bg-[#f5f4f1] hover:text-[#1a1a1a]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {tab === 'suppliers' && (
          <button
            onClick={() => setSupplierModal({ mode: 'new' })}
            className="flex h-9 items-center gap-2 rounded-lg bg-[#06b6d4] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-[#0891b2]"
          >
            <Plus size={15} /> Nuevo proveedor
          </button>
        )}
        {(tab === 'invoices' || tab === 'payables') && (
          <button
            onClick={() => setShowInvoiceModal(true)}
            className="flex h-9 items-center gap-2 rounded-lg bg-[#06b6d4] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-[#0891b2]"
          >
            <Plus size={15} /> Nueva factura
          </button>
        )}
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden" style={{ background: '#f8f7f5' }}>
        {tab === 'suppliers' && (
          <SuppliersTab
            initialSupplierId={supplierParam}
            onNew={() => setSupplierModal({ mode: 'new' })}
            onEdit={(s) => setSupplierModal({ mode: 'edit', supplier: s })}
            onOpenInvoice={(id) => setDetailInvoiceId(id)}
          />
        )}
        {tab === 'invoices' && (
          <InvoicesTab
            onOpenInvoice={(id) => setDetailInvoiceId(id)}
            onPay={(t) => setPaymentTarget(t)}
          />
        )}
        {tab === 'payables' && (
          <PayablesTab
            onOpenInvoice={(id) => setDetailInvoiceId(id)}
            onPay={(t) => setPaymentTarget(t)}
          />
        )}
      </div>

      {/* Modales */}
      {supplierModal && (
        <SupplierModal
          supplier={supplierModal.mode === 'edit' ? supplierModal.supplier : null}
          onClose={() => setSupplierModal(null)}
        />
      )}
      {showInvoiceModal && (
        <NewInvoiceModal onClose={() => setShowInvoiceModal(false)} />
      )}
      {detailInvoiceId && (
        <InvoiceDetailModal
          invoiceId={detailInvoiceId}
          onClose={() => setDetailInvoiceId(null)}
        />
      )}
      {paymentTarget && (
        <PaymentModal
          invoiceId={paymentTarget.id}
          invoiceNumber={paymentTarget.number}
          pendingAmount={paymentTarget.pending}
          onClose={() => setPaymentTarget(null)}
        />
      )}
    </div>
  )
}

// ── Tab 1: Proveedores ────────────────────────────────────────────────────────

function SuppliersTab({
  initialSupplierId,
  onNew,
  onEdit,
  onOpenInvoice,
}: {
  initialSupplierId?: string | null
  onNew: () => void
  onEdit: (s: Supplier) => void
  onOpenInvoice: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(initialSupplierId ?? null)

  const { data: suppliers = [], isLoading } = useSupplierList({
    search,
    isActive: !showInactive,
  })
  const { data: detail, isLoading: detailLoading } = useSupplierDetail(selectedId)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Lista */}
      <aside className="flex w-[35%] shrink-0 flex-col overflow-hidden border-r border-[#ebe9e6] bg-white">
        <div className="space-y-2 border-b border-[#ebe9e6] px-4 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-3 py-2 focus-within:border-[#06b6d4] focus-within:shadow-[0_0_0_3px_#06b6d41a]">
            <Search size={14} className="shrink-0 text-[#a8a29e]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, NIT o teléfono…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#a8a29e]"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-[#a8a29e] hover:text-[#525252]">
                <X size={13} />
              </button>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[#737373]">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer rounded accent-cyan-500"
            />
            Mostrar inactivos
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="divide-y divide-[#f5f4f1]">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-100" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-32 animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : suppliers.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f5f4f1]">
                <Building2 size={20} className="text-[#a8a29e]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#525252]">
                  {search ? 'Sin resultados' : 'Aún no hay proveedores registrados'}
                </p>
                <p className="mt-1 text-[11px] text-[#a8a29e]">
                  {search ? `No se encontró "${search}".` : 'Crea el primero con el botón de arriba.'}
                </p>
              </div>
              {!search && (
                <button
                  onClick={onNew}
                  className="mt-1 flex items-center gap-1.5 rounded-lg bg-[#06b6d4] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0891b2]"
                >
                  <Plus size={13} /> Nuevo proveedor
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[#f5f4f1]">
              {suppliers.map((s) => (
                <SupplierRow
                  key={s.id}
                  supplier={s}
                  selected={s.id === selectedId}
                  onClick={() => setSelectedId(s.id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Detalle */}
      <main className="min-h-0 flex-1 overflow-hidden bg-white">
        {detailLoading && selectedId ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#06b6d4] border-t-transparent" />
          </div>
        ) : detail ? (
          <SupplierDetailView
            key={detail.supplier.id}
            detail={detail}
            onEdit={() => onEdit(detail.supplier)}
            onOpenInvoice={onOpenInvoice}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#f5f4f1]">
              <Building2 size={24} className="text-[#a8a29e]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#525252]">Selecciona un proveedor</p>
              <p className="mt-1 text-xs text-[#a8a29e]">
                Elige un proveedor de la lista para ver su detalle y facturas.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function SupplierRow({
  supplier,
  selected,
  onClick,
}: {
  supplier: SupplierListItem
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
      <Avatar name={supplier.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`truncate text-sm font-medium ${selected ? 'text-[#06b6d4]' : 'text-[#1a1a1a]'}`}>
            {supplier.name}
          </p>
          {!supplier.is_active && (
            <span className="rounded-full bg-[#f5f4f1] px-1.5 py-0.5 text-[10px] font-semibold text-[#a8a29e]">
              Inactivo
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-[#a8a29e]">
          {supplier.nit ?? 'Sin NIT'}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-xs font-semibold tabular-nums text-[#525252]">
          {fmtCOP(supplier.total_purchased)}
        </p>
        {supplier.pending_amount > 0 && (
          <p className="mt-0.5 font-mono text-[10px] font-semibold tabular-nums text-red-600">
            {fmtCOP(supplier.pending_amount)}
          </p>
        )}
      </div>
    </button>
  )
}

function SupplierDetailView({
  detail,
  onEdit,
  onOpenInvoice,
}: {
  detail: NonNullable<ReturnType<typeof useSupplierDetail>['data']>
  onEdit: () => void
  onOpenInvoice: (id: string) => void
}) {
  const toggleActive = useToggleSupplierActive()
  const s = detail.supplier

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-[#ebe9e6] bg-white px-6 py-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={s.name} size="lg" />
            <div>
              <h2
                className="tracking-[-0.02em]"
                style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 22, fontWeight: 600 }}
              >
                {s.name}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-[#737373]">
                {s.nit && <span className="font-mono">{s.nit}</span>}
                {s.contact_name && <span>{s.contact_name}</span>}
                {s.phone && <span>{s.phone}</span>}
                {s.email && <span>{s.email}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                toggleActive.mutate({ id: s.id, isActive: s.is_active })
              }
              className={`flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium ${
                s.is_active
                  ? 'border-[#ebe9e6] bg-white text-[#525252] hover:bg-[#f8f7f5]'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              <Power size={13} /> {s.is_active ? 'Activo' : 'Inactivo'}
            </button>
            <button
              onClick={onEdit}
              className="flex h-9 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-3.5 text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
            >
              <Edit2 size={13} /> Editar
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            { label: 'Total comprado', value: fmtCOP(detail.total_purchased), tone: '#1a1a1a' },
            {
              label: 'Pendiente',
              value: fmtCOP(detail.pending_amount),
              tone: detail.pending_amount > 0 ? '#dc2626' : '#1a1a1a',
            },
            {
              label: 'Última factura',
              value: detail.last_invoice_date ? fmtInvoiceDate(detail.last_invoice_date) : '—',
              tone: '#1a1a1a',
            },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
                {stat.label}
              </p>
              <p
                className="mt-1 font-mono text-lg font-semibold leading-none tracking-[-0.02em] tabular-nums"
                style={{ color: stat.tone }}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Facturas */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1a1a1a]">
          <FileText size={15} className="text-[#a8a29e]" /> Facturas ({detail.invoices.length})
        </h3>
        {detail.invoices.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#d6d3d1] bg-[#fafaf9] px-4 py-6 text-center text-sm text-[#a8a29e]">
            Este proveedor aún no tiene facturas.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#ebe9e6]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#fafaf9]">
                  {['# Factura', 'Fecha', 'Total', 'Pagado', 'Saldo', 'Estado'].map((h, i) => (
                    <th
                      key={h}
                      className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373] ${
                        i >= 2 && i <= 4 ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.invoices.map((inv: SupplierInvoiceRow) => (
                  <tr
                    key={inv.id}
                    onClick={() => onOpenInvoice(inv.id)}
                    className="cursor-pointer border-t border-[#f5f4f1] hover:bg-[#f8f7f5]"
                  >
                    <td className="px-3 py-2.5 font-mono font-medium text-[#1a1a1a]">
                      {inv.invoice_number}
                    </td>
                    <td className="px-3 py-2.5 text-[#525252]">{fmtInvoiceDate(inv.invoice_date)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtCOP(inv.total)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-600">
                      {fmtCOP(inv.paid_amount)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-red-600">
                      {inv.pending_amount > 0 ? fmtCOP(inv.pending_amount) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={inv.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab 2: Facturas ───────────────────────────────────────────────────────────

function InvoicesTab({
  onOpenInvoice,
  onPay,
}: {
  onOpenInvoice: (id: string) => void
  onPay: (t: PaymentTarget) => void
}) {
  const [search, setSearch] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  const { data: allSuppliers = [] } = useSupplierList({ isActive: false })
  const { data, isLoading, isFetching } = useInvoiceList({
    search,
    supplierId,
    status,
    dateFrom,
    dateTo,
    page,
  })

  const rows = data?.rows ?? []

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Filtros */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#ebe9e6] bg-white px-6 py-3">
        <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-3 py-2 focus-within:border-[#06b6d4]">
          <Search size={14} className="shrink-0 text-[#a8a29e]" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="N° de factura…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#a8a29e]"
          />
        </div>
        <select
          value={supplierId}
          onChange={(e) => {
            setSupplierId(e.target.value)
            setPage(1)
          }}
          className="h-10 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-[#06b6d4]"
        >
          <option value="">Todos los proveedores</option>
          {allSuppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as InvoiceStatus | 'all')
            setPage(1)
          }}
          className="h-10 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-[#06b6d4]"
        >
          <option value="all">Todas</option>
          <option value="pending">Pendientes</option>
          <option value="partial">Parciales</option>
          <option value="paid">Pagadas</option>
          <option value="cancelled">Canceladas</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value)
            setPage(1)
          }}
          className="h-10 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-[#06b6d4]"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value)
            setPage(1)
          }}
          className="h-10 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-[#06b6d4]"
        />
      </div>

      {/* Tabla */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f5f4f1]">
              <FileText size={22} className="text-[#a8a29e]" />
            </div>
            <p className="text-sm text-[#737373]">No hay facturas con estos filtros.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#ebe9e6] bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#fafaf9]">
                  {['# Factura', 'Fecha', 'Proveedor', 'Total', 'Pagado', 'Saldo', 'Vence', 'Estado', ''].map(
                    (h, i) => (
                      <th
                        key={h || `a${i}`}
                        className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373] ${
                          i >= 3 && i <= 5 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => (
                  <InvoiceTableRow
                    key={inv.id}
                    inv={inv}
                    onOpen={() => onOpenInvoice(inv.id)}
                    onPay={() =>
                      onPay({
                        id: inv.id,
                        number: inv.invoice_number,
                        pending: inv.pending_amount,
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Paginación */}
      {data && data.pageCount > 1 && (
        <div className="flex shrink-0 items-center justify-between border-t border-[#ebe9e6] bg-white px-6 py-3">
          <p className="text-xs text-[#a8a29e]">
            {data.total} facturas · página {data.page} de {data.pageCount}
            {isFetching ? ' · actualizando…' : ''}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex h-8 items-center gap-1 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-[#f8f7f5] disabled:opacity-40"
            >
              <ChevronLeft size={13} /> Anterior
            </button>
            <button
              disabled={page >= data.pageCount}
              onClick={() => setPage((p) => Math.min(data.pageCount, p + 1))}
              className="flex h-8 items-center gap-1 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-[#f8f7f5] disabled:opacity-40"
            >
              Siguiente <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function InvoiceTableRow({
  inv,
  onOpen,
  onPay,
}: {
  inv: InvoiceListRow
  onOpen: () => void
  onPay: () => void
}) {
  const overdue = inv.days_overdue != null && inv.status !== 'paid'
  const canPay = inv.status === 'pending' || inv.status === 'partial'
  return (
    <tr
      onClick={onOpen}
      className={`cursor-pointer border-t border-[#f5f4f1] hover:bg-[#f8f7f5] ${
        overdue ? 'bg-red-50/50' : ''
      }`}
    >
      <td className="px-3 py-2.5 font-mono font-medium text-[#1a1a1a]">{inv.invoice_number}</td>
      <td className="px-3 py-2.5 text-[#525252]">{fmtInvoiceDate(inv.invoice_date)}</td>
      <td className="px-3 py-2.5 text-[#525252]">{inv.supplier_name}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtCOP(inv.total)}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-600">
        {fmtCOP(inv.paid_amount)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-red-600">
        {inv.pending_amount > 0 ? fmtCOP(inv.pending_amount) : '—'}
      </td>
      <td className="px-3 py-2.5">
        {inv.due_date ? (
          <span className={overdue ? 'font-semibold text-red-600' : 'text-[#525252]'}>
            {fmtInvoiceDate(inv.due_date)}
            {overdue && ` · ${inv.days_overdue}d`}
          </span>
        ) : (
          <span className="text-[#a8a29e]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={inv.status} />
      </td>
      <td className="px-3 py-2.5 text-right">
        {canPay && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPay()
            }}
            className="rounded-md border border-[#ebe9e6] bg-white px-2.5 py-1 text-[11px] font-medium text-[#06b6d4] hover:bg-[#f5f4f1]"
          >
            Pagar
          </button>
        )}
      </td>
    </tr>
  )
}

// ── Tab 3: Cuentas por pagar ──────────────────────────────────────────────────

function PayablesTab({
  onOpenInvoice,
  onPay,
}: {
  onOpenInvoice: (id: string) => void
  onPay: (t: PaymentTarget) => void
}) {
  const { data: invoices = [], isLoading } = usePendingInvoices()
  const { data: balances } = useSupplierBalances()

  const sorted = useMemo(
    () =>
      [...invoices].sort((a, b) => (b.days_overdue ?? -1) - (a.days_overdue ?? -1)),
    [invoices],
  )

  // Vencidas: monto + count desde las facturas (consistente con la tabla).
  // Próximas a vencer (7d) también a nivel factura.
  const invoiceStats = useMemo(() => {
    let overdueAmount = 0
    let overdueCount = 0
    let dueSoonCount = 0
    for (const inv of invoices) {
      if (inv.days_overdue != null) {
        overdueCount += 1
        overdueAmount += inv.pending_amount
      } else {
        const until = daysUntilDue(inv.due_date)
        if (until != null && until <= 7) dueSoonCount += 1
      }
    }
    return { overdueAmount, overdueCount, dueSoonCount }
  }, [invoices])

  // Totales consolidados desde supplier_balance (server-side, proveedores activos).
  const totalDue = balances?.totalPending ?? 0
  const supplierCount = balances?.suppliersWithDebt ?? 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Banner de vencidas */}
      {invoiceStats.overdueCount > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-200 bg-red-50 px-6 py-2.5 text-sm font-medium text-red-700">
          <AlertTriangle size={15} className="shrink-0" />
          Tienes {invoiceStats.overdueCount} factura
          {invoiceStats.overdueCount !== 1 ? 's' : ''} vencida
          {invoiceStats.overdueCount !== 1 ? 's' : ''} por {fmtCOP(invoiceStats.overdueAmount)}
        </div>
      )}

      {/* Cards resumen */}
      <div className="grid shrink-0 grid-cols-4 gap-3 border-b border-[#ebe9e6] bg-white px-6 py-4">
        <SummaryCard label="Total adeudado" value={fmtCOP(totalDue)} tone="#06b6d4" big />
        <SummaryCard label="Facturas vencidas" value={String(invoiceStats.overdueCount)} tone="#dc2626" />
        <SummaryCard label="Por vencer (7 días)" value={String(invoiceStats.dueSoonCount)} tone="#d97706" />
        <SummaryCard label="Proveedores con saldo" value={String(supplierCount)} tone="#1a1a1a" />
      </div>

      {/* Tabla */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <CreditCard size={22} className="text-emerald-500" />
            </div>
            <p className="text-sm text-[#737373]">No hay cuentas pendientes por pagar. 🎉</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#ebe9e6] bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#fafaf9]">
                  {['Proveedor', '# Factura', 'Total', 'Pagado', 'Saldo', 'Vence', 'Días', ''].map(
                    (h, i) => (
                      <th
                        key={h || `a${i}`}
                        className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373] ${
                          i >= 2 && i <= 4 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {sorted.map((inv) => {
                  const until = daysUntilDue(inv.due_date)
                  let daysLabel = '—'
                  let daysClass = 'text-[#a8a29e]'
                  if (inv.days_overdue != null) {
                    daysLabel = `${inv.days_overdue}d vencida`
                    daysClass = 'font-semibold text-red-600'
                  } else if (until != null) {
                    daysLabel = until === 0 ? 'Hoy' : `${until}d`
                    daysClass = until <= 7 ? 'font-semibold text-amber-600' : 'text-[#525252]'
                  }
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => onOpenInvoice(inv.id)}
                      className={`cursor-pointer border-t border-[#f5f4f1] hover:bg-[#f8f7f5] ${
                        inv.days_overdue != null ? 'bg-red-50/50' : ''
                      }`}
                    >
                      <td className="px-3 py-2.5 text-[#1a1a1a]">{inv.supplier_name}</td>
                      <td className="px-3 py-2.5 font-mono text-[#525252]">{inv.invoice_number}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtCOP(inv.total)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-600">
                        {fmtCOP(inv.paid_amount)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-red-600">
                        {fmtCOP(inv.pending_amount)}
                      </td>
                      <td className="px-3 py-2.5 text-[#525252]">
                        {inv.due_date ? fmtInvoiceDate(inv.due_date) : '—'}
                      </td>
                      <td className={`px-3 py-2.5 ${daysClass}`}>
                        <span className="inline-flex items-center gap-1">
                          {inv.days_overdue != null && <AlertTriangle size={11} />}
                          {daysLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onPay({
                              id: inv.id,
                              number: inv.invoice_number,
                              pending: inv.pending_amount,
                            })
                          }}
                          className="rounded-md border border-[#ebe9e6] bg-white px-2.5 py-1 text-[11px] font-medium text-[#06b6d4] hover:bg-[#f5f4f1]"
                        >
                          Pagar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone,
  big,
}: {
  label: string
  value: string
  tone: string
  big?: boolean
}) {
  return (
    <div className="rounded-xl border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
        {label}
      </p>
      <p
        className={`mt-1 font-mono font-semibold leading-none tracking-[-0.02em] tabular-nums ${
          big ? 'text-2xl' : 'text-xl'
        }`}
        style={{ color: tone }}
      >
        {value}
      </p>
    </div>
  )
}
