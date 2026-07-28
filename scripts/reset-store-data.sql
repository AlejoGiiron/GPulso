-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║                                                                            ║
-- ║   ⚠⚠⚠  RESET DE DATOS OPERATIVOS POR TIENDA — DESTRUCTIVO E IRREVERSIBLE ║
-- ║                                                                            ║
-- ║   Este script BORRA datos reales (ventas, separados, devoluciones, caja,  ║
-- ║   compras, clientes y, opcionalmente, el catálogo) de UNA tienda.         ║
-- ║                                                                            ║
-- ║   NO es una migración. NO va en la app. Es una utilidad manual para        ║
-- ║   correr en el SQL Editor de Supabase.                                     ║
-- ║                                                                            ║
-- ║   ANTES DE EJECUTAR EN PRODUCCIÓN:                                         ║
-- ║     1. Haz un SNAPSHOT / BACKUP de la base (Supabase → Database → Backups).║
-- ║     2. Confirma el store_id objetivo (sección 0).                          ║
-- ║     3. Revisa qué secciones están activas (comenta las que no quieras).    ║
-- ║     4. Idealmente envuelve la corrida en BEGIN; ... ; revisa; COMMIT;       ║
-- ║        (o ROLLBACK; si algo se ve mal). Ver nota al final.                  ║
-- ║                                                                            ║
-- ║   NO se puede deshacer una vez confirmado. No hay papelera.                ║
-- ║                                                                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ════════════════════════════════════════════════════════════════════════════
-- ÍNDICE DE SECCIONES  (orden de ejecución = orden en el archivo)
-- ════════════════════════════════════════════════════════════════════════════
--   0.  Parámetro: store_id objetivo (definir UNA sola vez) + validación
--   E.  Compras            (purchase_invoice_items, supplier_payments,
--                           purchase_invoices) — NO borra suppliers
--   C.  Devoluciones       (return_items, returns)
--   B.  Separados          (layaway_items, layaway_payments, layaways)
--   A.  Ventas e historial (order_items, orders)
--   D.  Caja               (cash_expenses, cash_shifts)
--   F.  Clientes           (customers)
--   G.  Productos e invent. (stock_movements, variants, products) + reset reserved_qty
--
-- CONSERVA SIEMPRE (este script NO los toca):
--   stores · stores.config · profiles · user_stores · suppliers · categories
--
-- ════════════════════════════════════════════════════════════════════════════
-- DEPENDENCIAS ENTRE SECCIONES (por qué este orden)
-- ════════════════════════════════════════════════════════════════════════════
--   · returns.original_order_id → orders   es ON DELETE RESTRICT
--       ⇒ hay que borrar DEVOLUCIONES (C) ANTES que VENTAS (A).
--   · layaways.customer_id → customers     es ON DELETE RESTRICT
--       ⇒ hay que borrar SEPARADOS (B) ANTES que CLIENTES (F).
--   · layaway_payments.layaway_id → layaways es ON DELETE RESTRICT
--       ⇒ dentro de B: abonos ANTES que layaways.
--   · order_items / return_items / layaway_items / purchase_invoice_items /
--     stock_movements  referencian variants y products con ON DELETE RESTRICT
--       ⇒ TODO lo operativo (A, B, C, E, y stock_movements) debe borrarse
--         ANTES que el CATÁLOGO (G: variants/products).
--   · Los FK "que no estorban" (no bloquean borrados) son SET NULL:
--       orders.return_id, cash_expenses.return_id, orders.customer_id,
--       layaways.converted_order_id, supplier_payments.shift_id.
--       Por eso al borrar devoluciones/clientes no se rompe nada aguas arriba.
--
-- Resumen del orden seguro:  E → C → B → A → D → F → G
-- ════════════════════════════════════════════════════════════════════════════


-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 🔒🔒 GUARDA 0 — ¿ESTA BASE ES G-PULSO?  (no saltable, sin parámetro)        │
-- ╰──────────────────────────────────────────────────────────────────────────╯
-- Incidente 2026-07-28 (ver FORKED_FROM.md): el toolchain de backup del repo se
-- heredó del fork apuntando a G-MURA producción (otro cliente). Validar solo el
-- store_id NO protege: un UUID de esa base es "una tienda real" y este script
-- habría borrado producción ajena. Esta guarda valida la BASE, no la tienda.
--
-- Criterio doble: objetos exclusivos de G-Pulso (units / repair_orders /
-- credit_commissions, que G-Mura no tiene) Y la organización 'CelFashion'.
-- Corre ANTES del set_config y de cualquier lectura o DELETE.
DO $guarda_base$
DECLARE
  v_faltan text[] := '{}';
  v_orgs   int;
BEGIN
  IF to_regclass('public.units') IS NULL THEN
    v_faltan := array_append(v_faltan, 'tabla public.units (Fase 2 — serializados)');
  END IF;
  IF to_regclass('public.repair_orders') IS NULL THEN
    v_faltan := array_append(v_faltan, 'tabla public.repair_orders (Fase 3 — taller)');
  END IF;
  IF to_regclass('public.credit_commissions') IS NULL THEN
    v_faltan := array_append(v_faltan, 'tabla public.credit_commissions (Fase 4 — comisiones)');
  END IF;

  IF to_regclass('public.organizations') IS NULL THEN
    v_faltan := array_append(v_faltan, 'tabla public.organizations');
  ELSE
    SELECT count(*) INTO v_orgs FROM public.organizations WHERE name = 'CelFashion';
    IF v_orgs = 0 THEN
      v_faltan := array_append(v_faltan, 'organización ''CelFashion''');
    END IF;
  END IF;

  IF array_length(v_faltan, 1) IS NOT NULL THEN
    RAISE EXCEPTION E'ABORTADO: esta base NO es gpulso-prod.\n'
      '  Falta: %\n'
      '  NO se leyó ni se borró NADA.\n'
      '  Verifica a qué proyecto Supabase apunta tu conexión antes de reintentar.\n'
      '  (La BD de G-Mura / La Bodega del Jeans es OTRO cliente — ver FORKED_FROM.md)',
      array_to_string(v_faltan, ' · ');
  END IF;

  RAISE NOTICE '🔒 GUARDA 0 OK: la base es G-Pulso.';
END
$guarda_base$;


-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ SECCIÓN 0 — PARÁMETRO: store_id objetivo (definir UNA sola vez aquí)       │
-- ╰──────────────────────────────────────────────────────────────────────────╯
-- Cambia SOLO este UUID. Todas las secciones lo leen vía
-- current_setting('gpulso.reset_store_id'). El parámetro vive a nivel de sesión
-- (is_local = false), así que persiste mientras corras todo el script de una.
--
--   ⚠ Ejecuta el script COMPLETO de una sola vez (o al menos esta línea junto
--     con las secciones que quieras correr). Si corres una sección suelta sin
--     esta línea, fallará con "unrecognized configuration parameter" — falla
--     segura, no borra nada.

SELECT set_config('gpulso.reset_store_id',
                  'PEGA-AQUI-EL-UUID-DE-LA-TIENDA',  -- ← ÚNICO lugar a editar
                  false);

-- Validación de seguridad: aborta si el UUID no corresponde a una tienda real.
DO $$
DECLARE
  v_store uuid := current_setting('gpulso.reset_store_id')::uuid;
  v_name  text;
BEGIN
  SELECT name INTO v_name FROM public.stores WHERE id = v_store;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'ABORTADO: no existe ninguna tienda con id %', v_store;
  END IF;
  RAISE NOTICE '>>> Reset apuntando a la tienda: % (%)', v_name, v_store;
END $$;


-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ SECCIÓN E — COMPRAS                                                        │
-- │   Borra: purchase_invoice_items, supplier_payments, purchase_invoices      │
-- │   CONSERVA: suppliers                                                       │
-- │   Hijos antes que padres. Va antes de G (los items referencian variants).  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- E.1 — Líneas de factura (sin store_id propio → vía invoice padre)
DELETE FROM public.purchase_invoice_items
 WHERE invoice_id IN (
   SELECT id FROM public.purchase_invoices
    WHERE store_id = current_setting('gpulso.reset_store_id')::uuid
 );

-- E.2 — Pagos a proveedor (store_id directo). Al borrarse no afecta suppliers.
DELETE FROM public.supplier_payments
 WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;

-- E.3 — Cabeceras de factura (store_id directo)
DELETE FROM public.purchase_invoices
 WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;


-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ SECCIÓN C — DEVOLUCIONES                                                   │
-- │   Borra: return_items, returns                                             │
-- │   DEBE ir ANTES de VENTAS (A): returns.original_order_id → orders RESTRICT. │
-- │   Al borrar returns, orders.return_id y cash_expenses.return_id se ponen   │
-- │   en NULL solos (SET NULL).                                                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- C.1 — Líneas de devolución (sin store_id propio → vía return padre)
DELETE FROM public.return_items
 WHERE return_id IN (
   SELECT id FROM public.returns
    WHERE store_id = current_setting('gpulso.reset_store_id')::uuid
 );

-- C.2 — Cabeceras de devolución (store_id directo)
DELETE FROM public.returns
 WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;


-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ SECCIÓN B — SEPARADOS (layaways)                                           │
-- │   Borra: layaway_items, layaway_payments, layaways                         │
-- │   DEBE ir ANTES de CLIENTES (F): layaways.customer_id → customers RESTRICT. │
-- │   layaway_payments.layaway_id → layaways es RESTRICT → abonos primero.      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- B.1 — Ítems del separado (sin store_id propio → vía layaway padre)
DELETE FROM public.layaway_items
 WHERE layaway_id IN (
   SELECT id FROM public.layaways
    WHERE store_id = current_setting('gpulso.reset_store_id')::uuid
 );

-- B.2 — Abonos del separado (store_id directo). Deben morir antes que layaways.
DELETE FROM public.layaway_payments
 WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;

-- B.3 — Cabeceras de separado (store_id directo)
DELETE FROM public.layaways
 WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;


-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ SECCIÓN A — VENTAS E HISTORIAL                                             │
-- │   Borra: order_items, orders                                               │
-- │   REQUIERE que C (devoluciones) ya se haya corrido, o el DELETE de orders  │
-- │   fallará por returns.original_order_id (RESTRICT).                         │
-- │   Incluye órdenes normales, de diferencia de cambio (return_id) y de       │
-- │   separado completado (converted_order_id).                                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- A.1 — Líneas de venta (sin store_id propio → vía order padre).
--       Su borrado NO repone stock (el trigger de stock está en INSERT).
DELETE FROM public.order_items
 WHERE order_id IN (
   SELECT id FROM public.orders
    WHERE store_id = current_setting('gpulso.reset_store_id')::uuid
 );

-- A.2 — Cabeceras de venta (store_id directo)
DELETE FROM public.orders
 WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;


-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ SECCIÓN D — CAJA                                                           │
-- │   Borra: cash_expenses, cash_shifts                                        │
-- │   Independiente del resto. cash_expenses.shift_id → cash_shifts es CASCADE, │
-- │   pero borramos hijos primero de forma explícita.                          │
-- │   supplier_payments.shift_id → cash_shifts es SET NULL (no estorba).        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- D.1 — Egresos del turno (store_id directo; incluye kind='expense' y 'return')
DELETE FROM public.cash_expenses
 WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;

-- D.2 — Turnos de caja (store_id directo)
DELETE FROM public.cash_shifts
 WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;


-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ SECCIÓN F — CLIENTES                                                       │
-- │   Borra: customers                                                          │
-- │   REQUIERE que B (separados) ya se haya corrido (layaways → customers       │
-- │   RESTRICT). orders.customer_id es SET NULL, así que A no es obligatoria,   │
-- │   pero lo normal es resetear A también.                                     │
-- ╰──────────────────────────────────────────────────────────────────────────╯

DELETE FROM public.customers
 WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;


-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ SECCIÓN G — PRODUCTOS E INVENTARIO                                         │
-- │   G.1 reset reserved_qty   ← SEGURO aunque CONSERVES el catálogo            │
-- │   G.2 stock_movements      ← borra historial de movimientos                 │
-- │   G.3 variants  (CATÁLOGO) ← ⚠ DESTRUCTIVO, comentado por defecto           │
-- │   G.4 products  (CATÁLOGO) ← ⚠ DESTRUCTIVO, comentado por defecto           │
-- │                                                                            │
-- │   DEBE ir AL FINAL: variants/products están referenciados con RESTRICT por  │
-- │   order_items (A), return_items (C), layaway_items (B),                      │
-- │   purchase_invoice_items (E) y stock_movements (G.2). Todos esos deben       │
-- │   estar vacíos para esta tienda antes de G.3/G.4.                            │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- G.1 — Reset de reservas. Útil cuando borras separados (B) pero CONSERVAS el
--       catálogo: deja reserved_qty en 0 ya que las reservas que lo inflaban
--       ya no existen. Idempotente.
UPDATE public.variants
   SET reserved_qty = 0
 WHERE store_id = current_setting('gpulso.reset_store_id')::uuid
   AND reserved_qty <> 0;

-- G.2 — Historial de movimientos de stock (store_id directo).
DELETE FROM public.stock_movements
 WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;

-- G.3 — ⚠ VARIANTES (BORRA EL CATÁLOGO). Descomenta SOLO si quieres un wipe total.
--       Requiere que A, B, C, E y G.2 ya estén corridas para esta tienda.
-- DELETE FROM public.variants
--  WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;

-- G.4 — ⚠ PRODUCTOS (BORRA EL CATÁLOGO). Descomenta junto con G.3 para wipe total.
--       (Borrar productos haría CASCADE sobre variants, pero G.3 ya las borra
--        explícitamente para respetar el orden y los RESTRICT de las líneas.)
-- DELETE FROM public.products
--  WHERE store_id = current_setting('gpulso.reset_store_id')::uuid;


-- ════════════════════════════════════════════════════════════════════════════
-- LIMPIEZA DEL PARÁMETRO DE SESIÓN (opcional)
-- ════════════════════════════════════════════════════════════════════════════
-- SELECT set_config('gpulso.reset_store_id', '', false);

-- ════════════════════════════════════════════════════════════════════════════
-- NOTA — correr dentro de una transacción para poder abortar:
--   Envuelve el bloque que quieras correr así:
--
--     BEGIN;
--       -- (la línea SELECT set_config ... + las secciones deseadas)
--       -- revisa los "rows affected" de cada statement en el panel de Supabase
--     COMMIT;     -- o  ROLLBACK;  si algo se ve mal
--
--   set_config(..., false) funciona igual dentro de la transacción.
-- ════════════════════════════════════════════════════════════════════════════
