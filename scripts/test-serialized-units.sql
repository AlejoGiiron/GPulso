-- ============================================================
-- test-serialized-units.sql — Tests de la Fase 2 (migración 039)
--
-- Cubre (menos la carrera, que va aparte con 2 conexiones):
--   · Sincronización variants.stock_qty = COUNT(unidades 'disponible')
--     en alta / venta / devolución / reserva.
--   · Unicidad de serial por organización.
--   · claim_unit: venta ok + guardia (segundo claim falla).
--   · Ciclo de separado: reservar→cancelar y reservar→completar.
--   · Devolución que restaura 'disponible' conservando historial.
--   · is_serialized inmutable con unidades/ventas.
--
-- Todo en una transacción con ROLLBACK final → no deja rastro.
--   docker exec -i supabase_db_<proj> psql -U postgres -d <db> \
--     -v ON_ERROR_STOP=1 < scripts/test-serialized-units.sql
-- ============================================================

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures (como postgres; bypass RLS) ────────────────────────────────────
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin@ser.test');

INSERT INTO public.organizations (name) VALUES ('OrgSER') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');
SELECT id AS role_admin FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreSER', :'org') RETURNING id AS store \gset

INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active)
VALUES ('00000000-0000-0000-0000-0000000000a1','admin@ser.test','Admin SER','admin',:'role_admin',:'org',:'store',:'store',true);

-- Producto serializado + variante
INSERT INTO public.products (name, store_id, is_serialized) VALUES ('iPhone Test', :'store', true) RETURNING id AS prod \gset
INSERT INTO public.variants (product_id, store_id, size, color, price) VALUES (:'prod', :'store', '128GB', 'Azul', 1000000) RETURNING id AS vser \gset

-- Cliente (para separado)
INSERT INTO public.customers (full_name, store_id) VALUES ('Cliente SER', :'store') RETURNING id AS cust \gset

-- Contexto de auth: actuamos como el admin de la tienda.
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ── T1 — Sincronización en ALTA ─────────────────────────────────────────────
INSERT INTO public.units (store_id, variant_id, serial, cost) VALUES
  (:'store', :'vser', 'IMEI-001', 900000) ,
  (:'store', :'vser', 'IMEI-002', 900000) ,
  (:'store', :'vser', 'IMEI-003', 900000) ;
SELECT id AS u1 FROM public.units WHERE serial='IMEI-001' \gset
SELECT id AS u2 FROM public.units WHERE serial='IMEI-002' \gset

DO $$ BEGIN
  IF (SELECT stock_qty FROM public.variants WHERE id=(SELECT variant_id FROM public.units WHERE serial='IMEI-001'))<>3 THEN
    RAISE EXCEPTION 'T1 FALLO: stock_qty no es 3 tras alta de 3 unidades.';
  END IF;
  RAISE NOTICE 'T1 OK: alta de 3 unidades → stock_qty=3.';
END $$;

-- ── T2 — Unicidad de serial por organización ────────────────────────────────
DO $$
DECLARE v_dup boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.units (store_id, variant_id, serial) VALUES
      ((SELECT id FROM public.stores WHERE name='StoreSER'),
       (SELECT id FROM public.variants WHERE size='128GB' AND color='Azul'),
       'IMEI-001');
  EXCEPTION WHEN unique_violation THEN v_dup := true;
  END;
  IF NOT v_dup THEN RAISE EXCEPTION 'T2 FALLO: se permitió serial duplicado en la org.'; END IF;
  RAISE NOTICE 'T2 OK: serial duplicado por org rechazado.';
END $$;

-- ── T3 — claim_unit (venta) + sincronización ────────────────────────────────
INSERT INTO public.orders (store_id, created_by, payment_method, total)
VALUES (:'store','00000000-0000-0000-0000-0000000000a1','cash',1000000) RETURNING id AS ord \gset
INSERT INTO public.order_items (order_id, variant_id, product_id, qty, unit_price, list_price)
VALUES (:'ord', :'vser', :'prod', 1, 1000000, 1000000) RETURNING id AS oi \gset

SELECT public.claim_unit(:'u1', :'oi');

DO $$ BEGIN
  IF (SELECT status FROM public.units WHERE id=(SELECT id FROM public.units WHERE serial='IMEI-001'))<>'vendida' THEN
    RAISE EXCEPTION 'T3 FALLO: la unidad no quedó vendida.';
  END IF;
  IF (SELECT stock_qty FROM public.variants WHERE id=(SELECT variant_id FROM public.units WHERE serial='IMEI-001'))<>2 THEN
    RAISE EXCEPTION 'T3 FALLO: stock_qty no bajó a 2 tras la venta.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE type='sale' AND qty=-1) THEN
    RAISE EXCEPTION 'T3 FALLO: no se registró el movimiento sale.';
  END IF;
  RAISE NOTICE 'T3 OK: claim_unit vende la unidad, stock_qty=2, movimiento sale.';
END $$;

-- ── T4 — claim_unit guardia (segundo claim falla) ───────────────────────────
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    PERFORM public.claim_unit((SELECT id FROM public.units WHERE serial='IMEI-001'), (SELECT id FROM public.order_items LIMIT 1));
  EXCEPTION WHEN check_violation THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T4 FALLO: se pudo vender dos veces la misma unidad.'; END IF;
  RAISE NOTICE 'T4 OK: segundo claim de la misma unidad rechazado.';
END $$;

-- ── T5 — Devolución restaura 'disponible' conservando historial ─────────────
-- return_id es obligatorio; pasamos un uuid de referencia (stock_movements.reference_id
-- no tiene FK, así que basta un uuid real de trazabilidad).
SELECT public.restore_returned_unit((SELECT id FROM public.units WHERE serial='IMEI-001'),
                                     '00000000-0000-0000-0000-0000000000c0');

DO $$ BEGIN
  IF (SELECT status FROM public.units WHERE serial='IMEI-001')<>'disponible' THEN
    RAISE EXCEPTION 'T5 FALLO: la unidad devuelta no volvió a disponible.';
  END IF;
  IF (SELECT order_item_id FROM public.units WHERE serial='IMEI-001') IS NOT NULL THEN
    RAISE EXCEPTION 'T5 FALLO: no se limpió order_item_id.';
  END IF;
  IF (SELECT stock_qty FROM public.variants WHERE id=(SELECT variant_id FROM public.units WHERE serial='IMEI-001'))<>3 THEN
    RAISE EXCEPTION 'T5 FALLO: stock_qty no volvió a 3.';
  END IF;
  -- Historial conservado: el order_item de la venta sigue existiendo.
  IF NOT EXISTS (SELECT 1 FROM public.order_items) THEN
    RAISE EXCEPTION 'T5 FALLO: se perdió el historial de la venta (order_items vacío).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_movements WHERE type='return' AND qty=1) THEN
    RAISE EXCEPTION 'T5 FALLO: no se registró el movimiento return.';
  END IF;
  RAISE NOTICE 'T5 OK: devolución → disponible, stock_qty=3, historial y movimiento return intactos.';
END $$;

-- ── T6 — Separado: reservar → cancelar ──────────────────────────────────────
INSERT INTO public.layaways (store_id, customer_id, created_by, subtotal, total, expires_at, status)
VALUES (:'store', :'cust', '00000000-0000-0000-0000-0000000000a1', 1000000, 1000000, now()+interval '30 days', 'active')
RETURNING id AS lay \gset

SELECT public.reserve_unit(:'u2', :'lay');
DO $$ BEGIN
  IF (SELECT status FROM public.units WHERE serial='IMEI-002')<>'reservada' THEN RAISE EXCEPTION 'T6 FALLO: unidad no quedó reservada.'; END IF;
  IF (SELECT stock_qty FROM public.variants WHERE id=(SELECT variant_id FROM public.units WHERE serial='IMEI-002'))<>2 THEN RAISE EXCEPTION 'T6 FALLO: stock_qty no bajó a 2 tras reservar.'; END IF;
END $$;

UPDATE public.layaways SET status='cancelled' WHERE id=:'lay';
DO $$ BEGIN
  IF (SELECT status FROM public.units WHERE serial='IMEI-002')<>'disponible' THEN RAISE EXCEPTION 'T6 FALLO: cancelar no liberó la unidad.'; END IF;
  IF (SELECT stock_qty FROM public.variants WHERE id=(SELECT variant_id FROM public.units WHERE serial='IMEI-002'))<>3 THEN RAISE EXCEPTION 'T6 FALLO: stock_qty no volvió a 3 tras cancelar.'; END IF;
  RAISE NOTICE 'T6 OK: reservar→cancelar libera la unidad (stock 2→3).';
END $$;

-- ── T7 — Separado: reservar → completar ─────────────────────────────────────
INSERT INTO public.layaways (store_id, customer_id, created_by, subtotal, total, expires_at, status)
VALUES (:'store', :'cust', '00000000-0000-0000-0000-0000000000a1', 1000000, 1000000, now()+interval '30 days', 'active')
RETURNING id AS lay2 \gset
SELECT public.reserve_unit((SELECT id FROM public.units WHERE serial='IMEI-002'), :'lay2');

INSERT INTO public.orders (store_id, created_by, payment_method, total)
VALUES (:'store','00000000-0000-0000-0000-0000000000a1','cash',1000000) RETURNING id AS ord2 \gset
INSERT INTO public.order_items (order_id, variant_id, product_id, qty, unit_price, list_price)
VALUES (:'ord2', :'vser', :'prod', 1, 1000000, 1000000) RETURNING id AS oi2 \gset
SELECT public.complete_reserved_unit((SELECT id FROM public.units WHERE serial='IMEI-002'), :'oi2');
UPDATE public.layaways SET status='completed' WHERE id=:'lay2';

DO $$ BEGIN
  IF (SELECT status FROM public.units WHERE serial='IMEI-002')<>'vendida' THEN RAISE EXCEPTION 'T7 FALLO: completar no marcó vendida.'; END IF;
  IF (SELECT order_item_id FROM public.units WHERE serial='IMEI-002') IS NULL THEN RAISE EXCEPTION 'T7 FALLO: no fijó order_item_id.'; END IF;
  IF (SELECT stock_qty FROM public.variants WHERE id=(SELECT variant_id FROM public.units WHERE serial='IMEI-002'))<>2 THEN RAISE EXCEPTION 'T7 FALLO: stock_qty no bajó a 2 tras completar.'; END IF;
  RAISE NOTICE 'T7 OK: reservar→completar vende la unidad (stock 3→2).';
END $$;

-- ── T8 — is_serialized inmutable con unidades/ventas ────────────────────────
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE public.products SET is_serialized=false WHERE name='iPhone Test';
  EXCEPTION WHEN others THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T8 FALLO: se pudo cambiar is_serialized con unidades/ventas.'; END IF;
  RAISE NOTICE 'T8 OK: is_serialized bloqueado por unidades/ventas existentes.';
END $$;

-- ── Fixtures para los guards de coherencia ──────────────────────────────────
-- Otra variante del mismo producto serializado.
INSERT INTO public.variants (product_id, store_id, size, color, price)
VALUES (:'prod', :'store', '256GB', 'Negro', 1200000) RETURNING id AS vser2 \gset
-- order_item de OTRA variante (misma tienda).
INSERT INTO public.orders (store_id, created_by, payment_method, total)
VALUES (:'store','00000000-0000-0000-0000-0000000000a1','cash',1200000) RETURNING id AS ord3 \gset
INSERT INTO public.order_items (order_id, variant_id, product_id, qty, unit_price, list_price)
VALUES (:'ord3', :'vser2', :'prod', 1, 1200000, 1200000) RETURNING id AS oi_othervar \gset
-- Otra tienda de la misma org + order_item allí (misma variante Vser).
INSERT INTO public.stores (name, organization_id) VALUES ('StoreSER2', :'org') RETURNING id AS store2 \gset
INSERT INTO public.orders (store_id, created_by, payment_method, total)
VALUES (:'store2','00000000-0000-0000-0000-0000000000a1','cash',1000000) RETURNING id AS ord4 \gset
INSERT INTO public.order_items (order_id, variant_id, product_id, qty, unit_price, list_price)
VALUES (:'ord4', :'vser', :'prod', 1, 1000000, 1000000) RETURNING id AS oi_otherstore \gset

-- ── T9 — claim_unit con order_item de OTRA variante → rechazado ─────────────
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    PERFORM public.claim_unit(
      (SELECT id FROM public.units WHERE serial='IMEI-003'),
      (SELECT id FROM public.order_items WHERE variant_id=(SELECT id FROM public.variants WHERE size='256GB' AND store_id=(SELECT id FROM public.stores WHERE name='StoreSER'))));
  EXCEPTION WHEN check_violation THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T9 FALLO: se permitió claim con order_item de otra variante.'; END IF;
  IF (SELECT status FROM public.units WHERE serial='IMEI-003')<>'disponible' THEN RAISE EXCEPTION 'T9 FALLO: la unidad cambió pese al rechazo.'; END IF;
  RAISE NOTICE 'T9 OK: claim_unit con order_item de otra variante rechazado (unidad intacta).';
END $$;

-- ── T10 — claim_unit con order_item de OTRA tienda → rechazado ──────────────
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    PERFORM public.claim_unit(
      (SELECT id FROM public.units WHERE serial='IMEI-003'),
      (SELECT oi.id FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
        WHERE o.store_id=(SELECT id FROM public.stores WHERE name='StoreSER2')));
  EXCEPTION WHEN check_violation THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T10 FALLO: se permitió claim con order_item de otra tienda.'; END IF;
  IF (SELECT status FROM public.units WHERE serial='IMEI-003')<>'disponible' THEN RAISE EXCEPTION 'T10 FALLO: la unidad cambió pese al rechazo.'; END IF;
  RAISE NOTICE 'T10 OK: claim_unit con order_item de otra tienda rechazado.';
END $$;

-- ── T11 — complete_reserved_unit: otra variante / otra tienda → rechazados ──
INSERT INTO public.layaways (store_id, customer_id, created_by, subtotal, total, expires_at, status)
VALUES (:'store', :'cust', '00000000-0000-0000-0000-0000000000a1', 1000000, 1000000, now()+interval '30 days', 'active')
RETURNING id AS lay3 \gset
SELECT public.reserve_unit((SELECT id FROM public.units WHERE serial='IMEI-003'), :'lay3');
DO $$
DECLARE v_a boolean := false; v_b boolean := false;
BEGIN
  BEGIN
    PERFORM public.complete_reserved_unit(
      (SELECT id FROM public.units WHERE serial='IMEI-003'),
      (SELECT id FROM public.order_items WHERE variant_id=(SELECT id FROM public.variants WHERE size='256GB' AND store_id=(SELECT id FROM public.stores WHERE name='StoreSER'))));
  EXCEPTION WHEN check_violation THEN v_a := true; END;
  BEGIN
    PERFORM public.complete_reserved_unit(
      (SELECT id FROM public.units WHERE serial='IMEI-003'),
      (SELECT oi.id FROM public.order_items oi JOIN public.orders o ON o.id=oi.order_id
        WHERE o.store_id=(SELECT id FROM public.stores WHERE name='StoreSER2')));
  EXCEPTION WHEN check_violation THEN v_b := true; END;
  IF NOT (v_a AND v_b) THEN RAISE EXCEPTION 'T11 FALLO: complete_reserved_unit aceptó order_item incoherente.'; END IF;
  IF (SELECT status FROM public.units WHERE serial='IMEI-003')<>'reservada' THEN RAISE EXCEPTION 'T11 FALLO: la unidad cambió pese al rechazo.'; END IF;
  RAISE NOTICE 'T11 OK: complete_reserved_unit rechaza order_item de otra variante y de otra tienda.';
END $$;
SELECT public.release_reserved_unit((SELECT id FROM public.units WHERE serial='IMEI-003'));

-- ── T12 — Cambio de variante de una unidad → ambas variantes correctas ──────
INSERT INTO public.units (store_id, variant_id, serial) VALUES (:'store', :'vser', 'IMEI-004');
DO $$
DECLARE v_ser_before int; v_ser2_before int;
BEGIN
  SELECT stock_qty INTO v_ser_before  FROM public.variants WHERE id=(SELECT id FROM public.variants WHERE size='128GB' AND store_id=(SELECT id FROM public.stores WHERE name='StoreSER'));
  SELECT stock_qty INTO v_ser2_before FROM public.variants WHERE id=(SELECT id FROM public.variants WHERE size='256GB' AND store_id=(SELECT id FROM public.stores WHERE name='StoreSER'));

  UPDATE public.units SET variant_id=(SELECT id FROM public.variants WHERE size='256GB' AND store_id=(SELECT id FROM public.stores WHERE name='StoreSER'))
   WHERE serial='IMEI-004';

  IF (SELECT stock_qty FROM public.variants WHERE size='128GB' AND store_id=(SELECT id FROM public.stores WHERE name='StoreSER')) <> v_ser_before - 1 THEN
    RAISE EXCEPTION 'T12 FALLO: la variante VIEJA quedó con stock fantasma.';
  END IF;
  IF (SELECT stock_qty FROM public.variants WHERE size='256GB' AND store_id=(SELECT id FROM public.stores WHERE name='StoreSER')) <> v_ser2_before + 1 THEN
    RAISE EXCEPTION 'T12 FALLO: la variante NUEVA no sumó la unidad.';
  END IF;
  RAISE NOTICE 'T12 OK: cambio de variante recalcula AMBAS (vieja -1, nueva +1).';
END $$;

-- ── T13 — restore_returned_unit sin return_id → error de firma ──────────────
DO $$
DECLARE v_no_fn boolean := false;
BEGIN
  BEGIN
    EXECUTE 'SELECT public.restore_returned_unit($1)' USING (SELECT id FROM public.units WHERE serial='IMEI-001');
  EXCEPTION WHEN undefined_function THEN v_no_fn := true; END;
  IF NOT v_no_fn THEN RAISE EXCEPTION 'T13 FALLO: restore_returned_unit aceptó llamada de 1 argumento.'; END IF;
  RAISE NOTICE 'T13 OK: restore_returned_unit exige return_id (no existe versión de 1 arg).';
END $$;

ROLLBACK;
\echo '✔ TEST SERIALIZED UNITS OK — todos los asserts pasaron.'
