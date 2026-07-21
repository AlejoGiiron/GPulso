-- ============================================================
-- test-credit-commission.sql — Tests de register_credit_commission (048)
-- Atomicidad, reparto coherente, turno por tienda en efectivo, consignación sin
-- turno, permiso comisiones.gestionar, RLS self-select del trabajador, y
-- ESCRITURA RPC-ONLY (INSERT/UPDATE/DELETE directo del cliente rechazado).
--
-- IMPORTANTE: las operaciones de CLIENTE corren bajo `SET LOCAL ROLE
-- authenticated` para que el RLS se aplique (como postgres/owner el RLS se
-- saltaría y los tests darían falsos verdes). Los fixtures/DDL corren como
-- postgres (RESET ROLE). Mismo patrón que scripts/test-active-user-rls.sql.
-- Transacción con ROLLBACK final.
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures (como postgres) ─────────────────────────────────────────────────
INSERT INTO auth.users (id,email) VALUES
  ('00000000-0000-0000-0000-0000000000c1','admin@com.test'),
  ('00000000-0000-0000-0000-0000000000c2','seller@com.test');
INSERT INTO public.organizations (name) VALUES ('OrgCOM') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');
SELECT id AS role_admin  FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
SELECT id AS role_seller FROM public.roles WHERE organization_id=:'org' AND name='Vendedor' \gset

-- Garantizar comisiones.gestionar en el Administrador (canonical al día tras 049;
-- defensa por si el orden de aplicación difiere en una BD de test).
UPDATE public.roles
   SET permissions = permissions || '["comisiones.gestionar"]'::jsonb
 WHERE id = :'role_admin' AND NOT permissions ? 'comisiones.gestionar';

INSERT INTO public.stores (name, organization_id) VALUES ('StoreCOM', :'org') RETURNING id AS store \gset
INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active) VALUES
  ('00000000-0000-0000-0000-0000000000c1','admin@com.test','Admin COM','admin',:'role_admin',:'org',:'store',:'store',true),
  ('00000000-0000-0000-0000-0000000000c2','seller@com.test','Seller COM','seller',:'role_seller',:'org',:'store',:'store',true);
INSERT INTO public.customers (id, full_name, phone, store_id)
VALUES ('00000000-0000-0000-0000-0000000000cc', 'Cliente COM', '3009876543', :'store');

-- ── T1 — Efectivo SIN turno abierto → RECHAZA ───────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.register_credit_commission(
      '00000000-0000-0000-0000-0000000000c2','efectivo',100000,50000,50000,NULL,NULL,NULL);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T1 FALLO: efectivo sin turno debía rechazar.'; END IF;
  RAISE NOTICE 'T1 OK: efectivo sin turno rechazado.';
END $$;

-- ── T2 — Consignación SIN turno → OK, shift_id NULL, no toca caja ────────────
DO $$
DECLARE v_id uuid; v_shift uuid; v_metodo commission_method;
BEGIN
  v_id := public.register_credit_commission(
    '00000000-0000-0000-0000-0000000000c2','consignacion',100000,50000,50000,
    '00000000-0000-0000-0000-0000000000cc',NULL,'Crédito por consignación');
  SELECT shift_id, metodo INTO v_shift, v_metodo FROM public.credit_commissions WHERE id=v_id;
  IF v_shift IS NOT NULL THEN RAISE EXCEPTION 'T2 FALLO: consignación no debe imputar turno.'; END IF;
  IF v_metodo <> 'consignacion' THEN RAISE EXCEPTION 'T2 FALLO: método incorrecto.'; END IF;
  RAISE NOTICE 'T2 OK: consignación registrada sin turno.';
END $$;

-- ── T3 — Reparto incoherente (local+worker != total) → RECHAZA ──────────────
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN  -- 60000 + 50000 = 110000 <> 100000
    PERFORM public.register_credit_commission(
      '00000000-0000-0000-0000-0000000000c2','consignacion',100000,60000,50000,NULL,NULL,NULL);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T3 FALLO: reparto incoherente debía rechazar.'; END IF;
  RAISE NOTICE 'T3 OK: reparto incoherente rechazado.';
END $$;

-- Fixture para T4: un turno ABIERTO de la tienda (como postgres).
RESET ROLE;
INSERT INTO public.cash_shifts (store_id, opened_by, opening_amount)
VALUES (:'store', '00000000-0000-0000-0000-0000000000c1', 100000);

-- ── T4 — Efectivo CON turno abierto → OK, imputa al turno ───────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
DO $$
DECLARE v_id uuid; v_shift uuid; v_open uuid;
BEGIN
  -- El turno abierto de la tienda (natural key; los psql vars no entran al bloque).
  SELECT id INTO v_open FROM public.cash_shifts WHERE closed_at IS NULL LIMIT 1;
  v_id := public.register_credit_commission(
    '00000000-0000-0000-0000-0000000000c2','efectivo',100000,50000,50000,NULL,NULL,NULL);
  SELECT shift_id INTO v_shift FROM public.credit_commissions WHERE id=v_id;
  IF v_shift IS DISTINCT FROM v_open THEN
    RAISE EXCEPTION 'T4 FALLO: efectivo no se imputó al turno abierto (got %, exp %).', v_shift, v_open;
  END IF;
  RAISE NOTICE 'T4 OK: efectivo imputado al turno abierto.';
END $$;

-- ── T5 — Sin permiso comisiones.gestionar → RECHAZA ─────────────────────────
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.register_credit_commission(
      '00000000-0000-0000-0000-0000000000c2','consignacion',100000,50000,50000,NULL,NULL,NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T5 FALLO: vendedor sin permiso debía rechazar.'; END IF;
  RAISE NOTICE 'T5 OK: registro sin permiso rechazado.';
END $$;

-- ── T7 — ESCRITURA RPC-ONLY: INSERT/UPDATE/DELETE directo del cliente RECHAZADO
-- (punto 1: cerrar el bypass de la RPC). Bajo authenticated + admin CON permiso.
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
DO $$
DECLARE v_target uuid; v_ins boolean := false; v_upd boolean := false; v_del boolean := false; v_rows int;
BEGIN
  -- Una fila existente que el admin SÍ ve (gestionar) para intentar UPDATE/DELETE.
  SELECT id INTO v_target FROM public.credit_commissions LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'T7 SETUP: no hay fila para probar.'; END IF;

  -- INSERT directo → sin política INSERT → RLS lo rechaza.
  BEGIN
    INSERT INTO public.credit_commissions
      (store_id, worker_id, monto_total, monto_local, monto_trabajador, metodo, created_by)
    VALUES
      ((SELECT get_my_store_id()), '00000000-0000-0000-0000-0000000000c2',
       100000, 50000, 50000, 'consignacion', '00000000-0000-0000-0000-0000000000c1');
  EXCEPTION WHEN insufficient_privilege THEN v_ins := true;
  END;
  IF NOT v_ins THEN RAISE EXCEPTION 'T7 FALLO: INSERT directo del cliente NO fue rechazado.'; END IF;

  -- UPDATE directo → sin política UPDATE → RLS no actualiza ninguna fila.
  BEGIN
    UPDATE public.credit_commissions SET monto_trabajador = 999999 WHERE id = v_target;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN v_upd := true; END IF;  -- RLS filtró: 0 filas afectadas
  EXCEPTION WHEN insufficient_privilege THEN v_upd := true;
  END;
  IF NOT v_upd THEN RAISE EXCEPTION 'T7 FALLO: UPDATE directo del cliente afectó filas.'; END IF;

  -- DELETE directo → sin política DELETE → RLS no borra ninguna fila.
  BEGIN
    DELETE FROM public.credit_commissions WHERE id = v_target;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN v_del := true; END IF;
  EXCEPTION WHEN insufficient_privilege THEN v_del := true;
  END;
  IF NOT v_del THEN RAISE EXCEPTION 'T7 FALLO: DELETE directo del cliente borró filas.'; END IF;

  RAISE NOTICE 'T7 OK: escritura directa (INSERT/UPDATE/DELETE) rechazada → RPC es la única vía.';
END $$;

-- ── T6 — RLS self-select: el trabajador ve SOLO lo suyo ─────────────────────
-- El admin crea una comisión cuyo worker es el ADMIN (no el vendedor). El
-- vendedor (sin gestionar) NO debe verla.
DO $$
BEGIN
  PERFORM public.register_credit_commission(
    '00000000-0000-0000-0000-0000000000c1','consignacion',100000,50000,50000,NULL,NULL,'del admin');
END $$;

SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
DO $$
DECLARE v_mias int; v_ajenas int;
BEGIN
  SELECT count(*) INTO v_mias   FROM public.credit_commissions
    WHERE worker_id = '00000000-0000-0000-0000-0000000000c2';
  SELECT count(*) INTO v_ajenas FROM public.credit_commissions
    WHERE worker_id <> '00000000-0000-0000-0000-0000000000c2';
  IF v_mias = 0   THEN RAISE EXCEPTION 'T6 FALLO: el trabajador no ve NINGUNA de las suyas.'; END IF;
  IF v_ajenas <> 0 THEN RAISE EXCEPTION 'T6 FALLO: el trabajador ve % comisión(es) ajena(s).', v_ajenas; END IF;
  RAISE NOTICE 'T6 OK: RLS self-select — el trabajador ve solo lo suyo (% suyas, 0 ajenas).', v_mias;
END $$;

RESET ROLE;
ROLLBACK;

\echo '✔ TEST 048 OK — register_credit_commission + RLS self-select + escritura RPC-only.'
