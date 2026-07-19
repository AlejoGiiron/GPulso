-- ============================================================
-- 037 — Enforcement de is_active EN SERVIDOR (deuda heredada #1)
--
-- PROBLEMA (heredado de G-Mura):
--   profiles.is_active existe desde 001, pero solo se chequeaba en el CLIENTE.
--   Un usuario desactivado (is_active = false) conservaba acceso real: su token
--   seguía siendo válido y el RLS no lo distinguía de uno activo. Desactivar a
--   alguien era cosmético hasta que expirara/cerrara sesión.
--
-- SOLUCIÓN — cerrar el hueco en los CUATRO choke-points de identidad que el RLS
--   y la UI consultan. Todos hacen `... FROM public.profiles WHERE id = auth.uid()`;
--   les agregamos el filtro `AND is_active`. Al desactivar a un usuario:
--     · get_my_store_id()        → NULL  ⇒ todo el RLS `store_id = get_my_store_id()`
--                                          falla cerrado (products, variants, orders,
--                                          order_items, customers, cash_shifts,
--                                          cash_expenses, layaways, returns, …).
--     · get_my_organization_id() → NULL  ⇒ RLS org-scoped (organizations, roles)
--                                          falla cerrado.
--     · get_my_role()            → NULL  ⇒ ramas admin de políticas (p. ej.
--                                          cash_shifts_update `get_my_role() = 'admin'`)
--                                          dejan de aplicar.
--     · has_permission(perm)     → false ⇒ toda política gateada por permisos
--                                          (roles RBAC, escrituras 024/030, etc.)
--                                          se niega.
--
-- POR QUÉ ESTOS CUATRO Y NO MÁS:
--   Auditoría de las políticas RLS heredadas (001–036): TODA tabla de negocio
--   se aísla por `store_id = get_my_store_id()` (a veces AND una rama extra
--   `opened_by = auth.uid()` / `get_my_role() = 'admin'`, siempre EN CONJUNCIÓN
--   con el store_id, nunca como OR de nivel superior). Las tablas org-scoped usan
--   `get_my_organization_id()`. Las escrituras RBAC usan `has_permission()`. No
--   hay ninguna política que conceda acceso a datos por una vía que NO pase por
--   uno de estos cuatro. Excepciones deliberadas (ver abajo): la auto-lectura y
--   auto-escritura del propio profile y de user_stores por `id/user_id = auth.uid()`.
--
-- EXCEPCIÓN INTENCIONAL — el propio profile:
--   La política profiles_select (016) es `id = auth.uid() OR store_id =
--   get_my_store_id()`. La primera rama SE MANTIENE viva a propósito: el frontend
--   necesita poder LEER su propio perfil (aunque esté desactivado) para detectar
--   is_active = false y expulsar al usuario con un mensaje claro. Bloquear esa
--   lectura dejaría al cliente sin saber POR QUÉ no tiene acceso. La auto-escritura
--   de profile / user_stores por auth.uid() es de bajo riesgo (un desactivado solo
--   podría tocar SU fila) y no da acceso a datos de negocio.
--
-- PORTABILIDAD A G-MURA (candidata a portear en sentido inverso — ver FORKED_FROM.md):
--   Esta migración es AUTOCONTENIDA y sin dependencias de G-Pulso. Redefine las
--   mismas funciones con las mismas firmas que existen en G-Mura (001/013/020/021).
--   Se puede aplicar tal cual en G-Mura para cerrar el mismo hueco.
--
-- Atomicidad: todo en una transacción. Idempotente: CREATE OR REPLACE +
--   verificación; reaplicar deja el mismo estado.
--
-- NO toca: ninguna política RLS (solo redefine las funciones que ya consumen),
--   ni datos, ni el enum user_role, ni los triggers.
--
-- Requiere: 001 (get_my_store_id, get_my_role, profiles.is_active),
--   013 (redefinición de get_my_store_id → tienda activa),
--   020 (get_my_organization_id), 021 (has_permission).
--
-- Cómo aplicar (lab): ./scripts/lab-apply-migration.sh 037_active_user_enforcement.sql
--   (o psql -v ON_ERROR_STOP=1 -f supabase/migrations/037_active_user_enforcement.sql)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. get_my_store_id() — tienda ACTIVA, NULL si el usuario está desactivado.
--    Preserva el COALESCE(current_store_id, store_id) de la 013. Con is_active
--    = false la fila se excluye del WHERE → devuelve NULL → RLS falla cerrado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_store_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(current_store_id, store_id)
  FROM public.profiles
  WHERE id = auth.uid()
    AND is_active;
$$;

-- ------------------------------------------------------------
-- 2. get_my_role() — rol del usuario, NULL si está desactivado.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
    AND is_active;
$$;

-- ------------------------------------------------------------
-- 3. get_my_organization_id() — org del usuario, NULL si está desactivado.
--    Cierra el acceso a las tablas org-scoped (organizations, roles) para un
--    usuario desactivado (defensa en profundidad; la 020 no filtraba is_active).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_organization_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.profiles
  WHERE id = auth.uid()
    AND is_active;
$$;

-- ------------------------------------------------------------
-- 4. has_permission(perm) — false si el usuario está desactivado.
--    Mismo cuerpo que la 021 + `AND p.is_active`.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(perm text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.roles    r ON r.id = p.role_id
     WHERE p.id = auth.uid()
       AND p.is_active
       AND (r.permissions ? perm OR r.permissions ? '*')
  );
$$;

-- ------------------------------------------------------------
-- 5. Autoverificación (aborta y revierte si algo quedó mal).
--    Confirma que las 4 funciones filtran por is_active en su definición.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_missing text := '';
  fn record;
BEGIN
  FOR fn IN
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('get_my_store_id', 'get_my_role',
                         'get_my_organization_id', 'has_permission')
  LOOP
    IF position('is_active' IN fn.def) = 0 THEN
      v_missing := v_missing || fn.proname || ' ';
    END IF;
  END LOOP;

  IF length(v_missing) > 0 THEN
    RAISE EXCEPTION '037 FALLÓ: estas funciones no filtran is_active: %', v_missing;
  END IF;

  RAISE NOTICE '037 OK: get_my_store_id / get_my_role / get_my_organization_id / has_permission ahora niegan a usuarios desactivados en servidor.';
END;
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar tras aplicar, con 2 usuarios)
-- ============================================================
-- Prep: un usuario ACTIVO (uA) y uno DESACTIVADO (uD) en la misma tienda.
--   UPDATE public.profiles SET is_active = false WHERE id = '<uD>';
--
-- 1. Como uD (SET request.jwt.claims con sub=<uD>):
--      SELECT get_my_store_id();          -- NULL
--      SELECT get_my_role();              -- NULL
--      SELECT get_my_organization_id();   -- NULL
--      SELECT has_permission('pos.usar'); -- false
--
-- 2. uD NO puede leer datos de negocio (deben dar 0 filas / error de RLS):
--      SET LOCAL ROLE authenticated;
--      SET LOCAL "request.jwt.claims" = '{"sub":"<uD>","role":"authenticated"}';
--      SELECT count(*) FROM public.products;   -- 0
--      SELECT count(*) FROM public.orders;     -- 0
--      SELECT count(*) FROM public.customers;  -- 0
--
-- 3. uD NO puede escribir (INSERT bloqueado por WITH CHECK):
--      INSERT INTO public.customers (store_id, full_name)
--        VALUES (get_my_store_id(), 'x');      -- 0 filas / violación de RLS
--
-- 4. uD SÍ puede leer su PROPIO profile (para que el cliente lo expulse):
--      SELECT id, is_active FROM public.profiles WHERE id = '<uD>';  -- 1 fila
--
-- 5. uA (activo) sigue operando normal: get_my_store_id() no-NULL, ve productos,
--    puede vender, has_permission('pos.usar') = true.
--
-- 6. Reactivar restaura el acceso sin más cambios:
--      UPDATE public.profiles SET is_active = true WHERE id = '<uD>';
-- ============================================================
