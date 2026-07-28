# Laboratorio local de G-Pulso (Supabase + Docker)

Entorno **espejo de producción** que corre 100% en tu máquina con Docker.
Sirve para **probar migraciones y cambios contra datos reales sin tocar
producción**. Si algo se rompe, lo reseteas en segundos.

> **No requiere internet ni credenciales de producción.** El lab solo habla con
> el PostgreSQL local que levanta el CLI de Supabase dentro de Docker.

---

## 0. Requisitos (una sola vez)

- **Docker Desktop** instalado y **corriendo** (la ballena fija en la bandeja).
  Verifica: `docker ps` debe imprimir una tabla sin error.
- **Supabase CLI**: `supabase --version`.

---

## 1. Levantar / apagar el lab

```bash
supabase start          # levanta todos los contenedores (1ª vez baja ~GB; luego segundos)
supabase stop           # apaga los contenedores PERO conserva los datos
supabase stop --no-backup   # apaga y BORRA los datos del lab (empezar de cero)
supabase status         # muestra URLs y llaves locales
```

> ℹ️ El contenedor `vector` puede aparecer "Restarting" en Windows: es un
> problema conocido del módulo de analytics/logs y **no afecta** la BD, auth,
> storage ni el lab. Se puede ignorar.

---

## 2. URLs y credenciales locales

| URL | Para qué sirve |
|-----|----------------|
| http://127.0.0.1:54323 | **Studio** — panel web: Table Editor, SQL Editor, Auth, etc. |
| http://127.0.0.1:54321 | **API / Project URL** — REST, GraphQL, Auth, Edge Functions |
| http://127.0.0.1:54324 | **Mailpit** — bandeja de correos de prueba (magic links, etc.) |
| `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | **DB URL** — conexión directa a Postgres |

**Llaves locales** (son los *defaults públicos* del CLI de Supabase, idénticos en
cualquier máquina — **NO son secretos** y **NO** corresponden a producción):

```
ANON_KEY:
  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SERVICE_ROLE_KEY:
  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
```

Para apuntar la app al lab, en tu `.env.local`:

```
VITE_GPULSO_SUPABASE_URL=http://127.0.0.1:54321
VITE_GPULSO_SUPABASE_ANON_KEY=<el ANON_KEY de arriba>
```

> Si tu CLI imprime las llaves en formato nuevo (`sb_publishable_…` / `sb_secret_…`),
> obtén las JWT clásicas con: `supabase status -o env | grep -E "ANON_KEY|SERVICE_ROLE_KEY"`.

---

## 3. El ciclo de pruebas

```
  supabase start
        │
        ▼
  ./scripts/lab-restore.sh           ← restaura el dump de prod (estado limpio)
        │
        ▼
  ./scripts/lab-apply-migration.sh 020_organizations.sql   ← prueba UNA migración
        │
        ├── corrió LIMPIO  → verifica en Studio / con SQL que hizo lo esperado
        │
        └── FALLÓ          → corrige la migración y vuelve a empezar:
                              ./scripts/lab-restore.sh   (resetea)
                              ./scripts/lab-apply-migration.sh 020_organizations.sql
```

### 3.1 Restaurar el dump

```bash
./scripts/lab-restore.sh                       # el .dump más reciente de backups/
./scripts/lab-restore.sh backups/gpulso_X.dump  # uno específico
```

Restaura el `schema public` (estructura + datos + FKs + RLS + funciones) y los
datos de `auth.users` + `auth.identities` (para que las FKs y el login
funcionen), reaplica los GRANT estándar de Supabase y verifica con conteos.
**Es idempotente**: vuelve a correrlo cuando quieras volver al estado limpio.

### 3.2 Aplicar una migración

```bash
./scripts/lab-apply-migration.sh 020_organizations.sql
```

La aplica con `psql ON_ERROR_STOP=1` y dice si corrió **LIMPIO** o **FALLÓ**.

### 3.3 Verificar el resultado

- Studio → SQL Editor: corre tus `SELECT` de comprobación.
- O por terminal:
  ```bash
  MSYS_NO_PATHCONV=1 docker exec supabase_db_gpulso \
    psql -U postgres -d postgres -c "\dt public.*"
  ```

---

## 4. ⚠️ Por qué NO usar `supabase db push` / `migration up` en el lab

El lab se arma **restaurando un dump**, no aplicando migraciones. Por eso la tabla
`supabase_migrations.schema_migrations` (el registro de qué migraciones se han
aplicado) queda **vacía** en el lab.

Si corrieras `supabase migration up`, el CLI creería que **ninguna** migración se
ha aplicado e intentaría aplicar **todas** (001…020) sobre una base que **ya
tiene** esas tablas → choca con "ya existe".

Por eso, para probar **una** migración usamos `lab-apply-migration.sh`, que
ejecuta solo ese archivo. Además, en `supabase/config.toml` dejamos
`[db.migrations] enabled = false` para que `supabase start` **no** auto-aplique
migraciones y el dump sea la única fuente de verdad.

---

## 5. Sobre los backups (`.dump`)

- Los `.dump` viven en `backups/` y están **ignorados por git** (`.gitignore`:
  `backups/*`). **Nunca se commitean**: contienen datos de clientes.
- Generar un backup nuevo de producción: `./scripts/backup-db.sh <etiqueta>`
  (requiere `.env.backup` con la cadena de conexión — tampoco se commitea).
- Estos scripts de lab **no contienen** llaves de producción ni el dump: solo
  los defaults públicos locales.

---

## 6. Problemas comunes

| Síntoma | Causa / arreglo |
|---------|-----------------|
| `Cannot connect to the Docker daemon` | Docker Desktop no está corriendo. Ábrelo. |
| `No encuentro el contenedor supabase_db_*` | Falta `supabase start`. |
| Rutas internas raras (`C:/Users/...Temp/...`) en docker exec | Git Bash traduce rutas; los scripts ya exportan `MSYS_NO_PATHCONV=1`. Si lo corres a mano, antepón `MSYS_NO_PATHCONV=1`. |
| La migración falló a medias | Resetea: `./scripts/lab-restore.sh` y vuelve a aplicarla. |
| `must be owner of table` al tocar `auth` | El rol `postgres` de Supabase no es superusuario; el restore ya evita esto cargando `users` antes que `identities` sin `--disable-triggers`. |
