-- ============================================================
-- test-serialized-read-price.sql — Fase B del rediseño de serializados
--
-- Verifica la REGLA DE LECTURA de precio para serializados que aplica el cliente
-- (useUnits.ts): precio de una unidad = unit.price ?? product.suggested_price.
-- Aquí se prueba la MISMA resolución en la BD con COALESCE(u.price,
-- p.suggested_price), sobre datos sembrados:
--   · Unidad con price propio → muestra SU precio.
--   · Unidad con price NULL   → cae al suggested_price del producto.
--
-- Todo en una transacción con ROLLBACK final → no deja rastro.
--   docker exec -i supabase_db_<proj> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < scripts/test-serialized-read-price.sql
--
-- Requiere: 053 (products.suggested_price, units.price).
-- ============================================================

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-0000000000d1', 'admin@rp.test');
INSERT INTO public.organizations (name) VALUES ('OrgRP') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');
SELECT id AS role_admin FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreRP', :'org') RETURNING id AS store \gset
INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active)
VALUES ('00000000-0000-0000-0000-0000000000d1','admin@rp.test','Admin RP','admin',:'role_admin',:'org',:'store',:'store',true);

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';

-- Producto serializado con precio SUGERIDO 1.500.000.
INSERT INTO public.products (name, store_id, is_serialized, suggested_price)
VALUES ('iPhone RP', :'store', true, 1500000) RETURNING id AS prod \gset
INSERT INTO public.variants (product_id, store_id, size, color, price, stock_qty)
VALUES (:'prod', :'store', NULL, NULL, 1500000, 0) RETURNING id AS vser \gset

-- Unidad A: precio PROPIO 1.600.000. Unidad B: precio NULL (cae al sugerido).
INSERT INTO public.units (store_id, variant_id, serial, price, variant_label)
VALUES (:'store', :'vser', 'RP-CON-PRECIO', 1600000, '256GB Negro');
INSERT INTO public.units (store_id, variant_id, serial, price, variant_label)
VALUES (:'store', :'vser', 'RP-SIN-PRECIO', NULL, '128GB Azul');

DO $$
DECLARE v_a numeric; v_b numeric; lbl_a text; lbl_b text;
BEGIN
  -- Misma resolución que el cliente: COALESCE(unit.price, product.suggested_price).
  SELECT COALESCE(u.price, p.suggested_price), u.variant_label INTO v_a, lbl_a
    FROM public.units u
    JOIN public.variants v ON v.id = u.variant_id
    JOIN public.products p ON p.id = v.product_id
   WHERE u.serial = 'RP-CON-PRECIO';
  SELECT COALESCE(u.price, p.suggested_price), u.variant_label INTO v_b, lbl_b
    FROM public.units u
    JOIN public.variants v ON v.id = u.variant_id
    JOIN public.products p ON p.id = v.product_id
   WHERE u.serial = 'RP-SIN-PRECIO';

  IF v_a IS DISTINCT FROM 1600000 THEN
    RAISE EXCEPTION 'FALLO: unidad con precio propio resolvió % (esperado 1600000).', v_a;
  END IF;
  RAISE NOTICE 'OK: unidad con price propio → muestra SU precio (1.600.000).';

  IF v_b IS DISTINCT FROM 1500000 THEN
    RAISE EXCEPTION 'FALLO: unidad con price NULL resolvió % (esperado 1500000 = sugerido).', v_b;
  END IF;
  RAISE NOTICE 'OK: unidad con price NULL → cae al sugerido del producto (1.500.000).';

  IF lbl_a <> '256GB Negro' OR lbl_b <> '128GB Azul' THEN
    RAISE EXCEPTION 'FALLO: variant_label no coincide (a=%, b=%).', lbl_a, lbl_b;
  END IF;
  RAISE NOTICE 'OK: la etiqueta mostrada es unit.variant_label (a=256GB Negro, b=128GB Azul).';

  RAISE NOTICE '=== test-serialized-read-price: TODOS LOS TESTS PASARON ===';
END $$;

ROLLBACK;
