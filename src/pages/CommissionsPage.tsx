import { useMemo, useState } from 'react'
import { CreditCard, Plus, Users } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { todayInBogota } from '@/lib/dateRange'
import { quincenaRange } from '@/lib/commissionCalc'
import { usePermissions } from '@/hooks/usePermissions'
import {
  useCommissionsList,
  summarizeByWorker,
  type CommissionFilters,
  type CommissionRow,
} from '@/hooks/useCreditCommissions'
import { NewCommissionModal } from '@/components/commissions/NewCommissionModal'
import type { CommissionMethod } from '@/types/database.types'

// Etiquetas de método (chip). efectivo = cian (entra al cajón); consignación =
// slate (a la cuenta, no toca caja).
const METHOD_META: Record<CommissionMethod, { label: string; cls: string }> = {
  efectivo: { label: 'Efectivo', cls: 'bg-cyan-50 text-cyan-700 ring-cyan-200' },
  consignacion: { label: 'Consignación', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

function fmtFecha(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

export default function CommissionsPage() {
  const { can } = usePermissions()
  const canManage = can('comisiones.gestionar')

  // Rango por defecto: la quincena que contiene hoy (el corte con el que se paga).
  const today = todayInBogota()
  const defaultRange = useMemo(() => quincenaRange(today), [today])
  const [from, setFrom] = useState(defaultRange.from)
  const [to, setTo] = useState(defaultRange.to)
  const [creating, setCreating] = useState(false)

  const filters: CommissionFilters = { from, to }
  const { data: rows = [], isLoading } = useCommissionsList(filters)
  const report = useMemo(() => summarizeByWorker(rows), [rows])

  const totalPeriodo = rows.reduce((s, r) => s + r.monto_total, 0)
  const totalTrabajadores = rows.reduce((s, r) => s + r.monto_trabajador, 0)

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      {/* Encabezado */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[#1a1a1a]">
            <CreditCard size={20} className="text-cyan-600" />
            {canManage ? 'Comisiones por crédito' : 'Mis comisiones'}
          </h1>
          <p className="mt-0.5 text-sm text-[#737373]">
            {canManage
              ? 'Comisiones de la financiera y reporte quincenal por trabajador.'
              : 'Tus comisiones del período (solo lectura).'}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setCreating(true)}
            className="flex h-9 items-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700"
          >
            <Plus size={15} />
            Registrar comisión
          </button>
        )}
      </div>

      {/* Filtro de período */}
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-[#ebe9e6] bg-white p-4">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#737373]">Desde</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#737373]">Hasta</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
          />
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => {
              const r = quincenaRange(today)
              setFrom(r.from)
              setTo(r.to)
            }}
            className="h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-slate-50"
          >
            Quincena actual
          </button>
        </div>
      </div>

      {/* Reporte quincenal por trabajador (solo gestores) */}
      {canManage && (
        <div className="mb-6 rounded-xl border border-[#ebe9e6] bg-white">
          <div className="flex items-center gap-2 border-b border-[#f5f4f1] px-5 py-3">
            <Users size={15} className="text-[#737373]" />
            <h2 className="text-sm font-semibold text-[#1a1a1a]">
              A pagar por trabajador (período)
            </h2>
          </div>
          {report.length === 0 ? (
            <p className="px-5 py-6 text-sm text-[#a8a29e]">
              Sin comisiones en el período.
            </p>
          ) : (
            <div className="divide-y divide-[#f5f4f1]">
              {report.map((w) => (
                <div key={w.worker_id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-[#1a1a1a]">{w.worker_name}</p>
                    <p className="text-[11px] text-[#a8a29e]">
                      {w.count} crédito{w.count === 1 ? '' : 's'} · comisión total{' '}
                      {fmtCOP(w.totalCommission)}
                    </p>
                  </div>
                  <span className="font-mono text-base font-semibold text-cyan-700">
                    {fmtCOP(w.totalWorker)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between bg-[#fafaf9] px-5 py-3">
                <span className="text-sm font-semibold text-[#525252]">
                  Total a pagar a trabajadores
                </span>
                <span className="font-mono text-base font-bold text-[#1a1a1a]">
                  {fmtCOP(totalTrabajadores)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lista de comisiones */}
      <div className="rounded-xl border border-[#ebe9e6] bg-white">
        <div className="flex items-center justify-between border-b border-[#f5f4f1] px-5 py-3">
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Detalle del período</h2>
          {canManage && rows.length > 0 && (
            <span className="text-[11px] text-[#a8a29e]">
              Comisión total del período: {fmtCOP(totalPeriodo)}
            </span>
          )}
        </div>
        {isLoading ? (
          <div className="space-y-2 p-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[#a8a29e]">
            No hay comisiones registradas en el período.
          </p>
        ) : (
          <CommissionTable rows={rows} />
        )}
      </div>

      {creating && <NewCommissionModal onClose={() => setCreating(false)} />}
    </div>
  )
}

// ── Tabla ─────────────────────────────────────────────────────────────────────

function CommissionTable({ rows }: { rows: CommissionRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#f5f4f1] text-left text-[11px] uppercase tracking-[.04em] text-[#a8a29e]">
            <th className="px-5 py-2.5 font-medium">Fecha</th>
            <th className="px-3 py-2.5 font-medium">Trabajador</th>
            <th className="px-3 py-2.5 font-medium">Cliente</th>
            <th className="px-3 py-2.5 font-medium">Método</th>
            <th className="px-3 py-2.5 text-right font-medium">Total</th>
            <th className="px-5 py-2.5 text-right font-medium">Trabajador</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f5f4f1]">
          {rows.map((r) => {
            const meta = METHOD_META[r.metodo]
            return (
              <tr key={r.id} className="hover:bg-[#fafaf9]">
                <td className="whitespace-nowrap px-5 py-2.5 font-mono text-[13px] text-[#525252]">
                  {fmtFecha(r.fecha)}
                </td>
                <td className="px-3 py-2.5 text-[#1a1a1a]">{r.worker_name}</td>
                <td className="px-3 py-2.5 text-[#737373]">{r.customer_name ?? '—'}</td>
                <td className="px-3 py-2.5">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-[#525252]">
                  {fmtCOP(r.monto_total)}
                </td>
                <td className="whitespace-nowrap px-5 py-2.5 text-right font-mono font-semibold text-cyan-700">
                  {fmtCOP(r.monto_trabajador)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
