#!/usr/bin/env bash
#
# apply-migrations-fresh.sh — Aplica TODAS las migraciones (001…NNN) EN ORDEN
# sobre una base de datos VIRGEN (sin el historial incremental de prod de
# G-Mura), de forma repetible y limpia.
#
# POR QUÉ EXISTE (no basta con "correr los .sql en orden"):
#   El set heredado de G-Mura NO fue diseñado para replay desde cero (el lab de
#   G-Mura se restaura de un DUMP, no replayando migraciones). Al replayar en
#   una BD virgen aparecen DOS necesidades que la plataforma Supabase resuelve
#   sola pero un psql "pelado" no:
#
#   1. check_function_bodies = false
#      001 define funciones SQL (get_my_store_id, …) que referencian
#      public.profiles ANTES de que la tabla exista (se crea más abajo en el
#      mismo archivo). Postgres valida el cuerpo de las funciones SQL al crearlas
#      salvo que este flag esté en off — que es justo lo que hace pg_restore y el
#      runner de migraciones de Supabase. Lo ponemos por sesión (no toca los .sql).
#
#   2. Pre-flight de la migración 006 (ÚNICO conflicto de orden del set):
#      003 crea la vista public.daily_sales_summary, que SELECCIONA
#      orders.payment_method. 006 hace un swap del tipo de esa columna (quita
#      'nequi', agrega 'addi') y Postgres lo rechaza mientras una vista dependa
#      de la columna. Solución sin editar la heredada: DROP de la vista JUSTO
#      ANTES de 006. La migración 033 la vuelve a crear más adelante → el estado
#      final es idéntico y completo (verificado en lab).
#
#   NINGÚN archivo de migración se edita. Todo el arreglo vive en este wrapper.
#
# Las tablas nacen con RLS habilitado y políticas (auditado: 24/24 tablas con
# RLS). Los GRANT de tabla a anon/authenticated/service_role los provee la
# plataforma Supabase (roles y default privileges); en un Postgres "pelado" hay
# que otorgarlos aparte (este script lo hace si se le pasa --with-grants).
#
# USO:
#   # Contra el lab local (BD nueva dentro del contenedor):
#   ./scripts/apply-migrations-fresh.sh --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
#
#   # Contra gpulso-prod (BD virgen recién creada):
#   ./scripts/apply-migrations-fresh.sh --db-url "$GPULSO_DB_URL" --with-grants
#
#   Requiere psql en el PATH y conectividad a la BD destino.
#
# ⚠ Está pensado para una BD VIRGEN. NO lo corras sobre una BD con datos: aplica
#   el set completo desde 001.
# ============================================================================

set -Eeuo pipefail
export MSYS_NO_PATHCONV=1

DB_URL=""
WITH_GRANTS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db-url)      DB_URL="$2"; shift 2 ;;
    --with-grants) WITH_GRANTS=1; shift ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$DB_URL" ]] || { echo "✗ Falta --db-url \"postgresql://…\"" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG_DIR="$SCRIPT_DIR/../supabase/migrations"

command -v psql >/dev/null 2>&1 || { echo "✗ psql no está en el PATH." >&2; exit 2; }

PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 -q)

echo "▶ Aplicando migraciones sobre: $DB_URL"

for f in "$MIG_DIR"/*.sql; do
  name="$(basename "$f")"

  # Pre-flight del ÚNICO conflicto de orden (ver cabecera): quitar la vista que
  # bloquea el swap de tipo de 006. 033 la recrea después.
  if [[ "$name" == "006_payment_methods_cleanup.sql" ]]; then
    "${PSQL[@]}" -c "DROP VIEW IF EXISTS public.daily_sales_summary CASCADE;" >/dev/null
    echo "  · pre-flight: DROP VIEW daily_sales_summary (la recrea la 033)"
  fi

  # check_function_bodies=false por sesión (igual que pg_restore / Supabase).
  { echo "SET check_function_bodies = false;"; cat "$f"; } | "${PSQL[@]}" >/dev/null
  echo "  ✔ $name"
done

if [[ "$WITH_GRANTS" -eq 1 ]]; then
  echo "▶ Otorgando privilegios de tabla (equivalente a los defaults de Supabase)…"
  "${PSQL[@]}" \
    -c "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;" \
    -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;" \
    -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;" >/dev/null
  echo "  ✔ grants aplicados"
fi

echo "✔ Migraciones aplicadas. Auditá RLS con:"
echo "    SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind='r' AND NOT relrowsecurity;"
echo "  (no debe devolver filas → todas las tablas con RLS)."
