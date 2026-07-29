-- ============================================================
-- test-serialized-backfill.sql — Fase A del rediseño de serializados (053)
--
-- Prueba el BACKFILL de products.suggested_price con datos sembrados (prod no
-- tiene serializados aún, así que en prod el backfill toca 0 filas; esto
-- demuestra que la lógica funciona el día que aparezcan datos o se porte G-Mura).
--
-- Cubre:
--   · T1: serializado con UNA variante ancla → suggested_price = price de la variante.
--   · T2: serializado con DOS variantes (ancla NULL/NULL + otra) → toma la ANCLA,
--         no la otra (DISTINCT ON prefiere size/color NULL).
--   · T3: ACCESORIO (no serializado) → suggested_price queda NULL (no se toca).
--   · T4: idempotencia → re-correr el backfill no cambia un suggested_price ya puesto.
--
-- El UPDATE del backfill es IDÉNTICO al de la migración 053 (§A3).
-- Todo en una transacción con ROLLBACK final → no deja rastro.
--   docker exec -i supabase_db_<proj> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < scripts/test-serialized-backfill.sql
--
-- Requiere: 053 aplicada (columnas presentes).
-- ============================================================

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-0000000000c1', 'admin@bf.test');

INSERT INTO public.organizations (name) VALUES ('OrgBF') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');
SELECT id AS role_admin FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreBF', :'org') RETURNING id AS store \gset
INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active)
VALUES ('00000000-0000-0000-0000-0000000000c1','admin@bf.test','Admin BF','admin',:'role_admin',:'org',:'store',:'store',true);

-- T1: serializado con una variante ancla (size/color NULL), price 1.500.000.
INSERT INTO public.products (name, store_id, is_serialized) VALUES ('iPhone 15', :'store', true) RETURNING id AS pser1 \gset
INSERT INTO public.variants (product_id, store_id, size, color, price, stock_qty)
VALUES (:'pser1', :'store', NULL, NULL, 1500000, 0);

-- T2: serializado con DOS variantes; la ANCLA (NULL/NULL, 2.000.000) creada
-- primero, y otra (256GB/Negro, 2.200.000) después. El backfill debe tomar 2.000.000.
INSERT INTO public.products (name, store_id, is_serialized) VALUES ('iPhone 15 Pro', :'store', true) RETURNING id AS pser2 \gset
INSERT INTO public.variants (product_id, store_id, size, color, price, stock_qty)
VALUES (:'pser2', :'store', NULL, NULL, 2000000, 0);
INSERT INTO public.variants (product_id, store_id, size, color, price, stock_qty)
VALUES (:'pser2', :'store', '256GB', 'Negro', 2200000, 0);

-- T3: accesorio (no serializado), price 80.000 → NO debe recibir suggested_price.
INSERT INTO public.products (name, store_id, is_serialized) VALUES ('Cargador', :'store', false) RETURNING id AS pacc \gset
INSERT INTO public.variants (product_id, store_id, size, color, price, stock_qty)
VALUES (:'pacc', :'store', 'Único', 'Negro', 80000, 0);

-- Sanidad: todos arrancan con suggested_price NULL.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE store_id=(SELECT id FROM public.stores WHERE name='StoreBF') AND suggested_price IS NOT NULL) THEN
    RAISE EXCEPTION 'PRE FALLO: algún producto ya tenía suggested_price antes del backfill.';
  END IF;
END $$;

-- ── BACKFILL (idéntico a la migración 053 §A3) ──────────────────────────────
UPDATE public.products p
   SET suggested_price = sub.price
  FROM (
    SELECT DISTINCT ON (v.product_id) v.product_id, v.price
      FROM public.variants v
     ORDER BY v.product_id,
              (v.size IS NULL AND v.color IS NULL) DESC,
              v.created_at ASC
  ) sub
 WHERE sub.product_id = p.id
   AND p.is_serialized = true
   AND p.suggested_price IS NULL;

-- ── Asserts ─────────────────────────────────────────────────────────────────
DO $$
DECLARE v1 numeric; v2 numeric; vacc numeric;
BEGIN
  SELECT suggested_price INTO v1   FROM public.products WHERE name='iPhone 15'     AND store_id=(SELECT id FROM public.stores WHERE name='StoreBF');
  SELECT suggested_price INTO v2   FROM public.products WHERE name='iPhone 15 Pro' AND store_id=(SELECT id FROM public.stores WHERE name='StoreBF');
  SELECT suggested_price INTO vacc FROM public.products WHERE name='Cargador'      AND store_id=(SELECT id FROM public.stores WHERE name='StoreBF');

  IF v1 IS DISTINCT FROM 1500000 THEN
    RAISE EXCEPTION 'T1 FALLO: suggested_price del serializado simple = % (esperado 1500000).', v1;
  END IF;
  RAISE NOTICE 'T1 OK: serializado con variante única → suggested_price = 1.500.000 (= price de la variante).';

  IF v2 IS DISTINCT FROM 2000000 THEN
    RAISE EXCEPTION 'T2 FALLO: suggested_price del serializado con 2 variantes = % (esperado 2000000, el de la ANCLA).', v2;
  END IF;
  RAISE NOTICE 'T2 OK: serializado con 2 variantes → toma la ancla (2.000.000), no la otra (2.200.000).';

  IF vacc IS NOT NULL THEN
    RAISE EXCEPTION 'T3 FALLO: el accesorio recibió suggested_price = % (debía quedar NULL).', vacc;
  END IF;
  RAISE NOTICE 'T3 OK: accesorio intacto → suggested_price NULL (precia por variants.price).';
END $$;

-- T4: idempotencia — re-correr el backfill no cambia lo ya puesto.
UPDATE public.products p
   SET suggested_price = sub.price
  FROM (
    SELECT DISTINCT ON (v.product_id) v.product_id, v.price
      FROM public.variants v
     ORDER BY v.product_id,
              (v.size IS NULL AND v.color IS NULL) DESC,
              v.created_at ASC
  ) sub
 WHERE sub.product_id = p.id
   AND p.is_serialized = true
   AND p.suggested_price IS NULL;

DO $$
DECLARE v1 numeric;
BEGIN
  SELECT suggested_price INTO v1 FROM public.products WHERE name='iPhone 15' AND store_id=(SELECT id FROM public.stores WHERE name='StoreBF');
  IF v1 IS DISTINCT FROM 1500000 THEN
    RAISE EXCEPTION 'T4 FALLO: la 2da corrida cambió un suggested_price ya puesto (=%).', v1;
  END IF;
  RAISE NOTICE 'T4 OK: backfill idempotente (2da corrida no cambia lo ya sembrado).';
END $$;

DO $$ BEGIN RAISE NOTICE '=== test-serialized-backfill: TODOS LOS TESTS PASARON ==='; END $$;

ROLLBACK;
