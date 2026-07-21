import { supabase } from '@/lib/supabase'

// Fuente ÚNICA de la imputación de comisiones por crédito al cuadre (Fase 4).
// La comparten useShiftClosing (un turno) y useShiftHistory (varios turnos) para
// NO reimplementar por separado qué comisiones caen en un turno — la deuda
// heredada #4 (imputación duplicada) NO se repite para este concepto.
//
// Solo cuentan las comisiones en EFECTIVO: por construcción tienen shift_id
// (CHECK credit_commissions_shift_coherent en la 048), así que la imputación es
// DIRECTA por shift_id, sin ventana de tiempo ni ruta legacy (la tabla es nueva,
// no hay filas pre-026 con shift_id NULL). Las de consignación no tocan caja.

/**
 * Suma de comisiones por crédito en efectivo imputadas a cada turno.
 * Devuelve un Map shift_id → total (solo turnos con al menos una comisión).
 */
export async function fetchShiftCashCommissions(
  storeId: string,
  shiftIds: string[],
): Promise<Map<string, number>> {
  const byShift = new Map<string, number>()
  if (shiftIds.length === 0) return byShift

  const { data, error } = await supabase
    .from('credit_commissions')
    .select('shift_id, monto_total')
    .eq('store_id' as never, storeId)
    .eq('metodo' as never, 'efectivo')
    .in('shift_id' as never, shiftIds)
  if (error) throw error

  for (const row of (data ?? []) as unknown as {
    shift_id: string | null
    monto_total: number | string
  }[]) {
    if (!row.shift_id) continue
    byShift.set(
      row.shift_id,
      (byShift.get(row.shift_id) ?? 0) + Number(row.monto_total),
    )
  }
  return byShift
}
