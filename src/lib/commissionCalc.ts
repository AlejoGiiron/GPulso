// Lógica pura de comisiones por crédito (Fase 4). Aislada de React y de la red
// para poder testear el reparto y el corte quincenal sin montar nada.

export interface CommissionSplit {
  local: number
  worker: number
}

/**
 * Reparte el total de una comisión entre el LOCAL y el TRABAJADOR según la
 * fracción del trabajador (0..1). Por construcción local + worker = total EXACTO
 * (el local absorbe el redondeo), para que nunca descuadre contra el CHECK de la
 * BD (monto_local + monto_trabajador = monto_total).
 *
 * @param total       monto total de la comisión (COP, >= 0)
 * @param workerShare fracción del trabajador (0..1); se clampa fuera de rango
 */
export function splitCommission(total: number, workerShare: number): CommissionSplit {
  const safeTotal = Math.max(0, Math.round(total))
  const share = Math.min(1, Math.max(0, workerShare))
  const worker = Math.round(safeTotal * share)
  const local = safeTotal - worker
  return { local, worker }
}

// ── Corte quincenal ───────────────────────────────────────────────────────────
// Quincena = 1..15 y 16..fin de mes. Es el corte con el que se le paga al
// trabajador (reemplaza el cuaderno). Se opera sobre fechas civiles 'YYYY-MM-DD'
// (la columna credit_commissions.fecha ya es un día civil de Bogotá).

export interface DateRange {
  /** 'YYYY-MM-DD' inclusive. */
  from: string
  /** 'YYYY-MM-DD' inclusive. */
  to: string
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function lastDayOfMonth(year: number, month1: number): number {
  // month1 = 1..12; Date usa mes 0-based, día 0 = último del mes anterior.
  return new Date(year, month1, 0).getDate()
}

/**
 * Devuelve el rango [from, to] de la quincena que CONTIENE la fecha dada.
 * @param dateStr 'YYYY-MM-DD' (día civil)
 */
export function quincenaRange(dateStr: string): DateRange {
  const [y, m, d] = dateStr.split('-').map((p) => parseInt(p, 10))
  if (d <= 15) {
    return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-15` }
  }
  return {
    from: `${y}-${pad2(m)}-16`,
    to: `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}`,
  }
}

// ── Reporte quincenal por trabajador ──────────────────────────────────────────
// Suma por trabajador lo que se le paga (monto_trabajador). Es lo que reemplaza
// el cuaderno. CRÍTICO: las comisiones ANULADAS (reversed_at != null) NO cuentan
// en ningún total — si una sola las siguiera sumando, se le pagaría de más a
// alguien.

export interface CommissionAggInput {
  worker_id: string
  worker_name: string
  monto_total: number
  monto_local: number
  monto_trabajador: number
  reversed_at: string | null
}

export interface WorkerCommissionReport {
  worker_id: string
  worker_name: string
  count: number
  totalWorker: number
  totalLocal: number
  totalCommission: number
}

/** Agrupa por trabajador EXCLUYENDO las anuladas. */
export function summarizeByWorker(
  rows: CommissionAggInput[],
): WorkerCommissionReport[] {
  const map = new Map<string, WorkerCommissionReport>()
  for (const r of rows) {
    if (r.reversed_at) continue // anulada: no se paga
    const prev =
      map.get(r.worker_id) ??
      ({
        worker_id: r.worker_id,
        worker_name: r.worker_name,
        count: 0,
        totalWorker: 0,
        totalLocal: 0,
        totalCommission: 0,
      } satisfies WorkerCommissionReport)
    prev.count += 1
    prev.totalWorker += r.monto_trabajador
    prev.totalLocal += r.monto_local
    prev.totalCommission += r.monto_total
    map.set(r.worker_id, prev)
  }
  return Array.from(map.values()).sort((a, b) => b.totalWorker - a.totalWorker)
}

/** Suma de montos ACTIVOS (no anulados) de una lista, por campo. */
export function sumActive(
  rows: { monto_total: number; monto_trabajador: number; reversed_at: string | null }[],
): { total: number; worker: number } {
  let total = 0
  let worker = 0
  for (const r of rows) {
    if (r.reversed_at) continue
    total += r.monto_total
    worker += r.monto_trabajador
  }
  return { total, worker }
}
