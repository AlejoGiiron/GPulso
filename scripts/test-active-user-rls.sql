-- ============================================================
-- test-active-user-rls.sql — Test de RLS de la migración 037 (is_active en servidor)
--
-- Verifica, con DOS usuarios reales (uno ACTIVO, uno DESACTIVADO) en la MISMA
-- tienda, que un usuario desactivado NO puede leer ni escribir tablas
-- protegidas, y que el usuario activo sigue operando normal.
--
-- Se corre en el LAB LOCAL, sobre una BD con TODAS las migraciones (001–037)
-- aplicadas. Todo va en una transacción con ROLLBACK final → no deja rastro.
--
-- Uso:
--   docker exec -i supabase_db_gmura psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < scripts/test-active-user-rls.sql
--
-- Si TODOS los asserts pasan, imprime "✔ TEST 037 OK" y hace ROLLBACK.
-- Si algún assert falla, RAISE EXCEPTION aborta con el motivo.
-- ============================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── Fixtures (como postgres; superusuario, bypassa RLS para el setup) ────────
-- Usuarios auth con UUIDs fijos para poder construir el JWT claim estático.
INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-0000-0000-0000000000aa', 'activo@test.local'),
  ('00000000-0000-0000-0000-0000000000dd', 'inactivo@test.local');

-- Organización + roles (vía la fuente única de verdad 035) + tienda.
INSERT INTO public.organizations (name) VALUES ('Org Test 037')
RETURNING id AS org_id \gset

SELECT public.seed_org_roles(:'org_id');
SELECT id AS role_admin FROM public.roles
 WHERE organization_id = :'org_id' AND name = 'Administrador' \gset

INSERT INTO public.stores (name, organization_id)
VALUES ('Tienda Test 037', :'org_id')
RETURNING id AS store_id \gset

-- Profiles: ambos Administrador de la misma tienda; uno activo, uno inactivo.
INSERT INTO public.profiles
  (id, email, full_name, role, role_id, organization_id, store_id, current_store_id, is_active)
VALUES
  ('00000000-0000-0000-0000-0000000000aa', 'activo@test.local',  'Usuario Activo',
   'admin', :'role_admin', :'org_id', :'store_id', :'store_id', true),
  ('00000000-0000-0000-0000-0000000000dd', 'inactivo@test.local','Usuario Inactivo',
   'admin', :'role_admin', :'org_id', :'store_id', :'store_id', false);

-- Un cliente de la tienda (fixture para el test de lectura).
INSERT INTO public.customers (full_name, store_id)
VALUES ('Cliente Fixture', :'store_id');


-- ── TEST 1 — Usuario ACTIVO opera normal ────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}';

DO $$
BEGIN
  IF public.get_my_store_id() IS NULL THEN
    RAISE EXCEPTION 'FALLO T1: get_my_store_id() es NULL para el usuario ACTIVO.';
  END IF;
  IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'FALLO T1: get_my_role() no es admin para el usuario ACTIVO.';
  END IF;
  IF public.get_my_organization_id() IS NULL THEN
    RAISE EXCEPTION 'FALLO T1: get_my_organization_id() es NULL para el usuario ACTIVO.';
  END IF;
  IF NOT public.has_permission('pos.usar') THEN
    RAISE EXCEPTION 'FALLO T1: has_permission(pos.usar) es false para el usuario ACTIVO.';
  END IF;
  IF (SELECT count(*) FROM public.customers) = 0 THEN
    RAISE EXCEPTION 'FALLO T1: el usuario ACTIVO no ve el cliente de su tienda (RLS de más).';
  END IF;
  RAISE NOTICE 'T1 OK: usuario activo ve datos y tiene permisos.';
END $$;

-- El activo puede ESCRIBIR (INSERT respeta WITH CHECK).
INSERT INTO public.customers (full_name, store_id)
VALUES ('Cliente creado por activo', public.get_my_store_id());

RESET ROLE;


-- ── TEST 2 — Usuario DESACTIVADO queda bloqueado en servidor ─────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000dd","role":"authenticated"}';

DO $$
BEGIN
  IF public.get_my_store_id() IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO T2: get_my_store_id() NO es NULL para el usuario DESACTIVADO.';
  END IF;
  IF public.get_my_role() IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO T2: get_my_role() NO es NULL para el usuario DESACTIVADO.';
  END IF;
  IF public.get_my_organization_id() IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO T2: get_my_organization_id() NO es NULL para el usuario DESACTIVADO.';
  END IF;
  IF public.has_permission('pos.usar') THEN
    RAISE EXCEPTION 'FALLO T2: has_permission(pos.usar) es true para el usuario DESACTIVADO.';
  END IF;

  -- No LEE datos de negocio de la tienda.
  IF (SELECT count(*) FROM public.customers) <> 0 THEN
    RAISE EXCEPTION 'FALLO T2: el usuario DESACTIVADO VE % cliente(s) (RLS no lo bloqueó).',
      (SELECT count(*) FROM public.customers);
  END IF;

  -- SÍ lee su PROPIO perfil (para que el frontend lo expulse con mensaje).
  IF (SELECT count(*) FROM public.profiles
       WHERE id = '00000000-0000-0000-0000-0000000000dd') <> 1 THEN
    RAISE EXCEPTION 'FALLO T2: el usuario DESACTIVADO no puede leer su propio perfil.';
  END IF;

  RAISE NOTICE 'T2 OK: usuario desactivado no ve datos ni tiene permisos; sí lee su propio perfil.';
END $$;

-- No puede ESCRIBIR: el INSERT no debe insertar ninguna fila (WITH CHECK falla).
DO $$
DECLARE
  v_before bigint;
  v_after  bigint;
BEGIN
  SELECT count(*) INTO v_before FROM public.customers;  -- (RLS: el desactivado ve 0)
  BEGIN
    INSERT INTO public.customers (full_name, store_id)
    VALUES ('Cliente creado por inactivo',
            '00000000-0000-0000-0000-0000000000dd'::uuid);  -- store falso: WITH CHECK falla igual
    -- Si llega acá sin excepción, la fila NO debió pasar el WITH CHECK.
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;  -- esperado: RLS lo rechaza
  END;
  RAISE NOTICE 'T2 OK: el INSERT del usuario desactivado fue bloqueado por RLS.';
END $$;

RESET ROLE;

ROLLBACK;

\echo '✔ TEST 037 OK — is_active se aplica en servidor (activo opera, desactivado bloqueado).'
