-- ============================================================
-- test-create-equipment.sql — RPC create_equipment_with_unit (055, Fase C)
--
-- Cubre:
--   · T1: happy path → plantilla serializada + variante ancla (stock 1) +
--         primera unidad + movimiento 'adjustment' con unit_id.
--   · T2: suggested_price <= 0 → rechazado (obligatorio > 0).
--   · T3: serial vacío → rechazado.
--   · T4: sin permiso (Vendedor) → insufficient_privilege.
--   · T5: R5 atomicidad → serial duplicado aborta TODO (sin plantilla huérfana).
--   · T6: categoría de otra tienda → rechazada.
--
-- Todo en una transacción con ROLLBACK final → no deja rastro.
--   docker exec -i supabase_db_<proj> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < scripts/test-create-equipment.sql
--
-- Requiere: 053 (columnas), 055 (RPC).
-- ============================================================

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'admin@eq.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'seller@eq.test');

INSERT INTO public.organizations (name) VALUES ('OrgEQ') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');
SELECT id AS role_admin  FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
SELECT id AS role_seller FROM public.roles WHERE organization_id=:'org' AND name='Vendedor' \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreEQ', :'org') RETURNING id AS store \gset

INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active) VALUES
  ('00000000-0000-0000-0000-0000000000f1','admin@eq.test','Admin EQ','admin',:'role_admin',:'org',:'store',:'store',true),
  ('00000000-0000-0000-0000-0000000000f2','seller@eq.test','Seller EQ','seller',:'role_seller',:'org',:'store',:'store',true);

INSERT INTO public.categories (name, store_id) VALUES ('Celulares', :'store') RETURNING id AS cat \gset

-- Otra tienda + su categoría (para T6).
INSERT INTO public.organizations (name) VALUES ('OrgEQ2') RETURNING id AS org2 \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreEQ2', :'org2') RETURNING id AS store2 \gset
INSERT INTO public.categories (name, store_id) VALUES ('AjenaCat', :'store2') RETURNING id AS cat_ajena \gset

-- Actuamos como el ADMIN de StoreEQ.
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

-- ── T1 — Happy path ─────────────────────────────────────────────────────────
SELECT public.create_equipment_with_unit(
  'iPhone 15', 'Apple', :'cat', 'Sellado', 1500000, 'IMEI-EQ-1', 1400000, '128GB Azul', NULL
);

DO $$
DECLARE p record; v record; u record; m int;
BEGIN
  SELECT * INTO p FROM public.products WHERE name='iPhone 15' AND store_id=(SELECT id FROM public.stores WHERE name='StoreEQ');
  IF p.id IS NULL OR NOT p.is_serialized OR p.suggested_price <> 1500000 OR p.size_type <> 'unique' THEN
    RAISE EXCEPTION 'T1 FALLO: plantilla incorrecta (is_ser=%, sugerido=%, size_type=%).', p.is_serialized, p.suggested_price, p.size_type;
  END IF;

  SELECT * INTO v FROM public.variants WHERE product_id=p.id;
  IF v.size IS NOT NULL OR v.color IS NOT NULL OR v.price <> 1500000 OR v.cost_price IS NOT NULL OR v.stock_qty <> 1 THEN
    RAISE EXCEPTION 'T1 FALLO: variante ancla incorrecta (size=%, price=%, cost=%, stock=%).', v.size, v.price, v.cost_price, v.stock_qty;
  END IF;

  SELECT * INTO u FROM public.units WHERE variant_id=v.id;
  IF u.serial <> 'IMEI-EQ-1' OR u.cost <> 1400000 OR u.price IS NOT NULL OR u.variant_label <> '128GB Azul' OR u.status <> 'disponible' THEN
    RAISE EXCEPTION 'T1 FALLO: unidad incorrecta (serial=%, cost=%, price=%, label=%, status=%).', u.serial, u.cost, u.price, u.variant_label, u.status;
  END IF;

  SELECT count(*) INTO m FROM public.stock_movements WHERE unit_id=u.id AND type='adjustment' AND qty=1;
  IF m <> 1 THEN RAISE EXCEPTION 'T1 FALLO: no hay movimiento de ingreso de la unidad (=%).', m; END IF;

  RAISE NOTICE 'T1 OK: plantilla + ancla (stock 1) + unidad (price NULL → sugerido) + movimiento. Todo coherente.';
END $$;

-- ── T2 — suggested_price <= 0 rechazado ─────────────────────────────────────
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.create_equipment_with_unit('Sin precio', NULL, NULL, NULL, 0, 'IMEI-EQ-2', NULL, NULL, NULL);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T2 FALLO: se permitió precio sugerido 0.'; END IF;
  RAISE NOTICE 'T2 OK: precio sugerido <= 0 rechazado.';
END $$;

-- ── T3 — serial vacío rechazado ─────────────────────────────────────────────
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.create_equipment_with_unit('Sin serial', NULL, NULL, NULL, 900000, '   ', NULL, NULL, NULL);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T3 FALLO: se permitió serial vacío.'; END IF;
  RAISE NOTICE 'T3 OK: serial vacío rechazado.';
END $$;

-- ── T5 — R5: serial duplicado aborta TODO (sin plantilla huérfana) ──────────
DO $$
DECLARE ok boolean := false; n_before int; n_after int;
BEGIN
  SELECT count(*) INTO n_before FROM public.products WHERE store_id=(SELECT id FROM public.stores WHERE name='StoreEQ');
  BEGIN
    -- Nombre NUEVO pero serial DUPLICADO ('IMEI-EQ-1' ya existe por T1).
    PERFORM public.create_equipment_with_unit('iPhone Dup', NULL, NULL, NULL, 999000, 'IMEI-EQ-1', NULL, NULL, NULL);
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T5 FALLO: se permitió un serial duplicado.'; END IF;
  SELECT count(*) INTO n_after FROM public.products WHERE store_id=(SELECT id FROM public.stores WHERE name='StoreEQ');
  IF n_after <> n_before THEN
    RAISE EXCEPTION 'T5 FALLO: quedó una plantilla HUÉRFANA tras el fallo (% -> %).', n_before, n_after;
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE name='iPhone Dup') THEN
    RAISE EXCEPTION 'T5 FALLO: la plantilla iPhone Dup no se revirtió.';
  END IF;
  RAISE NOTICE 'T5 OK: serial duplicado → aborta TODO, sin plantilla huérfana (R5).';
END $$;

-- ── T6 — categoría de otra tienda rechazada ─────────────────────────────────
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.create_equipment_with_unit(
      'iPhone CatAjena', NULL,
      (SELECT id FROM public.categories WHERE name='AjenaCat'),
      NULL, 1000000, 'IMEI-EQ-6', NULL, NULL, NULL);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T6 FALLO: se aceptó una categoría de otra tienda.'; END IF;
  RAISE NOTICE 'T6 OK: categoría de otra tienda rechazada.';
END $$;

-- ── T4 — sin permiso (Vendedor) → insufficient_privilege ────────────────────
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.create_equipment_with_unit('iPhone Vendedor', NULL, NULL, NULL, 1000000, 'IMEI-EQ-4', NULL, NULL, NULL);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'T4 FALLO: un vendedor pudo crear un equipo.'; END IF;
  RAISE NOTICE 'T4 OK: sin permiso (Vendedor) → rechazado (insufficient_privilege).';
END $$;

DO $$ BEGIN RAISE NOTICE '=== test-create-equipment: TODOS LOS TESTS PASARON ==='; END $$;

ROLLBACK;
