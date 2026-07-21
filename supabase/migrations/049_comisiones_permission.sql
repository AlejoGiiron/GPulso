-- ============================================================
-- 049 — FASE 4 / Bloque C: permiso comisiones.gestionar
--
-- Permiso nuevo del módulo de comisiones por crédito:
--   · comisiones.gestionar — registrar comisiones, ver todas las de la tienda y
--     el reporte quincenal por trabajador.
--
-- Reparto (BLOQUE C, decisión aprobada):
--   · Dueño         → '*' (todo).
--   · Administrador → comisiones.gestionar.
--   · Vendedor / Técnico → NO lo tienen. Un trabajador SIN el permiso ve SOLO
--     SUS comisiones (RLS self-select, 048), en modo lectura; nunca las de otros
--     ni el registro. No se le quita la visibilidad que hoy le da el cuaderno.
--
-- Sigue el patrón 035/046 (fuente única canonical_role_permissions) al pie:
--   1) editar el array del rol en canonical_role_permissions(),
--   2) reconciliación ADITIVA SIN filtro de org (patrón 034/035),
--   3) actualizar permissionsCatalog.ts (mismo commit).
--
-- Requiere: 021 (roles, has_permission), 035 (canonical_role_permissions,
--   reconciliación), 046 (última redefinición de canonical_role_permissions).
-- Idempotente / self-healing.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Fuente única de verdad — agrega comisiones.gestionar a Administrador.
--    (Cuerpo de la 046 + una entrada más en Administrador.)
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
        "reparaciones.ver_costos",
        "comisiones.gestionar"
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
-- 2. Reconciliación ADITIVA de Administrador (patrón 034/035/046): le agrega los
--    permisos canónicos que falten, SIN quitar extras y SIN filtro de org.
--    Idempotente (guard de contención @>). Vendedor/Técnico se incluyen por
--    consistencia con la 046 aunque su set canónico no cambió (el guard los deja
--    intactos).
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
-- 3. Autoverificación (aborta y revierte si algo quedó mal).
-- ------------------------------------------------------------
DO $$
DECLARE
  v_incompletos integer;
  v_admin_sin   integer;
BEGIN
  SELECT count(*) INTO v_incompletos
    FROM public.roles
   WHERE name IN ('Administrador', 'Vendedor', 'Técnico')
     AND NOT permissions ? '*'
     AND NOT (permissions @> canonical_role_permissions(name));
  IF v_incompletos > 0 THEN
    RAISE EXCEPTION 'Reconciliación 049 incompleta: % rol(es) sin el set canónico.', v_incompletos;
  END IF;

  -- Todo Administrador (sin comodín) debe tener comisiones.gestionar.
  SELECT count(*) INTO v_admin_sin
    FROM public.roles
   WHERE name = 'Administrador'
     AND NOT permissions ? '*'
     AND NOT permissions ? 'comisiones.gestionar';
  IF v_admin_sin > 0 THEN
    RAISE EXCEPTION '049: % Administrador(es) sin comisiones.gestionar.', v_admin_sin;
  END IF;

  RAISE NOTICE '049 OK: comisiones.gestionar repartido a Administrador (Dueño via *); reconciliado en todas las orgs.';
END $$;

COMMIT;
