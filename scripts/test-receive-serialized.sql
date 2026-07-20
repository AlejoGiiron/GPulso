-- ============================================================
-- test-receive-serialized.sql — Tests de receive_serialized_units (mig. 040)
--   · Recepción PARCIAL (2 de 3) → pendiente derivado = 1.
--   · Completar después (1 más) → total 3, pendiente 0.
--   · Intento de EXCEDER N → rechazado (guard de servidor).
--   · Serial duplicado en el lote → all-or-nothing (nada se inserta).
--   · Sin permiso inventario.gestionar → rechazado.
-- Transacción con ROLLBACK final.
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id,email) VALUES ('00000000-0000-0000-0000-0000000000b1','admin@rec.test');
INSERT INTO public.organizations (name) VALUES ('OrgREC') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');
SELECT id AS role_admin  FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
SELECT id AS role_seller FROM public.roles WHERE organization_id=:'org' AND name='Vendedor' \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreREC', :'org') RETURNING id AS store \gset
INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active)
VALUES ('00000000-0000-0000-0000-0000000000b1','admin@rec.test','Admin REC','admin',:'role_admin',:'org',:'store',:'store',true);
-- Vendedor (sin inventario.gestionar) para el test de permiso.
INSERT INTO auth.users (id,email) VALUES ('00000000-0000-0000-0000-0000000000b2','seller@rec.test');
INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active)
VALUES ('00000000-0000-0000-0000-0000000000b2','seller@rec.test','Seller REC','seller',:'role_seller',:'org',:'store',:'store',true);

INSERT INTO public.products (name, store_id, is_serialized) VALUES ('iPhone REC', :'store', true) RETURNING id AS prod \gset
INSERT INTO public.variants (product_id, store_id, price) VALUES (:'prod', :'store', 1000000) RETURNING id AS vser \gset
INSERT INTO public.suppliers (store_id, name) VALUES (:'store', 'Proveedor REC') RETURNING id AS sup \gset
INSERT INTO public.purchase_invoices (invoice_number, store_id, supplier_id, created_by, invoice_date, total)
VALUES ('FC-REC-1', :'store', :'sup', '00000000-0000-0000-0000-0000000000b1', current_date, 2700000)
RETURNING id AS inv \gset
INSERT INTO public.purchase_invoice_items (invoice_id, variant_id, product_id, qty, unit_cost, subtotal)
VALUES (:'inv', :'vser', :'prod', 3, 900000, 2700000) RETURNING id AS item \gset

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- ── T1 — Recepción parcial 2 de 3 ───────────────────────────────────────────
DO $$
DECLARE v_n int; v_pending int;
BEGIN
  v_n := public.receive_serialized_units((SELECT ii.id FROM public.purchase_invoice_items ii JOIN public.purchase_invoices pi ON pi.id=ii.invoice_id WHERE pi.invoice_number='FC-REC-1' AND ii.qty=3),
                                         ARRAY['REC-IMEI-1','REC-IMEI-2']);
  IF v_n <> 2 THEN RAISE EXCEPTION 'T1 FALLO: no recibió 2.'; END IF;
  -- pendiente DERIVADO = qty - count(units de la línea)
  SELECT ii.qty - (SELECT count(*) FROM public.units u WHERE u.purchase_invoice_item_id = ii.id)
    INTO v_pending FROM public.purchase_invoice_items ii JOIN public.purchase_invoices pi ON pi.id=ii.invoice_id WHERE pi.invoice_number='FC-REC-1' AND ii.qty=3;
  IF v_pending <> 1 THEN RAISE EXCEPTION 'T1 FALLO: pendiente derivado no es 1 (es %).', v_pending; END IF;
  IF (SELECT stock_qty FROM public.variants v JOIN public.products p ON p.id=v.product_id WHERE p.name='iPhone REC') <> 2
    THEN RAISE EXCEPTION 'T1 FALLO: stock_qty no es 2.'; END IF;
  RAISE NOTICE 'T1 OK: recepción parcial 2/3, pendiente derivado=1, stock_qty=2.';
END $$;

-- ── T2 — Completar después (1 más) → total 3, pendiente 0 ───────────────────
DO $$
DECLARE v_pending int;
BEGIN
  PERFORM public.receive_serialized_units((SELECT ii.id FROM public.purchase_invoice_items ii JOIN public.purchase_invoices pi ON pi.id=ii.invoice_id WHERE pi.invoice_number='FC-REC-1' AND ii.qty=3),
                                          ARRAY['REC-IMEI-3']);
  SELECT ii.qty - (SELECT count(*) FROM public.units u WHERE u.purchase_invoice_item_id = ii.id)
    INTO v_pending FROM public.purchase_invoice_items ii JOIN public.purchase_invoices pi ON pi.id=ii.invoice_id WHERE pi.invoice_number='FC-REC-1' AND ii.qty=3;
  IF v_pending <> 0 THEN RAISE EXCEPTION 'T2 FALLO: pendiente no es 0.'; END IF;
  IF (SELECT stock_qty FROM public.variants v JOIN public.products p ON p.id=v.product_id WHERE p.name='iPhone REC') <> 3
    THEN RAISE EXCEPTION 'T2 FALLO: stock_qty no es 3.'; END IF;
  RAISE NOTICE 'T2 OK: completado 3/3, pendiente=0, stock_qty=3.';
END $$;

-- ── T3 — Intento de exceder N → rechazado ───────────────────────────────────
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    PERFORM public.receive_serialized_units((SELECT ii.id FROM public.purchase_invoice_items ii JOIN public.purchase_invoices pi ON pi.id=ii.invoice_id WHERE pi.invoice_number='FC-REC-1' AND ii.qty=3),
                                            ARRAY['REC-IMEI-4']);
  EXCEPTION WHEN check_violation THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T3 FALLO: permitió exceder la cantidad de la línea.'; END IF;
  IF (SELECT count(*) FROM public.units WHERE serial='REC-IMEI-4') <> 0 THEN RAISE EXCEPTION 'T3 FALLO: insertó de más.'; END IF;
  RAISE NOTICE 'T3 OK: exceder N rechazado, nada insertado.';
END $$;

-- ── T4 — Duplicado en el lote → all-or-nothing ──────────────────────────────
-- Nueva línea con qty 2, intento con serial repetido en el mismo lote.
INSERT INTO public.purchase_invoice_items (invoice_id, variant_id, product_id, qty, unit_cost, subtotal)
VALUES (:'inv', :'vser', :'prod', 2, 900000, 1800000) RETURNING id AS item2 \gset
DO $$
DECLARE v_blocked boolean := false; v_item2 uuid;
BEGIN
  SELECT ii2.id INTO v_item2 FROM public.purchase_invoice_items ii2 JOIN public.purchase_invoices pi ON pi.id=ii2.invoice_id WHERE pi.invoice_number='FC-REC-1' AND ii2.qty=2 LIMIT 1;
  BEGIN
    PERFORM public.receive_serialized_units(v_item2, ARRAY['DUP-1','DUP-1']);
  EXCEPTION WHEN unique_violation THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T4 FALLO: aceptó serial duplicado en el lote.'; END IF;
  IF (SELECT count(*) FROM public.units WHERE serial='DUP-1') <> 0 THEN RAISE EXCEPTION 'T4 FALLO: quedó media captura.'; END IF;
  RAISE NOTICE 'T4 OK: duplicado en lote → all-or-nothing (0 insertadas).';
END $$;

-- ── T5 — Sin permiso inventario.gestionar (Vendedor) → rechazado ────────────
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
DO $$
DECLARE v_blocked boolean := false; v_item2 uuid;
BEGIN
  SELECT ii2.id INTO v_item2 FROM public.purchase_invoice_items ii2 JOIN public.purchase_invoices pi ON pi.id=ii2.invoice_id WHERE pi.invoice_number='FC-REC-1' AND ii2.qty=2 LIMIT 1;
  BEGIN
    PERFORM public.receive_serialized_units(v_item2, ARRAY['SELLER-1']);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'T5 FALLO: un vendedor sin inventario.gestionar pudo crear unidades.'; END IF;
  RAISE NOTICE 'T5 OK: sin inventario.gestionar → rechazado.';
END $$;

ROLLBACK;
\echo '✔ TEST RECEIVE SERIALIZED OK — todos los asserts pasaron.'

-- ============================================================
-- TEST DE CARRERA (2 sesiones — no cabe en una transacción con ROLLBACK).
-- Verifica el FOR UPDATE OF ii del guard anti-exceso: dos recepciones parciales
-- CONCURRENTES de la MISMA línea (qty=3) que juntas exceden N → la primera
-- commitea, la segunda BLOQUEA en el lock y luego FALLA con el mensaje de exceso
-- (no ambas pasan). Resultado esperado: 2 unidades, no 4.
--
-- Procedimiento (fixtures committeados: línea qty=3, id=…c1):
--   Sesión A:  BEGIN; SELECT receive_serialized_units('…c1', ARRAY['A1','A2']);
--              SELECT pg_sleep(3); COMMIT;
--   Sesión B:  (arranca ~1s después)
--              BEGIN; SELECT receive_serialized_units('…c1', ARRAY['B1','B2']); COMMIT;
--
--   → A: 2 unidades committeadas.
--   → B: ERROR 'Excede la cantidad de la línea. Cantidad=3, ya recibidas=2, intento=2.'
--   → COUNT(units de la línea) = 2.
--
-- Validado en lab (2026-07): con FOR UPDATE OF ii el resultado es 2; sin él, 4.
-- ============================================================
