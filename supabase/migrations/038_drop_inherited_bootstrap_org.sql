-- ============================================================
-- 038 — Eliminar la organización bootstrap heredada de G-Mura
--       (ESPECÍFICA DE G-PULSO — NO PORTABLE A G-MURA)
--
-- CONTEXTO:
--   La migración heredada 020 crea la organización 'La Bodega del Jeans' (el
--   tenant de PRODUCCIÓN de G-Mura) y la 021 le siembra sus 3 roles. En G-Mura
--   eso es correcto: es su org real con datos. Pero en una BD VIRGEN de G-Pulso,
--   correr el set heredado deja esa org como un CASCARÓN vacío (sin tiendas ni
--   usuarios) que no tiene nada que ver con el cliente de G-Pulso (CelFashion,
--   sembrada aparte por scripts/seed-celfashion-org.sql). 020 no se edita
--   (regla del fork: no tocar heredadas) → se limpia con esta migración nueva.
--
-- ⚠ NO PORTABLE A G-MURA: en G-Mura 'La Bodega del Jeans' es la org real EN
--   PRODUCCIÓN. Esta migración jamás debe aplicarse allá. Es exclusiva de
--   G-Pulso. Anotada como tal en FORKED_FROM.md.
--
-- GUARDAS DEFENSIVAS (borra solo el cascarón, nunca datos reales):
--   · Identifica la org SOLO por su nombre EXACTO 'La Bodega del Jeans'.
--   · Borra ÚNICAMENTE si NO tiene tiendas NI profiles asociados. Si alguien
--     (por error) ya la usó, NO se borra: RAISE NOTICE y sigue (no aborta).
--   · Al borrar la org, sus roles sembrados cascadean solos
--     (roles.organization_id ... ON DELETE CASCADE, migración 021).
--
-- POR QUÉ SE DESACTIVA UN TRIGGER:
--   El rol 'Dueño' lleva el comodín '*' y el trigger trg_roles_protect_owner
--   (021) BLOQUEA cualquier DELETE/UPDATE de un rol con '*' — incluido el DELETE
--   que dispara el cascade de la FK. Para poder limpiar el cascarón se desactiva
--   ese trigger SOLO durante esta migración y se REACTIVA antes del COMMIT. Es
--   transaccional: si algo falla, el ALTER se revierte con todo lo demás. Requiere
--   privilegios de owner de la tabla (los tiene la conexión postgres/service_role
--   que aplica las migraciones).
--
-- IDEMPOTENTE: si la org no existe (ya borrada), no hace nada.
--
-- Requiere: 020 (crea la org) y 021 (roles con FK ON DELETE CASCADE +
--   trigger trg_roles_protect_owner).
--
-- Cómo aplicar (lab): ./scripts/lab-apply-migration.sh 038_drop_inherited_bootstrap_org.sql
-- ============================================================

BEGIN;

-- Desactiva la protección del rol Dueño SOLO para esta migración (ver cabecera).
-- Transaccional: se revierte si algo falla antes del COMMIT.
ALTER TABLE public.roles DISABLE TRIGGER trg_roles_protect_owner;

DO $$
DECLARE
  v_org_id    uuid;
  v_stores    integer;
  v_profiles  integer;
  v_roles     integer;
BEGIN
  -- Solo por nombre EXACTO (guarda 1).
  SELECT id INTO v_org_id
    FROM public.organizations
   WHERE name = 'La Bodega del Jeans';

  IF v_org_id IS NULL THEN
    RAISE NOTICE '038: no existe ''La Bodega del Jeans''; nada que borrar (idempotente).';
    RETURN;
  END IF;

  -- Guarda 2: no borrar si tiene tiendas o usuarios (no es un cascarón).
  SELECT count(*) INTO v_stores   FROM public.stores   WHERE organization_id = v_org_id;
  SELECT count(*) INTO v_profiles FROM public.profiles WHERE organization_id = v_org_id;

  IF v_stores > 0 OR v_profiles > 0 THEN
    RAISE NOTICE '038: ''La Bodega del Jeans'' tiene % tienda(s) y % profile(s) asociados → NO se borra (guarda defensiva). Revisar manualmente.',
      v_stores, v_profiles;
    RETURN;
  END IF;

  -- Cascarón confirmado (0 tiendas, 0 profiles): borrar. Con el trigger de
  -- protección desactivado, la FK ON DELETE CASCADE de la 021 arrastra los roles
  -- sembrados (incluido el Dueño con '*').
  SELECT count(*) INTO v_roles FROM public.roles WHERE organization_id = v_org_id;

  DELETE FROM public.organizations WHERE id = v_org_id;

  RAISE NOTICE '038 OK: org heredada ''La Bodega del Jeans'' eliminada (cascarón vacío); % rol(es) sembrado(s) cascadeado(s).',
    v_roles;
END;
$$;

-- Reactiva la protección del rol Dueño antes de cerrar la transacción.
ALTER TABLE public.roles ENABLE TRIGGER trg_roles_protect_owner;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================
-- 1. La org heredada ya no existe (debe dar 0):
--      SELECT count(*) FROM public.organizations WHERE name = 'La Bodega del Jeans';
-- 2. Sus roles se fueron con ella (debe dar 0):
--      SELECT count(*) FROM public.roles r
--        WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = r.organization_id);
-- 3. CelFashion (sembrada aparte) queda intacta:
--      SELECT name FROM public.organizations ORDER BY name;   -- solo CelFashion
-- ============================================================
