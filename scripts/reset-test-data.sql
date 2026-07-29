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
-- ║                                                                            ║
-- ║  ⛔ NUNCA correr con el store_id de una tienda EN OPERACIÓN. Verifica el     ║
-- ║     store_id contra la tienda de PRUEBAS antes de ejecutar. Este script     ║
-- ║     borraría ventas, inventario y caja reales sin más preguntas.            ║
-- ║                                                                            ║
-- ║  🔒 GUARDA 0 — DE BASE (no saltable, sin parámetro): el script ABORTA si la ║
-- ║     base no es G-Pulso. Exige objetos exclusivos (units, repair_orders,     ║
-- ║     credit_commissions) Y la org 'CelFashion'. Corre ANTES de leer nada.    ║
-- ║     Protege contra la BASE equivocada; las guardas 1-2 solo protegen contra ║
-- ║     la TIENDA equivocada dentro de la base correcta. Ver FORKED_FROM.md.    ║
-- ║                                                                            ║
-- ║  🔒 GUARDA DE CONFIRMACIÓN (doble, obligatoria): el script ABORTA sin borrar ║
-- ║     nada salvo que se pasen AMBOS:                                          ║
-- ║       -v i_understand=YES            (acuse consciente, literal 'YES')       ║
-- ║       -v confirm_store_name='<nombre EXACTO de la tienda>'                   ║
-- ║     El nombre debe COINCIDIR con el de la tienda del store_id. Así, borrar   ║
-- ║     en serio exige una acción consciente y atada al objetivo — no se puede   ║
-- ║     disparar por accidente ni copiando-pegando un comando viejo.            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- USO (psql / docker, el patrón de los PROD-FASE*.md):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 \
--        -v store_id='<UUID-DE-LA-TIENDA-DE-PRUEBAS>' \
--        -v i_understand=YES \
--        -v confirm_store_name='<nombre EXACTO de esa tienda>' \
--        -f scripts/reset-test-data.sql
--
--   Contenedorizado:
--     MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
--       sh -c 'psql "$GPULSO_DB_URL" -v ON_ERROR_STOP=1 \
--                 -v store_id='"'"'<UUID>'"'"' \
--                 -v i_understand=YES \
--                 -v confirm_store_name='"'"'<nombre exacto>'"'"' -f -' \
--       < scripts/reset-test-data.sql
--
--   En el SQL Editor de Supabase (sin -v): reemplaza los tres literales marcados
--   "EDITAR" más abajo (store_id, i_understand, confirm_store_name).
--
-- ⚠ WINDOWS + NOMBRES CON ACENTOS O RAYA LARGA (—): NO pasar confirm_store_name
--   por línea de comandos. Windows convierte los argumentos de UTF-8 al codepage
--   ANSI, así que una raya larga (U+2014, bytes e2 80 94) llega como 0x97 y psql
--   la rechaza con «invalid byte sequence for encoding "UTF8"». La GUARDA 2
--   aborta —o el script revienta a mitad— aunque el nombre sea el correcto.
--   (Detectado el 2026-07-28 con la tienda 'CelFashion — Principal'.)
--
--   SOLUCIÓN: pasar los parámetros por ARCHIVO, que no atraviesa argv. Crea un
--   wrapper .sql en UTF-8 y ejecútalo con psql -f:
--
--       \set store_id 'UUID-DE-LA-TIENDA'
--       \set i_understand YES
--       \set confirm_store_name 'CelFashion — Principal'
--       \i scripts/reset-test-data.sql
--
--   Comprobación previa (solo lectura) de que el literal coincide byte a byte:
--       SELECT (name = :'confirm_store_name') FROM public.stores WHERE id = :'store_id';
--   Debe dar t ANTES de ejecutar el reset.
--
-- GARANTÍAS:
--   · Recibe store_id como PARÁMETRO (-v store_id=…), sin UUID hardcodeado.
--   · GUARDA DE CONFIRMACIÓN doble: aborta sin borrar nada salvo que
--       i_understand='YES' (literal) Y confirm_store_name = nombre real de la
--       tienda del store_id. Impide un borrado accidental o por copiar-pegar.
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

-- ════════════════════════════════════════════════════════════════════════════
-- 🔒🔒 GUARDA 0 — ¿ESTA BASE ES G-PULSO?  (la guarda MÁS importante)
--
-- POR QUÉ EXISTE (incidente 2026-07-28, ver FORKED_FROM.md):
--   Las guardas 1 y 2 (i_understand + confirm_store_name) protegen contra la
--   TIENDA equivocada DENTRO de la base correcta. NO protegen contra la BASE
--   equivocada. El toolchain de backup se heredó del fork apuntando a G-MURA
--   producción (otro cliente, La Bodega del Jeans): con un store_id y un nombre
--   de tienda de ESA base, las guardas 1 y 2 habrían pasado limpias y este
--   script habría borrado producción de un cliente ajeno al proyecto.
--
-- CRITERIO (doble, ambas condiciones obligatorias):
--   a) Objetos ESTRUCTURALES exclusivos de G-Pulso, que G-Mura no tiene:
--        public.units               (Fase 2 — unidades serializadas / IMEI)
--        public.repair_orders       (Fase 3 — taller de reparaciones)
--        public.credit_commissions  (Fase 4 — comisiones por crédito)
--   b) El TENANT esperado: debe existir la organización 'CelFashion'.
--
--   (a) descarta cualquier base con esquema de G-Mura aunque le crearan una org
--   homónima; (b) descarta una base de G-Pulso virgen/ajena sin el tenant real.
--
-- NO ES SALTABLE POR PARÁMETRO: no lee ningún :var ni GUC. Para "saltarla" hay
--   que editar este archivo — un acto consciente y visible en el diff.
--
-- Corre ANTES de abrir la transacción y ANTES de leer nada: si aborta, no se
--   ejecutó ni un SELECT sobre datos.
-- ════════════════════════════════════════════════════════════════════════════
DO $guarda_base$
DECLARE
  v_faltan text[] := '{}';
  v_orgs   int;
BEGIN
  -- (a) Objetos estructurales exclusivos de G-Pulso.
  IF to_regclass('public.units') IS NULL THEN
    v_faltan := array_append(v_faltan, 'tabla public.units (Fase 2 — serializados)');
  END IF;
  IF to_regclass('public.repair_orders') IS NULL THEN
    v_faltan := array_append(v_faltan, 'tabla public.repair_orders (Fase 3 — taller)');
  END IF;
  IF to_regclass('public.credit_commissions') IS NULL THEN
    v_faltan := array_append(v_faltan, 'tabla public.credit_commissions (Fase 4 — comisiones)');
  END IF;

  -- (b) El tenant esperado de G-Pulso.
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
      '  Verifica a qué proyecto Supabase apunta tu cadena de conexión antes de reintentar.\n'
      '  (Recordatorio: la BD de G-Mura / La Bodega del Jeans es OTRO cliente — ver FORKED_FROM.md)',
      array_to_string(v_faltan, ' · ');
  END IF;

  RAISE NOTICE '🔒 GUARDA 0 OK: la base es G-Pulso (units + repair_orders + credit_commissions + org CelFashion).';
END
$guarda_base$;

-- Presencia de los 3 parámetros (falla segura ANTES de abrir transacción).
\if :{?store_id} \else
  \echo '✗ ERROR: falta -v store_id="<uuid-de-la-tienda-de-PRUEBAS>".'
  \quit 1
\endif
\if :{?i_understand} \else
  \echo '✗ ABORTADO: falta la guarda -v i_understand=YES (acuse consciente).'
  \quit 1
\endif
\if :{?confirm_store_name} \else
  \echo '✗ ABORTADO: falta -v confirm_store_name="<nombre EXACTO de la tienda>".'
  \quit 1
\endif

BEGIN;

-- Parámetros → GUCs transaccionales (los psql :vars NO entran a un bloque DO;
-- el DO los lee con current_setting). is_local=true → mueren con la transacción.
-- ── EDITAR (solo si corres en el SQL Editor sin -v): cambia los tres literales
--    (store_id, i_understand, confirm_store_name) en las 3 líneas siguientes. ──
SELECT set_config('gpulso.reset_store_id',    :'store_id',           true);
SELECT set_config('gpulso.reset_ack',         :'i_understand',       true);
SELECT set_config('gpulso.reset_confirm_name', :'confirm_store_name', true);

DO $$
DECLARE
  v_store   uuid := current_setting('gpulso.reset_store_id')::uuid;
  v_name    text;
  v_ack     text := current_setting('gpulso.reset_ack');
  v_confirm text := current_setting('gpulso.reset_confirm_name');
  n         bigint;
  total     bigint := 0;
BEGIN
  -- 🔒 GUARDA 1 — acuse consciente. Debe ser exactamente 'YES'.
  IF v_ack <> 'YES' THEN
    RAISE EXCEPTION 'ABORTADO: la guarda i_understand debe ser exactamente YES (recibido: %). No se borró nada.', quote_literal(v_ack);
  END IF;

  -- Validación: la tienda debe existir. Si no, aborta y revierte TODO.
  SELECT name INTO v_name FROM public.stores WHERE id = v_store;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'ABORTADO: no existe ninguna tienda con id %. No se borró nada.', v_store;
  END IF;

  -- 🔒 GUARDA 2 — el nombre confirmado debe COINCIDIR con el real de la tienda.
  -- Ata la confirmación al objetivo: un comando viejo con OTRO store_id no
  -- coincidiría con el nombre y aborta. Debe ser el nombre de la tienda de PRUEBAS.
  IF v_confirm IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'ABORTADO: confirm_store_name (%) NO coincide con el nombre real de la tienda del store_id (%). Verifica que apuntas a la tienda de PRUEBAS. No se borró nada.',
      quote_literal(v_confirm), quote_literal(v_name);
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
