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
