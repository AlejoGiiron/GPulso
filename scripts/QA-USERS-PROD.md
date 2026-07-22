# Procedimiento — crear usuarios de PRUEBA (QA) en producción

> **Estado: PROCEDIMIENTO. NO ejecutado.** Lo ejecuta un humano cuando quiera
> habilitar la ronda de QA sobre `gpulso-prod`.
>
> Crea tres usuarios de prueba en la org **CelFashion** — un **Administrador**, un
> **Vendedor** y un **Técnico** — para que el manual de QA pruebe los permisos por
> rol. Hoy CelFashion solo tiene el usuario **Dueño**.
>
> Los roles ya existen en CelFashion (los sembró `seed_org_roles()`; verificado en
> el despliegue de la Fase 4, §3.5: Dueño/Administrador/Vendedor/Técnico). Este
> procedimiento solo crea los **usuarios de Auth** y sus **profiles**.

---

## Contexto del modelo (por qué estos dos pasos)

Un usuario "operable" en G-Pulso son **dos cosas**:

1. Un **usuario de Auth** (`auth.users`) → es con lo que inicia sesión. Se crea en
   el **Dashboard** (o Admin API). La Edge Function `create-user` **no** sirve acá
   sin un caller admin de la org logueado; el Dashboard es la vía directa.
2. Un **profile** (`public.profiles`) que lo ata a la **org + tienda + rol** de
   CelFashion. El RBAC real lo da `profiles.role_id` (FK al rol). La columna
   `profiles.role` es un enum heredado con **solo `admin` | `seller`** (no existe
   `technician`): el Técnico va como `role='seller'` + `role_id` = rol **Técnico**
   (mismo patrón que el resto del sistema).

Mapeo rol → columnas del profile:

| Usuario QA     | email                       | `role` (enum) | `role_id` (rol de la org) |
|----------------|-----------------------------|:-------------:|---------------------------|
| Administrador  | `qa.admin@celfashion.co`    | `admin`       | Administrador             |
| Vendedor       | `qa.vendedor@celfashion.co` | `seller`      | Vendedor                  |
| Técnico        | `qa.tecnico@celfashion.co`  | `seller`      | Técnico                   |

---

## Paso 1 — Crear los 3 usuarios en Auth (Dashboard)

Supabase → proyecto **gpulso-prod** → **Authentication** → **Users** → **Add user**
(una vez por cada uno):

1. **Add user → Create new user**.
2. **Email**: el de la tabla (`qa.admin@…`, `qa.vendedor@…`, `qa.tecnico@…`).
3. **Password**: una contraseña de prueba (anótala para el manual de QA).
4. **Auto Confirm User: ✅ ON** (sin esto no puede iniciar sesión — no hay correo
   real que confirmar).
5. Crear, y **copiar el UUID** que queda en la columna *User UID*.

Al final tienes **tres UUID**. Guárdalos para el Paso 2.

> Emails deliberadamente reconocibles como de prueba (`qa.*@celfashion.co`) para
> encontrarlos y desactivarlos fácil después (Paso 4).

---

## Paso 2 — Crear los profiles (SQL)

Pega los 3 UUID donde dice `PEGA-UUID-…` y corre este bloque en el **SQL Editor**
de Supabase (o por `psql`). Resuelve org / tienda / roles **por nombre**, así que
no hay que hardcodear más UUIDs. Es **idempotente** (`ON CONFLICT`).

```sql
BEGIN;

WITH org AS (
  SELECT id FROM public.organizations WHERE name = 'CelFashion'
),
store AS (
  -- La tienda de CelFashion. Si algún día hay >1, fija aquí la principal.
  SELECT id AS store_id
  FROM public.stores
  WHERE organization_id = (SELECT id FROM org)
  ORDER BY created_at
  LIMIT 1
),
qa(auth_id, email, full_name, role, role_name) AS (
  VALUES
    -- ↓↓↓ PEGA los 3 UUID de Authentication (Paso 1) ↓↓↓
    ('PEGA-UUID-ADMIN'::uuid,    'qa.admin@celfashion.co',    'QA Administrador', 'admin'::public.user_role,  'Administrador'),
    ('PEGA-UUID-VENDEDOR'::uuid, 'qa.vendedor@celfashion.co', 'QA Vendedor',      'seller'::public.user_role, 'Vendedor'),
    ('PEGA-UUID-TECNICO'::uuid,  'qa.tecnico@celfashion.co',  'QA Técnico',       'seller'::public.user_role, 'Técnico')
)
INSERT INTO public.profiles
  (id, email, full_name, role, role_id, organization_id, store_id, current_store_id, is_active)
SELECT q.auth_id, q.email, q.full_name, q.role,
       r.id, o.id, s.store_id, s.store_id, true
FROM qa q
CROSS JOIN org   o
CROSS JOIN store s
JOIN public.roles r ON r.organization_id = o.id AND r.name = q.role_name
ON CONFLICT (id) DO UPDATE SET
  role_id          = EXCLUDED.role_id,
  organization_id  = EXCLUDED.organization_id,
  store_id         = EXCLUDED.store_id,
  current_store_id = EXCLUDED.current_store_id,
  is_active        = true;

-- Acceso a la tienda (modelo multi-store). Idempotente.
INSERT INTO public.user_stores (user_id, store_id)
SELECT p.id, p.store_id
FROM public.profiles p
WHERE p.email IN ('qa.admin@celfashion.co','qa.vendedor@celfashion.co','qa.tecnico@celfashion.co')
ON CONFLICT (user_id, store_id) DO NOTHING;

-- Verificación (revisa ANTES del COMMIT): cada uno con su rol correcto y activo.
SELECT p.email, p.role AS enum_role, r.name AS rbac_role, p.is_active
FROM public.profiles p
JOIN public.roles r ON r.id = p.role_id
WHERE p.email LIKE 'qa.%@celfashion.co'
ORDER BY p.email;

COMMIT;
```

**Esperado** en la verificación (3 filas):

| email                       | enum_role | rbac_role     | is_active |
|-----------------------------|-----------|---------------|:---------:|
| qa.admin@celfashion.co      | admin     | Administrador | t         |
| qa.tecnico@celfashion.co    | seller    | Técnico       | t         |
| qa.vendedor@celfashion.co   | seller    | Vendedor      | t         |

Si algo se ve mal, `ROLLBACK;` en lugar de `COMMIT;` y revisa.

> **Nota:** el `INSERT` en `profiles` dispara el trigger de coherencia
> `trg_profiles_store_org` (tienda/rol/org deben ser de la misma org). Como todo
> se resuelve de CelFashion, pasa sin problema.

---

## Paso 3 — Probar el login

Con cada usuario, iniciar sesión en la app y confirmar que el menú/permisos
coinciden con el rol (el Administrador ve config/usuarios; el Vendedor no ve
config; el Técnico ve el taller pero no puede cobrar ventas — `pos.usar` no lo
tiene). Ese es el objeto de la ronda de QA.

---

## Paso 4 — DESACTIVARLOS cuando el cliente arranque (⚠ importante)

Los usuarios de prueba **no** pueden quedar activos cuando CelFashion empiece a
operar. Desactivarlos es un `UPDATE` — el bloqueo es **en servidor** desde la
Fase 1 (migración `037_active_user_enforcement`): un profile con `is_active=false`
hace que `get_my_store_id()` / `get_my_role()` / `has_permission()` devuelvan
NULL/false → el RLS le niega todos los datos, y el frontend lo expulsa al detectar
`is_active=false`.

```sql
UPDATE public.profiles
   SET is_active = false
 WHERE email LIKE 'qa.%@celfashion.co';

-- Verificar que quedaron inactivos
SELECT email, is_active FROM public.profiles
WHERE email LIKE 'qa.%@celfashion.co' ORDER BY email;   -- is_active = f en los tres
```

Desactivar es **reversible** (volver a `is_active=true` reactiva al usuario para
otra ronda de QA), y es lo recomendado.

### (Opcional) Borrado total

Si prefieres eliminarlos por completo en vez de desactivarlos:

```sql
-- 1) Quitar accesos y profiles (en una transacción)
BEGIN;
DELETE FROM public.user_stores
 WHERE user_id IN (SELECT id FROM public.profiles WHERE email LIKE 'qa.%@celfashion.co');
DELETE FROM public.profiles
 WHERE email LIKE 'qa.%@celfashion.co';
COMMIT;
```
```
-- 2) Luego, en el Dashboard → Authentication → Users, borrar los 3 usuarios
--    qa.admin@ / qa.vendedor@ / qa.tecnico@  (esto elimina el auth.users).
```

> Para el arranque del cliente basta el **Paso 4 (desactivar)**. El borrado total
> es opcional y solo si no vas a hacer más QA.
