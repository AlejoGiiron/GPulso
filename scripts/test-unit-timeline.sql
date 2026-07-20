-- ============================================================
-- test-unit-timeline.sql — Rastro por unidad (migración 042)
-- Verifica que venta/devolución/reventa estampan stock_movements.unit_id y que
-- la línea de tiempo de una unidad se reconstruye (2 ventas + 1 devolución).
-- Transacción con ROLLBACK final.
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id,email) VALUES ('00000000-0000-0000-0000-0000000000e1','admin@tl.test');
INSERT INTO public.organizations (name) VALUES ('OrgTL') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');
SELECT id AS role_admin FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreTL', :'org') RETURNING id AS store \gset
INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active)
VALUES ('00000000-0000-0000-0000-0000000000e1','admin@tl.test','Admin TL','admin',:'role_admin',:'org',:'store',:'store',true);
INSERT INTO public.products (name, store_id, is_serialized) VALUES ('iPhone TL', :'store', true) RETURNING id AS prod \gset
INSERT INTO public.variants (product_id, store_id, price) VALUES (:'prod', :'store', 1000000) RETURNING id AS vser \gset
INSERT INTO public.units (id, store_id, variant_id, serial) VALUES
  ('00000000-0000-0000-0000-00000000e1a1', :'store', :'vser', 'TL-IMEI-1');

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

DO $$
DECLARE
  v_prod uuid; v_vser uuid; v_unit uuid := '00000000-0000-0000-0000-00000000e1a1';
  v_ord uuid; v_oi uuid; v_n int;
BEGIN
  SELECT id INTO v_prod FROM public.products WHERE name='iPhone TL';
  SELECT id INTO v_vser FROM public.variants WHERE product_id=v_prod;

  -- Venta 1
  INSERT INTO public.orders (store_id, created_by, payment_method, total)
  VALUES ((SELECT store_id FROM public.variants WHERE id=v_vser),'00000000-0000-0000-0000-0000000000e1','cash',1000000) RETURNING id INTO v_ord;
  INSERT INTO public.order_items (order_id, variant_id, product_id, qty, unit_price, list_price)
  VALUES (v_ord, v_vser, v_prod, 1, 1000000, 1000000) RETURNING id INTO v_oi;
  PERFORM public.claim_unit(v_unit, v_oi);

  IF NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE unit_id=v_unit AND type='sale') THEN
    RAISE EXCEPTION 'FALLO: la venta no estampó unit_id.';
  END IF;

  -- Devolución
  PERFORM public.restore_returned_unit(v_unit, gen_random_uuid());
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE unit_id=v_unit AND type='return') THEN
    RAISE EXCEPTION 'FALLO: la devolución no estampó unit_id.';
  END IF;

  -- Reventa (nueva orden)
  INSERT INTO public.orders (store_id, created_by, payment_method, total)
  VALUES ((SELECT store_id FROM public.variants WHERE id=v_vser),'00000000-0000-0000-0000-0000000000e1','cash',1000000) RETURNING id INTO v_ord;
  INSERT INTO public.order_items (order_id, variant_id, product_id, qty, unit_price, list_price)
  VALUES (v_ord, v_vser, v_prod, 1, 1000000, 1000000) RETURNING id INTO v_oi;
  PERFORM public.claim_unit(v_unit, v_oi);

  -- La línea de tiempo de la unidad: 2 ventas + 1 devolución = 3 movimientos,
  -- todos con unit_id, reconstruibles por created_at.
  SELECT count(*) INTO v_n FROM public.stock_movements WHERE unit_id=v_unit;
  IF v_n <> 3 THEN RAISE EXCEPTION 'FALLO: se esperaban 3 movimientos de la unidad, hay %.', v_n; END IF;
  IF (SELECT count(*) FROM public.stock_movements WHERE unit_id=v_unit AND type='sale') <> 2 THEN
    RAISE EXCEPTION 'FALLO: no hay 2 ventas en el rastro.';
  END IF;
  RAISE NOTICE 'OK: rastro por unidad = 2 ventas + 1 devolución, todos con unit_id (línea de tiempo reconstruible).';
END $$;

ROLLBACK;
\echo '✔ TEST UNIT TIMELINE OK.'
