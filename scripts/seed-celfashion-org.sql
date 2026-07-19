-- ============================================================
-- seed-celfashion-org.sql — Siembra de la organización del cliente (CelFashion)
--
-- Crea la organización "CelFashion" con su tienda inicial
-- "CelFashion — Principal" y sus roles base vía seed_org_roles() (migración 035:
-- la FUENTE ÚNICA DE VERDAD de permisos de rol). NO define permisos inline: para
-- cambiarlos se edita canonical_role_permissions() en la 035, nunca este script.
--
-- Roles que crea seed_org_roles() (reportados en el resumen al final):
--     · Dueño         → ["*"]  (comodín: todos los permisos; inmutable)
--     · Administrador → 19 permisos (todo menos roles.gestionar)
--     · Vendedor      →  6 permisos (operación de tienda)
--   NO existe rol "Técnico": se definirá formalmente en la FASE 3 (taller), con
--   sus permisos propios. NO se inventa aquí.
--
-- ES UN SCRIPT, NO UNA MIGRACIÓN. Se corre UNA vez contra prod (documentado en
-- el README). Requiere la migración 035 aplicada (seed_org_roles).
--
-- IDEMPOTENTE: re-ejecutarlo NO duplica la org, la tienda, el profile ni el
--   acceso (guards NOT EXISTS / ON CONFLICT). seed_org_roles() ya es idempotente.
--
-- REQUIERE un parámetro: owner_id = el UUID del usuario auth del Dueño, creado
--   FUERA DE BANDA (Dashboard → Authentication → Add user, o Admin API con
--   service_role). La Edge Function create-user NO sirve para el PRIMER usuario
--   de una org nueva (huevo/gallina: no hay caller de esa org todavía).
--
-- Uso:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v owner_id="<uuid-del-auth-user>" \
--        -f scripts/seed-celfashion-org.sql
--
--   Parámetros opcionales (con -v):
--     -v org_name='CelFashion'  -v store_name='CelFashion — Principal'
--     -v owner_email='dueno@celfashion.co'  -v owner_name='Dueño CelFashion'
--
-- Todo en UNA transacción: si cualquier paso (incl. el trigger
--   enforce_profile_store_org) falla, se revierte TODO.
-- ============================================================

\set ON_ERROR_STOP on

-- Parámetros (sobreescribibles con -v en la línea de comandos)
\if :{?org_name}    \else \set org_name    'CelFashion'                \endif
\if :{?store_name}  \else \set store_name  'CelFashion — Principal'    \endif
\if :{?owner_email} \else \set owner_email 'dueno@celfashion.co'       \endif
\if :{?owner_name}  \else \set owner_name  'Dueño CelFashion'          \endif

-- owner_id es OBLIGATORIO: sin él no se puede crear el profile del Dueño.
\if :{?owner_id} \else
  \echo '✗ ERROR: falta -v owner_id="<uuid-del-auth-user>" (créalo en Dashboard → Authentication → Add user).'
  \quit 1
\endif

BEGIN;

-- 1) Organización (idempotente por nombre) ----------------------------------
INSERT INTO public.organizations (name)
SELECT :'org_name'
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations WHERE name = :'org_name'
);

SELECT id AS org_id FROM public.organizations WHERE name = :'org_name' \gset

-- 2) Roles base — vía la fuente única de verdad (035). Idempotente. ----------
SELECT public.seed_org_roles(:'org_id');

SELECT id AS role_owner_id  FROM public.roles WHERE organization_id = :'org_id' AND name = 'Dueño'         \gset
SELECT id AS role_admin_id  FROM public.roles WHERE organization_id = :'org_id' AND name = 'Administrador' \gset
SELECT id AS role_seller_id FROM public.roles WHERE organization_id = :'org_id' AND name = 'Vendedor'      \gset

-- 3) Tienda inicial (idempotente por nombre + org) --------------------------
--    config '{}' → resolveConfig() rellena los defaults en la app.
INSERT INTO public.stores (name, organization_id)
SELECT :'store_name', :'org_id'
WHERE NOT EXISTS (
  SELECT 1 FROM public.stores
   WHERE name = :'store_name' AND organization_id = :'org_id'
);

SELECT id AS store_id FROM public.stores
 WHERE name = :'store_name' AND organization_id = :'org_id' \gset

-- 4) Profile del Dueño (idempotente por id de auth user) --------------------
--    role (enum) = 'admin' porque el Dueño es "gestor" (tiene '*').
--    store_id / current_store_id / role_id / org son TODOS de CelFashion → el
--    trigger enforce_profile_store_org valida coherencia y pasa.
INSERT INTO public.profiles
  (id, email, full_name, role, role_id, organization_id, store_id, current_store_id, is_active)
VALUES
  (:'owner_id', :'owner_email', :'owner_name', 'admin',
   :'role_owner_id', :'org_id', :'store_id', :'store_id', true)
ON CONFLICT (id) DO UPDATE SET
  role_id          = EXCLUDED.role_id,
  organization_id  = EXCLUDED.organization_id,
  store_id         = EXCLUDED.store_id,
  current_store_id = EXCLUDED.current_store_id,
  is_active        = true;

-- 5) Acceso del Dueño a su tienda (idempotente) -----------------------------
INSERT INTO public.user_stores (user_id, store_id)
VALUES (:'owner_id', :'store_id')
ON CONFLICT (user_id, store_id) DO NOTHING;

-- Resumen (antes del commit) -------------------------------------------------
\echo '--- CelFashion sembrada (pendiente COMMIT) ---'
SELECT o.name AS organizacion,
       s.name AS tienda,
       (SELECT count(*) FROM public.roles r WHERE r.organization_id = o.id) AS roles_creados
  FROM public.organizations o
  JOIN public.stores s ON s.organization_id = o.id AND s.id = :'store_id'
 WHERE o.id = :'org_id';

\echo '--- Roles de la org (nombre + n.º de permisos) ---'
SELECT name,
       CASE WHEN permissions ? '*' THEN 'comodín (*)'
            ELSE jsonb_array_length(permissions)::text || ' permisos' END AS permisos
  FROM public.roles
 WHERE organization_id = :'org_id'
 ORDER BY name;

COMMIT;

\echo '✔ CelFashion lista. Roles: Dueño / Administrador / Vendedor (Técnico llega en fase 3).'
