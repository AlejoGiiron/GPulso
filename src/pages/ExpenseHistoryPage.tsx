import { useMemo, useState } from 'react'
import { Receipt, Download, TrendingDown } from 'lucide-react'
import { format, subDays } from 'date-fns'
import toast from 'react-hot-toast'
import { fmtCOP } from '@/lib/formatters'
import {
  useExpenseHistory,
  type ExpenseHistoryFilters,
  type ExpenseHistoryRow,
} from '@/hooks/useCashExpenses'
import { useMyStores } from '@/hooks/useStores'

const DEFAULT_FROM = format(subDays(new Date(), 30), 'yyyy-MM-dd')
const DEFAULT_TO = format(new Date(), 'yyyy-MM-dd')

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
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

interface ReasonBreakdown {
  reason: string
  total: number
  count: number
}

function buildSummary(rows: ExpenseHistoryRow[]): {
  total: number
  byReason: ReasonBreakdown[]
} {
  let total = 0
  const map = new Map<string, { total: number; count: number }>()
  for (const r of rows) {
    total += r.amount
    const prev = map.get(r.reason) ?? { total: 0, count: 0 }
    map.set(r.reason, { total: prev.total + r.amount, count: prev.count + 1 })
  }
  const byReason = Array.from(map.entries())
    .map(([reason, v]) => ({ reason, ...v }))
    .sort((a, b) => b.total - a.total)
  return { total, byReason }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExpenseHistoryPage() {
  const [filters, setFilters] = useState<ExpenseHistoryFilters>({
    dateFrom: DEFAULT_FROM,
    dateTo: DEFAULT_TO,
  })
  const [reason, setReason] = useState<string>('all')

  const { data: rows = [], isLoading } = useExpenseHistory(filters)
  const { data: myStores = [] } = useMyStores()
  const activeStoreName = myStores.find((s) => s.is_current)?.store_name ?? null

  // Opciones de motivo a partir de los datos del período (incluye motivos de
  // pagos a proveedor, que no están en la config de motivos de egreso).
  const reasonOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.reason))).sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  const displayedRows = useMemo(
    () => (reason === 'all' ? rows : rows.filter((r) => r.reason === reason)),
    [rows, reason],
  )

  const { total, byReason } = useMemo(
    () => buildSummary(displayedRows),
    [displayedRows],
  )

  // ── Excel export ──────────────────────────────────────────────────────────
  async function exportExcel() {
    if (displayedRows.length === 0) {
      toast.error('No hay gastos para exportar')
      return
    }
    try {
      const { Workbook } = await import('exceljs')
      const wb = new Workbook()
      wb.creator = 'G-Pulso'

      const HEADER_FILL = {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FFF5F4F1' },
      }
      const BOLD = { bold: true, size: 11 }
      const MONEY_FMT = '"$"#,##0'

      // Hoja 1 — Gastos
      const ws = wb.addWorksheet('Gastos')
      ws.columns = [
        { header: 'Fecha', key: 'fecha', width: 18 },
        { header: 'Motivo', key: 'motivo', width: 24 },
        { header: 'Notas', key: 'notas', width: 32 },
        { header: 'Monto', key: 'monto', width: 16 },
        { header: 'Registrado por', key: 'cajero', width: 22 },
      ]
      const head = ws.getRow(1)
      head.font = BOLD
      head.fill = HEADER_FILL
      head.commit()

      for (const r of displayedRows) {
        ws.addRow({
          fecha: fmtDateTime(r.created_at),
          motivo: r.reason,
          notas: r.notes ?? '',
          monto: r.amount,
          cajero: r.cashierName,
        })
      }
      const totalRow = ws.addRow({
        fecha: 'TOTAL',
        motivo: '',
        notas: '',
        monto: total,
        cajero: '',
      })
      totalRow.font = BOLD
      ws.getColumn('monto').numFmt = MONEY_FMT

      // Hoja 2 — Desglose por motivo
      const ws2 = wb.addWorksheet('Por motivo')
      ws2.columns = [
        { header: 'Motivo', key: 'motivo', width: 28 },
        { header: 'Gastos', key: 'cantidad', width: 12 },
        { header: 'Total', key: 'total', width: 18 },
      ]
      const head2 = ws2.getRow(1)
      head2.font = BOLD
      head2.fill = HEADER_FILL
      head2.commit()
      for (const b of byReason) {
        ws2.addRow({ motivo: b.reason, cantidad: b.count, total: b.total })
      }
      const totalRow2 = ws2.addRow({
        motivo: 'TOTAL',
        cantidad: displayedRows.length,
        total,
      })
      totalRow2.font = BOLD
      ws2.getColumn('total').numFmt = MONEY_FMT

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const storeSlug = (activeStoreName ?? 'tienda')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      a.href = url
      a.download = `historial-gastos-${storeSlug}-${filters.dateFrom}_${filters.dateTo}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('No se pudo exportar el archivo')
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between rounded-2xl border border-[#ebe9e6] bg-[#fdfcfb] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-100">
            <Receipt size={17} className="text-cyan-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1a1a1a]">
              Historial de gastos
            </p>
            <p className="text-xs text-[#737373]">
              {activeStoreName ? `Gastos de ${activeStoreName}` : 'Gastos de la tienda activa'}
              {' · '}
              {filters.dateFrom} → {filters.dateTo}
            </p>
          </div>
        </div>
        <button
          onClick={() => void exportExcel()}
          className="flex h-9 items-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700"
        >
          <Download size={14} /> Exportar a Excel
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#ebe9e6] bg-white p-4">
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
          className="h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-cyan-400"
        />
        <span className="text-xs text-[#737373]">a</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
          className="h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-cyan-400"
        />
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 pr-8 text-sm text-[#525252] outline-none focus:border-cyan-400"
        >
          <option value="all">Todos los motivos</option>
          {reasonOptions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-[#ebe9e6] bg-[#fdfcfb] p-5">
          <div className="flex items-center gap-2 text-[#737373]">
            <TrendingDown size={15} className="text-red-500" />
            <p className="text-[11px] font-semibold uppercase tracking-[.06em]">
              Total del período
            </p>
          </div>
          <p
            className="mt-2 font-mono text-3xl font-bold tabular-nums text-[#1a1a1a]"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
          >
            {fmtCOP(total)}
          </p>
          <p className="mt-1 text-xs text-[#737373]">
            {displayedRows.length} gasto{displayedRows.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="rounded-2xl border border-[#ebe9e6] bg-white p-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.06em] text-[#737373]">
            Desglose por motivo
          </p>
          {byReason.length === 0 ? (
            <p className="text-sm text-[#a8a29e]">Sin gastos en el período.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {byReason.map((b) => (
                <div
                  key={b.reason}
                  className="flex items-center justify-between gap-3 border-b border-[#f5f4f1] pb-2 last:border-0 last:pb-0"
                >
                  <span className="min-w-0 truncate text-sm text-[#1a1a1a]">
                    {b.reason}
                    <span className="ml-2 text-xs text-[#a8a29e]">
                      ({b.count} gasto{b.count !== 1 ? 's' : ''})
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-[#1a1a1a]">
                    {fmtCOP(b.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#ebe9e6] bg-white">
        <div className="grid grid-cols-[150px_minmax(0,1fr)_minmax(0,1.2fr)_130px_160px] gap-3 border-b border-[#ebe9e6] bg-[#fafaf9] px-6 py-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
          <span>Fecha</span>
          <span>Motivo</span>
          <span>Notas</span>
          <span className="text-right">Monto</span>
          <span>Registrado por</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : displayedRows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
                <Receipt size={24} className="text-slate-300" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#525252]">
                  Sin gastos en este período
                </p>
                <p className="mt-1 text-xs text-[#737373]">
                  Ajusta los filtros o registra gastos desde el turno de caja.
                </p>
              </div>
            </div>
          ) : (
            displayedRows.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[150px_minmax(0,1fr)_minmax(0,1.2fr)_130px_160px] items-center gap-3 border-b border-[#f5f4f1] px-6 py-3 text-sm"
              >
                <span className="text-xs text-[#525252]">{fmtDateTime(r.created_at)}</span>
                <span className="min-w-0 truncate font-medium text-[#1a1a1a]">
                  {r.reason}
                </span>
                <span className="min-w-0 truncate text-[#737373]">
                  {r.notes ?? <span className="text-[#d6d3d1]">—</span>}
                </span>
                <span className="text-right font-mono tabular-nums font-semibold text-red-700">
                  -{fmtCOP(r.amount)}
                </span>
                <span className="min-w-0 truncate text-[#525252]">{r.cashierName}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
