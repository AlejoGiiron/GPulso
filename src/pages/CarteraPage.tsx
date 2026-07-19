import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { HandCoins, Search, Users, Wallet, X, Clock } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import {
  useCreditBalances,
  useCustomerCredits,
  type CreditBalanceRow,
} from '@/hooks/useCredit'
import { AddCreditPaymentModal } from '@/components/credit/AddCreditPaymentModal'

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
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="rounded-xl border border-[#ebe9e6] bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-xl font-bold ${
          accent ? 'text-amber-700' : 'text-[#1a1a1a]'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

// ── Detalle: fiados de un cliente ─────────────────────────────────────────────

function CustomerDetail({
  customer,
  onChanged,
}: {
  customer: CreditBalanceRow
  onChanged: () => void
}) {
  const { data: credits = [], isLoading } = useCustomerCredits(customer.customer_id)
  const [payTarget, setPayTarget] = useState<CustomerCreditRowLite | null>(null)

  return (
    <div className="flex h-full flex-col">
      {/* Header del cliente */}
      <div className="border-b border-[#ebe9e6] bg-white px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)' }}
            >
              {initials(customer.customer_name)}
            </div>
            <div>
              <p className="text-[15px] font-semibold text-[#1a1a1a]">
                {customer.customer_name}
              </p>
              {customer.phone && (
                <p className="text-[12px] text-[#737373]">{customer.phone}</p>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Debe
            </p>
            <p className="font-mono text-2xl font-bold text-amber-700">
              {fmtCOP(customer.pending_amount)}
            </p>
          </div>
        </div>
      </div>

      {/* Lista de fiados abiertos */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
          Fiados abiertos ({credits.length})
        </p>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : credits.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-[#a8a29e]">
            <HandCoins size={26} />
            <p className="text-sm">Sin fiados con saldo</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {credits.map((c) => {
              const paidPct =
                c.total > 0 ? Math.min(100, Math.round((c.paid_amount / c.total) * 100)) : 0
              const age = daysAgo(c.created_at)
              return (
                <div
                  key={c.id}
                  className="rounded-xl border border-[#ebe9e6] bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[13px] font-bold text-[#1a1a1a]">
                        #{c.order_number}
                      </p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[#737373]">
                        <Clock size={10} /> {fmtDate(c.created_at)} · hace {age}d
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        setPayTarget({
                          id: c.id,
                          order_number: c.order_number,
                          total: c.total,
                          paid_amount: c.paid_amount,
                        })
                      }
                      className="flex h-8 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-xs font-semibold text-white hover:bg-cyan-700"
                    >
                      <Wallet size={13} /> Abonar
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[#a8a29e]">Total</p>
                      <p className="font-mono text-[12.5px] font-semibold text-[#1a1a1a]">
                        {fmtCOP(c.total)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[#a8a29e]">Pagado</p>
                      <p className="font-mono text-[12.5px] font-semibold text-[#525252]">
                        {fmtCOP(c.paid_amount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-[#a8a29e]">Saldo</p>
                      <p className="font-mono text-[12.5px] font-bold text-amber-700">
                        {fmtCOP(c.balance)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f5f4f1]">
                    <div
                      className="h-full rounded-full bg-cyan-500"
                      style={{ width: `${paidPct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {payTarget && (
        <AddCreditPaymentModal
          order={payTarget}
          onClose={() => setPayTarget(null)}
          onDone={() => {
            setPayTarget(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

interface CustomerCreditRowLite {
  id: string
  order_number: number
  total: number
  paid_amount: number
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function CarteraPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data, isLoading, refetch } = useCreditBalances()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const balances = useMemo(() => data?.balances ?? [], [data])

  // Deep-link ?customer=id → preselección.
  useEffect(() => {
    const c = searchParams.get('customer')
    if (c) {
      setSelectedId(c)
      searchParams.delete('customer')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return balances
    return balances.filter(
      (b) =>
        b.customer_name.toLowerCase().includes(q) ||
        (b.phone ?? '').toLowerCase().includes(q),
    )
  }, [balances, query])

  const selected = balances.find((b) => b.customer_id === selectedId) ?? null

  return (
    <div className="flex h-full flex-col bg-[#f8f7f5]">
      {/* Header + resumen */}
      <div className="border-b border-[#ebe9e6] bg-white px-6 pb-4 pt-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
            <HandCoins size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight text-[#1a1a1a]">
              Cartera
            </h1>
            <p className="text-[12.5px] text-[#737373]">
              Cuentas por cobrar — fiados con saldo pendiente
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <SummaryCard
            label="Total por cobrar"
            value={fmtCOP(data?.totalPending ?? 0)}
            accent
          />
          <SummaryCard
            label="Clientes con deuda"
            value={String(data?.customersWithDebt ?? 0)}
          />
          <SummaryCard label="Fiados abiertos" value={String(data?.openCredits ?? 0)} />
        </div>
      </div>

      {/* Cuerpo 35/65 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(320px,35%)_1fr]">
        {/* Lista */}
        <div className="flex min-h-0 flex-col border-r border-[#ebe9e6] bg-white">
          <div className="border-b border-[#f5f4f1] p-3">
            <div className="flex items-center gap-2 rounded-lg border border-[#ebe9e6] bg-[#fafaf9] px-3 py-2 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
              <Search size={15} className="shrink-0 text-[#737373]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar cliente por nombre o teléfono…"
                className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-[#a8a29e]"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-[#737373]">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-[#a8a29e]">
                <Users size={26} />
                <p className="text-sm">
                  {balances.length === 0
                    ? 'No hay clientes con deuda'
                    : 'Sin resultados para la búsqueda'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((b) => {
                  const active = b.customer_id === selectedId
                  return (
                    <button
                      key={b.customer_id}
                      onClick={() => setSelectedId(b.customer_id)}
                      className={`w-full rounded-xl border p-3 text-left transition-all ${
                        active
                          ? 'border-cyan-500 bg-cyan-50/40 shadow-[0_0_0_3px_rgba(139,92,246,0.1)]'
                          : 'border-[#ebe9e6] bg-white hover:border-cyan-300'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                          style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)' }}
                        >
                          {initials(b.customer_name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-[#1a1a1a]">
                            {b.customer_name}
                          </p>
                          <p className="text-[11px] text-[#737373]">
                            {b.open_credits} fiado{b.open_credits !== 1 ? 's' : ''} abierto
                            {b.open_credits !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-[13px] font-bold text-amber-700">
                          {fmtCOP(b.pending_amount)}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Detalle */}
        <div className="min-h-0 overflow-hidden">
          {selected ? (
            <CustomerDetail customer={selected} onChanged={() => void refetch()} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[#a8a29e]">
              <HandCoins size={34} />
              <p className="text-sm">Selecciona un cliente para ver sus fiados</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
