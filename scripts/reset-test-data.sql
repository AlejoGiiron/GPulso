-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⚠⚠⚠  reset-test-data.sql — BORRADO DESTRUCTIVO E IRREVERSIBLE  ⚠⚠⚠        ║
-- ║                                                                            ║
-- ║  Borra TODOS los datos TRANSACCIONALES de UNA tienda (ventas, pagos,       ║
-- ║  devoluciones, separados, caja, gastos, unidades serializadas, movimientos ║
-- ║  de stock, reparaciones, comisiones, compras, y el CATÁLOGO de prueba:     ║
-- ║  productos/variantes/categorías/clientes).                                 ║
-- ║                                                                            ║
-- ║  CONSERVA (NO toca): organizations, stores, stores.config, profiles,       ║
-- ║  user_stores, roles (permisos), suppliers.                                 ║
-- ║                                                                            ║
-- ║  Pensado para limpiar los datos de una ronda de QA antes de que el cliente ║
-- ║  arranque. NO es una migración; NO va en la app.                           ║
-- ║                                                                            ║
-- ║  ⛔ EXIGE BACKUP PREVIO. No hay papelera. Una vez COMMIT, no se deshace.    ║
-- ║     En prod: Supabase → Database → Backups (o pg_dump). Ver PROD-FASE*.md.  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- USO (psql / docker, el patrón de los PROD-FASE*.md):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v store_id='<UUID-DE-LA-TIENDA>' \
--        -f scripts/reset-test-data.sql
--
--   Contenedorizado:
--     { echo "SET x=1;"; cat scripts/reset-test-data.sql; }  # (ejemplo)
--     MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
--       sh -c 'psql "$GPULSO_DB_URL" -v ON_ERROR_STOP=1 -v store_id='"'"'<UUID>'"'"' -f -' \
--       < scripts/reset-test-data.sql
--
--   En el SQL Editor de Supabase (sin -v): reemplaza la línea marcada "EDITAR"
--   más abajo por el UUID literal y corre todo el bloque de una.
--
-- GARANTÍAS:
--   · Recibe store_id como PARÁMETRO (-v store_id=…), sin UUID hardcodeado.
--   · Va en UNA transacción (BEGIN…COMMIT): si algo falla, ROLLBACK total.
--   · ABORTA si el store_id no existe (RAISE EXCEPTION → revierte).
--   · Respeta el orden de las FK (ver mapa abajo) — sin CASCADE sorpresa.
--   · Imprime un CONTEO de filas borradas por tabla (RAISE NOTICE).
--
-- ════════════════════════════════════════════════════════════════════════════
-- ORDEN SEGURO (hijos / referenciadores RESTRICT primero). FKs verificadas en BD:
--   RESTRICT que mandan el orden:
--     returns.original_order_id → orders    ⇒ devoluciones ANTES que ventas
--     credit_payments.order_id  → orders    ⇒ fiado ANTES que ventas
--     layaway_payments.layaway_id → layaways⇒ abonos ANTES que separados
--     layaways.customer_id / repair_orders.customer_id → customers (RESTRICT)
--                                           ⇒ separados y reparaciones ANTES que clientes
--     order_items / return_items / layaway_items / purchase_invoice_items /
--       stock_movements  .variant_id/.product_id → variants/products (RESTRICT)
--                                           ⇒ TODO lo de líneas + movimientos ANTES que catálogo
--   CASCADE a vigilar (se borran solos, por eso los borro EXPLÍCITO para contarlos):
--     order_items, order_payments (←orders) · return_items (←returns) ·
--     layaway_items (←layaways) · repair_parts, repair_status_history (←repair_orders) ·
--     units, variants (←variants/products) · cash_expenses (←cash_shifts)
--   SET NULL (no estorban): orders.customer_id/shift_id/return_id,
--     credit_commissions.customer_id/shift_id, layaway_payments.shift_id,
--     supplier_payments.shift_id, repair_parts.variant_id, stock_movements.unit_id,
--     units.order_item_id/purchase_invoice_item_id/layaway_id, products.category_id
--
--   Secuencia:  A compras → B reparaciones → C devoluciones → D separados →
--               E ventas → F comisiones → G caja → H inventario → I clientes →
--               J catálogo
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

\if :{?store_id} \else
  \echo '✗ ERROR: falta -v store_id="<uuid-de-la-tienda>".'
  \quit 1
\endif

BEGIN;

-- Parámetro → GUC transaccional (los psql :vars NO entran a un bloque DO;
-- el DO lo lee con current_setting). is_local=true → muere con la transacción.
-- ── EDITAR (solo si corres en el SQL Editor sin -v): cambia :'store_id' por
--    '<uuid>' literal en la línea siguiente. ─────────────────────────────────
SELECT set_config('gpulso.reset_store_id', :'store_id', true);

DO $$
DECLARE
  v_store uuid := current_setting('gpulso.reset_store_id')::uuid;
  v_name  text;
  n       bigint;
  total   bigint := 0;
BEGIN
  -- Validación: la tienda debe existir. Si no, aborta y revierte TODO.
  SELECT name INTO v_name FROM public.stores WHERE id = v_store;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'ABORTADO: no existe ninguna tienda con id %', v_store;
  END IF;
  RAISE NOTICE '>>> Reset de datos de PRUEBA — tienda: % (%)', v_name, v_store;
  RAISE NOTICE '    (conserva org, tiendas, usuarios, roles y suppliers)';

  -- ── A. COMPRAS ────────────────────────────────────────────────────────────
  DELETE FROM public.purchase_invoice_items
   WHERE invoice_id IN (SELECT id FROM public.purchase_invoices WHERE store_id = v_store);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  purchase_invoice_items : %', n;

  DELETE FROM public.supplier_payments WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  supplier_payments      : %', n;

  DELETE FROM public.purchase_invoices WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  purchase_invoices      : %', n;

  -- ── B. REPARACIONES (taller) ──────────────────────────────────────────────
  DELETE FROM public.repair_status_history WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  repair_status_history  : %', n;

  DELETE FROM public.repair_parts WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  repair_parts           : %', n;

  DELETE FROM public.repair_orders WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  repair_orders          : %', n;

  -- ── C. DEVOLUCIONES (antes que ventas) ────────────────────────────────────
  DELETE FROM public.return_items
   WHERE return_id IN (SELECT id FROM public.returns WHERE store_id = v_store);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  return_items           : %', n;

  DELETE FROM public.returns WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  returns                : %', n;

  -- ── D. SEPARADOS (antes que clientes) ─────────────────────────────────────
  DELETE FROM public.layaway_items
   WHERE layaway_id IN (SELECT id FROM public.layaways WHERE store_id = v_store);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  layaway_items          : %', n;

  DELETE FROM public.layaway_payments WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  layaway_payments       : %', n;

  DELETE FROM public.layaways WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  layaways               : %', n;

  -- ── E. VENTAS (fiado + pagos + ítems antes que las órdenes) ───────────────
  DELETE FROM public.credit_payments WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  credit_payments        : %', n;

  DELETE FROM public.order_payments WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  order_payments         : %', n;

  DELETE FROM public.order_items
   WHERE order_id IN (SELECT id FROM public.orders WHERE store_id = v_store);
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  order_items            : %', n;

  DELETE FROM public.orders WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  orders                 : %', n;

  -- ── F. COMISIONES POR CRÉDITO ─────────────────────────────────────────────
  DELETE FROM public.credit_commissions WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  credit_commissions     : %', n;

  -- ── G. CAJA (gastos antes que turnos) ─────────────────────────────────────
  DELETE FROM public.cash_expenses WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  cash_expenses          : %', n;

  DELETE FROM public.cash_shifts WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  cash_shifts            : %', n;

  -- ── H. INVENTARIO (movimientos + unidades antes que variantes) ────────────
  DELETE FROM public.stock_movements WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  stock_movements        : %', n;

  DELETE FROM public.units WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  units                  : %', n;

  -- ── I. CLIENTES (después de separados y reparaciones) ─────────────────────
  DELETE FROM public.customers WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  customers              : %', n;

  -- ── J. CATÁLOGO (variantes → productos → categorías) ──────────────────────
  DELETE FROM public.variants WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  variants               : %', n;

  DELETE FROM public.products WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  products               : %', n;

  DELETE FROM public.categories WHERE store_id = v_store;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n; RAISE NOTICE '  categories             : %', n;

  RAISE NOTICE '>>> TOTAL filas borradas: %', total;
END $$;

-- Verificación pre-commit: lo transaccional en 0; org/usuarios/roles intactos.
\echo '--- Verificación (revisa antes del COMMIT) ---'
SELECT 'transaccional_restante' AS chequeo,
  (SELECT count(*) FROM public.orders             WHERE store_id = :'store_id') AS orders,
  (SELECT count(*) FROM public.cash_shifts        WHERE store_id = :'store_id') AS shifts,
  (SELECT count(*) FROM public.credit_commissions WHERE store_id = :'store_id') AS comisiones,
  (SELECT count(*) FROM public.repair_orders      WHERE store_id = :'store_id') AS reparaciones,
  (SELECT count(*) FROM public.units              WHERE store_id = :'store_id') AS unidades,
  (SELECT count(*) FROM public.products           WHERE store_id = :'store_id') AS productos,
  (SELECT count(*) FROM public.customers          WHERE store_id = :'store_id') AS clientes;

SELECT 'preservado' AS chequeo,
  (SELECT count(*) FROM public.stores    WHERE id = :'store_id') AS tienda,
  (SELECT count(*) FROM public.profiles  WHERE store_id = :'store_id') AS usuarios,
  (SELECT count(*) FROM public.roles r JOIN public.stores s ON s.organization_id = r.organization_id
    WHERE s.id = :'store_id') AS roles_org,
  (SELECT count(*) FROM public.suppliers WHERE store_id = :'store_id') AS suppliers;

COMMIT;

\echo '✔ reset-test-data COMPLETADO (COMMIT). Datos transaccionales de la tienda en cero; org/usuarios/roles/suppliers intactos.'
