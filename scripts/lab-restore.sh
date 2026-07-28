#!/usr/bin/env bash
#
# lab-restore.sh — Restaura un dump de PRODUCCIÓN en el Supabase LOCAL (laboratorio).
#
# Uso:
#   ./scripts/lab-restore.sh                      # usa el .dump más reciente de backups/
#   ./scripts/lab-restore.sh backups/gpulso_X.dump # usa un dump específico
#
# Qué restaura (espejo fiel de producción, SIN tocar producción):
#   - schema public       : estructura + datos + FKs + RLS + funciones + triggers
#   - auth.users          : (solo datos) para que las FKs y el login funcionen
#   - auth.identities     : (solo datos) necesarias para login email/password
#   + re-aplica los GRANT estándar de Supabase sobre public (el dump es --no-acl)
#
# Qué NO toca:
#   - La ESTRUCTURA de los esquemas auth/storage/realtime/etc. que el CLI ya montó
#   - El historial de migraciones de GoTrue (auth.schema_migrations)
#   - Producción (este script solo habla con el Postgres local de Docker)
#
# Es IDEMPOTENTE: cada corrida deja el lab en un estado limpio = espejo del dump.
# Corre supabase start antes de usarlo.

set -Eeuo pipefail

# Git Bash (MSYS) traduce rutas tipo /tmp a rutas Windows al pasarlas a
# docker exec/cp, lo que rompe las rutas internas del contenedor. Esto lo evita.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

# ----------------------------------------------------------------------------
# Colores (solo si la salida es una terminal)
# ----------------------------------------------------------------------------
if [[ -t 1 ]]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
  BLUE=$'\033[0;34m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; RESET=''
fi
info()  { printf '%s\n' "${BLUE}ℹ${RESET}  $*"; }
ok()    { printf '%s\n' "${GREEN}✔${RESET}  $*"; }
warn()  { printf '%s\n' "${YELLOW}⚠${RESET}  $*" >&2; }
die()   { printf '%s\n' "${RED}✗ ERROR:${RESET} $*" >&2; exit 1; }
trap 'die "El restore falló (línea $LINENO). El lab puede haber quedado a medias; vuelve a correr este script."' ERR

# ----------------------------------------------------------------------------
# Rutas
# ----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$REPO_ROOT/backups"
CONFIG_TOML="$REPO_ROOT/supabase/config.toml"

# ----------------------------------------------------------------------------
# 1. Resolver el dump a restaurar
# ----------------------------------------------------------------------------
DUMP_ARG="${1:-}"
if [[ -n "$DUMP_ARG" ]]; then
  DUMP_PATH="$DUMP_ARG"
  [[ -f "$DUMP_PATH" ]] || die "No existe el dump indicado: $DUMP_PATH"
else
  # 🔒 Solo autoselecciona dumps de G-PULSO (prefijo gpulso_). Antes tomaba el
  # *.dump más reciente sin mirar el prefijo: con un dump ajeno en backups/ (ej.
  # gmura_*.dump) el lab se cargaba con datos del otro cliente sin avisar.
  # Ver FORKED_FROM.md § incidente 2026-07-28.
  DUMP_PATH="$(ls -t "$BACKUP_DIR"/gpulso_*.dump 2>/dev/null | head -n1 || true)"
  if [[ -z "$DUMP_PATH" ]]; then
    OTHERS="$(ls -t "$BACKUP_DIR"/*.dump 2>/dev/null | head -n3 | xargs -r -n1 basename | paste -sd', ' - || true)"
    die "No hay ningún dump de G-Pulso (gpulso_*.dump) en $BACKUP_DIR.
     ${OTHERS:+Sí hay dumps de otro origen: $OTHERS — NO se autoseleccionan.}
     Genera uno con ./scripts/backup-db.sh <etiqueta>, o pasa la ruta explícita como argumento."
  fi
fi
info "Dump a restaurar: ${BOLD}$DUMP_PATH${RESET}"

# ----------------------------------------------------------------------------
# 2. Docker + contenedor de la BD local
# ----------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker no está instalado o no está en el PATH."
docker info >/dev/null 2>&1 || die "El daemon de Docker no responde. Abre Docker Desktop y reintenta."

PROJECT_ID="$(grep -E '^project_id' "$CONFIG_TOML" 2>/dev/null | head -n1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"
DB_CONTAINER="supabase_db_${PROJECT_ID}"

# 🔒 Sin fallback ciego. El fallback anterior tomaba el PRIMER supabase_db_* que
# estuviera corriendo: con el lab de G-Mura levantado, este restore (que DROPEA y
# recarga el schema public) se lo habría llevado por delante. Mismo patrón que el
# incidente 2026-07-28 con la base de prod — ver FORKED_FROM.md.
# Override consciente: LAB_DB_CONTAINER=<nombre> ./scripts/lab-restore.sh
if [[ -n "${LAB_DB_CONTAINER:-}" ]]; then
  DB_CONTAINER="$LAB_DB_CONTAINER"
  warn "Usando contenedor forzado por LAB_DB_CONTAINER: ${BOLD}$DB_CONTAINER${RESET}"
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  RUNNING="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | paste -sd', ' - || true)"
  die "No está corriendo el contenedor del lab de G-Pulso (${BOLD}$DB_CONTAINER${RESET}).
     Contenedores supabase_db_* activos: ${RUNNING:-ninguno}
     Corre 'supabase start' en ESTE repo. Si ves un lab de otro proyecto (ej. supabase_db_gmura),
     apágalo primero: docker stop \$(docker ps -q --filter name=_gmura)
     NO se restaura sobre un lab ajeno: este script dropea y recarga el schema public."
fi
info "Contenedor de la BD: ${BOLD}$DB_CONTAINER${RESET}"

# Helper: psql como postgres, abortando al primer error SQL
psql_c() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

CONTAINER_DUMP="/tmp/lab_restore.dump"

# ----------------------------------------------------------------------------
# 3. Copiar el dump dentro del contenedor
# ----------------------------------------------------------------------------
info "Copiando el dump al contenedor…"
# Se transmite por stdin (no 'docker cp') para evitar la traducción de rutas de
# Git Bash en Windows: la redirección '< archivo' la resuelve bash con la ruta
# del host, y el contenedor escribe en una ruta interna literal.
docker exec -i "$DB_CONTAINER" sh -c "cat > '$CONTAINER_DUMP'" < "$DUMP_PATH"

# ----------------------------------------------------------------------------
# 4. Estado limpio (idempotencia): vaciar public y los usuarios cargados antes
#    El orden importa: se elimina public PRIMERO (quita las FKs hacia auth),
#    luego se limpian los datos de auth de una corrida previa del lab.
# ----------------------------------------------------------------------------
info "Dejando el lab en estado limpio…"
psql_c <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE  ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO postgres;
-- Limpia los usuarios que una corrida anterior del lab haya cargado (identities
-- antes que users por la FK). En un lab recién creado estas tablas están vacías.
DELETE FROM auth.identities;
DELETE FROM auth.users;
SQL

# ----------------------------------------------------------------------------
# 5. Cargar los usuarios de auth (solo datos). Orden: users -> identities.
#    Sin --disable-triggers a propósito: el rol postgres de Supabase no es
#    superusuario y no puede deshabilitar triggers de tablas ajenas; cargando
#    users primero, la FK de identities queda satisfecha sin necesidad de ello.
# ----------------------------------------------------------------------------
info "Cargando auth.users + auth.identities…"
docker exec "$DB_CONTAINER" pg_restore -U postgres -d postgres \
  --data-only --no-owner -n auth -t users "$CONTAINER_DUMP"
docker exec "$DB_CONTAINER" pg_restore -U postgres -d postgres \
  --data-only --no-owner -n auth -t identities "$CONTAINER_DUMP"

# ----------------------------------------------------------------------------
# 6. Restaurar el schema public completo
#    --no-owner: los objetos quedan en manos de postgres (no del owner de prod)
#    --no-acl  : el dump ya viene sin ACLs; los GRANT se reaplican en el paso 7
# ----------------------------------------------------------------------------
info "Restaurando el schema public…"
docker exec "$DB_CONTAINER" pg_restore -U postgres -d postgres \
  --no-owner --no-acl -n public "$CONTAINER_DUMP"

# ----------------------------------------------------------------------------
# 7. Reaplicar los GRANT estándar de Supabase sobre public
#    Necesario porque el dump se hizo con --no-acl: sin esto, la API (PostgREST
#    como anon/authenticated) no podría leer las tablas. RLS sigue protegiendo
#    las filas, así que otorgar a nivel tabla es seguro.
# ----------------------------------------------------------------------------
info "Reaplicando permisos (GRANT) de Supabase…"
psql_c <<'SQL'
GRANT ALL ON ALL TABLES    IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES  TO postgres, anon, authenticated, service_role;
SQL

# ----------------------------------------------------------------------------
# 8. Borrar el dump temporal del contenedor (lleva datos de cliente)
# ----------------------------------------------------------------------------
docker exec "$DB_CONTAINER" rm -f "$CONTAINER_DUMP"

# ----------------------------------------------------------------------------
# 9. Verificación: que las tablas tengan datos
# ----------------------------------------------------------------------------
info "Verificando datos restaurados…"
psql_c -c "
SELECT 'auth.users'  AS tabla, count(*) AS filas FROM auth.users
UNION ALL SELECT 'stores',    count(*) FROM public.stores
UNION ALL SELECT 'products',  count(*) FROM public.products
UNION ALL SELECT 'variants',  count(*) FROM public.variants
UNION ALL SELECT 'orders',    count(*) FROM public.orders
UNION ALL SELECT 'profiles',  count(*) FROM public.profiles
ORDER BY tabla;
"

# Gate final: si stores quedó vacío, algo salió mal.
STORES_N="$(psql_c -tAc 'SELECT count(*) FROM public.stores;' | tr -d '[:space:]')"
[[ "${STORES_N:-0}" -gt 0 ]] || die "La tabla stores quedó vacía: la restauración no fue válida."

ok "Lab restaurado: ${BOLD}$STORES_N${RESET} tienda(s) y datos de producción cargados."
info "Studio: ${BOLD}http://127.0.0.1:54323${RESET}  ·  Ver scripts/LAB.md para el ciclo de pruebas."
