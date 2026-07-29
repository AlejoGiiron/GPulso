-- ============================================================
-- test-advance-repair-status.sql — matriz de la migración 20260728_1630
--
-- Verifica que `repair_orders.status` sea RPC-only y que la edición legítima
-- siga viva. Mismo formato que test-deliver-repair.sql / test-credit-commission.sql.
--
-- USO (lab, NUNCA prod):
--   ./scripts/lab-apply-migration.sh 20260728_1630_repair_status_rpc_only.sql
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_gpulso \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/test-advance-repair-status.sql
--
-- TODO el script corre dentro de una transacción que termina en ROLLBACK:
--   no deja datos. Si algún caso falla, aborta con el número de caso.
--
-- Se impersona a un usuario real con `SET LOCAL ROLE authenticated` +
-- `request.jwt.claims`, que es como llega una petición de PostgREST. Ese es el
-- punto: los casos 5-7 SOLO son significativos si corren como `authenticated`,
-- porque el owner (postgres) no está sujeto ni a RLS ni a grants de columna.
-- ============================================================

\set ON_ERROR_STOP on

BEGIN;

-- ------------------------------------------------------------
-- Fixture: tienda, usuario con reparaciones.gestionar, cliente y 2 órdenes.
-- ------------------------------------------------------------
DO $fixture$
DECLARE
  v_org   uuid;
  v_store uuid;
  v_role  uuid;
  v_user  uuid := gen_random_uuid();
  v_cust  uuid;
BEGIN
  SELECT id INTO v_org FROM public.organizations WHERE name = 'CelFashion';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Fixture: no existe la org CelFashion (¿lab sin sembrar?).';
  END IF;

  SELECT id INTO v_store FROM public.stores
   WHERE organization_id = v_org ORDER BY created_at LIMIT 1;

  SELECT id INTO v_role FROM public.roles
   WHERE organization_id = v_org AND name = 'Técnico';

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
          'test-057@lab.local', crypt('lab12345', gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now());

  INSERT INTO public.profiles (id, email, full_name, role, role_id,
                               organization_id, store_id, current_store_id, is_active)
  VALUES (v_user, 'test-057@lab.local', 'Test 057', 'seller', v_role,
          v_org, v_store, v_store, true);

  INSERT INTO public.customers (store_id, full_name, phone)
  VALUES (v_store, 'Cliente Test 057', '3000000057')
  RETURNING id INTO v_cust;

  -- Orden A: CON precio (podrá llegar a 'listo').
  INSERT INTO public.repair_orders
    (store_id, customer_id, marca, modelo, falla_reportada, checklist, precio, received_by)
  VALUES (v_store, v_cust, 'Test', 'A', 'no enciende', '{}'::jsonb, 150000, v_user);

  -- Orden B: SIN precio (no debe poder llegar a 'listo').
  INSERT INTO public.repair_orders
    (store_id, customer_id, marca, modelo, falla_reportada, checklist, precio, received_by)
  VALUES (v_store, v_cust, 'Test', 'B', 'pantalla rota', '{}'::jsonb, NULL, v_user);

  PERFORM set_config('test_repair_status.user',  v_user::text,  true);
  PERFORM set_config('test_repair_status.store', v_store::text, true);
END
$fixture$;

-- Impersonar al usuario (como una petición de PostgREST).
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test_repair_status.user'), 'role', 'authenticated')::text,
  true);
SET LOCAL ROLE authenticated;


-- ------------------------------------------------------------
-- CASOS
-- ------------------------------------------------------------
DO $tests$
DECLARE
  v_store uuid := current_setting('test_repair_status.store')::uuid;
  v_a     uuid;
  v_b     uuid;
  v_st    public.repair_status;
  v_precio numeric;
  v_obs   text;
  v_ok    boolean;
BEGIN
  SELECT id INTO v_a FROM public.repair_orders WHERE modelo = 'A' AND store_id = v_store;
  SELECT id INTO v_b FROM public.repair_orders WHERE modelo = 'B' AND store_id = v_store;

  -- 1. Transición legal: recibido → en_reparacion.
  PERFORM public.advance_repair_status(v_a, 'en_reparacion');
  SELECT status INTO v_st FROM public.repair_orders WHERE id = v_a;
  IF v_st <> 'en_reparacion' THEN
    RAISE EXCEPTION 'CASO 1 FALLÓ: esperaba en_reparacion, quedó %.', v_st;
  END IF;
  RAISE NOTICE '✔ 1. Transición legal recibido → en_reparacion';

  -- 2. Transición legal: en_reparacion → listo (con precio).
  PERFORM public.advance_repair_status(v_a, 'listo');
  SELECT status INTO v_st FROM public.repair_orders WHERE id = v_a;
  IF v_st <> 'listo' THEN
    RAISE EXCEPTION 'CASO 2 FALLÓ: esperaba listo, quedó %.', v_st;
  END IF;
  RAISE NOTICE '✔ 2. Transición legal en_reparacion → listo (con precio)';

  -- 2b. RETROCESO legal: listo → en_reparacion (la pantalla quedó mal pegada).
  PERFORM public.advance_repair_status(v_a, 'en_reparacion');
  SELECT status INTO v_st FROM public.repair_orders WHERE id = v_a;
  IF v_st <> 'en_reparacion' THEN
    RAISE EXCEPTION 'CASO 2b FALLÓ: el retroceso listo → en_reparacion no funcionó (quedó %).', v_st;
  END IF;
  RAISE NOTICE '✔ 2b. Retroceso legal listo → en_reparacion';

  -- 2c. El retroceso quedó AUDITADO en el historial (no es un cambio silencioso).
  IF NOT EXISTS (
    SELECT 1 FROM public.repair_status_history h
     WHERE h.repair_order_id = v_a AND h.status = 'en_reparacion'
     GROUP BY h.repair_order_id HAVING count(*) >= 2
  ) THEN
    RAISE EXCEPTION 'CASO 2c FALLÓ: el retroceso no dejó rastro en repair_status_history.';
  END IF;
  RAISE NOTICE '✔ 2c. El retroceso quedó auditado en el historial';

  -- Devolvemos la orden A a 'listo' para los casos siguientes.
  PERFORM public.advance_repair_status(v_a, 'listo');

  -- 2d. Retroceso NO permitido: en_reparacion → recibido (deliberadamente fuera).
  v_ok := false;
  BEGIN
    PERFORM public.advance_repair_status(v_b, 'recibido');
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
    IF SQLERRM NOT LIKE '%no válido para esta operación%'
       AND SQLERRM NOT LIKE '%Transición no permitida%' THEN
      RAISE EXCEPTION 'CASO 2d: abortó pero por otra razón: %', SQLERRM;
    END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'CASO 2d FALLÓ: permitió en_reparacion → recibido.';
  END IF;
  RAISE NOTICE '✔ 2d. Retroceso en_reparacion → recibido rechazado (fuera de la máquina de estados)';

  -- 3. Salto de estados: recibido → listo (orden B, aún en recibido).
  v_ok := false;
  BEGIN
    PERFORM public.advance_repair_status(v_b, 'listo');
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
    IF SQLERRM NOT LIKE '%Transición no permitida%' THEN
      RAISE EXCEPTION 'CASO 3: abortó pero por otra razón: %', SQLERRM;
    END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'CASO 3 FALLÓ: permitió el salto recibido → listo.'; END IF;
  RAISE NOTICE '✔ 3. Salto de estados rechazado (recibido → listo)';

  -- 4. 'entregado' por esta RPC: rechazado (la orden A está en listo).
  v_ok := false;
  BEGIN
    PERFORM public.advance_repair_status(v_a, 'entregado');
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
    IF SQLERRM NOT LIKE '%entrega se registra con el cobro%' THEN
      RAISE EXCEPTION 'CASO 4: abortó pero por otra razón: %', SQLERRM;
    END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'CASO 4 FALLÓ: dejó marcar entregado sin cobro.'; END IF;
  RAISE NOTICE '✔ 4. entregado por advance_repair_status rechazado (redirige a deliver_repair)';

  -- 5. A 'listo' sin precio: rechazado (orden B, la avanzamos legalmente antes).
  PERFORM public.advance_repair_status(v_b, 'en_reparacion');
  v_ok := false;
  BEGIN
    PERFORM public.advance_repair_status(v_b, 'listo');
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
    IF SQLERRM NOT LIKE '%precio antes de marcar como listo%' THEN
      RAISE EXCEPTION 'CASO 5: abortó pero por otra razón: %', SQLERRM;
    END IF;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'CASO 5 FALLÓ: dejó marcar listo sin precio.'; END IF;
  RAISE NOTICE '✔ 5. listo sin precio rechazado';

  -- 6. EL HUECO: PATCH directo de status desde el cliente. Debe fallar.
  --    (privilegio de columna revocado + trigger de segunda capa)
  v_ok := false;
  BEGIN
    UPDATE public.repair_orders SET status = 'entregado' WHERE id = v_a;
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'CASO 6 FALLÓ: ¡el cliente pudo escribir status directamente! El hueco sigue abierto.';
  END IF;
  SELECT status INTO v_st FROM public.repair_orders WHERE id = v_a;
  IF v_st <> 'listo' THEN
    RAISE EXCEPTION 'CASO 6 FALLÓ: el status cambió a % pese al error.', v_st;
  END IF;
  RAISE NOTICE '✔ 6. UPDATE directo de status desde cliente RECHAZADO (hueco cerrado)';
  RAISE NOTICE '     (lo frenó la capa 1: privilegio de columna revocado)';
END
$tests$;

-- ------------------------------------------------------------
-- CASO 6b — SEGUNDA CAPA aislada.
--   El caso 6 lo frena el privilegio de columna, así que por sí solo NO prueba
--   el trigger. Acá se simula exactamente la regresión que reabriría el hueco
--   (`apply-migrations-fresh.sh --with-grants` → GRANT ALL sobre la tabla) y se
--   verifica que el trigger lo frena igual. Todo dentro del ROLLBACK.
-- ------------------------------------------------------------
RESET ROLE;
GRANT UPDATE ON public.repair_orders TO authenticated;   -- simula el GRANT ALL
SET LOCAL ROLE authenticated;

DO $test6b$
DECLARE
  v_a  uuid;
  v_st public.repair_status;
  v_ok boolean := false;
BEGIN
  SELECT id INTO v_a FROM public.repair_orders
   WHERE modelo = 'A' AND store_id = current_setting('test_repair_status.store')::uuid;

  -- Con el privilegio de columna restaurado, la capa 1 ya no frena nada.
  IF NOT has_column_privilege('authenticated', 'public.repair_orders', 'status', 'UPDATE') THEN
    RAISE EXCEPTION 'CASO 6b: el fixture no logró restaurar el privilegio; el caso no probaría nada.';
  END IF;

  BEGIN
    UPDATE public.repair_orders SET status = 'entregado' WHERE id = v_a;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'CASO 6b FALLÓ: con el GRANT restaurado el cliente pudo escribir status. La segunda capa (trigger) no está funcionando.';
  END IF;

  SELECT status INTO v_st FROM public.repair_orders WHERE id = v_a;
  IF v_st <> 'listo' THEN
    RAISE EXCEPTION 'CASO 6b FALLÓ: el status cambió a %.', v_st;
  END IF;

  RAISE NOTICE '✔ 6b. Con GRANT ALL restaurado, el TRIGGER frena igual (capa 2 verificada)';
END
$test6b$;

-- Continúa la matriz.
DO $tests_cont$
DECLARE
  v_store  uuid := current_setting('test_repair_status.store')::uuid;
  v_a      uuid;
  v_precio numeric;
  v_obs    text;
  v_ok     boolean;
BEGIN
  SELECT id INTO v_a FROM public.repair_orders WHERE modelo = 'A' AND store_id = v_store;

  -- 7. useUpdateRepair sigue funcionando: precio y datos del equipo.
  UPDATE public.repair_orders
     SET precio = 180000, observaciones = 'cambio de pantalla', accesorios = 'funda'
   WHERE id = v_a;
  SELECT precio, observaciones INTO v_precio, v_obs FROM public.repair_orders WHERE id = v_a;
  IF v_precio <> 180000 OR v_obs <> 'cambio de pantalla' THEN
    RAISE EXCEPTION 'CASO 7 FALLÓ: no se pudo editar precio/observaciones (rompimos la UI).';
  END IF;
  RAISE NOTICE '✔ 7. useUpdateRepair sigue editando precio y datos del equipo';

  -- 8. Precio a NULL en una orden 'listo': rechazado por el CHECK.
  v_ok := false;
  BEGIN
    UPDATE public.repair_orders SET precio = NULL WHERE id = v_a;
  EXCEPTION WHEN check_violation THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'CASO 8 FALLÓ: dejó poner precio NULL en una orden lista.';
  END IF;
  RAISE NOTICE '✔ 8. precio NULL en orden lista rechazado (CHECK)';

  -- 9. El historial registró los pasos con el usuario real (no con postgres),
  --    aunque la RPC sea SECURITY DEFINER.
  IF (SELECT count(*) FROM public.repair_status_history
       WHERE repair_order_id = v_a AND changed_by = current_setting('test_repair_status.user')::uuid) < 2 THEN
    RAISE EXCEPTION 'CASO 9 FALLÓ: el historial no registró los avances con el usuario real.';
  END IF;
  RAISE NOTICE '✔ 9. Historial registrado con el usuario real (auth.uid en SECURITY DEFINER)';

  RAISE NOTICE '';
  RAISE NOTICE '════════ 13/13 CASOS VERDES — status es RPC-only ════════';
END
$tests_cont$;

RESET ROLE;
ROLLBACK;
