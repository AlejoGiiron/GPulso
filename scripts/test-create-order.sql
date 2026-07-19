-- ============================================================
-- test-create-order.sql — Tests de create_order (migración 041)
--   T1  Venta MIXTA de contado (accesorio + equipo serializado) → atómica OK.
--   T2  Sin turno abierto → rechazada.
--   T3  Pagos que no cuadran con el total → rechazada.
--   T4  Claim falla a mitad (unidad ya vendida) → rollback TOTAL: sin orden,
--       sin pago, y el stock del ACCESORIO NO quedó descontado.
-- La carrera (dos cobros del mismo IMEI) va aparte, con 2 sesiones (al final).
-- Transacción con ROLLBACK final.
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id,email) VALUES ('00000000-0000-0000-0000-0000000000d1','admin@ord.test');
INSERT INTO public.organizations (name) VALUES ('OrgORD') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');
SELECT id AS role_admin FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreORD', :'org') RETURNING id AS store \gset
INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active)
VALUES ('00000000-0000-0000-0000-0000000000d1','admin@ord.test','Admin ORD','admin',:'role_admin',:'org',:'store',:'store',true);

-- Turno ABIERTO del admin.
INSERT INTO public.cash_shifts (store_id, opened_by, opening_amount)
VALUES (:'store', '00000000-0000-0000-0000-0000000000d1', 100000) RETURNING id AS shift \gset

-- Producto serializado + variante + 2 unidades.
INSERT INTO public.products (name, store_id, is_serialized) VALUES ('iPhone ORD', :'store', true) RETURNING id AS pser \gset
INSERT INTO public.variants (product_id, store_id, price) VALUES (:'pser', :'store', 1000000) RETURNING id AS vser \gset
INSERT INTO public.units (id, store_id, variant_id, serial) VALUES
  ('00000000-0000-0000-0000-00000000f1a1', :'store', :'vser', 'ORD-IMEI-1'),
  ('00000000-0000-0000-0000-00000000f2a2', :'store', :'vser', 'ORD-IMEI-2');

-- Accesorios (NO serializados) con stock.
INSERT INTO public.products (name, store_id) VALUES ('Cargador ORD', :'store') RETURNING id AS pacc \gset
INSERT INTO public.variants (product_id, store_id, price, stock_qty) VALUES (:'pacc', :'store', 50000, 5) RETURNING id AS vaccA \gset
INSERT INTO public.variants (product_id, store_id, price, stock_qty, color) VALUES (:'pacc', :'store', 50000, 3, 'Negro') RETURNING id AS vaccB \gset

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- ── T1 — Venta mixta de contado (accesorio + equipo) ────────────────────────
DO $$
DECLARE v_order uuid; v_pser uuid; v_vser uuid; v_pacc uuid; v_vaccA uuid; v_store uuid;
BEGIN
  SELECT id INTO v_pser FROM public.products WHERE name='iPhone ORD';
  SELECT id INTO v_vser FROM public.variants WHERE product_id=v_pser;
  SELECT id INTO v_pacc FROM public.products WHERE name='Cargador ORD';
  SELECT id INTO v_vaccA FROM public.variants WHERE product_id=v_pacc AND color IS NULL;
  SELECT store_id INTO v_store FROM public.products WHERE id=v_pser;

  v_order := public.create_order(
    NULL, 1050000, 1050000, 0, 0, 1050000, 'cash',
    jsonb_build_array(
      jsonb_build_object('variant_id',v_vaccA,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000),
      jsonb_build_object('variant_id',v_vser,'product_id',v_pser,'qty',1,'unit_price',1000000,'list_price',1000000,
                         'unit_id','00000000-0000-0000-0000-00000000f1a1')
    ),
    jsonb_build_array(jsonb_build_object('method','cash','amount',1050000))
  );

  IF (SELECT order_number FROM public.orders WHERE id=v_order) IS NULL THEN RAISE EXCEPTION 'T1 FALLO: sin order_number.'; END IF;
  IF (SELECT count(*) FROM public.order_items WHERE order_id=v_order) <> 2 THEN RAISE EXCEPTION 'T1 FALLO: no hay 2 ítems.'; END IF;
  IF (SELECT count(*) FROM public.order_payments WHERE order_id=v_order) <> 1 THEN RAISE EXCEPTION 'T1 FALLO: no hay pago.'; END IF;
  IF (SELECT status FROM public.units WHERE serial='ORD-IMEI-1') <> 'vendida' THEN RAISE EXCEPTION 'T1 FALLO: unidad no vendida.'; END IF;
  IF (SELECT order_item_id FROM public.units WHERE serial='ORD-IMEI-1') IS NULL THEN RAISE EXCEPTION 'T1 FALLO: unidad sin order_item.'; END IF;
  IF (SELECT stock_qty FROM public.variants WHERE id=v_vaccA) <> 4 THEN RAISE EXCEPTION 'T1 FALLO: accesorio no bajó a 4.'; END IF;
  RAISE NOTICE 'T1 OK: venta mixta atómica (equipo vendido, accesorio 5→4, pago OK).';
END $$;

-- ── T2 — Sin turno abierto → rechazada ──────────────────────────────────────
DO $$
DECLARE v_blocked boolean := false; v_pacc uuid; v_vaccB uuid;
BEGIN
  SELECT id INTO v_pacc FROM public.products WHERE name='Cargador ORD';
  SELECT id INTO v_vaccB FROM public.variants WHERE product_id=v_pacc AND color='Negro';
  -- cerrar el turno temporalmente
  UPDATE public.cash_shifts SET closed_at = now() WHERE closed_at IS NULL;
  BEGIN
    PERFORM public.create_order(NULL, 50000, 50000, 0, 0, 50000, 'cash',
      jsonb_build_array(jsonb_build_object('variant_id',v_vaccB,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000)),
      jsonb_build_array(jsonb_build_object('method','cash','amount',50000)));
  EXCEPTION WHEN check_violation THEN v_blocked := true; END;
  UPDATE public.cash_shifts SET closed_at = NULL;  -- reabrir para los siguientes
  IF NOT v_blocked THEN RAISE EXCEPTION 'T2 FALLO: vendió sin turno abierto.'; END IF;
  RAISE NOTICE 'T2 OK: venta sin turno abierto rechazada.';
END $$;

-- ── T3 — Pagos que no cuadran → rechazada ───────────────────────────────────
DO $$
DECLARE v_blocked boolean := false; v_pacc uuid; v_vaccB uuid;
BEGIN
  SELECT id INTO v_pacc FROM public.products WHERE name='Cargador ORD';
  SELECT id INTO v_vaccB FROM public.variants WHERE product_id=v_pacc AND color='Negro';
  BEGIN
    PERFORM public.create_order(NULL, 40000, 50000, 0, 0, 50000, 'cash',
      jsonb_build_array(jsonb_build_object('variant_id',v_vaccB,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000)),
      jsonb_build_array(jsonb_build_object('method','cash','amount',40000)));  -- paga 40k de 50k
  EXCEPTION WHEN check_violation THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T3 FALLO: aceptó pagos que no cuadran.'; END IF;
  RAISE NOTICE 'T3 OK: pagos que no cuadran rechazados.';
END $$;

-- ── T4 — Claim falla a mitad → rollback TOTAL (accesorio intacto) ────────────
DO $$
DECLARE
  v_blocked boolean := false; v_pser uuid; v_vser uuid; v_pacc uuid; v_vaccB uuid;
  v_orders_before bigint; v_orders_after bigint; v_accB_before int;
BEGIN
  SELECT id INTO v_pser FROM public.products WHERE name='iPhone ORD';
  SELECT id INTO v_vser FROM public.variants WHERE product_id=v_pser;
  SELECT id INTO v_pacc FROM public.products WHERE name='Cargador ORD';
  SELECT id INTO v_vaccB FROM public.variants WHERE product_id=v_pacc AND color='Negro';

  -- La unidad u2 ya está VENDIDA (simula "otra caja la tomó").
  UPDATE public.units SET status='vendida' WHERE serial='ORD-IMEI-2';

  SELECT count(*) INTO v_orders_before FROM public.orders;
  SELECT stock_qty INTO v_accB_before FROM public.variants WHERE id=v_vaccB;

  BEGIN
    PERFORM public.create_order(NULL, 1050000, 1050000, 0, 0, 1050000, 'cash',
      jsonb_build_array(
        jsonb_build_object('variant_id',v_vaccB,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000),
        jsonb_build_object('variant_id',v_vser,'product_id',v_pser,'qty',1,'unit_price',1000000,'list_price',1000000,
                           'unit_id','00000000-0000-0000-0000-00000000f2a2')
      ),
      jsonb_build_array(jsonb_build_object('method','cash','amount',1050000)));
  EXCEPTION WHEN check_violation THEN v_blocked := true; END;

  SELECT count(*) INTO v_orders_after FROM public.orders;

  IF NOT v_blocked THEN RAISE EXCEPTION 'T4 FALLO: la venta con unidad tomada NO falló.'; END IF;
  IF v_orders_after <> v_orders_before THEN RAISE EXCEPTION 'T4 FALLO: quedó orden fantasma.'; END IF;
  IF (SELECT stock_qty FROM public.variants WHERE id=v_vaccB) <> v_accB_before THEN
    RAISE EXCEPTION 'T4 FALLO: el stock del accesorio quedó descontado pese al rollback.';
  END IF;
  RAISE NOTICE 'T4 OK: claim perdido → rollback total (sin orden, sin pago, accesorio intacto).';
END $$;

ROLLBACK;
\echo '✔ TEST CREATE ORDER OK — todos los asserts pasaron.'

-- ============================================================
-- TEST DE CARRERA (2 sesiones — no cabe en un ROLLBACK).
-- Dos create_order SIMULTÁNEOS del MISMO IMEI (misma unidad disponible) →
-- una orden se crea completa, la otra FALLA ENTERA (sin orden, sin pago, sin
-- stock de accesorios descontado). El claim_unit dentro de la RPC serializa por
-- el lock de fila de la unidad.
--   Sesión A: BEGIN; SELECT create_order(... unit_id=U ...); pg_sleep(3); COMMIT;
--   Sesión B: (arranca ~1s después) BEGIN; SELECT create_order(... unit_id=U ...); COMMIT;
--   → A: 1 orden con la unidad 'vendida'. B: ERROR 'La unidad ya no está disponible…'.
--   → COUNT(orders)=1. Validado en lab (2026-07).
-- ============================================================
