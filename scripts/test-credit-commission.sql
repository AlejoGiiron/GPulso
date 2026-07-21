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

-- ============================================================
-- Punto 2 (050) — reverso (gateado por turno) + reasignación (caja-safe).
-- ============================================================
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- ── T8 — Reverso de EFECTIVO con turno ABIERTO → OK + no cuenta al cuadre ────
DO $$
DECLARE v_open uuid; v_eff uuid; v_before numeric; v_after numeric;
BEGIN
  SELECT id INTO v_open FROM public.cash_shifts WHERE closed_at IS NULL LIMIT 1;
  SELECT id INTO v_eff FROM public.credit_commissions
    WHERE metodo='efectivo' AND shift_id=v_open AND reversed_at IS NULL LIMIT 1;  -- la de T4
  SELECT coalesce(sum(monto_total),0) INTO v_before FROM public.credit_commissions
    WHERE metodo='efectivo' AND shift_id=v_open AND reversed_at IS NULL;

  PERFORM public.reverse_credit_commission(v_eff);

  IF (SELECT reversed_at FROM public.credit_commissions WHERE id=v_eff) IS NULL THEN
    RAISE EXCEPTION 'T8 FALLO: no marcó reversed_at.';
  END IF;
  -- La anulada NO cuenta al efectivo del turno (fuente del expectedCash).
  SELECT coalesce(sum(monto_total),0) INTO v_after FROM public.credit_commissions
    WHERE metodo='efectivo' AND shift_id=v_open AND reversed_at IS NULL;
  IF v_after <> v_before - 100000 THEN
    RAISE EXCEPTION 'T8 FALLO: la anulada sigue contando (esperado %, got %).', v_before-100000, v_after;
  END IF;
  RAISE NOTICE 'T8 OK: reverso efectivo turno abierto; la anulada baja el efectivo esperado.';
END $$;

-- Registrar una NUEVA efectivo (turno aún abierto) para probar el reverso tras
-- cierre y la reasignación caja-safe.
DO $$ BEGIN
  PERFORM public.register_credit_commission(
    '00000000-0000-0000-0000-0000000000c2','efectivo',100000,50000,50000,NULL,NULL,'para cerrar');
END $$;

-- Cerrar el turno (como postgres).
RESET ROLE;
UPDATE public.cash_shifts SET closed_at = now(), closing_amount = 0 WHERE closed_at IS NULL;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- ── T9 — Reverso de EFECTIVO con turno CERRADO → RECHAZADO ──────────────────
DO $$
DECLARE v_c2 uuid; v_ok boolean := false;
BEGIN
  SELECT id INTO v_c2 FROM public.credit_commissions
    WHERE metodo='efectivo' AND reversed_at IS NULL LIMIT 1;  -- la recién creada
  BEGIN PERFORM public.reverse_credit_commission(v_c2);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T9 FALLO: reverso de efectivo-turno-cerrado debía rechazar.'; END IF;
  RAISE NOTICE 'T9 OK: reverso efectivo turno cerrado rechazado.';
END $$;

-- ── T10 — Reverso de CONSIGNACIÓN → OK (no toca caja, permitido siempre) ─────
DO $$
DECLARE v_c uuid;
BEGIN
  SELECT id INTO v_c FROM public.credit_commissions
    WHERE metodo='consignacion' AND reversed_at IS NULL LIMIT 1;
  PERFORM public.reverse_credit_commission(v_c);
  IF (SELECT reversed_at FROM public.credit_commissions WHERE id=v_c) IS NULL THEN
    RAISE EXCEPTION 'T10 FALLO: no anuló la consignación.';
  END IF;
  RAISE NOTICE 'T10 OK: reverso de consignación permitido.';
END $$;

-- ── T11 — Reasignación TRAS CIERRE → OK y expectedCash NO cambia ─────────────
DO $$
DECLARE v_c2 uuid; v_shift uuid; v_oldw uuid; v_before numeric; v_after numeric;
BEGIN
  SELECT id, shift_id, worker_id INTO v_c2, v_shift, v_oldw
    FROM public.credit_commissions WHERE metodo='efectivo' AND reversed_at IS NULL LIMIT 1;
  SELECT coalesce(sum(monto_total),0) INTO v_before FROM public.credit_commissions
    WHERE metodo='efectivo' AND shift_id=v_shift AND reversed_at IS NULL;

  PERFORM public.reassign_commission_worker(v_c2, '00000000-0000-0000-0000-0000000000c1');

  IF (SELECT worker_id FROM public.credit_commissions WHERE id=v_c2) = v_oldw THEN
    RAISE EXCEPTION 'T11 FALLO: no reasignó el beneficiario.';
  END IF;
  IF (SELECT original_worker_id FROM public.credit_commissions WHERE id=v_c2) IS DISTINCT FROM v_oldw THEN
    RAISE EXCEPTION 'T11 FALLO: no guardó el trabajador original.';
  END IF;
  SELECT coalesce(sum(monto_total),0) INTO v_after FROM public.credit_commissions
    WHERE metodo='efectivo' AND shift_id=v_shift AND reversed_at IS NULL;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'T11 FALLO: reasignar cambió el efectivo del cuadre (%, %).', v_before, v_after;
  END IF;
  RAISE NOTICE 'T11 OK: reasignación tras cierre; expectedCash sin cambio y traza guardada.';
END $$;

-- ── T13 — Anular una comisión YA anulada → RECHAZADO (no se pierde quién la
--          anuló primero). ────────────────────────────────────────────────────
DO $$
DECLARE v_rev uuid; v_ok boolean := false;
BEGIN
  SELECT id INTO v_rev FROM public.credit_commissions WHERE reversed_at IS NOT NULL LIMIT 1;
  BEGIN PERFORM public.reverse_credit_commission(v_rev);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T13 FALLO: anular una ya anulada debía rechazar.'; END IF;
  RAISE NOTICE 'T13 OK: no se puede anular una comisión ya anulada.';
END $$;

-- ── T14 — Reasignar una comisión ANULADA → RECHAZADO (no se le paga a nadie) ─
DO $$
DECLARE v_rev uuid; v_ok boolean := false;
BEGIN
  SELECT id INTO v_rev FROM public.credit_commissions WHERE reversed_at IS NOT NULL LIMIT 1;
  BEGIN PERFORM public.reassign_commission_worker(v_rev, '00000000-0000-0000-0000-0000000000c1');
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T14 FALLO: reasignar una anulada debía rechazar.'; END IF;
  RAISE NOTICE 'T14 OK: no se puede reasignar una comisión anulada.';
END $$;

-- ── T15 — Reasignar a un trabajador que NO es de la org → RECHAZADO ──────────
DO $$
DECLARE v_act uuid; v_ok boolean := false;
BEGIN
  SELECT id INTO v_act FROM public.credit_commissions WHERE reversed_at IS NULL LIMIT 1;
  -- uuid inexistente → no pertenece a la organización.
  BEGIN PERFORM public.reassign_commission_worker(v_act, '00000000-0000-0000-0000-0000000000f9');
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'T15 FALLO: reasignar a un trabajador ajeno a la org debía rechazar.'; END IF;
  RAISE NOTICE 'T15 OK: reasignar a un trabajador ajeno a la organización rechazado.';
END $$;

-- ── T12 — Worker sin permiso NO puede revertir NI reasignar (ni por API) ─────
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
DO $$
DECLARE v_r boolean := false; v_a boolean := false;
BEGIN
  -- El permiso se chequea ANTES del lookup de fila → el id da igual.
  BEGIN PERFORM public.reverse_credit_commission('00000000-0000-0000-0000-0000000000f0');
  EXCEPTION WHEN insufficient_privilege THEN v_r := true;
  END;
  BEGIN PERFORM public.reassign_commission_worker(
    '00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-0000000000c1');
  EXCEPTION WHEN insufficient_privilege THEN v_a := true;
  END;
  IF NOT v_r THEN RAISE EXCEPTION 'T12 FALLO: worker pudo revertir.'; END IF;
  IF NOT v_a THEN RAISE EXCEPTION 'T12 FALLO: worker pudo reasignar.'; END IF;
  RAISE NOTICE 'T12 OK: worker sin permiso no puede revertir ni reasignar.';
END $$;

RESET ROLE;
ROLLBACK;

\echo '✔ TEST 048/050 OK — registro + RLS self-select + escritura RPC-only + reverso gateado + reasignación caja-safe + guards (doble anulación / reasignar anulada / worker fuera de org).'
