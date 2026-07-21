-- ============================================================
-- test-deliver-repair.sql — Tests de add_repair_part y deliver_repair (045)
-- Consumo atómico de repuestos, cobro atómico al retirar, permisos (técnico no
-- vende / vendedor cobra), garantía $0, turno por tienda y ciclo de estados.
-- Transacción con ROLLBACK final. Estilo de scripts/test-create-order.sql.
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id,email) VALUES
  ('00000000-0000-0000-0000-0000000000e1','admin@rep.test'),
  ('00000000-0000-0000-0000-0000000000e2','seller@rep.test'),
  ('00000000-0000-0000-0000-0000000000e3','tech@rep.test');
INSERT INTO public.organizations (name) VALUES ('OrgREP') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');   -- crea Dueño/Administrador/Vendedor/Técnico
SELECT id AS role_admin  FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
SELECT id AS role_seller FROM public.roles WHERE organization_id=:'org' AND name='Vendedor' \gset
SELECT id AS role_tech   FROM public.roles WHERE organization_id=:'org' AND name='Técnico' \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreREP', :'org') RETURNING id AS store \gset
INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active) VALUES
  ('00000000-0000-0000-0000-0000000000e1','admin@rep.test','Admin REP','admin',:'role_admin',:'org',:'store',:'store',true),
  ('00000000-0000-0000-0000-0000000000e2','seller@rep.test','Seller REP','seller',:'role_seller',:'org',:'store',:'store',true),
  ('00000000-0000-0000-0000-0000000000e3','tech@rep.test','Tech REP','seller',:'role_tech',:'org',:'store',:'store',true);

-- Turno ABIERTO por la admin (las entregas se cobran bajo el turno de la tienda).
INSERT INTO public.cash_shifts (store_id, opened_by, opening_amount)
VALUES (:'store', '00000000-0000-0000-0000-0000000000e1', 100000);

-- Cliente (obligatorio en una reparación).
INSERT INTO public.customers (id, full_name, phone, store_id)
VALUES ('00000000-0000-0000-0000-0000000000ca', 'Cliente REP', '3001234567', :'store');

-- Repuesto: producto normal por cantidad (categoría Repuestos), stock 10, costo 5000.
INSERT INTO public.products (name, store_id) VALUES ('Pantalla A10', :'store') RETURNING id AS prep \gset
INSERT INTO public.variants (product_id, store_id, price, cost_price, stock_qty)
VALUES (:'prep', :'store', 80000, 5000, 10) RETURNING id AS vrep \gset

-- Orden de reparación en estado 'listo', precio definido.
INSERT INTO public.repair_orders
  (store_id, customer_id, marca, modelo, imei_serial, falla_reportada, status, precio, received_by)
VALUES
  (:'store', '00000000-0000-0000-0000-0000000000ca', 'Samsung', 'A10', 'IMEI-REP-1',
   'No enciende', 'listo', 150000, '00000000-0000-0000-0000-0000000000e1')
RETURNING id AS rep1 \gset

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- ── T1 — add_repair_part: inventario descuenta stock + compra externa ────────
DO $$
DECLARE v_rep uuid; v_vrep uuid; v_part uuid; v_stock int; v_costo numeric;
BEGIN
  SELECT id INTO v_rep FROM public.repair_orders WHERE imei_serial='IMEI-REP-1';
  SELECT v.id INTO v_vrep FROM public.variants v JOIN public.products p ON p.id=v.product_id WHERE p.name='Pantalla A10';

  v_part := public.add_repair_part(v_rep,'inventario',v_vrep,2,NULL,NULL);
  SELECT stock_qty INTO v_stock FROM public.variants WHERE id=v_vrep;
  IF v_stock <> 8 THEN RAISE EXCEPTION 'T1 FALLO: stock no bajó (esperado 8, got %)', v_stock; END IF;
  SELECT costo INTO v_costo FROM public.repair_parts WHERE id=v_part;
  IF v_costo <> 10000 THEN RAISE EXCEPTION 'T1 FALLO: costo (esperado 10000 = 5000*2, got %)', v_costo; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE reference_id=v_rep AND type='repair_consumption' AND qty=-2) THEN
    RAISE EXCEPTION 'T1 FALLO: sin movimiento repair_consumption';
  END IF;

  -- Compra externa: solo descripción + costo.
  v_part := public.add_repair_part(v_rep,'compra_externa',NULL,NULL,'Flex de carga',12000);
  IF (SELECT costo FROM public.repair_parts WHERE id=v_part) <> 12000 THEN RAISE EXCEPTION 'T1 FALLO: compra externa'; END IF;

  RAISE NOTICE 'T1 OK: repuesto inventario (stock -2, costo de variante) + compra externa.';
END $$;

-- ── T2 — add_repair_part sin stock suficiente → rechazado ────────────────────
DO $$
DECLARE v_ok boolean:=false; v_rep uuid; v_vrep uuid; v_stock int;
BEGIN
  SELECT id INTO v_rep FROM public.repair_orders WHERE imei_serial='IMEI-REP-1';
  SELECT v.id INTO v_vrep FROM public.variants v JOIN public.products p ON p.id=v.product_id WHERE p.name='Pantalla A10';
  SELECT stock_qty INTO v_stock FROM public.variants WHERE id=v_vrep;   -- 8
  BEGIN PERFORM public.add_repair_part(v_rep,'inventario',v_vrep,999,NULL,NULL);
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T2 FALLO: consumió sin stock'; END IF;
  IF (SELECT stock_qty FROM public.variants WHERE id=v_vrep) <> v_stock THEN RAISE EXCEPTION 'T2 FALLO: stock cambió'; END IF;
  RAISE NOTICE 'T2 OK: repuesto sin stock → rechazado, stock intacto.';
END $$;

-- ── T2b — remove_repair_part: restaura stock + movimiento inverso ────────────
DO $$
DECLARE v_rep uuid; v_vrep uuid; v_part uuid; v_stock0 int; v_stock1 int; v_stock2 int;
BEGIN
  SELECT id INTO v_rep FROM public.repair_orders WHERE imei_serial='IMEI-REP-1';
  SELECT v.id INTO v_vrep FROM public.variants v JOIN public.products p ON p.id=v.product_id WHERE p.name='Pantalla A10';
  SELECT stock_qty INTO v_stock0 FROM public.variants WHERE id=v_vrep;   -- 8 (tras T1)
  v_part := public.add_repair_part(v_rep,'inventario',v_vrep,3,NULL,NULL);
  SELECT stock_qty INTO v_stock1 FROM public.variants WHERE id=v_vrep;   -- 5
  IF v_stock1 <> v_stock0 - 3 THEN RAISE EXCEPTION 'T2b FALLO: no descontó (got %)', v_stock1; END IF;

  PERFORM public.remove_repair_part(v_part);
  SELECT stock_qty INTO v_stock2 FROM public.variants WHERE id=v_vrep;   -- 8 de nuevo
  IF v_stock2 <> v_stock0 THEN RAISE EXCEPTION 'T2b FALLO: no restauró stock (esperado %, got %)', v_stock0, v_stock2; END IF;
  IF EXISTS (SELECT 1 FROM public.repair_parts WHERE id=v_part) THEN RAISE EXCEPTION 'T2b FALLO: no borró la fila'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE reference_id=v_rep AND type='repair_consumption' AND qty=3) THEN
    RAISE EXCEPTION 'T2b FALLO: sin movimiento inverso (qty +3)';
  END IF;
  RAISE NOTICE 'T2b OK: reverso de repuesto → stock restaurado + movimiento inverso + fila borrada.';
END $$;

-- ── T3 — deliver_repair como VENDEDORA (pos.usar) → venta atómica ────────────
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
DO $$
DECLARE v_rep uuid; v_order uuid; v_svc uuid;
BEGIN
  SELECT id INTO v_rep FROM public.repair_orders WHERE imei_serial='IMEI-REP-1';
  v_order := public.deliver_repair(v_rep,
    jsonb_build_array(jsonb_build_object('method','cash','amount',150000)), 150000);
  IF v_order IS NULL THEN RAISE EXCEPTION 'T3 FALLO: sin orden'; END IF;
  IF (SELECT status FROM public.repair_orders WHERE id=v_rep) <> 'entregado' THEN RAISE EXCEPTION 'T3 FALLO: no entregado'; END IF;
  IF (SELECT order_id FROM public.repair_orders WHERE id=v_rep) <> v_order THEN RAISE EXCEPTION 'T3 FALLO: order_id no ligado'; END IF;
  IF (SELECT total FROM public.orders WHERE id=v_order) <> 150000 THEN RAISE EXCEPTION 'T3 FALLO: total'; END IF;
  -- La línea es un producto de servicio (no descontó stock).
  SELECT oi.variant_id INTO v_svc FROM public.order_items oi WHERE oi.order_id=v_order;
  IF NOT public.is_service_variant(v_svc) THEN RAISE EXCEPTION 'T3 FALLO: la línea no es de servicio'; END IF;
  IF (SELECT count(*) FROM public.order_payments WHERE order_id=v_order) <> 1 THEN RAISE EXCEPTION 'T3 FALLO: pagos'; END IF;
  -- Historial: existe una fila 'entregado'.
  IF NOT EXISTS (SELECT 1 FROM public.repair_status_history WHERE repair_order_id=v_rep AND status='entregado') THEN
    RAISE EXCEPTION 'T3 FALLO: sin historial entregado';
  END IF;
  RAISE NOTICE 'T3 OK: vendedora cobra entrega → venta de servicio + pago + entregado + historial.';
END $$;

-- ── T4 — doble entrega (ya entregada) → rechazada (idempotencia/carrera) ─────
DO $$
DECLARE v_ok boolean:=false; v_rep uuid; v_ob bigint; v_oa bigint;
BEGIN
  SELECT id INTO v_rep FROM public.repair_orders WHERE imei_serial='IMEI-REP-1';
  SELECT count(*) INTO v_ob FROM public.orders;
  BEGIN PERFORM public.deliver_repair(v_rep,
    jsonb_build_array(jsonb_build_object('method','cash','amount',150000)), 150000);
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  SELECT count(*) INTO v_oa FROM public.orders;
  IF NOT v_ok THEN RAISE EXCEPTION 'T4 FALLO: entregó dos veces'; END IF;
  IF v_oa <> v_ob THEN RAISE EXCEPTION 'T4 FALLO: orden fantasma en 2da entrega'; END IF;
  RAISE NOTICE 'T4 OK: 2da entrega rechazada, sin orden fantasma.';
END $$;

-- ── T4b — remove_repair_part sobre orden ENTREGADA → rechazado ───────────────
DO $$
DECLARE v_ok boolean:=false; v_part uuid;
BEGIN
  SELECT rp.id INTO v_part FROM public.repair_parts rp
    JOIN public.repair_orders ro ON ro.id=rp.repair_order_id
   WHERE ro.imei_serial='IMEI-REP-1' AND rp.source='inventario' LIMIT 1;   -- orden ya entregada en T3
  IF v_part IS NULL THEN RAISE EXCEPTION 'T4b setup: sin repuesto en la orden entregada'; END IF;
  BEGIN PERFORM public.remove_repair_part(v_part);
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T4b FALLO: quitó repuesto de una reparación entregada'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.repair_parts WHERE id=v_part) THEN RAISE EXCEPTION 'T4b FALLO: borró la fila'; END IF;
  RAISE NOTICE 'T4b OK: no se quitan repuestos de una reparación entregada.';
END $$;

-- ── Fixture 2: otra orden 'listo' para los tests de rechazo/atomicidad ───────
INSERT INTO public.repair_orders
  (store_id, customer_id, marca, modelo, falla_reportada, status, precio, received_by)
VALUES
  ((SELECT id FROM public.stores WHERE name='StoreREP'), '00000000-0000-0000-0000-0000000000ca',
   'Xiaomi', 'Redmi 9', 'Pantalla', 'listo', 200000, '00000000-0000-0000-0000-0000000000e1')
RETURNING id AS rep2 \gset

-- ── T5 — TÉCNICO no puede cobrar (sin pos.usar) → rechazado ──────────────────
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}';
DO $$
DECLARE v_ok boolean:=false; v_rep uuid;
BEGIN
  SELECT id INTO v_rep FROM public.repair_orders WHERE modelo='Redmi 9';
  BEGIN PERFORM public.deliver_repair(v_rep,
    jsonb_build_array(jsonb_build_object('method','cash','amount',200000)), 200000);
  EXCEPTION WHEN insufficient_privilege THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T5 FALLO: el técnico vendió'; END IF;
  IF (SELECT status FROM public.repair_orders WHERE id=v_rep) <> 'listo' THEN RAISE EXCEPTION 'T5 FALLO: cambió estado'; END IF;
  RAISE NOTICE 'T5 OK: el técnico no vende (deliver_repair rechazado por pos.usar).';
END $$;

-- ── T6 — ATOMICIDAD: falla un pago (método inválido) → nada queda ────────────
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
DO $$
DECLARE v_ok boolean:=false; v_rep uuid; v_ob bigint; v_oa bigint; v_ib bigint; v_ia bigint;
BEGIN
  SELECT id INTO v_rep FROM public.repair_orders WHERE modelo='Redmi 9';
  SELECT count(*) INTO v_ob FROM public.orders;
  SELECT count(*) INTO v_ib FROM public.order_items;
  -- 'bogus' no es un payment_method → el cast falla DESPUÉS de crear orden e ítem.
  BEGIN PERFORM public.deliver_repair(v_rep,
    jsonb_build_array(jsonb_build_object('method','bogus','amount',200000)), 200000);
  EXCEPTION WHEN others THEN v_ok:=true; END;
  SELECT count(*) INTO v_oa FROM public.orders;
  SELECT count(*) INTO v_ia FROM public.order_items;
  IF NOT v_ok THEN RAISE EXCEPTION 'T6 FALLO: no falló con método inválido'; END IF;
  IF v_oa <> v_ob THEN RAISE EXCEPTION 'T6 FALLO: quedó orden a pesar del error'; END IF;
  IF v_ia <> v_ib THEN RAISE EXCEPTION 'T6 FALLO: quedó order_item a pesar del error'; END IF;
  IF (SELECT status FROM public.repair_orders WHERE id=v_rep) <> 'listo' THEN RAISE EXCEPTION 'T6 FALLO: se marcó entregado'; END IF;
  RAISE NOTICE 'T6 OK: pago inválido → rollback total (sin orden, sin ítem, sigue listo).';
END $$;

-- ── T7 — pagos que no cuadran / garantía $0 con pagos → rechazados ───────────
DO $$
DECLARE v_ok boolean:=false; v_rep uuid;
BEGIN
  SELECT id INTO v_rep FROM public.repair_orders WHERE modelo='Redmi 9';
  v_ok:=false;
  BEGIN PERFORM public.deliver_repair(v_rep,
    jsonb_build_array(jsonb_build_object('method','cash','amount',100000)), 100000);  -- < 200000
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T7 FALLO: aceptó pago que no cuadra'; END IF;
  RAISE NOTICE 'T7 OK: pago que no cuadra → rechazado.';
END $$;

-- ── T8 — sin turno abierto → rechazada ──────────────────────────────────────
DO $$
DECLARE v_ok boolean:=false; v_rep uuid; v_store uuid;
BEGIN
  SELECT id INTO v_store FROM public.stores WHERE name='StoreREP';
  SELECT id INTO v_rep FROM public.repair_orders WHERE modelo='Redmi 9';
  UPDATE public.cash_shifts SET closed_at=now() WHERE store_id=v_store AND closed_at IS NULL;
  BEGIN PERFORM public.deliver_repair(v_rep,
    jsonb_build_array(jsonb_build_object('method','cash','amount',200000)), 200000);
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T8 FALLO: cobró sin turno'; END IF;
  RAISE NOTICE 'T8 OK: sin turno en la tienda → entrega rechazada.';
  UPDATE public.cash_shifts SET closed_at=NULL WHERE store_id=v_store;  -- reabrir para T9
END $$;

-- ── T9 — garantía $0: sin pagos → OK, orden total 0, entregado ───────────────
DO $$
DECLARE v_rep uuid; v_order uuid;
BEGIN
  SELECT id INTO v_rep FROM public.repair_orders WHERE modelo='Redmi 9';
  UPDATE public.repair_orders SET precio=0 WHERE id=v_rep;
  v_order := public.deliver_repair(v_rep, '[]'::jsonb, NULL);
  IF (SELECT total FROM public.orders WHERE id=v_order) <> 0 THEN RAISE EXCEPTION 'T9 FALLO: total no es 0'; END IF;
  IF (SELECT count(*) FROM public.order_payments WHERE order_id=v_order) <> 0 THEN RAISE EXCEPTION 'T9 FALLO: garantía con pagos'; END IF;
  IF (SELECT status FROM public.repair_orders WHERE id=v_rep) <> 'entregado' THEN RAISE EXCEPTION 'T9 FALLO: no entregado'; END IF;
  RAISE NOTICE 'T9 OK: garantía $0 → orden $0 sin pagos, entregado.';
END $$;

-- ── T10 — ciclo de estados registra historial en cada transición ────────────
DO $$
DECLARE v_rep uuid; v_n int;
BEGIN
  INSERT INTO public.repair_orders
    (store_id, customer_id, marca, modelo, falla_reportada, received_by)
  VALUES
    ((SELECT id FROM public.stores WHERE name='StoreREP'), '00000000-0000-0000-0000-0000000000ca',
     'Motorola', 'G20', 'Batería', '00000000-0000-0000-0000-0000000000e1')
  RETURNING id INTO v_rep;   -- nace 'recibido'
  UPDATE public.repair_orders SET status='en_reparacion' WHERE id=v_rep;
  UPDATE public.repair_orders SET status='listo', precio=90000 WHERE id=v_rep;
  SELECT count(*) INTO v_n FROM public.repair_status_history WHERE repair_order_id=v_rep;
  IF v_n <> 3 THEN RAISE EXCEPTION 'T10 FALLO: historial esperado 3 (recibido/en_reparacion/listo), got %', v_n; END IF;
  RAISE NOTICE 'T10 OK: cada cambio de estado deja una fila en la bitácora (3).';
END $$;

ROLLBACK;
\echo '✔ TEST DELIVER REPAIR OK — todos los asserts pasaron.'

-- ============================================================
-- TEST DE CARRERA — find-or-create del producto de servicio (2 sesiones).
-- No cabe en una transacción con ROLLBACK. Dos deliver_repair CONCURRENTES en
-- una tienda que aún NO tiene "Servicio de reparación": el helper
-- ensure_repair_service_variant intenta crearlo en ambas.
--
-- Procedimiento (fixtures committeados: 1 tienda sin producto de servicio, 2
-- órdenes 'listo' repA/repB, mismo vendedor con turno abierto):
--   Sesión A:  BEGIN; SELECT deliver_repair(repA, [cash 100000], 100000);
--              SELECT pg_sleep(2); COMMIT;      -- retiene el servicio uncommitted
--   Sesión B:  (~0.6s después) BEGIN; SELECT deliver_repair(repB, [cash 120000], 120000); COMMIT;
--
-- RESULTADO VALIDADO EN LAB (postgres:17, 2026-07):
--   · READ COMMITTED (isolación real de PostgREST/Supabase en prod):
--       ambas entregas OK, EXACTAMENTE 1 producto de servicio + 1 variante.
--       (Confirmado 3/3 corridas.) La versión FIXED (ON CONFLICT DO UPDATE
--       ... RETURNING) obtiene la fila existente atómicamente; B espera el
--       commit de A y continúa.
--   · REPEATABLE READ (forzado): B falla con 'could not serialize access due
--       to concurrent update' → 1 entrega. Comportamiento correcto (aborta y
--       revierte, sin duplicar). PostgREST NO usa RR, así que esto es informativo.
--
-- INVARIANTE DURO: el índice único parcial uq_products_one_service_per_store
--   (044) garantiza "nunca dos productos de servicio por tienda" en TODA
--   isolación — verificado: incluso la variante previa DO NOTHING dio 1 producto
--   bajo READ COMMITTED; el DO UPDATE ... RETURNING es la forma atómica y limpia
--   de recuperar la fila del ganador sin un SELECT posterior dependiente del
--   snapshot.
-- ============================================================
