import type { PaymentMethod } from '@/types/database.types'

// Lógica pura de cálculo del cuadre de caja. Aislada del hook useShiftClosing
// (que solo hace las queries) para poder testearla sin React ni red.

export interface SalesByMethod {
  method: PaymentMethod
  count: number
  total: number
  regularTotal: number
  layawayTotal: number
  // Abonos de FIADO (029) cobrados en este método. Parte del efectivo del
  // cuadre; el revenue del fiado ya se reconoció en la orden (reportes).
  creditTotal: number
}

export interface OrderPaymentInput {
  method: PaymentMethod
  amount: number
}

export interface ShiftOrderInput {
  id: string
  total: number
  // Desglose de pagos de la venta (order_payments, 032). Una venta de un solo
  // método trae UNA fila; una venta MIXTA, varias. La suma de amount = total
  // (paridad garantizada por el backfill/escritura). Antes había un único
  // payment_method; ahora el cuadre suma por método desde estas filas. Los
  // fiados no traen filas (su efectivo entra por creditPayments) y además la
  // orden fiada ya se excluye aguas arriba, así que nunca llega acá.
  payments: OrderPaymentInput[]
  // Si la orden es la diferencia cobrada en un cambio, apunta a la devolución.
  // Esas órdenes son INGRESO por devolución → se muestran aparte, no en ventas.
  return_id?: string | null
}

export interface ShiftLayawayPaymentInput {
  payment_method: PaymentMethod
  amount: number
}

// Abono de una venta FIADA (029). Efectivo real cobrado ahora; se suma al
// cuadre igual que un abono de separado. Su orden (is_credit) se EXCLUYE del
// efectivo (su total no entró), por eso el abono no duplica.
export interface ShiftCreditPaymentInput {
  payment_method: PaymentMethod
  amount: number
}

export interface ShiftExpenseInput {
  amount: number
  // 'return' = reembolso de una devolución; 'expense' (default) = gasto normal.
  kind?: 'expense' | 'return'
}

// Comisión por crédito en EFECTIVO imputada al turno (Fase 4). Es dinero que
// entró al cajón pero NO es venta: se suma al efectivo del cuadre igual que un
// abono de separado/fiado, sin contar como venta ni aparecer en salesByMethod.
// Las comisiones por CONSIGNACIÓN no llegan acá (no tocan caja).
export interface ShiftCommissionInput {
  amount: number
}

export interface ShiftSummaryInput {
  openingAmount: number
  orders: ShiftOrderInput[]
  // Ids de órdenes generadas al COMPLETAR un separado. Se excluyen del cuadre
  // porque cada abono del separado ya se contó como ingreso el día que se
  // cobró; contar además la orden de cierre duplicaría el dinero.
  excludedOrderIds?: Iterable<string>
  layawayPayments: ShiftLayawayPaymentInput[]
  // Abonos de fiados imputados al turno. Opcional para compatibilidad con los
  // call sites/tests previos a fiados (default []).
  creditPayments?: ShiftCreditPaymentInput[]
  // Comisiones por crédito en efectivo imputadas al turno (Fase 4). Solo las de
  // efectivo (las de consignación no tocan caja). Opcional (default []).
  commissionIncomes?: ShiftCommissionInput[]
  expenses: ShiftExpenseInput[]
}

export interface ShiftSummary {
  salesByMethod: SalesByMethod[]
  regularSalesTotal: number
  layawayPaymentsTotal: number
  // Total de abonos de fiado del turno (parte del efectivo; NO revenue).
  creditPaymentsTotal: number
  // Total de comisiones por crédito en efectivo del turno (Fase 4). Parte del
  // efectivo esperado; NO es venta ni revenue. Se muestra aparte en el recibo.
  commissionsIncome: number
  totalSales: number
  cashSales: number
  totalExpenses: number
  // Efectivo esperado en caja (tope en 0, Lógica B). Si los egresos superan lo
  // disponible, el faltante se reporta en `overdraft` en vez de un esperado
  // negativo.
  expectedCash: number
  overdraft: number
  orderCount: number
  // ── Devoluciones (solo presentación; NO afectan expectedCash) ──────────────
  // Ingreso por devoluciones = órdenes con return_id (diferencia cobrada en un
  // cambio); su efectivo YA está dentro de cashSales.
  returnsIncome: number
  // Reembolsos = cash_expenses kind='return'; su monto YA está en totalExpenses.
  returnsExpense: number
  returnsNet: number
  // Egresos "regulares" para mostrar (totalExpenses menos los reembolsos).
  regularExpensesTotal: number
}

export interface CashReconciliation {
  expectedCash: number
  overdraft: number
}

/**
 * Lógica B del cuadre: el efectivo esperado nunca baja de 0. Cuando los egresos
 * superan el efectivo disponible (apertura + ventas/abonos en efectivo) el
 * exceso se reporta como `overdraft` (sobregiro), no como un esperado negativo.
 */
export function reconcileCash(
  availableCash: number,
  totalExpenses: number,
): CashReconciliation {
  return {
    expectedCash: Math.max(0, availableCash - totalExpenses),
    overdraft: Math.max(0, totalExpenses - availableCash),
  }
}

/**
 * Diferencia del cuadre = contado − esperado − sobregiro. Positiva = SOBRANTE,
 * negativa = FALTANTE, cero = CUADRADO. Restar el sobregiro asegura que un
 * egreso que vacía la caja se lea como faltante y no como sobrante.
 */
export function shiftDifference(
  countedCash: number,
  rec: CashReconciliation,
): number {
  return countedCash - rec.expectedCash - rec.overdraft
}

type AggRow = {
  count: number
  total: number
  regularTotal: number
  layawayTotal: number
  creditTotal: number
}

const emptyAgg = (): AggRow => ({
  count: 0,
  total: 0,
  regularTotal: 0,
  layawayTotal: 0,
  creditTotal: 0,
})

/**
 * Calcula el resumen del cuadre de un turno a partir de las ventas, los abonos
 * de separados y los egresos. Solo el efectivo afecta `expectedCash`:
 *   expectedCash = apertura + ventas efectivo + abonos efectivo - egresos
 */
export function calculateShiftSummary(input: ShiftSummaryInput): ShiftSummary {
  const excluded = new Set(input.excludedOrderIds ?? [])
  const orders = input.orders.filter((o) => !excluded.has(o.id))

  const aggMap = new Map<PaymentMethod, AggRow>()
  let regularSalesTotal = 0
  let layawayPaymentsTotal = 0
  let creditPaymentsTotal = 0
  let cashSales = 0
  let returnsIncome = 0
  let regularOrderCount = 0

  for (const o of orders) {
    // El efectivo de la orden = suma de sus pagos en efectivo (antes: el total
    // si payment_method==='cash'). Cuenta para el cuadre aunque la orden sea el
    // ingreso por un cambio (return_id) → expectedCash queda idéntico.
    for (const p of o.payments) {
      if (p.method === 'cash') cashSales += p.amount
    }

    if (o.return_id) {
      // Ingreso por devolución (diferencia de cambio): se muestra aparte, no
      // entra a ventas regulares ni a salesByMethod.
      returnsIncome += o.total
      continue
    }

    regularOrderCount += 1
    regularSalesTotal += o.total
    // Una fila de salesByMethod por cada pago: una venta mixta aporta a varios
    // métodos. Para una venta de un solo método equivale a leer el
    // payment_method anterior (un único pago cuyo monto = el total).
    for (const p of o.payments) {
      const prev = aggMap.get(p.method) ?? emptyAgg()
      aggMap.set(p.method, {
        count: prev.count + 1,
        total: prev.total + p.amount,
        regularTotal: prev.regularTotal + p.amount,
        layawayTotal: prev.layawayTotal,
        creditTotal: prev.creditTotal,
      })
    }
  }

  for (const p of input.layawayPayments) {
    const t = p.amount
    layawayPaymentsTotal += t
    if (p.payment_method === 'cash') cashSales += t
    const prev = aggMap.get(p.payment_method) ?? emptyAgg()
    aggMap.set(p.payment_method, {
      count: prev.count + 1,
      total: prev.total + t,
      regularTotal: prev.regularTotal,
      layawayTotal: prev.layawayTotal + t,
      creditTotal: prev.creditTotal,
    })
  }

  // Abonos de FIADO (029): efectivo real cobrado ahora. Se suman al cuadre
  // igual que los de separado. La ORDEN fiada se excluyó del efectivo aguas
  // arriba (query .eq('is_credit', false)), así que esto no duplica.
  for (const p of input.creditPayments ?? []) {
    const t = p.amount
    creditPaymentsTotal += t
    if (p.payment_method === 'cash') cashSales += t
    const prev = aggMap.get(p.payment_method) ?? emptyAgg()
    aggMap.set(p.payment_method, {
      count: prev.count + 1,
      total: prev.total + t,
      regularTotal: prev.regularTotal,
      layawayTotal: prev.layawayTotal,
      creditTotal: prev.creditTotal + t,
    })
  }

  // Comisiones por crédito en efectivo (Fase 4): dinero en el cajón que NO es
  // venta. Suben cashSales (→ expectedCash) pero NO entran a salesByMethod ni a
  // regularSalesTotal; se muestran en su propia sección del recibo.
  let commissionsIncome = 0
  for (const c of input.commissionIncomes ?? []) {
    commissionsIncome += c.amount
    cashSales += c.amount
  }

  const salesByMethod: SalesByMethod[] = Array.from(aggMap.entries())
    .map(([method, v]) => ({ method, ...v }))
    .sort((a, b) => b.total - a.total)

  const totalSales = regularSalesTotal + layawayPaymentsTotal + creditPaymentsTotal

  // Egresos: el total (para el cuadre) es TODO; los reembolsos se separan solo
  // para la presentación. totalExpenses NO cambia → expectedCash idéntico.
  let totalExpenses = 0
  let returnsExpense = 0
  for (const e of input.expenses) {
    totalExpenses += e.amount
    if (e.kind === 'return') returnsExpense += e.amount
  }
  const regularExpensesTotal = totalExpenses - returnsExpense

  const { expectedCash, overdraft } = reconcileCash(
    input.openingAmount + cashSales,
    totalExpenses,
  )

  return {
    salesByMethod,
    regularSalesTotal,
    layawayPaymentsTotal,
    creditPaymentsTotal,
    commissionsIncome,
    totalSales,
    cashSales,
    totalExpenses,
    expectedCash,
    overdraft,
    orderCount: regularOrderCount,
    returnsIncome,
    returnsExpense,
    returnsNet: returnsIncome - returnsExpense,
    regularExpensesTotal,
  }
}
