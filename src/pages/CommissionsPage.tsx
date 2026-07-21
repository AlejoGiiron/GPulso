import { useMemo, useState } from 'react'
import { CreditCard, Plus, Users, Ban, UserCog } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { todayInBogota } from '@/lib/dateRange'
import { quincenaRange, summarizeByWorker, sumActive } from '@/lib/commissionCalc'
import { usePermissions } from '@/hooks/usePermissions'
import {
  useCommissionsList,
  type CommissionFilters,
  type CommissionRow,
} from '@/hooks/useCreditCommissions'
import { NewCommissionModal } from '@/components/commissions/NewCommissionModal'
import { ReverseCommissionModal } from '@/components/commissions/ReverseCommissionModal'
import { ReassignWorkerModal } from '@/components/commissions/ReassignWorkerModal'
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
  // Reporte y totales EXCLUYEN las anuladas (summarizeByWorker/sumActive las
  // filtran). La lista de abajo sí las muestra, marcadas.
  const report = useMemo(() => summarizeByWorker(rows), [rows])
  const totals = useMemo(() => sumActive(rows), [rows])
  const totalPeriodo = totals.total
  const totalTrabajadores = totals.worker

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
          <CommissionTable rows={rows} canManage={canManage} />
        )}
      </div>

      {creating && <NewCommissionModal onClose={() => setCreating(false)} />}
    </div>
  )
}

// ── Tabla ─────────────────────────────────────────────────────────────────────

function fmtTsDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

function CommissionTable({
  rows,
  canManage,
}: {
  rows: CommissionRow[]
  canManage: boolean
}) {
  const [reversing, setReversing] = useState<CommissionRow | null>(null)
  const [reassigning, setReassigning] = useState<CommissionRow | null>(null)

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#f5f4f1] text-left text-[11px] uppercase tracking-[.04em] text-[#a8a29e]">
              <th className="px-5 py-2.5 font-medium">Fecha</th>
              <th className="px-3 py-2.5 font-medium">Trabajador</th>
              <th className="px-3 py-2.5 font-medium">Cliente</th>
              <th className="px-3 py-2.5 font-medium">Método</th>
              <th className="px-3 py-2.5 text-right font-medium">Total</th>
              <th className="px-3 py-2.5 text-right font-medium">Trabajador</th>
              {canManage && <th className="px-5 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f5f4f1]">
            {rows.map((r) => {
              const meta = METHOD_META[r.metodo]
              const anulada = !!r.reversed_at
              return (
                <tr
                  key={r.id}
                  className={anulada ? 'bg-[#fafaf9] text-[#a8a29e]' : 'hover:bg-[#fafaf9]'}
                >
                  <td className="whitespace-nowrap px-5 py-2.5 font-mono text-[13px]">
                    {fmtFecha(r.fecha)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={anulada ? 'text-[#a8a29e]' : 'text-[#1a1a1a]'}>
                      {r.worker_name}
                    </span>
                    {/* Traza visible: anulada (con fecha) o reasignada. */}
                    {anulada && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 ring-1 ring-inset ring-red-200">
                        Anulada · {r.reversed_at ? fmtTsDate(r.reversed_at) : ''}
                      </span>
                    )}
                    {!anulada && r.reassigned_at && (
                      <span
                        className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
                        title={
                          r.original_worker_name
                            ? `Reasignada desde ${r.original_worker_name}`
                            : 'Reasignada'
                        }
                      >
                        Reasignada
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[#737373]">{r.customer_name ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${meta.cls} ${anulada ? 'opacity-60' : ''}`}
                    >
                      {meta.label}
                    </span>
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2.5 text-right font-mono ${anulada ? 'text-[#a8a29e] line-through' : 'text-[#525252]'}`}
                  >
                    {fmtCOP(r.monto_total)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2.5 text-right font-mono font-semibold ${anulada ? 'text-[#a8a29e] line-through' : 'text-cyan-700'}`}
                  >
                    {fmtCOP(r.monto_trabajador)}
                  </td>
                  {canManage && (
                    <td className="whitespace-nowrap px-5 py-2.5 text-right">
                      {!anulada && (
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setReassigning(r)}
                            className="rounded-md p-1.5 text-[#a8a29e] hover:bg-amber-50 hover:text-amber-700"
                            title="Reasignar trabajador"
                          >
                            <UserCog size={15} />
                          </button>
                          {/* Anular solo si es reversible (consignación o
                              efectivo con turno abierto). */}
                          <button
                            onClick={() => setReversing(r)}
                            disabled={!r.reversible}
                            className="rounded-md p-1.5 text-[#a8a29e] enabled:hover:bg-red-50 enabled:hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                            title={
                              r.reversible
                                ? 'Anular comisión'
                                : 'No se puede anular: efectivo de un turno ya cerrado'
                            }
                          >
                            <Ban size={15} />
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {reversing && (
        <ReverseCommissionModal commission={reversing} onClose={() => setReversing(null)} />
      )}
      {reassigning && (
        <ReassignWorkerModal commission={reassigning} onClose={() => setReassigning(null)} />
      )}
    </>
  )
}
