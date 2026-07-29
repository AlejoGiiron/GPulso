#!/usr/bin/env bash
#
# backup-db.sh — Backup de la BD de producción de G-PULSO (Supabase / PostgreSQL)
#
# Lee GPULSO_DB_URL de .env.backup y verifica que la base SEA G-Pulso antes de
# respaldar (ver sección 4b). NO usar la credencial de G-Mura acá: es otro
# cliente, otro proyecto Supabase. Ver FORKED_FROM.md § incidente 2026-07-28.
#
# Uso:
#   ./scripts/backup-db.sh <etiqueta>
#   ./scripts/backup-db.sh pre-fase1
#
# Lee la cadena de conexión desde .env.backup (NO commiteado). Ver scripts/BACKUP.md.
#
# Diseñado para fallar ruidosamente: cualquier error aborta y NO deja pasar un
# backup vacío o incompleto.

set -Eeuo pipefail

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

# Mensaje claro si algo revienta en mitad del script
trap 'die "El backup falló (línea $LINENO). NO se generó un dump confiable."' ERR

# ----------------------------------------------------------------------------
# Rutas (resueltas relativas a la raíz del repo, no al cwd)
# ----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.backup"
BACKUP_DIR="$REPO_ROOT/backups"
REGISTRO="$BACKUP_DIR/REGISTRO.md"

# ----------------------------------------------------------------------------
# 1. Argumento de etiqueta
# ----------------------------------------------------------------------------
LABEL="${1:-}"
[[ -n "$LABEL" ]] || die "Falta la etiqueta de fase. Uso: ./scripts/backup-db.sh pre-fase1"

# Sanitiza la etiqueta para usarla como nombre de archivo (a-z A-Z 0-9 - _)
SAFE_LABEL="$(printf '%s' "$LABEL" | tr -c 'a-zA-Z0-9_-' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')"
[[ -n "$SAFE_LABEL" ]] || die "La etiqueta '$LABEL' no contiene caracteres válidos."

# ----------------------------------------------------------------------------
# 2. Herramientas requeridas
# ----------------------------------------------------------------------------
command -v pg_dump    >/dev/null 2>&1 || die "pg_dump no está instalado o no está en el PATH."
command -v pg_restore >/dev/null 2>&1 || die "pg_restore no está instalado o no está en el PATH."

# ----------------------------------------------------------------------------
# 3. Cargar credencial desde .env.backup
# ----------------------------------------------------------------------------
[[ -f "$ENV_FILE" ]] || die "No existe $ENV_FILE. Copia .env.backup.example y pon tu cadena. Ver scripts/BACKUP.md."

# Carga solo variables, sin ejecutar comandos arbitrarios
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

[[ -n "${GPULSO_DB_URL:-}" ]] || {
  if [[ -n "${GMURA_DB_URL:-}" ]]; then
    die "$ENV_FILE define GMURA_DB_URL (variable de OTRO proyecto: G-Mura / La Bodega del Jeans).
     En este repo la variable es GPULSO_DB_URL y debe apuntar a gpulso-prod.
     Renómbrala a mano en $ENV_FILE y pega la cadena de gpulso-prod. Ver scripts/BACKUP.md."
  fi
  die "GPULSO_DB_URL no está definida en $ENV_FILE. Copia .env.backup.example y pega la cadena de gpulso-prod."
}

# ----------------------------------------------------------------------------
# 4. Verificación de versión de pg_dump vs. servidor
# ----------------------------------------------------------------------------
# Versión mayor del cliente (pg_dump 16.2 -> 16)
CLIENT_VER="$(pg_dump --version | grep -oE '[0-9]+' | head -n1)"
[[ -n "$CLIENT_VER" ]] || die "No se pudo determinar la versión de pg_dump."

info "Cliente pg_dump: versión mayor ${BOLD}$CLIENT_VER${RESET}"

# Versión mayor del servidor (best-effort; no aborta si no se puede consultar)
SERVER_VER=""
if command -v psql >/dev/null 2>&1; then
  SERVER_VER="$(psql "$GPULSO_DB_URL" -tAc 'SHOW server_version_num;' 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -n "$SERVER_VER" ]]; then
    # server_version_num: 150004 -> 15 ; 160002 -> 16
    SERVER_MAJOR="$(( SERVER_VER / 10000 ))"
    info "Servidor PostgreSQL: versión mayor ${BOLD}$SERVER_MAJOR${RESET}"
    if (( CLIENT_VER < SERVER_MAJOR )); then
      warn "${BOLD}pg_dump ($CLIENT_VER) es MÁS VIEJO que el servidor ($SERVER_MAJOR).${RESET}"
      warn "Un dump con cliente viejo puede salir INCOMPLETO. Actualiza pg_dump a >= $SERVER_MAJOR."
      printf '%s' "${YELLOW}¿Continuar de todos modos? [y/N] ${RESET}"
      read -r answer
      [[ "$answer" =~ ^[yY]$ ]] || die "Abortado por versión de cliente desactualizada."
    else
      ok "Versión de cliente compatible (>= servidor)."
    fi
  else
    warn "No se pudo consultar la versión del servidor (psql falló). Continuando sin verificar."
  fi
else
  warn "psql no está instalado: no se pudo verificar la versión del servidor."
  warn "Asegúrate de que pg_dump sea versión >= la del servidor Supabase (15 o 16)."
fi

# ----------------------------------------------------------------------------
# 4b. 🔒 VERIFICACIÓN DE IDENTIDAD DE LA BASE — ¿es G-Pulso?
#
# Incidente 2026-07-28 (ver FORKED_FROM.md): este script se heredó del fork
# leyendo GMURA_DB_URL y apuntando a la producción de G-MURA (otro cliente).
# Un backup de la base equivocada no destruye nada, pero SÍ genera un dump mal
# rotulado que después alguien toma por bueno — que es exactamente como se
# encadenó el incidente.
#
# Criterio idéntico al de los scripts de reset: objetos exclusivos de G-Pulso
# (units / repair_orders / credit_commissions) + la organización 'CelFashion'.
#
# Es SOLO LECTURA, así que ADVIERTE y pide confirmación en vez de abortar en
# seco (a veces querrás respaldar el lab o una base ajena a propósito). Sin
# terminal interactiva (CI, pipe) ABORTA: nadie puede confirmar.
# ----------------------------------------------------------------------------
IDENTITY="desconocida"
if command -v psql >/dev/null 2>&1; then
  # to_regclass nunca lanza error si la tabla no existe → consulta segura.
  TABLES_PRESENT="$(psql "$GPULSO_DB_URL" -tAc "
    SELECT (to_regclass('public.units')              IS NOT NULL)::int
         + (to_regclass('public.repair_orders')      IS NOT NULL)::int
         + (to_regclass('public.credit_commissions') IS NOT NULL)::int
         + (to_regclass('public.organizations')      IS NOT NULL)::int;" 2>/dev/null | tr -d '[:space:]' || true)"

  if [[ "$TABLES_PRESENT" == "4" ]]; then
    ORG_PRESENT="$(psql "$GPULSO_DB_URL" -tAc \
      "SELECT count(*) FROM public.organizations WHERE name = 'CelFashion';" 2>/dev/null | tr -d '[:space:]' || true)"
    [[ "${ORG_PRESENT:-0}" -ge 1 ]] && IDENTITY="gpulso" || IDENTITY="ajena"
  elif [[ -n "$TABLES_PRESENT" ]]; then
    IDENTITY="ajena"
  fi
fi

case "$IDENTITY" in
  gpulso)
    ok "Identidad verificada: la base ES G-Pulso (units + repair_orders + credit_commissions + org CelFashion)."
    ;;
  ajena|desconocida)
    warn "${BOLD}Esta base NO se identifica como G-Pulso.${RESET}"
    if [[ "$IDENTITY" == "ajena" ]]; then
      # Pista de a quién pertenece, sin exponer la credencial.
      OTHER_ORGS="$(psql "$GPULSO_DB_URL" -tAc \
        "SELECT string_agg(name, ', ' ORDER BY name) FROM public.organizations;" 2>/dev/null | tr -d '\r' || true)"
      [[ -n "$OTHER_ORGS" ]] && warn "Organizaciones encontradas: ${BOLD}${OTHER_ORGS}${RESET}"
      warn "Faltan objetos propios de G-Pulso y/o la org 'CelFashion'."
    else
      warn "No se pudo consultar la base (¿psql, red o credencial?)."
    fi
    warn "Si esperabas gpulso-prod, ${BOLD}revisa GPULSO_DB_URL en $ENV_FILE${RESET} antes de continuar."
    if [[ -t 0 ]]; then
      printf '%s' "${YELLOW}¿Respaldar esta base de todos modos? [y/N] ${RESET}"
      read -r answer
      [[ "$answer" =~ ^[yY]$ ]] || die "Abortado: la base no es G-Pulso y no se confirmó."
      warn "Continuando por confirmación explícita. El dump NO es de G-Pulso: rotúlalo como corresponde."
    else
      die "Sin terminal interactiva para confirmar y la base no es G-Pulso. Abortado."
    fi
    ;;
esac

# ----------------------------------------------------------------------------
# 5. Ejecutar el backup
# ----------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d_%H%M)"
DUMP_NAME="gpulso_${STAMP}_${SAFE_LABEL}.dump"
DUMP_PATH="$BACKUP_DIR/$DUMP_NAME"

info "Generando backup: ${BOLD}$DUMP_NAME${RESET}"
info "Esto puede tardar según el tamaño de la BD…"

# -F c  => formato custom (restaurable con pg_restore, comprimido)
# --no-owner / --no-acl => portable entre entornos (no depende de roles de prod)
if ! pg_dump --no-owner --no-acl -F c -f "$DUMP_PATH" "$GPULSO_DB_URL"; then
  # Limpia un dump parcial si quedó algo escrito
  [[ -f "$DUMP_PATH" ]] && rm -f "$DUMP_PATH"
  die "pg_dump falló. No se generó backup."
fi

# ----------------------------------------------------------------------------
# 6. Verificación post-dump
# ----------------------------------------------------------------------------
[[ -f "$DUMP_PATH" ]] || die "El archivo de backup no existe tras pg_dump."

# Tamaño en bytes (portable: stat de GNU o BSD)
SIZE_BYTES="$(stat -c %s "$DUMP_PATH" 2>/dev/null || stat -f %z "$DUMP_PATH" 2>/dev/null || echo 0)"
(( SIZE_BYTES > 0 )) || { rm -f "$DUMP_PATH"; die "El backup tiene 0 bytes. Backup inválido, eliminado."; }

# Tamaño legible
if command -v numfmt >/dev/null 2>&1; then
  SIZE_HUMAN="$(numfmt --to=iec --suffix=B "$SIZE_BYTES")"
else
  SIZE_HUMAN="${SIZE_BYTES} B"
fi

# pg_restore --list confirma que el dump tiene contenido real
RESTORE_LIST="$(pg_restore --list "$DUMP_PATH" 2>/dev/null || true)"
[[ -n "$RESTORE_LIST" ]] || { rm -f "$DUMP_PATH"; die "pg_restore --list no devolvió contenido. Dump corrupto/vacío, eliminado."; }

TABLE_COUNT="$(printf '%s\n' "$RESTORE_LIST" | grep -cE '\bTABLE DATA\b' || true)"
FUNC_COUNT="$(printf '%s\n' "$RESTORE_LIST" | grep -cE '\bFUNCTION\b' || true)"
TOTAL_ENTRIES="$(printf '%s\n' "$RESTORE_LIST" | grep -cE '^[0-9;]' || true)"

# Un backup sin ninguna tabla con datos es muy sospechoso: avisar fuerte
if (( TABLE_COUNT == 0 )); then
  warn "El dump NO contiene ninguna entrada TABLE DATA. Revisa que la cadena apunte a la BD correcta."
fi

# Checksum (mejor esfuerzo)
CHECKSUM=""
if command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM="$(sha256sum "$DUMP_PATH" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  CHECKSUM="$(shasum -a 256 "$DUMP_PATH" | awk '{print $1}')"
fi

# ----------------------------------------------------------------------------
# 7. Append al registro
# ----------------------------------------------------------------------------
[[ -f "$REGISTRO" ]] || die "No existe $REGISTRO (debería estar versionado en el repo)."

NOW_HUMAN="$(date '+%Y-%m-%d %H:%M')"
SHORT_SUM="${CHECKSUM:0:12}"
printf '| %s | `%s` | `%s` | %s | `%s` |\n' \
  "$NOW_HUMAN" "$LABEL" "$DUMP_NAME" "$SIZE_HUMAN" "${SHORT_SUM:-n/a}" \
  >> "$REGISTRO"

# ----------------------------------------------------------------------------
# 8. Resumen
# ----------------------------------------------------------------------------
printf '\n%s\n' "${GREEN}${BOLD}════════════ BACKUP COMPLETADO ════════════${RESET}"
printf '  %-18s %s\n' "Etiqueta:"       "$LABEL"
printf '  %-18s %s\n' "Archivo:"        "$DUMP_NAME"
printf '  %-18s %s\n' "Ruta:"           "$DUMP_PATH"
printf '  %-18s %s\n' "Tamaño:"         "$SIZE_HUMAN"
printf '  %-18s %s\n' "Entradas dump:"  "$TOTAL_ENTRIES"
printf '  %-18s %s\n' "Tablas c/datos:" "$TABLE_COUNT"
printf '  %-18s %s\n' "Funciones:"      "$FUNC_COUNT"
[[ -n "$CHECKSUM" ]] && printf '  %-18s %s\n' "SHA-256:" "$CHECKSUM"
printf '  %-18s %s\n' "Registrado en:"  "backups/REGISTRO.md"
printf '%s\n\n' "${GREEN}${BOLD}═══════════════════════════════════════════${RESET}"

ok "Backup verificado y registrado. NO subas el .dump al repo."
