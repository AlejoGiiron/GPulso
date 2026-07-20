-- ============================================================
-- test-create-order.sql — Tests de create_order (migración 041)
-- Turno POR TIENDA + guards de invariante serializado, pertenencia y valores.
-- Transacción con ROLLBACK final. La carrera va aparte (2 sesiones, al final).
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id,email) VALUES
  ('00000000-0000-0000-0000-0000000000d1','admin@ord.test'),
  ('00000000-0000-0000-0000-0000000000d2','seller@ord.test');
INSERT INTO public.organizations (name) VALUES ('OrgORD') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');
SELECT id AS role_admin  FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
SELECT id AS role_seller FROM public.roles WHERE organization_id=:'org' AND name='Vendedor' \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreORD', :'org') RETURNING id AS store \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreORD2', :'org') RETURNING id AS store2 \gset
INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active) VALUES
  ('00000000-0000-0000-0000-0000000000d1','admin@ord.test','Admin ORD','admin',:'role_admin',:'org',:'store',:'store',true),
  ('00000000-0000-0000-0000-0000000000d2','seller@ord.test','Seller ORD','seller',:'role_seller',:'org',:'store',:'store',true);

-- Turno ABIERTO por la ADMIN (la vendedora venderá bajo ESTE turno).
INSERT INTO public.cash_shifts (store_id, opened_by, opening_amount)
VALUES (:'store', '00000000-0000-0000-0000-0000000000d1', 100000);

-- Serializado + 2 unidades.
INSERT INTO public.products (name, store_id, is_serialized) VALUES ('iPhone ORD', :'store', true) RETURNING id AS pser \gset
INSERT INTO public.variants (product_id, store_id, price) VALUES (:'pser', :'store', 1000000) RETURNING id AS vser \gset
INSERT INTO public.units (id, store_id, variant_id, serial) VALUES
  ('00000000-0000-0000-0000-00000000f1a1', :'store', :'vser', 'ORD-IMEI-1'),
  ('00000000-0000-0000-0000-00000000f2a2', :'store', :'vser', 'ORD-IMEI-2');
-- Accesorios.
INSERT INTO public.products (name, store_id) VALUES ('Cargador ORD', :'store') RETURNING id AS pacc \gset
INSERT INTO public.variants (product_id, store_id, price, stock_qty) VALUES (:'pacc', :'store', 50000, 5) RETURNING id AS vaccA \gset
INSERT INTO public.variants (product_id, store_id, price, stock_qty, color) VALUES (:'pacc', :'store', 50000, 3, 'Negro') RETURNING id AS vaccB \gset
-- Variante de OTRA tienda (misma org) para el guard de pertenencia.
INSERT INTO public.products (name, store_id) VALUES ('Otra tienda prod', :'store2') RETURNING id AS pother \gset
INSERT INTO public.variants (product_id, store_id, price, stock_qty) VALUES (:'pother', :'store2', 50000, 5) RETURNING id AS vother \gset
-- Cliente de OTRA organización.
INSERT INTO public.organizations (name) VALUES ('OrgX') RETURNING id AS orgx \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreX', :'orgx') RETURNING id AS storex \gset
INSERT INTO public.customers (id, full_name, store_id) VALUES ('00000000-0000-0000-0000-0000000000c9', 'Cliente X', :'storex');

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- helper de ids por nombre (evita depender de \gset dentro de DO)
-- ── T1 — Venta mixta de contado (admin) ─────────────────────────────────────
DO $$
DECLARE v_order uuid; v_vser uuid; v_pser uuid; v_pacc uuid; v_vaccA uuid;
BEGIN
  SELECT id INTO v_pser FROM public.products WHERE name='iPhone ORD';
  SELECT id INTO v_vser FROM public.variants WHERE product_id=v_pser;
  SELECT id INTO v_pacc FROM public.products WHERE name='Cargador ORD';
  SELECT id INTO v_vaccA FROM public.variants WHERE product_id=v_pacc AND color IS NULL;
  v_order := public.create_order(NULL,1050000,1050000,0,0,1050000,'cash',
    jsonb_build_array(
      jsonb_build_object('variant_id',v_vaccA,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000),
      jsonb_build_object('variant_id',v_vser,'product_id',v_pser,'qty',1,'unit_price',1000000,'list_price',1000000,'unit_id','00000000-0000-0000-0000-00000000f1a1')),
    jsonb_build_array(jsonb_build_object('method','cash','amount',1050000)));
  IF (SELECT status FROM public.units WHERE serial='ORD-IMEI-1')<>'vendida' THEN RAISE EXCEPTION 'T1 FALLO'; END IF;
  IF (SELECT stock_qty FROM public.variants WHERE id=v_vaccA)<>4 THEN RAISE EXCEPTION 'T1 FALLO accesorio'; END IF;
  RAISE NOTICE 'T1 OK: venta mixta atómica (admin).';
END $$;

-- ── T2 — Vendedora cobra bajo el turno abierto por la admin → OK ─────────────
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
DO $$
DECLARE v_order uuid; v_pacc uuid; v_vaccB uuid;
BEGIN
  SELECT id INTO v_pacc FROM public.products WHERE name='Cargador ORD';
  SELECT id INTO v_vaccB FROM public.variants WHERE product_id=v_pacc AND color='Negro';
  v_order := public.create_order(NULL,50000,50000,0,0,50000,'cash',
    jsonb_build_array(jsonb_build_object('variant_id',v_vaccB,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000)),
    jsonb_build_array(jsonb_build_object('method','cash','amount',50000)));
  IF v_order IS NULL THEN RAISE EXCEPTION 'T2 FALLO: la vendedora no pudo vender bajo el turno de la admin'; END IF;
  RAISE NOTICE 'T2 OK: vendedora vende bajo el turno de la tienda (abierto por la admin).';
END $$;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- ── Guards de rechazo (turno abierto; deben fallar por el motivo específico) ──
DO $$
DECLARE
  v_pser uuid; v_vser uuid; v_pacc uuid; v_vaccB uuid; v_vother uuid; v_ok boolean;
BEGIN
  SELECT id INTO v_pser FROM public.products WHERE name='iPhone ORD';
  SELECT id INTO v_vser FROM public.variants WHERE product_id=v_pser;
  SELECT id INTO v_pacc FROM public.products WHERE name='Cargador ORD';
  SELECT id INTO v_vaccB FROM public.variants WHERE product_id=v_pacc AND color='Negro';
  SELECT id INTO v_vother FROM public.variants WHERE store_id=(SELECT id FROM public.stores WHERE name='StoreORD2');

  -- T3 pagos que no cuadran
  v_ok:=false; BEGIN PERFORM public.create_order(NULL,40000,50000,0,0,50000,'cash',
    jsonb_build_array(jsonb_build_object('variant_id',v_vaccB,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000)),
    jsonb_build_array(jsonb_build_object('method','cash','amount',40000)));
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T3 FALLO: pagos que no cuadran'; END IF;

  -- T4 pago negativo
  v_ok:=false; BEGIN PERFORM public.create_order(NULL,-50000,-50000,0,0,-50000,'cash',
    jsonb_build_array(jsonb_build_object('variant_id',v_vaccB,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000)),
    jsonb_build_array(jsonb_build_object('method','cash','amount',-50000)));
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T4 FALLO: pago negativo'; END IF;

  -- T5 línea serializada SIN unit_id
  v_ok:=false; BEGIN PERFORM public.create_order(NULL,1000000,1000000,0,0,1000000,'cash',
    jsonb_build_array(jsonb_build_object('variant_id',v_vser,'product_id',v_pser,'qty',1,'unit_price',1000000,'list_price',1000000)),
    jsonb_build_array(jsonb_build_object('method','cash','amount',1000000)));
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T5 FALLO: serializada sin unit_id'; END IF;

  -- T6 unit_id en línea NO serializada
  v_ok:=false; BEGIN PERFORM public.create_order(NULL,50000,50000,0,0,50000,'cash',
    jsonb_build_array(jsonb_build_object('variant_id',v_vaccB,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000,'unit_id','00000000-0000-0000-0000-00000000f2a2')),
    jsonb_build_array(jsonb_build_object('method','cash','amount',50000)));
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T6 FALLO: unit en línea no serializada'; END IF;

  -- T7 unit_id con qty=2
  v_ok:=false; BEGIN PERFORM public.create_order(NULL,2000000,2000000,0,0,2000000,'cash',
    jsonb_build_array(jsonb_build_object('variant_id',v_vser,'product_id',v_pser,'qty',2,'unit_price',1000000,'list_price',1000000,'unit_id','00000000-0000-0000-0000-00000000f2a2')),
    jsonb_build_array(jsonb_build_object('method','cash','amount',2000000)));
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T7 FALLO: unit con qty=2'; END IF;

  -- T8 cliente de otra org
  v_ok:=false; BEGIN PERFORM public.create_order('00000000-0000-0000-0000-0000000000c9',50000,50000,0,0,50000,'cash',
    jsonb_build_array(jsonb_build_object('variant_id',v_vaccB,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000)),
    jsonb_build_array(jsonb_build_object('method','cash','amount',50000)));
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T8 FALLO: cliente de otra org'; END IF;

  -- T9 variante de otra tienda
  v_ok:=false; BEGIN PERFORM public.create_order(NULL,50000,50000,0,0,50000,'cash',
    jsonb_build_array(jsonb_build_object('variant_id',v_vother,'product_id',(SELECT product_id FROM public.variants WHERE id=v_vother),'qty',1,'unit_price',50000,'list_price',50000)),
    jsonb_build_array(jsonb_build_object('method','cash','amount',50000)));
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T9 FALLO: variante de otra tienda'; END IF;

  -- T10 product_id que no corresponde a la variante
  v_ok:=false; BEGIN PERFORM public.create_order(NULL,50000,50000,0,0,50000,'cash',
    jsonb_build_array(jsonb_build_object('variant_id',v_vaccB,'product_id',v_pser,'qty',1,'unit_price',50000,'list_price',50000)),
    jsonb_build_array(jsonb_build_object('method','cash','amount',50000)));
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T10 FALLO: product_id no corresponde a la variante'; END IF;

  RAISE NOTICE 'T3-T10 OK: pagos/negativo/serializado-sin-unit/unit-en-accesorio/qty2/cliente-org/variante-tienda/product-mismatch → todos rechazados.';
END $$;

-- ── T11 — Claim falla a mitad (unidad ya vendida) → rollback total ──────────
DO $$
DECLARE v_ok boolean:=false; v_pser uuid; v_vser uuid; v_pacc uuid; v_vaccB uuid; v_ob bigint; v_oa bigint; v_sb int;
BEGIN
  SELECT id INTO v_pser FROM public.products WHERE name='iPhone ORD';
  SELECT id INTO v_vser FROM public.variants WHERE product_id=v_pser;
  SELECT id INTO v_pacc FROM public.products WHERE name='Cargador ORD';
  SELECT id INTO v_vaccB FROM public.variants WHERE product_id=v_pacc AND color='Negro';
  UPDATE public.units SET status='vendida' WHERE serial='ORD-IMEI-2';
  SELECT count(*) INTO v_ob FROM public.orders; SELECT stock_qty INTO v_sb FROM public.variants WHERE id=v_vaccB;
  BEGIN PERFORM public.create_order(NULL,1050000,1050000,0,0,1050000,'cash',
    jsonb_build_array(
      jsonb_build_object('variant_id',v_vaccB,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000),
      jsonb_build_object('variant_id',v_vser,'product_id',v_pser,'qty',1,'unit_price',1000000,'list_price',1000000,'unit_id','00000000-0000-0000-0000-00000000f2a2')),
    jsonb_build_array(jsonb_build_object('method','cash','amount',1050000)));
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  SELECT count(*) INTO v_oa FROM public.orders;
  IF NOT v_ok THEN RAISE EXCEPTION 'T11 FALLO: no falló'; END IF;
  IF v_oa<>v_ob THEN RAISE EXCEPTION 'T11 FALLO: orden fantasma'; END IF;
  IF (SELECT stock_qty FROM public.variants WHERE id=v_vaccB)<>v_sb THEN RAISE EXCEPTION 'T11 FALLO: accesorio descontado'; END IF;
  RAISE NOTICE 'T11 OK: claim perdido → rollback total (accesorio intacto).';
END $$;

-- ── T12 — Turno por tienda: sin turno abierto → rechazada ───────────────────
DO $$
DECLARE v_ok boolean:=false; v_pacc uuid; v_vaccB uuid;
BEGIN
  SELECT id INTO v_pacc FROM public.products WHERE name='Cargador ORD';
  SELECT id INTO v_vaccB FROM public.variants WHERE product_id=v_pacc AND color='Negro';
  UPDATE public.cash_shifts SET closed_at=now() WHERE closed_at IS NULL;
  BEGIN PERFORM public.create_order(NULL,50000,50000,0,0,50000,'cash',
    jsonb_build_array(jsonb_build_object('variant_id',v_vaccB,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000)),
    jsonb_build_array(jsonb_build_object('method','cash','amount',50000)));
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T12 FALLO: vendió sin turno'; END IF;
  RAISE NOTICE 'T12 OK: sin turno en la tienda → rechazada.';
END $$;

-- ── T13 — Dos turnos abiertos: el índice impide el 2do; forzados → RAISE ─────
DO $$
DECLARE v_idx boolean:=false; v_store uuid;
BEGIN
  SELECT id INTO v_store FROM public.stores WHERE name='StoreORD';
  UPDATE public.cash_shifts SET closed_at=NULL WHERE store_id=v_store;  -- reabrir 1
  -- el índice impide un 2do turno abierto por la vía normal
  BEGIN
    INSERT INTO public.cash_shifts (store_id, opened_by) VALUES (v_store,'00000000-0000-0000-0000-0000000000d1');
  EXCEPTION WHEN unique_violation THEN v_idx:=true; END;
  IF NOT v_idx THEN RAISE EXCEPTION 'T13 FALLO: el índice permitió un 2do turno abierto'; END IF;
  RAISE NOTICE 'T13a OK: el índice único impide crear un 2do turno abierto.';
END $$;
-- Forzar 2 abiertos (quitando el índice dentro de la tx) y verificar el RAISE:
DROP INDEX public.uq_cash_shifts_one_open_per_store;
INSERT INTO public.cash_shifts (store_id, opened_by)
VALUES ((SELECT id FROM public.stores WHERE name='StoreORD'),'00000000-0000-0000-0000-0000000000d1');
DO $$
DECLARE v_ok boolean:=false; v_pacc uuid; v_vaccB uuid;
BEGIN
  SELECT id INTO v_pacc FROM public.products WHERE name='Cargador ORD';
  SELECT id INTO v_vaccB FROM public.variants WHERE product_id=v_pacc AND color='Negro';
  BEGIN PERFORM public.create_order(NULL,50000,50000,0,0,50000,'cash',
    jsonb_build_array(jsonb_build_object('variant_id',v_vaccB,'product_id',v_pacc,'qty',1,'unit_price',50000,'list_price',50000)),
    jsonb_build_array(jsonb_build_object('method','cash','amount',50000)));
  EXCEPTION WHEN check_violation THEN v_ok:=true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T13 FALLO: vendió con 2 turnos abiertos'; END IF;
  RAISE NOTICE 'T13b OK: con 2 turnos abiertos → venta rechazada (guard >1).';
END $$;

ROLLBACK;  -- restaura el índice y todo lo demás
\echo '✔ TEST CREATE ORDER OK — todos los asserts pasaron.'

-- ============================================================
-- TEST DE CARRERA (2 sesiones): dos create_order del mismo IMEI → una orden
-- completa, la otra falla entera (sin orden/pago/stock). Validado en lab.
--   Sesión A: BEGIN; SELECT create_order(...unit_id=U...); pg_sleep(3); COMMIT;
--   Sesión B: (~1s) BEGIN; SELECT create_order(...unit_id=U...); COMMIT;
--   → orders=1, unit 'vendida', payments=1. B: 'La unidad ya no está disponible…'.
-- ============================================================
