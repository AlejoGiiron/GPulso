-- ============================================================
-- create-lab-org.sql — Crear una organización nueva por SQL
--
-- Replica lo que 020/021 hicieron para La Bodega. Los roles/permisos NO van
-- inline (antes driftearon: faltaba historial.ver de la 034): se delegan a
-- seed_org_roles(org_id) — la FUENTE ÚNICA DE VERDAD de la migración 035, que
-- ya incluye todos los permisos al día (023/027/029/034 y los que vengan).
-- Para cambiar los permisos de un rol se edita canonical_role_permissions()
-- en la 035, NUNCA este script.
--
-- REQUIERE la migración 035 aplicada (seed_org_roles).
-- REQUIERE un parámetro: lab_owner_id = el UUID del usuario auth del Dueño,
-- que se crea FUERA DE BANDA (Dashboard → Authentication → Add user, o Admin
-- API con service_role). La Edge Function create-user NO sirve para el PRIMER
-- usuario de una org nueva (huevo/gallina: no hay caller de esa org todavía).
--
-- Uso:
--   psql "$URL" -v ON_ERROR_STOP=1 -v lab_owner_id="<uuid-del-auth-user>" \
--        -f create-lab-org.sql
--
-- Todo en UNA transacción: si cualquier paso (incl. el trigger
-- enforce_profile_store_org) falla, se revierte TODO. Idempotencia: NO es
-- idempotente (crea filas nuevas); correrlo dos veces crearía una 2ª org
-- homónima. Correr una sola vez.
-- ============================================================

\set ON_ERROR_STOP on

-- Parámetros ajustables (podés sobreescribir con -v en la línea de comandos)
\if :{?org_name}    \else \set org_name    'Laboratorio G-Mura'        \endif
\if :{?store_name}  \else \set store_name  'Lab — Tienda 1'            \endif
\if :{?owner_email} \else \set owner_email 'lab-owner@gpulso.test'      \endif
\if :{?owner_name}  \else \set owner_name  'Dueño Laboratorio'         \endif

BEGIN;

-- 1) Organización -----------------------------------------------------------
INSERT INTO public.organizations (name)
VALUES (:'org_name')
RETURNING id AS org_id \gset

-- 2) Roles base — vía la fuente única de verdad (035). Crea Dueño /
--    Administrador / Vendedor con los permisos canónicos al día. Sin arrays
--    inline → nunca vuelve a driftear.
SELECT public.seed_org_roles(:'org_id');

-- Recuperar los ids de los roles recién creados (para el profile y el resumen).
SELECT id AS role_owner_id  FROM public.roles WHERE organization_id = :'org_id' AND name = 'Dueño'         \gset
SELECT id AS role_admin_id  FROM public.roles WHERE organization_id = :'org_id' AND name = 'Administrador' \gset
SELECT id AS role_seller_id FROM public.roles WHERE organization_id = :'org_id' AND name = 'Vendedor'      \gset

-- 3) Tienda del lab (config '{}' → resolveConfig rellena los defaults) --------
INSERT INTO public.stores (name, organization_id)
VALUES (:'store_name', :'org_id')
RETURNING id AS store_id \gset

-- 4) Profile del Dueño -------------------------------------------------------
--    role (enum) = 'admin' porque el Dueño es "gestor" (tiene '*').
--    store_id, current_store_id y role_id son TODOS del lab → el trigger
--    enforce_profile_store_org valida coherencia y pasa.
INSERT INTO public.profiles
  (id, email, full_name, role, role_id, organization_id, store_id, current_store_id, is_active)
VALUES
  (:'lab_owner_id', :'owner_email', :'owner_name', 'admin',
   :'role_owner_id', :'org_id', :'store_id', :'store_id', true);

-- 5) Acceso del Dueño a su tienda -------------------------------------------
INSERT INTO public.user_stores (user_id, store_id)
VALUES (:'lab_owner_id', :'store_id');

-- Resumen (antes del commit) -------------------------------------------------
\echo '--- Andamiaje creado (pendiente COMMIT) ---'
SELECT :'org_id' AS org_id, :'store_id' AS store_id,
       :'role_owner_id' AS role_owner_id,
       :'role_admin_id' AS role_admin_id,
       :'role_seller_id' AS role_seller_id;

COMMIT;
