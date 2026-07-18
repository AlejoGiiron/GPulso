import { useState, useRef } from 'react'
import {
  Wallet,
  ChevronLeft,
  ChevronRight,
  Printer,
  X,
  CheckCircle,
  Receipt,
} from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import {
  useShiftHistory,
  useStoreCashiers,
  SHIFT_HISTORY_PAGE_SIZE,
  type ShiftHistoryFilters,
  type ShiftHistoryRow,
} from '@/hooks/useShiftHistory'
import { useShiftClosing } from '@/hooks/useShiftClosing'
import { useMyStores } from '@/hooks/useStores'
import {
  CashShiftReceipt,
  CashShiftReceiptPrint,
} from '@/components/cash/CashShiftReceipt'
import {
  DateRangeFilter,
  type DateRangeValue,
} from '@/components/ui/DateRangeFilter'
import { resolveDateRange, type DateRangePreset } from '@/lib/dateRange'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

function DifferenceBadge({ diff }: { diff: number }) {
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
        <CheckCircle size={10} /> Cuadrado
      </span>
    )
  }
  if (diff > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
        +{fmtCOP(diff)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
      {fmtCOP(diff)}
    </span>
  )
}

// ── Reprint Modal ─────────────────────────────────────────────────────────────

interface ReprintReceiptModalProps {
  shiftId: string
  countedCash: number
  difference: number
  onClose: () => void
}

function ReprintReceiptModal({
  shiftId,
  countedCash,
  difference,
  onClose,
}: ReprintReceiptModalProps) {
  const { data: closing, isLoading } = useShiftClosing(shiftId)
  const printedAtRef = useRef(new Date())

  function handlePrint() {
    window.print()
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 grid place-items-center p-4"
        style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <div
          className="flex max-h-[92vh] w-full max-w-md flex-col rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b border-[#f5f4f1] px-7 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-100">
                <Receipt size={18} className="text-cyan-600" />
              </div>
              <div>
                <h2
                  style={{
                    fontFamily: 'Bricolage Grotesque, sans-serif',
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: '-0.025em',
                    color: '#1a1a1a',
                  }}
                >
                  Reimprimir cuadre
                </h2>
                <p className="mt-0.5 text-[13px] text-[#737373]">
                  Cierre del turno seleccionado.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
            >
              <X size={14} className="text-[#525252]" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-[#fafaf9] px-7 py-5">
            {isLoading || !closing ? (
              <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
            ) : (
              <div className="mx-auto w-fit rounded-xl border border-[#ebe9e6] bg-white shadow-sm">
                <CashShiftReceipt
                  shift={closing.shift}
                  expenses={closing.expenses}
                  salesByMethod={closing.salesByMethod}
                  totalSales={closing.totalSales}
                  cashSales={closing.cashSales}
                  totalExpenses={closing.totalExpenses}
                  expectedCash={closing.expectedCash}
                  overdraft={closing.overdraft}
                  orderCount={closing.orderCount}
                  countedCash={countedCash}
                  difference={difference}
                  storeName={closing.storeName}
                  userName={closing.userName}
                  printedAt={printedAtRef.current}
                  layawayPayments={closing.layawayPayments}
                  layawayPaymentsTotal={closing.layawayPaymentsTotal}
                  creditPayments={closing.creditPayments}
                  creditPaymentsTotal={closing.creditPaymentsTotal}
                  regularSalesTotal={closing.regularSalesTotal}
                  returnsIncome={closing.returnsIncome}
                  returnsExpense={closing.returnsExpense}
                />
              </div>
            )}
          </div>

          <div className="flex gap-3 border-t border-[#f5f4f1] px-7 py-5">
            <button
              onClick={onClose}
              className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f5f4f1]"
            >
              Cerrar
            </button>
            <button
              onClick={handlePrint}
              disabled={!closing}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-600 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700 disabled:opacity-50"
            >
              <Printer size={14} />
              Imprimir
            </button>
          </div>
        </div>
      </div>

      {closing && (
        <CashShiftReceiptPrint
          shift={closing.shift}
          expenses={closing.expenses}
          salesByMethod={closing.salesByMethod}
          totalSales={closing.totalSales}
          cashSales={closing.cashSales}
          totalExpenses={closing.totalExpenses}
          expectedCash={closing.expectedCash}
          overdraft={closing.overdraft}
          orderCount={closing.orderCount}
          countedCash={countedCash}
          difference={difference}
          storeName={closing.storeName}
          userName={closing.userName}
          printedAt={printedAtRef.current}
          layawayPayments={closing.layawayPayments}
          layawayPaymentsTotal={closing.layawayPaymentsTotal}
          creditPayments={closing.creditPayments}
          creditPaymentsTotal={closing.creditPaymentsTotal}
          regularSalesTotal={closing.regularSalesTotal}
          returnsIncome={closing.returnsIncome}
          returnsExpense={closing.returnsExpense}
        />
      )}
    </>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface RowProps {
  row: ShiftHistoryRow
  onReprint: () => void
}

function ShiftRow({ row, onReprint }: RowProps) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)_100px_120px_100px_120px_120px_140px_120px] items-center gap-3 border-b border-[#f5f4f1] px-6 py-3 text-sm">
      <div className="text-xs text-[#525252]">
        <p>{fmtDateTime(row.shift.opened_at)}</p>
        <p className="text-[#a8a29e]">→ {fmtDateTime(row.shift.closed_at)}</p>
      </div>
      <span className="min-w-0 truncate font-medium text-[#1a1a1a]">
        {row.cashierName}
      </span>
      <span className="text-right font-mono tabular-nums text-[#525252]">
        {fmtCOP(row.shift.opening_amount)}
      </span>
      <span className="text-right font-mono tabular-nums text-[#525252]">
        {fmtCOP(row.cashSales)}
      </span>
      <span className="text-right font-mono tabular-nums text-red-700">
        {row.totalExpenses > 0 ? `-${fmtCOP(row.totalExpenses)}` : fmtCOP(0)}
      </span>
      <span className="text-right font-mono tabular-nums font-semibold text-[#1a1a1a]">
        {fmtCOP(row.expectedCash)}
      </span>
      <span className="text-right font-mono tabular-nums text-[#1a1a1a]">
        {fmtCOP(row.countedCash)}
      </span>
      <div className="flex justify-end">
        <DifferenceBadge diff={row.difference} />
      </div>
      <div className="flex justify-end">
        <button
          onClick={onReprint}
          className="flex h-7 items-center gap-1 rounded-md border border-[#ebe9e6] bg-white px-2 text-[11px] font-medium text-[#525252] hover:bg-[#f5f4f1]"
        >
          <Printer size={10} /> Reimprimir
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CashShiftsHistoryPage() {
  // Default: 'month' (conciliación histórica; NO 'today', que solo mostraría
  // turnos cerrados hoy).
  const [preset, setPreset] = useState<DateRangePreset>('month')
  const [filters, setFilters] = useState<ShiftHistoryFilters>(() => ({
    cashierId: 'all',
    ...resolveDateRange('month'),
    page: 0,
  }))
  const [reprintRow, setReprintRow] = useState<ShiftHistoryRow | null>(null)

  const handleDateChange = (next: DateRangeValue) => {
    setPreset(next.preset)
    setFilters((f) => ({
      ...f,
      dateFrom: next.dateFrom,
      dateTo: next.dateTo,
      page: 0,
    }))
  }

  const { data, isLoading } = useShiftHistory(filters)
  const { data: cashiers = [] } = useStoreCashiers()
  const { data: myStores = [] } = useMyStores()
  const activeStoreName = myStores.find((s) => s.is_current)?.store_name ?? null

  const rows = data?.rows ?? []
  const totalCount = data?.totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / SHIFT_HISTORY_PAGE_SIZE))

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between rounded-2xl border border-[#ebe9e6] bg-[#fdfcfb] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-100">
            <Wallet size={17} className="text-cyan-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1a1a1a]">
              Historial de caja
            </p>
            <p className="text-xs text-[#737373]">
              {activeStoreName ? `Turnos de ${activeStoreName}` : 'Turnos de la tienda activa'}
              {' · '}
              {filters.dateFrom} → {filters.dateTo}
            </p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#ebe9e6] bg-white p-4">
        <select
          value={filters.cashierId}
          onChange={(e) =>
            setFilters((f) => ({ ...f, cashierId: e.target.value, page: 0 }))
          }
          className="h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 pr-8 text-sm text-[#525252] outline-none focus:border-cyan-400"
        >
          <option value="all">Todos los cajeros</option>
          {cashiers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
        <DateRangeFilter
          preset={preset}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          onChange={handleDateChange}
        />
      </div>

      {/* Tabla */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#ebe9e6] bg-white">
        <div className="grid grid-cols-[180px_minmax(0,1fr)_100px_120px_100px_120px_120px_140px_120px] gap-3 border-b border-[#ebe9e6] bg-[#fafaf9] px-6 py-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
          <span>Apertura → Cierre</span>
          <span>Cajero</span>
          <span className="text-right">Apertura</span>
          <span className="text-right">Ventas $</span>
          <span className="text-right">Egresos</span>
          <span className="text-right">Esperado</span>
          <span className="text-right">Contado</span>
          <span className="text-right">Diferencia</span>
          <span className="text-right">Acción</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-lg bg-slate-100"
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                <Wallet size={24} className="text-slate-300" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#525252]">
                  Sin turnos cerrados en este período
                </p>
                <p className="mt-1 text-xs text-[#737373]">
                  Ajusta los filtros o regresa cuando se cierre el primer turno.
                </p>
              </div>
            </div>
          ) : (
            rows.map((row) => (
              <ShiftRow
                key={row.shift.id}
                row={row}
                onReprint={() => setReprintRow(row)}
              />
            ))
          )}
        </div>

        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-[#ebe9e6] bg-[#fafaf9] px-6 py-3 text-xs text-[#525252]">
            <span>
              Página {filters.page + 1} de {totalPages} · {totalCount} turno
              {totalCount !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={filters.page === 0}
                onClick={() =>
                  setFilters((f) => ({ ...f, page: Math.max(0, f.page - 1) }))
                }
                className="flex h-8 items-center gap-1 rounded-lg border border-[#ebe9e6] bg-white px-3 font-medium text-[#525252] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#f5f4f1]"
              >
                <ChevronLeft size={13} /> Anterior
              </button>
              <button
                disabled={filters.page >= totalPages - 1}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    page: Math.min(totalPages - 1, f.page + 1),
                  }))
                }
                className="flex h-8 items-center gap-1 rounded-lg border border-[#ebe9e6] bg-white px-3 font-medium text-[#525252] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[#f5f4f1]"
              >
                Siguiente <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {reprintRow && (
        <ReprintReceiptModal
          shiftId={reprintRow.shift.id}
          countedCash={reprintRow.countedCash}
          difference={reprintRow.difference}
          onClose={() => setReprintRow(null)}
        />
      )}
    </div>
  )
}
