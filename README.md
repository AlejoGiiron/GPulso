# G-Pulso — POS de tecnología con taller

POS para tiendas de tecnología (celulares, cómputo, accesorios) **con taller de
reparaciones**. Inventario por variantes, códigos de barras, devoluciones, caja,
separados y CRM.

> **Fork de G-Mura.** G-Pulso nace como fork del POS de ropa G-Mura (en
> producción). La trazabilidad del fork vive en [`FORKED_FROM.md`](FORKED_FROM.md).
> Aislamiento total: repo, proyecto Supabase y proyecto Vercel PROPIOS; nada
> compartido con G-Mura en runtime. El contexto completo del proyecto está en
> [`CLAUDE.md`](CLAUDE.md).

## Stack

React 18 + TypeScript (strict) + Vite + Tailwind · Supabase (PostgreSQL + Auth +
Storage) · Zustand · React Query · Zod · pnpm.

## Requisitos

- Node 18+ y **pnpm** (hay `pnpm-lock.yaml`; **no** usar `npm install`).
- Para el lab local: **Docker Desktop** + **Supabase CLI** + `psql` en el PATH.

## Variables de entorno

Crea un `.env` en la raíz (gitignored). Plantilla en [`.env.example`](.env.example):

```
VITE_GPULSO_SUPABASE_URL=<url del proyecto Supabase>
VITE_GPULSO_SUPABASE_ANON_KEY=<anon key>
```

## Desarrollo

```bash
pnpm install
pnpm dev          # servidor de desarrollo
pnpm check        # GATE: typecheck + lint (--max-warnings 0) + tests
pnpm test         # tests en watch
```

## Base de datos

### Modelo de migraciones

Las migraciones viven en `supabase/migrations/` numeradas `001…NNN`. **No** se
editan las heredadas de G-Mura (001–036); los arreglos van en migraciones nuevas
de G-Pulso. Ver el patrón de RBAC y permisos en [`CLAUDE.md`](CLAUDE.md).

> ⚠ **El set heredado NO se replaya "tal cual" en una BD virgen.** Tiene un único
> conflicto de orden (la migración 006 hace un swap de tipo de `orders.payment_method`
> y una vista de la 003 depende de esa columna) y necesita `check_function_bodies
> = false` (la 001 define funciones antes de sus tablas). En G-Mura esto no se
> nota porque su lab se **restaura de un dump**; G-Pulso arranca de CERO, así que
> el bring-up se hace con el wrapper [`scripts/apply-migrations-fresh.sh`](scripts/apply-migrations-fresh.sh),
> que aplica todo en orden, pone el flag y hace el pre-flight de la 006 **sin
> tocar ningún archivo de migración**. La vista se recrea sola en la 033 → estado
> final idéntico y completo (verificado en lab: 24/24 tablas con RLS).

### Lab local (Docker Supabase)

```bash
supabase start                       # levanta el stack local
# Aplica TODAS las migraciones sobre una BD virgen del contenedor:
./scripts/apply-migrations-fresh.sh \
  --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  --with-grants                      # --with-grants: GRANTs de tabla (Supabase real ya los trae)

# Carga en .env la URL y anon key locales:
supabase status                      # imprime API URL (54321) y anon key
```

Auditoría rápida de RLS (no debe devolver filas):

```sql
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND relkind='r' AND NOT relrowsecurity;
```

Test de seguridad de `is_active` en servidor (migración 037):

```bash
docker exec -i supabase_db_<project> psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 < scripts/test-active-user-rls.sql
# → "✔ TEST 037 OK"
```

## Despliegue a producción (gpulso-prod)

> **No hay backup que restaurar: la BD nace virgen.** Correr una sola vez.

1. **Crear el proyecto Supabase** `gpulso-prod` (propio, NADA compartido con
   G-Mura). Guardar la Project URL y la anon key.

2. **Aplicar las migraciones** sobre la BD virgen, en orden, con el wrapper
   (necesita la connection string de Postgres del proyecto — Settings → Database
   → Connection string → URI, modo *Session*):

   ```bash
   ./scripts/apply-migrations-fresh.sh --db-url "$GPULSO_DB_URL"
   ```

   > En Supabase gestionado los GRANT de tabla a `anon`/`authenticated` ya existen
   > por plataforma → **no** usar `--with-grants` contra prod. Si se aplican los
   > `.sql` a mano desde el SQL Editor: correrlos 001→037 en orden, ejecutando
   > `DROP VIEW IF EXISTS public.daily_sales_summary CASCADE;` **antes** de la 006.

3. **Configurar Auth** con el mismo esquema que G-Mura (email + password; sin
   signups públicos si así está en G-Mura). El PRIMER usuario (Dueño de la org)
   se crea **fuera de banda**: Dashboard → Authentication → Add user. Copiar su
   UUID.

4. **Sembrar la organización del cliente** (idempotente; correr una vez):

   ```bash
   psql "$GPULSO_DB_URL" -v ON_ERROR_STOP=1 \
     -v owner_id="<uuid-del-auth-user-dueño>" \
     -f scripts/seed-celfashion-org.sql
   ```

   Crea la org **CelFashion**, la tienda **CelFashion — Principal** y sus roles
   base vía `seed_org_roles()`:

   | Rol | Permisos |
   |-----|----------|
   | **Dueño** | `*` (comodín: todos; inmutable) |
   | **Administrador** | 19 permisos (todo menos `roles.gestionar`) |
   | **Vendedor** | 6 permisos (operación de tienda) |

   > No existe rol **Técnico**: se define en la **fase 3** (taller) con sus
   > permisos propios. No se inventa aquí.

5. **Vercel** — crear el proyecto `gpulso` (nuevo, aislado). Cargar las env vars
   `VITE_GPULSO_SUPABASE_URL` y `VITE_GPULSO_SUPABASE_ANON_KEY` con los valores de
   `gpulso-prod`. Build: `pnpm build`. SPA rewrites ya están en `vercel.json`.

## Estructura

- `src/pages/` — pantallas (POS, ventas, inventario, separados, caja, config…).
- `src/components/` — UI por módulo. `layout/Logo.tsx` es el logo (placeholder
  inline; reemplazable por el asset final).
- `src/hooks/` — queries y mutaciones de Supabase (nunca en componentes).
- `src/lib/` — lógica pura testeada (cuadre de caja, cálculos, etc.).
- `supabase/migrations/` — esquema. `scripts/` — utilidades de lab/ops (no van
  en la app).
- `_design/gpulso/` — lienzos de diseño de G-Pulso.
