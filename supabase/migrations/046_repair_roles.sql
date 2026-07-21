-- ============================================================
-- 046 — FASE 3 / Bloque A5: rol Técnico + permisos de reparaciones
--
-- Permisos nuevos del módulo:
--   · reparaciones.gestionar  — recibir equipos, avanzar estados, consumir
--     repuestos, cobrar entregas (según también pos.usar).
--   · reparaciones.ver_costos — ver los costos de repuestos (repair_parts).
--
-- Reparto (A5):
--   · Dueño         → '*' (todo).
--   · Administrador → gestionar + ver_costos.
--   · Vendedor      → gestionar (recibe y cobra) pero NO ver_costos (solo ve el
--     precio a cobrar). El bloqueo de costos es de BD: repair_parts SELECT exige
--     ver_costos (044).
--   · Técnico (rol NUEVO) → gestionar + ver_costos. SIN pos.usar (no vende: no
--     puede cobrar entregas, deliver_repair lo exige) ni inventario general.
--
-- Sigue el patrón 035 (fuente única canonical_role_permissions) al pie:
--   1) editar el array del rol en canonical_role_permissions(),
--   2) reconciliación ADITIVA sin filtro de org (patrón 034/035),
--   3) actualizar permissionsCatalog.ts (hecho en el mismo commit).
--
-- Requiere: 021 (roles, has_permission), 035 (canonical_role_permissions,
--   seed_org_roles, reconciliación). Idempotente / self-healing.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Fuente única de verdad — agrega reparaciones.* y el rol Técnico.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.canonical_role_permissions(p_role_name text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role_name
    WHEN 'Dueño' THEN
      '["*"]'::jsonb
    WHEN 'Administrador' THEN
      '[
        "pos.usar",
        "ventas.anular",
        "ventas.regalo",
        "ventas.fiar",
        "historial.ver",
        "separados.gestionar",
        "separados.eliminar",
        "devoluciones.gestionar",
        "clientes.gestionar",
        "clientes.eliminar",
        "inventario.ver",
        "inventario.gestionar",
        "productos.gestionar",
        "compras.gestionar",
        "reportes.ver",
        "gastos.ver",
        "gastos.gestionar",
        "config.gestionar",
        "usuarios.gestionar",
        "reparaciones.gestionar",
        "reparaciones.ver_costos"
      ]'::jsonb
    WHEN 'Vendedor' THEN
      '[
        "pos.usar",
        "separados.gestionar",
        "devoluciones.gestionar",
        "clientes.gestionar",
        "inventario.ver",
        "gastos.gestionar",
        "reparaciones.gestionar"
      ]'::jsonb
    WHEN 'Técnico' THEN
      '[
        "reparaciones.gestionar",
        "reparaciones.ver_costos"
      ]'::jsonb
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.canonical_role_permissions(text) IS
  'Fuente única de verdad de los permisos de los roles base (Dueño/Administrador/Vendedor/Técnico). Para agregar un permiso: editar acá + migración de reconciliación aditiva SIN filtro de org (patrón 034/035). Debe coincidir con ALL_PERMISSIONS de permissionsCatalog.ts.';


-- ------------------------------------------------------------
-- 2. seed_org_roles — ahora también crea el rol Técnico en orgs NUEVAS.
--    (Cuerpo de la 035 + una fila más para Técnico.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_org_roles(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'seed_org_roles: p_organization_id no puede ser NULL.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'seed_org_roles: no existe la organización % (¿se creó primero?).', p_organization_id;
  END IF;

  INSERT INTO public.roles (organization_id, name, permissions)
  VALUES (p_organization_id, 'Dueño', canonical_role_permissions('Dueño'))
  ON CONFLICT (organization_id, name) DO NOTHING;

  INSERT INTO public.roles (organization_id, name, permissions)
  VALUES (p_organization_id, 'Administrador', canonical_role_permissions('Administrador'))
  ON CONFLICT (organization_id, name) DO UPDATE SET permissions = EXCLUDED.permissions;

  INSERT INTO public.roles (organization_id, name, permissions)
  VALUES (p_organization_id, 'Vendedor', canonical_role_permissions('Vendedor'))
  ON CONFLICT (organization_id, name) DO UPDATE SET permissions = EXCLUDED.permissions;

  INSERT INTO public.roles (organization_id, name, permissions)
  VALUES (p_organization_id, 'Técnico', canonical_role_permissions('Técnico'))
  ON CONFLICT (organization_id, name) DO UPDATE SET permissions = EXCLUDED.permissions;
END;
$$;

COMMENT ON FUNCTION public.seed_org_roles(uuid) IS
  'Crea los 4 roles base (Dueño/Administrador/Vendedor/Técnico) de una organización a partir de canonical_role_permissions(). Primitiva de CREACIÓN de org. Para orgs existentes usar la reconciliación aditiva (035/046).';

REVOKE EXECUTE ON FUNCTION public.seed_org_roles(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.seed_org_roles(uuid) TO service_role;


-- ------------------------------------------------------------
-- 3. Crear el rol Técnico en TODA org existente que no lo tenga (SIN filtro de
--    org). No pisa un Técnico personalizado (DO NOTHING).
-- ------------------------------------------------------------
INSERT INTO public.roles (organization_id, name, permissions)
SELECT o.id, 'Técnico', canonical_role_permissions('Técnico')
  FROM public.organizations o
ON CONFLICT (organization_id, name) DO NOTHING;


-- ------------------------------------------------------------
-- 4. Reconciliación ADITIVA de Administrador/Vendedor/Técnico existentes
--    (patrón 034/035): les agrega los permisos canónicos que falten, SIN quitar
--    extras y SIN filtro de org. Idempotente (guard de contención @>).
-- ------------------------------------------------------------
UPDATE public.roles r
   SET permissions = (
     SELECT jsonb_agg(perm ORDER BY perm)
       FROM (
         SELECT DISTINCT jsonb_array_elements_text(
                  r.permissions || canonical_role_permissions(r.name)
                ) AS perm
       ) u
   )
 WHERE r.name IN ('Administrador', 'Vendedor', 'Técnico')
   AND NOT r.permissions ? '*'
   AND canonical_role_permissions(r.name) IS NOT NULL
   AND NOT (r.permissions @> canonical_role_permissions(r.name));


-- ------------------------------------------------------------
-- 5. Autoverificación (aborta y revierte si algo quedó mal).
-- ------------------------------------------------------------
DO $$
DECLARE
  v_incompletos integer;
  v_tecnicos    integer;
BEGIN
  SELECT count(*) INTO v_incompletos
    FROM public.roles
   WHERE name IN ('Administrador', 'Vendedor', 'Técnico')
     AND NOT permissions ? '*'
     AND NOT (permissions @> canonical_role_permissions(name));
  IF v_incompletos > 0 THEN
    RAISE EXCEPTION 'Reconciliación 046 incompleta: % rol(es) sin el set canónico.', v_incompletos;
  END IF;

  -- Toda org debe tener su Técnico.
  SELECT count(*) INTO v_tecnicos
    FROM public.organizations o
   WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.organization_id = o.id AND r.name = 'Técnico');
  IF v_tecnicos > 0 THEN
    RAISE EXCEPTION '046: % organización(es) quedaron sin rol Técnico.', v_tecnicos;
  END IF;

  RAISE NOTICE '046 OK: reparaciones.gestionar/ver_costos repartidos; rol Técnico sembrado y reconciliado en todas las orgs.';
END $$;

COMMIT;
