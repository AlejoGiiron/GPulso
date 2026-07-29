-- ============================================================
-- test-block-serialized-layaway.sql — guard de la migración 054
--
-- Verifica que:
--   · T1: una línea de separado sobre un ACCESORIO (no serializado) se acepta.
--   · T2: una línea de separado sobre un SERIALIZADO se RECHAZA con el mensaje
--         "Los equipos con IMEI aún no se pueden separar."
--
-- Todo en una transacción con ROLLBACK final → no deja rastro.
--   docker exec -i supabase_db_<proj> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < scripts/test-block-serialized-layaway.sql
--
-- Requiere: 054 aplicada.
-- ============================================================

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-0000000000e1', 'admin@bl.test');
INSERT INTO public.organizations (name) VALUES ('OrgBL') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');
SELECT id AS role_admin FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreBL', :'org') RETURNING id AS store \gset
INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active)
VALUES ('00000000-0000-0000-0000-0000000000e1','admin@bl.test','Admin BL','admin',:'role_admin',:'org',:'store',:'store',true);
INSERT INTO public.customers (full_name, store_id) VALUES ('Cliente BL', :'store') RETURNING id AS cust \gset

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- Accesorio (con stock) y serializado.
INSERT INTO public.products (name, store_id, is_serialized) VALUES ('Forro BL', :'store', false) RETURNING id AS pacc \gset
INSERT INTO public.variants (product_id, store_id, size, color, price, stock_qty)
VALUES (:'pacc', :'store', 'Único', 'Negro', 30000, 5) RETURNING id AS vacc \gset

INSERT INTO public.products (name, store_id, is_serialized) VALUES ('iPhone BL', :'store', true) RETURNING id AS pser \gset
INSERT INTO public.variants (product_id, store_id, size, color, price, stock_qty)
VALUES (:'pser', :'store', NULL, NULL, 1500000, 0) RETURNING id AS vser \gset

-- Separado.
INSERT INTO public.layaways (store_id, customer_id, created_by, subtotal, discount, total, expires_at)
VALUES (:'store', :'cust', '00000000-0000-0000-0000-0000000000e1', 30000, 0, 30000, now() + interval '30 days')
RETURNING id AS lay \gset

-- T1: accesorio → aceptado.
INSERT INTO public.layaway_items (layaway_id, variant_id, product_id, qty, unit_price, list_price)
VALUES (:'lay', :'vacc', :'pacc', 1, 30000, 30000);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.layaway_items WHERE variant_id=(SELECT id FROM public.variants WHERE product_id=(SELECT id FROM public.products WHERE name='Forro BL'))) THEN
    RAISE EXCEPTION 'T1 FALLO: no se insertó la línea de accesorio.';
  END IF;
  RAISE NOTICE 'T1 OK: separar un accesorio se acepta.';
END $$;

-- T2: serializado → rechazado con el mensaje esperado.
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.layaway_items (layaway_id, variant_id, product_id, qty, unit_price, list_price)
    VALUES (
      (SELECT id FROM public.layaways WHERE customer_id=(SELECT id FROM public.customers WHERE full_name='Cliente BL')),
      (SELECT id FROM public.variants WHERE product_id=(SELECT id FROM public.products WHERE name='iPhone BL')),
      (SELECT id FROM public.products WHERE name='iPhone BL'),
      1, 1500000, 1500000
    );
  EXCEPTION WHEN check_violation THEN
    v_blocked := true;
    IF SQLERRM NOT LIKE '%IMEI%no se pueden separar%' THEN
      RAISE EXCEPTION 'T2 FALLO: se bloqueó pero con otro mensaje: %', SQLERRM;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'T2 FALLO: se permitió separar un equipo serializado (sobreventa).';
  END IF;
  RAISE NOTICE 'T2 OK: separar un serializado se rechaza (Los equipos con IMEI aún no se pueden separar).';
END $$;

DO $$ BEGIN RAISE NOTICE '=== test-block-serialized-layaway: TODOS LOS TESTS PASARON ==='; END $$;

ROLLBACK;
