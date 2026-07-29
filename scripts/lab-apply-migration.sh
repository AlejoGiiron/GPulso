#!/usr/bin/env bash
#
# lab-apply-migration.sh — Aplica UNA migración suelta sobre el lab local para
# probarla contra datos reales, SIN tocar producción.
#
# Uso:
#   ./scripts/lab-apply-migration.sh 020_organizations.sql
#   ./scripts/lab-apply-migration.sh supabase/migrations/020_organizations.sql
#
# Copia el archivo al contenedor y lo aplica con psql ON_ERROR_STOP=1, de modo
# que se detiene al primer error y reporta si corrió LIMPIO o FALLÓ.
#
# NOTA: esto NO usa 'supabase migration up' a propósito. El lab se restaura
# desde un dump, así que auth.schema_migrations / supabase_migrations están
# vacíos: 'migration up' intentaría aplicar TODAS las migraciones y chocaría.
# Aquí pruebas una sola, de forma aislada. Si falla, resetea con lab-restore.sh.

set -Eeuo pipefail

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

# ----------------------------------------------------------------------------
# Colores
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

# ----------------------------------------------------------------------------
# Rutas
# ----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_TOML="$REPO_ROOT/supabase/config.toml"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

# ----------------------------------------------------------------------------
# 1. Resolver el archivo de migración (acepta nombre o ruta)
# ----------------------------------------------------------------------------
MIG_ARG="${1:-}"
[[ -n "$MIG_ARG" ]] || die "Falta el archivo de migración. Uso: ./scripts/lab-apply-migration.sh 020_organizations.sql"

if [[ -f "$MIG_ARG" ]]; then
  MIG_PATH="$MIG_ARG"
elif [[ -f "$MIGRATIONS_DIR/$MIG_ARG" ]]; then
  MIG_PATH="$MIGRATIONS_DIR/$MIG_ARG"
else
  die "No encuentro la migración '$MIG_ARG' (ni como ruta ni en $MIGRATIONS_DIR)."
fi
MIG_NAME="$(basename "$MIG_PATH")"
info "Migración a probar: ${BOLD}$MIG_NAME${RESET}"

# ----------------------------------------------------------------------------
# 2. Docker + contenedor de la BD local
# ----------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker no está instalado o no está en el PATH."
docker info >/dev/null 2>&1 || die "El daemon de Docker no responde. Abre Docker Desktop y reintenta."

PROJECT_ID="$(grep -E '^project_id' "$CONFIG_TOML" 2>/dev/null | head -n1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"
DB_CONTAINER="supabase_db_${PROJECT_ID}"

# 🔒 Sin fallback ciego (mismo criterio que lab-restore.sh): no aplicar una
# migración de G-Pulso sobre el lab de otro proyecto. Ver FORKED_FROM.md.
# Override consciente: LAB_DB_CONTAINER=<nombre> ./scripts/lab-apply-migration.sh …
if [[ -n "${LAB_DB_CONTAINER:-}" ]]; then
  DB_CONTAINER="$LAB_DB_CONTAINER"
  warn "Usando contenedor forzado por LAB_DB_CONTAINER: ${BOLD}$DB_CONTAINER${RESET}"
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  RUNNING="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | paste -sd', ' - || true)"
  die "No está corriendo el contenedor del lab de G-Pulso (${BOLD}$DB_CONTAINER${RESET}).
     Contenedores supabase_db_* activos: ${RUNNING:-ninguno}
     Corre 'supabase start' en ESTE repo. Si hay un lab de otro proyecto levantado
     (ej. supabase_db_gmura), apágalo: docker stop \$(docker ps -q --filter name=_gmura)"
fi

# ----------------------------------------------------------------------------
# 3. Copiar y aplicar la migración
# ----------------------------------------------------------------------------
CONTAINER_MIG="/tmp/lab_migration.sql"
# Se transmite por stdin (no 'docker cp') para evitar la traducción de rutas de
# Git Bash en Windows (ver lab-restore.sh).
docker exec -i "$DB_CONTAINER" sh -c "cat > '$CONTAINER_MIG'" < "$MIG_PATH"

info "Aplicando con psql (ON_ERROR_STOP=1)…"
echo "------------------------------------------------------------"
if docker exec "$DB_CONTAINER" psql -U postgres -d postgres \
     -v ON_ERROR_STOP=1 -f "$CONTAINER_MIG"; then
  RC=0
else
  RC=$?
fi
echo "------------------------------------------------------------"

docker exec "$DB_CONTAINER" rm -f "$CONTAINER_MIG" || true

if [[ "$RC" -eq 0 ]]; then
  ok "La migración ${BOLD}$MIG_NAME${RESET} corrió LIMPIO sobre el lab."
else
  die "La migración $MIG_NAME FALLÓ (revisa el error arriba). El lab puede haber quedado a medias: resetéalo con ./scripts/lab-restore.sh"
fi
