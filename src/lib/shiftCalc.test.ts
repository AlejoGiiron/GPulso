import { describe, it, expect } from 'vitest'
import {
  calculateShiftSummary,
  reconcileCash,
  shiftDifference,
  type ShiftOrderInput,
  type OrderPaymentInput,
  type ShiftLayawayPaymentInput,
  type ShiftCreditPaymentInput,
  type ShiftSummaryInput,
} from './shiftCalc'

function label(diff: number): 'CUADRADO' | 'SOBRANTE' | 'FALTANTE' {
  if (diff > 0) return 'SOBRANTE'
  if (diff < 0) return 'FALTANTE'
  return 'CUADRADO'
}

// Helper de un solo método: la venta trae UNA fila de order_payments cuyo monto
// es el total. Equivale a la fuente anterior (un payment_method por orden), así
// que los resultados esperados de los tests existentes NO cambian.
function order(
  id: string,
  total: number,
  method: OrderPaymentInput['method'] = 'cash',
  return_id: string | null = null,
): ShiftOrderInput {
  return { id, total, payments: [{ method, amount: total }], return_id }
}

// Helper de venta MIXTA: varias filas de order_payments en una sola orden.
function orderMixed(
  id: string,
  payments: OrderPaymentInput[],
  return_id: string | null = null,
): ShiftOrderInput {
  const total = payments.reduce((s, p) => s + p.amount, 0)
  return { id, total, payments, return_id }
}

function abono(
  amount: number,
  payment_method: ShiftLayawayPaymentInput['payment_method'] = 'cash',
): ShiftLayawayPaymentInput {
  return { amount, payment_method }
}

function creditAbono(
  amount: number,
  payment_method: ShiftCreditPaymentInput['payment_method'] = 'cash',
): ShiftCreditPaymentInput {
  return { amount, payment_method }
}

describe('calculateShiftSummary', () => {
  it('turno solo con ventas en efectivo: esperado = apertura + ventas', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('o1', 50_000), order('o2', 30_000)],
      layawayPayments: [],
      expenses: [],
    })
    expect(r.regularSalesTotal).toBe(80_000)
    expect(r.totalSales).toBe(80_000)
    expect(r.cashSales).toBe(80_000)
    expect(r.totalExpenses).toBe(0)
    expect(r.expectedCash).toBe(180_000)
    expect(r.orderCount).toBe(2)
  })

  it('ventas en varios métodos: solo el efectivo afecta el esperado', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [
        order('o1', 50_000, 'cash'),
        order('o2', 30_000, 'card'),
        order('o3', 20_000, 'transfer'),
      ],
      layawayPayments: [],
      expenses: [],
    })
    expect(r.totalSales).toBe(100_000)
    expect(r.cashSales).toBe(50_000)
    expect(r.expectedCash).toBe(150_000) // 100.000 + 50.000 efectivo
    // salesByMethod ordenado por total descendente
    expect(r.salesByMethod.map((s) => s.method)).toEqual([
      'cash',
      'card',
      'transfer',
    ])
    expect(r.salesByMethod[0]).toMatchObject({ method: 'cash', total: 50_000, count: 1 })
  })

  it('recargo Addi: el total con recargo cuenta como venta Addi y NO toca el efectivo', () => {
    // La orden Addi llega con total ya incluido el recargo (subtotal 100k +
    // recargo 15k = 115k). El recargo no es efectivo → expectedCash no cambia.
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [
        order('o1', 50_000, 'cash'),
        order('o2', 115_000, 'addi'),
      ],
      layawayPayments: [],
      expenses: [],
    })
    const addi = r.salesByMethod.find((s) => s.method === 'addi')
    expect(addi).toMatchObject({ method: 'addi', total: 115_000, count: 1 })
    expect(r.totalSales).toBe(165_000) // 50.000 + 115.000 (recargo incluido)
    expect(r.cashSales).toBe(50_000) // Addi no es efectivo
    expect(r.expectedCash).toBe(150_000) // 100.000 + 50.000, intacto pese al recargo
  })

  it('descuento por ítem: el cuadre usa el total REAL cobrado, no el catálogo', () => {
    // Catálogo $100.000, vendido con descuento por ítem a $70.000 en efectivo.
    // orders.total ya es el final ($70.000): el cuadre lo toma tal cual; el
    // catálogo no es visible para el cuadre.
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('o1', 70_000, 'cash')],
      layawayPayments: [],
      expenses: [],
    })
    expect(r.cashSales).toBe(70_000) // real cobrado, no 100.000
    expect(r.totalSales).toBe(70_000)
    expect(r.expectedCash).toBe(170_000) // 100.000 + 70.000
    expect(r.salesByMethod[0]).toMatchObject({ method: 'cash', total: 70_000 })
  })

  it('turno con gastos: esperado = apertura + ventas efectivo - gastos', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('o1', 60_000, 'cash')],
      layawayPayments: [],
      expenses: [{ amount: 20_000 }, { amount: 5_000 }],
    })
    expect(r.totalExpenses).toBe(25_000)
    expect(r.expectedCash).toBe(135_000) // 100.000 + 60.000 - 25.000
  })

  it('abonos de separados en efectivo suman al efectivo del cuadre', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('o1', 40_000, 'cash')],
      layawayPayments: [abono(20_000, 'cash'), abono(10_000, 'card')],
      expenses: [],
    })
    expect(r.regularSalesTotal).toBe(40_000)
    expect(r.layawayPaymentsTotal).toBe(30_000)
    expect(r.totalSales).toBe(70_000)
    // efectivo = 40.000 venta + 20.000 abono efectivo (el abono en tarjeta no)
    expect(r.cashSales).toBe(60_000)
    expect(r.expectedCash).toBe(160_000)
  })

  it('una devolución en efectivo (cash_expense) resta del esperado', () => {
    // venta de 50.000 en efectivo + devolución de esa venta como egreso 50.000
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('o1', 50_000, 'cash')],
      layawayPayments: [],
      expenses: [{ amount: 50_000 }], // "Devolución venta #N"
    })
    expect(r.cashSales).toBe(50_000)
    expect(r.totalExpenses).toBe(50_000)
    expect(r.expectedCash).toBe(100_000) // 100.000 + 50.000 - 50.000
  })

  it('NO duplica los separados completados (excluye órdenes con converted_order_id)', () => {
    // 'conv1' es la orden generada al completar un separado: debe excluirse,
    // porque el dinero del separado entra vía sus abonos (layawayPayments).
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('sale1', 50_000, 'cash'), order('conv1', 80_000, 'cash')],
      excludedOrderIds: ['conv1'],
      layawayPayments: [abono(80_000, 'cash')],
      expenses: [],
    })
    expect(r.orderCount).toBe(1) // solo sale1
    expect(r.regularSalesTotal).toBe(50_000) // sin la orden de conversión
    expect(r.layawayPaymentsTotal).toBe(80_000)
    expect(r.totalSales).toBe(130_000) // 50.000 venta + 80.000 abonos
    expect(r.cashSales).toBe(130_000)
    expect(r.expectedCash).toBe(230_000)
  })

  it('caso combinado completo (ventas + abonos + gastos + devolución)', () => {
    const r = calculateShiftSummary({
      openingAmount: 200_000,
      orders: [
        order('o1', 100_000, 'cash'),
        order('o2', 60_000, 'card'),
        order('conv1', 90_000, 'cash'), // excluida
      ],
      excludedOrderIds: ['conv1'],
      layawayPayments: [abono(90_000, 'cash'), abono(40_000, 'transfer')],
      expenses: [{ amount: 30_000 }, { amount: 50_000 }], // gasto + devolución
    })
    // Ventas regulares contadas: 100.000 (cash) + 60.000 (card) = 160.000
    expect(r.regularSalesTotal).toBe(160_000)
    expect(r.layawayPaymentsTotal).toBe(130_000)
    expect(r.totalSales).toBe(290_000)
    expect(r.orderCount).toBe(2)
    // Efectivo: 100.000 venta + 90.000 abono efectivo = 190.000
    expect(r.cashSales).toBe(190_000)
    expect(r.totalExpenses).toBe(80_000)
    // 200.000 + 190.000 - 80.000
    expect(r.expectedCash).toBe(310_000)
  })

  it('un turno vacío parte del monto de apertura', () => {
    const r = calculateShiftSummary({
      openingAmount: 50_000,
      orders: [],
      layawayPayments: [],
      expenses: [],
    })
    expect(r.totalSales).toBe(0)
    expect(r.cashSales).toBe(0)
    expect(r.expectedCash).toBe(50_000)
    expect(r.overdraft).toBe(0)
    expect(r.salesByMethod).toEqual([])
  })

  it('caso foto vía calculateShiftSummary: egreso mayor a lo disponible', () => {
    // apertura 162k, sin ventas, egreso 180k (pago a proveedor en efectivo)
    const r = calculateShiftSummary({
      openingAmount: 162_000,
      orders: [],
      layawayPayments: [],
      expenses: [{ amount: 180_000 }],
    })
    expect(r.cashSales).toBe(0)
    expect(r.totalExpenses).toBe(180_000)
    expect(r.expectedCash).toBe(0) // tope en 0, no negativo
    expect(r.overdraft).toBe(18_000)
    // contado 0 → FALTANTE 18.000 (no SOBRANTE)
    expect(shiftDifference(0, r)).toBe(-18_000)
  })
})

describe('reconcileCash + shiftDifference (Lógica B del cuadre)', () => {
  it('caso normal cuadrado: ap 50k + ventas 100k, sin egresos, contado 150k', () => {
    const rec = reconcileCash(150_000, 0)
    expect(rec).toEqual({ expectedCash: 150_000, overdraft: 0 })
    const diff = shiftDifference(150_000, rec)
    expect(diff).toBe(0)
    expect(label(diff)).toBe('CUADRADO')
  })

  it('faltante por error de conteo: contado 145k → -5k FALTANTE', () => {
    const rec = reconcileCash(150_000, 0)
    const diff = shiftDifference(145_000, rec)
    expect(diff).toBe(-5_000)
    expect(label(diff)).toBe('FALTANTE')
  })

  it('sobrante: contado 155k → +5k SOBRANTE', () => {
    const rec = reconcileCash(150_000, 0)
    const diff = shiftDifference(155_000, rec)
    expect(diff).toBe(5_000)
    expect(label(diff)).toBe('SOBRANTE')
  })

  it('egreso normal: ap 50k + ventas 100k, egresos 30k, contado 120k → CUADRADO', () => {
    const rec = reconcileCash(150_000, 30_000)
    expect(rec).toEqual({ expectedCash: 120_000, overdraft: 0 })
    const diff = shiftDifference(120_000, rec)
    expect(diff).toBe(0)
    expect(label(diff)).toBe('CUADRADO')
  })

  it('CASO FOTO: ap 162k, egresos 180k, contado 0 → FALTANTE 18.000', () => {
    const rec = reconcileCash(162_000, 180_000)
    expect(rec).toEqual({ expectedCash: 0, overdraft: 18_000 })
    const diff = shiftDifference(0, rec)
    expect(diff).toBe(-18_000)
    expect(label(diff)).toBe('FALTANTE')
  })

  it('pago exacto: ap 100k, egresos 100k, contado 0 → CUADRADO', () => {
    const rec = reconcileCash(100_000, 100_000)
    expect(rec).toEqual({ expectedCash: 0, overdraft: 0 })
    const diff = shiftDifference(0, rec)
    expect(diff).toBe(0)
    expect(label(diff)).toBe('CUADRADO')
  })

  it('sobregiro con conteo parcial: ap 162k, egresos 180k, contado 10k → FALTANTE 8.000', () => {
    const rec = reconcileCash(162_000, 180_000)
    const diff = shiftDifference(10_000, rec)
    expect(diff).toBe(-8_000)
    expect(label(diff)).toBe('FALTANTE')
  })
})

describe('calculateShiftSummary — devoluciones aparte (P5)', () => {
  // Escenario del test manual: venta 50k; devolución -50k; cambio más caro
  // (+10k cobrado); cambio más barato (-5k reembolsado). Todo en efectivo.
  const escenario = (): ShiftSummaryInput => ({
    openingAmount: 100_000,
    orders: [
      order('venta1', 50_000, 'cash'), // venta regular
      order('dif', 10_000, 'cash', 'ret-caro'), // ingreso por cambio más caro
      // las órdenes $0 de los cambios (mismo precio / más barato) no aportan
    ],
    layawayPayments: [],
    expenses: [
      { amount: 50_000, kind: 'return' }, // reembolso devolución
      { amount: 5_000, kind: 'return' }, // reembolso diferencia barata
    ],
  })

  it('clasifica ingresos y egresos de devolución sin tocarlos de ventas/egresos', () => {
    const r = calculateShiftSummary(escenario())
    // Ventas regulares: solo la venta de 50k (no el ingreso por cambio)
    expect(r.regularSalesTotal).toBe(50_000)
    expect(r.orderCount).toBe(1) // la orden con return_id no cuenta como venta
    expect(r.salesByMethod.reduce((s, m) => s + m.total, 0)).toBe(50_000)
    // Devoluciones
    expect(r.returnsIncome).toBe(10_000)
    expect(r.returnsExpense).toBe(55_000)
    expect(r.returnsNet).toBe(-45_000)
    // Egresos regulares (sin reembolsos)
    expect(r.regularExpensesTotal).toBe(0)
  })

  it('INVARIANTE: expectedCash es idéntico con y sin la clasificación de devoluciones', () => {
    const data = escenario()
    const r = calculateShiftSummary(data)
    // Cálculo "viejo" (sin distinguir devoluciones): todo el efectivo entra,
    // todos los egresos restan.
    const allCash =
      data.orders.reduce(
        (s, o) =>
          s +
          o.payments.reduce(
            (ps, p) => ps + (p.method === 'cash' ? p.amount : 0),
            0,
          ),
        0,
      ) +
      data.layawayPayments.reduce(
        (s, p) => s + (p.payment_method === 'cash' ? p.amount : 0),
        0,
      )
    const allExpenses = data.expenses.reduce((s, e) => s + e.amount, 0)
    const expectedOld = Math.max(0, data.openingAmount + allCash - allExpenses)
    // 100k + (50k + 10k) - (50k + 5k) = 105k
    expect(r.expectedCash).toBe(expectedOld)
    expect(r.expectedCash).toBe(105_000)
    expect(r.cashSales).toBe(60_000) // incluye el ingreso por cambio
    expect(r.totalExpenses).toBe(55_000) // incluye los reembolsos
    expect(r.overdraft).toBe(0)
  })

  it('un gasto normal (kind expense / sin kind) NO se clasifica como devolución', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('v', 80_000, 'cash')],
      layawayPayments: [],
      expenses: [
        { amount: 20_000 }, // sin kind → 'expense'
        { amount: 30_000, kind: 'expense' as const }, // p. ej. pago a proveedor
      ],
    })
    expect(r.returnsExpense).toBe(0)
    expect(r.returnsIncome).toBe(0)
    expect(r.regularExpensesTotal).toBe(50_000)
    expect(r.totalExpenses).toBe(50_000)
    expect(r.expectedCash).toBe(130_000) // 100k + 80k - 50k
  })

  it('solo reembolso (sin ingreso por cambio)', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('v', 50_000, 'cash')],
      layawayPayments: [],
      expenses: [{ amount: 50_000, kind: 'return' as const }],
    })
    expect(r.returnsIncome).toBe(0)
    expect(r.returnsExpense).toBe(50_000)
    expect(r.returnsNet).toBe(-50_000)
    expect(r.regularSalesTotal).toBe(50_000)
    expect(r.expectedCash).toBe(100_000) // 100k + 50k - 50k
  })

  it('solo ingreso por cambio (sin reembolso)', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('dif', 10_000, 'cash', 'ret-x')],
      layawayPayments: [],
      expenses: [],
    })
    expect(r.returnsIncome).toBe(10_000)
    expect(r.returnsExpense).toBe(0)
    expect(r.returnsNet).toBe(10_000)
    expect(r.regularSalesTotal).toBe(0)
    expect(r.cashSales).toBe(10_000)
    expect(r.expectedCash).toBe(110_000) // 100k + 10k
  })

  it('sin devoluciones: los campos nuevos quedan en 0 (compatibilidad)', () => {
    const r = calculateShiftSummary({
      openingAmount: 50_000,
      orders: [order('v', 30_000, 'cash')],
      layawayPayments: [],
      expenses: [{ amount: 5_000 }],
    })
    expect(r.returnsIncome).toBe(0)
    expect(r.returnsExpense).toBe(0)
    expect(r.returnsNet).toBe(0)
    expect(r.regularExpensesTotal).toBe(5_000)
  })
})

describe('calculateShiftSummary — abono histórico no cuenta en caja (028)', () => {
  // Contrato de la Fase 2: las 4 queries de layaway_payments de useShiftClosing
  // y useShiftHistory excluyen is_historical=true ANTES de llamar a esta
  // función pura. Por eso el abono histórico simplemente NO llega acá. Estos
  // tests fijan ese invariante: filtrar el histórico = calcular sin él.

  it('el histórico se filtra antes: el cuadre es idéntico a no tenerlo', () => {
    // Separado viejo: $60.000 recibidos antes (histórico, ya filtrado) + un
    // abono nuevo de $40.000 en efectivo cobrado en este turno.
    const conFiltro = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [],
      layawayPayments: [abono(40_000, 'cash')], // el histórico NO llega
      expenses: [],
    })
    const baseline = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [],
      layawayPayments: [abono(40_000, 'cash')],
      expenses: [],
    })
    expect(conFiltro).toEqual(baseline)
    // Solo el abono nuevo mueve el efectivo esperado.
    expect(conFiltro.cashSales).toBe(40_000)
    expect(conFiltro.layawayPaymentsTotal).toBe(40_000)
    expect(conFiltro.expectedCash).toBe(140_000) // 100.000 + 40.000
  })

  it('el filtro es load-bearing: si el histórico se colara, inflaría el efectivo', () => {
    // Este caso demuestra por qué el filtro importa: pasar el histórico a la
    // función (como si NO se hubiera filtrado) sube cashSales y expectedCash.
    const siSeColara = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [],
      layawayPayments: [abono(60_000, 'cash'), abono(40_000, 'cash')], // histórico + nuevo
      expenses: [],
    })
    expect(siSeColara.cashSales).toBe(100_000) // 60k histórico indebido + 40k
    expect(siSeColara.expectedCash).toBe(200_000) // inflado en los 60k del histórico
    // El cuadre correcto (solo el nuevo) esperaría 140.000, no 200.000.
  })
})

describe('calculateShiftSummary — fiados (029)', () => {
  // Contrato F2: la ORDEN fiada (is_credit) se EXCLUYE del efectivo en la query
  // (.eq('is_credit', false)), así que NUNCA llega como orden a esta función. El
  // efectivo del fiado entra SOLO por creditPayments. Estos tests fijan eso y la
  // separación revenue (orden, ya en reportes) vs caja (abonos, flujo).

  it('los abonos de fiado en efectivo suman al efectivo esperado', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('o1', 40_000, 'cash')],
      layawayPayments: [],
      creditPayments: [creditAbono(30_000, 'cash')],
      expenses: [],
    })
    expect(r.creditPaymentsTotal).toBe(30_000)
    // efectivo = 40.000 venta + 30.000 abono de fiado
    expect(r.cashSales).toBe(70_000)
    expect(r.expectedCash).toBe(170_000) // 100.000 + 70.000
    expect(r.totalSales).toBe(70_000) // 40.000 venta regular + 30.000 abonos
  })

  it('un abono de fiado NO efectivo (tarjeta) no toca el efectivo', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [],
      layawayPayments: [],
      creditPayments: [creditAbono(50_000, 'card')],
      expenses: [],
    })
    expect(r.creditPaymentsTotal).toBe(50_000)
    expect(r.cashSales).toBe(0)
    expect(r.expectedCash).toBe(100_000)
    const card = r.salesByMethod.find((s) => s.method === 'card')
    expect(card).toMatchObject({ method: 'card', creditTotal: 50_000, total: 50_000 })
  })

  it('la orden fiada se excluye aguas arriba: no llega, solo su abono cuenta', () => {
    // Lo que la query pasa al cuadre: SOLO el abono (la orden fiada fue filtrada
    // por is_credit=false). El total del fiado NO se cuenta como efectivo.
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [], // la orden fiada de $100.000 no llega
      layawayPayments: [],
      creditPayments: [creditAbono(30_000, 'cash')], // abono inicial del fiado
      expenses: [],
    })
    expect(r.cashSales).toBe(30_000) // solo el abono, no los $100.000 del fiado
    expect(r.expectedCash).toBe(130_000)
    expect(r.orderCount).toBe(0) // ninguna venta regular
  })

  it('load-bearing: si la fiada NO se excluyera, inflaría el efectivo', () => {
    // Simula el bug de NO filtrar is_credit: el total del fiado ($100.000) se
    // colaría como orden cash, ADEMÁS del abono → efectivo inflado.
    const siSeColara = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('fiada', 100_000, 'cash')], // ERROR: fiada contada como venta cash
      layawayPayments: [],
      creditPayments: [creditAbono(30_000, 'cash')],
      expenses: [],
    })
    expect(siSeColara.cashSales).toBe(130_000) // 100.000 del fiado (indebido) + 30.000
    expect(siSeColara.expectedCash).toBe(230_000) // inflado en los $100.000 del fiado
    // El cuadre correcto (solo el abono de 30k) esperaría 130.000, no 230.000.
  })
})

describe('calculateShiftSummary — pagos MIXTOS (032, Fase 2)', () => {
  // El cuadre ya debe saber sumar una orden con varios métodos, aunque el POS
  // todavía no los genere. Cada order_payment aporta a SU método; solo la
  // porción en efectivo mueve el efectivo esperado.

  it('una orden mixta ($50k cash + $30k card) suma cada método por separado', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [
        orderMixed('m1', [
          { method: 'cash', amount: 50_000 },
          { method: 'card', amount: 30_000 },
        ]),
      ],
      layawayPayments: [],
      expenses: [],
    })
    // Efectivo: SOLO la porción cash ($50k), no el total de la orden.
    expect(r.cashSales).toBe(50_000)
    expect(r.expectedCash).toBe(150_000) // 100.000 + 50.000
    // La orden cuenta como UNA venta aunque tenga dos pagos.
    expect(r.orderCount).toBe(1)
    expect(r.regularSalesTotal).toBe(80_000) // total de la orden
    expect(r.totalSales).toBe(80_000)
    // salesByMethod: una línea por método con su monto.
    const cash = r.salesByMethod.find((s) => s.method === 'cash')
    const card = r.salesByMethod.find((s) => s.method === 'card')
    expect(cash).toMatchObject({ method: 'cash', total: 50_000, count: 1 })
    expect(card).toMatchObject({ method: 'card', total: 30_000, count: 1 })
  })

  it('mixta sin efectivo (card + transfer) no mueve el efectivo esperado', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [
        orderMixed('m1', [
          { method: 'card', amount: 40_000 },
          { method: 'transfer', amount: 20_000 },
        ]),
      ],
      layawayPayments: [],
      expenses: [],
    })
    expect(r.cashSales).toBe(0)
    expect(r.expectedCash).toBe(100_000) // solo la apertura
    expect(r.totalSales).toBe(60_000)
    expect(r.salesByMethod.find((s) => s.method === 'card')?.total).toBe(40_000)
    expect(r.salesByMethod.find((s) => s.method === 'transfer')?.total).toBe(20_000)
  })

  it('mixta + venta simple: agrega por método a través de las órdenes', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [
        orderMixed('m1', [
          { method: 'cash', amount: 50_000 },
          { method: 'card', amount: 30_000 },
        ]),
        order('s1', 20_000, 'cash'), // venta simple en efectivo
      ],
      layawayPayments: [],
      expenses: [],
    })
    // Efectivo total: 50k (mixta) + 20k (simple) = 70k
    expect(r.cashSales).toBe(70_000)
    expect(r.expectedCash).toBe(170_000)
    expect(r.orderCount).toBe(2)
    // cash acumula ambas órdenes: 50k + 20k = 70k en 2 pagos
    expect(r.salesByMethod.find((s) => s.method === 'cash')).toMatchObject({
      method: 'cash',
      total: 70_000,
      count: 2,
    })
    expect(r.salesByMethod.find((s) => s.method === 'card')?.total).toBe(30_000)
  })
})

// ── Comisiones por crédito en efectivo (Fase 4) ────────────────────────────────
describe('calculateShiftSummary — comisiones por crédito', () => {
  it('comisión en efectivo sube cashSales y expectedCash como bucket propio', () => {
    const r = calculateShiftSummary({
      openingAmount: 100_000,
      orders: [order('o1', 50_000)],
      layawayPayments: [],
      commissionIncomes: [{ amount: 50_000 }],
      expenses: [],
    })
    // 100k apertura + 50k venta + 50k comisión = 200k esperado
    expect(r.commissionsIncome).toBe(50_000)
    expect(r.cashSales).toBe(100_000)
    expect(r.expectedCash).toBe(200_000)
  })

  it('la comisión NO es venta: no entra a salesByMethod ni a regularSalesTotal', () => {
    const r = calculateShiftSummary({
      openingAmount: 0,
      orders: [order('o1', 30_000, 'card')], // venta que NO es efectivo
      layawayPayments: [],
      commissionIncomes: [{ amount: 100_000 }],
      expenses: [],
    })
    expect(r.regularSalesTotal).toBe(30_000) // solo la venta
    expect(r.totalSales).toBe(30_000) // la comisión no infla ventas
    expect(r.orderCount).toBe(1)
    // La comisión no crea una fila de método (no es una venta).
    const methods = r.salesByMethod.map((s) => s.method)
    expect(methods).toEqual(['card'])
    // Pero SÍ es efectivo en el cajón → sube el esperado.
    expect(r.cashSales).toBe(100_000)
    expect(r.expectedCash).toBe(100_000)
  })

  it('varias comisiones se suman; sin comisiones el bucket es 0 (compat)', () => {
    const varias = calculateShiftSummary({
      openingAmount: 0,
      orders: [],
      layawayPayments: [],
      commissionIncomes: [{ amount: 50_000 }, { amount: 50_000 }],
      expenses: [],
    })
    expect(varias.commissionsIncome).toBe(100_000)
    expect(varias.expectedCash).toBe(100_000)

    const sin = calculateShiftSummary({
      openingAmount: 0,
      orders: [order('o1', 10_000)],
      layawayPayments: [],
      expenses: [],
    })
    expect(sin.commissionsIncome).toBe(0)
    expect(sin.expectedCash).toBe(10_000)
  })

  it('INVARIANTE: agregar una comisión efectivo solo suma su monto al esperado', () => {
    const base: ShiftSummaryInput = {
      openingAmount: 100_000,
      orders: [order('o1', 40_000)],
      layawayPayments: [abono(20_000)],
      creditPayments: [creditAbono(10_000)],
      expenses: [{ amount: 5_000 }],
    }
    const sin = calculateShiftSummary(base)
    const con = calculateShiftSummary({
      ...base,
      commissionIncomes: [{ amount: 100_000 }],
    })
    // El único cambio en el efectivo esperado es +100.000 (la comisión).
    expect(con.expectedCash - sin.expectedCash).toBe(100_000)
    // Y no cambia nada de ventas/egresos.
    expect(con.totalSales).toBe(sin.totalSales)
    expect(con.totalExpenses).toBe(sin.totalExpenses)
    expect(con.regularSalesTotal).toBe(sin.regularSalesTotal)
  })
})
