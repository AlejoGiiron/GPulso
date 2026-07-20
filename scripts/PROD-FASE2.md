# Procedimiento de producción — Fase 2 (inventario serializado)

> **Estado: BLOQUEADO.** No se ejecuta NADA contra `gpulso-prod` hasta el visto
> del smoke test humano + este procedimiento. Prod ya tiene datos reales de
> CelFashion.
>
> **Migraciones a aplicar:** `039` → `040` → `041` → `042` (las cuatro nuevas de
> la Fase 2). Prod ya está en `038` (Fase 1). Este es un **apply incremental
> sobre una BD CON datos**, NO un replay desde cero.

---

## ⚠ Regla de seguridad (vigente)

La cadena de conexión de `gpulso-prod` **NO se escribe en ningún archivo** (ni
`.env`, ni scripts, ni logs commiteados). Se pega en la sesión de terminal como
variable y se usa solo en línea de comandos. Todos los comandos de abajo asumen:

```bash
# Pégala UNA vez en la sesión. NO la guardes en disco. NO la commitees.
export GPULSO_DB_URL='postgresql://…'   # la cadena real la das tú por chat
```

Al cerrar la terminal, la variable muere con la sesión. No queda rastro.

---

## Convención: TODO se ejecuta vía Docker

El operador corre desde **Windows / Git Bash, sin `psql`/`pg_dump`/`pg_restore`
locales**. Todas las herramientas de PostgreSQL corren dentro de la imagen
**`postgres:17`** (debe igualar la versión mayor del servidor — ver §1.1). Los
built-ins de shell (`cat`, `echo`, `ls`, `grep`, `date`) sí corren en el host
(Git Bash los trae). El patrón, presente en cada comando de este documento:

```bash
MSYS_NO_PATHCONV=1 docker run --rm [-i] [-v "$(pwd -W)/backups":/backups] \
  -e GPULSO_DB_URL postgres:17  sh -c '<herramienta> "$GPULSO_DB_URL" …'
```

- `MSYS_NO_PATHCONV=1` → evita que Git Bash mangle rutas tipo `/backups`.
- `-e GPULSO_DB_URL` → pasa la cadena al contenedor por **entorno**, no por disco.
- **`sh -c '… "$GPULSO_DB_URL" …'` (comillas SIMPLES) es obligatorio.** Con
  comillas simples el host NO expande `$GPULSO_DB_URL`: la línea de comandos —y
  por tanto el **historial del shell**— guarda el literal `$GPULSO_DB_URL`, no la
  credencial. La cadena solo se expande DENTRO del contenedor, desde su entorno.
  Pasarla como argumento host-expandido (`psql "$GPULSO_DB_URL"` sin `sh -c`) la
  deja en el historial → **prohibido** (viola la regla de seguridad).
- Como la SQL viaja por **stdin** (heredoc `<<'SQL'` o pipe), no como argumento, no
  hay choque entre las comillas simples del `sh -c` y las comillas de los literales
  SQL (`'public'`, `'units'`, …).
- `-v "$(pwd -W)/backups":/backups` → monta la carpeta `backups/` del host; el
  dump SIEMPRE queda en el disco del host, nunca dentro del contenedor efímero.
- `-i` → cuando se le pipea/heredoc SQL por stdin (loop del §2.1 y queries del §3).

> **Primera vez:** `docker pull postgres:17` para no depender de la red el día D.

---

## 0. Ventana recomendada

- **Fuera del horario de CelFashion.** Idealmente después del cierre de caja del
  día.
- Motivo concreto: la 039 hace `CREATE OR REPLACE` de `deduct_stock_on_sale`,
  `restore_stock_on_return` y otros triggers de venta, y la 041 crea/reemplaza
  `create_order`. Reemplazar la función de descuento de stock **mientras el POS
  está registrando ventas** es riesgo innecesario (un `CREATE OR REPLACE FUNCTION`
  toma un lock breve, y una venta en vuelo podría cruzarse con el swap).
- **No debe haber turno abierto vendiendo** durante el apply. Verificable:
  ```bash
  MSYS_NO_PATHCONV=1 docker run --rm -e GPULSO_DB_URL postgres:17 \
    sh -c 'psql "$GPULSO_DB_URL" -c "SELECT id, store_id, opened_by, opened_at FROM public.cash_shifts WHERE closed_at IS NULL;"'
  ```
  Lo ideal es 0 filas; si hay un turno abierto pero sin actividad, no bloquea,
  pero mejor ventana muerta.

---

## 1. BACKUP PREVIO (obligatorio — no negociable)

### 1.1 Verificar la versión del servidor (NO asumir)

`gpulso-prod` corre **PostgreSQL 17.6** (verificado con `select version()` al
aplicar la Fase 1). Por la regla `pg_dump ≥ servidor`, la herramienta debe ser
**17+** → se usa la imagen **`postgres:17`** en todos los comandos.

Confirma en el momento (no asumas) que el servidor sigue en la mayor 17:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL" -tAc "SHOW server_version_num;"'
# Esperado: 1700xx  (17.x → server mayor 17). pg_dump de postgres:17 = 17 → OK.
```

Si el servidor reportara una mayor distinta (p. ej. `18xxxx`) → **detente** y sube
la imagen de referencia a `postgres:18` en TODO el documento antes de seguir. La
regla es una sola: **la mayor de la imagen ≥ la mayor del servidor.**

### 1.2 Generar el dump (formato custom, con timestamp, contenedorizado)

El dump DEBE quedar en el disco del host (`backups/`), no dentro del contenedor
efímero → se monta el volumen:

El nombre (con timestamp) se genera en el **host** y se reusa en §1.3 y §1.4 vía
`-e DUMP_NAME`. No es un secreto → sí puede ir host-expandido; la ÚNICA que se
mantiene fuera del historial es la cadena de conexión (dentro del `sh -c`):

```bash
mkdir -p backups
export DUMP_NAME="gpulso_$(date +%Y%m%d_%H%M)_pre-fase2.dump"   # host: hora local
# ↑ DEBE ir 'export': docker -e DUMP_NAME solo toma variables EXPORTADAS del
#   entorno; sin export el contenedor recibe vacío y -f cae en "/backups/" (dir).

MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W)/backups":/backups \
  -e GPULSO_DB_URL -e DUMP_NAME \
  postgres:17 \
  sh -c 'pg_dump --no-owner --no-acl -F c -f "/backups/$DUMP_NAME" "$GPULSO_DB_URL"'

ls -l "backups/$DUMP_NAME"   # confirma el archivo recién creado en el HOST
```

- `-F c` → formato custom (comprimido, restaurable con `pg_restore`).
- `--no-owner --no-acl` → portable, no depende de los roles de prod.
- `-f /backups/…` es la ruta DENTRO del contenedor; por el `-v` cae en
  `./backups/` del host. `$DUMP_NAME` se expande en el contenedor (viene por `-e`).
- **Mantén viva la misma sesión de terminal:** `DUMP_NAME` es una variable de
  shell del host que §1.3 y §1.4 reutilizan.

### 1.3 Verificar que el dump NO está vacío (antes de tocar nada)

`ls` corre en el host (el dump ya está en disco); `pg_restore --list` va
contenedorizado con el mismo volumen. Reutiliza `$DUMP_NAME` de §1.2 (misma
sesión); `pg_restore --list` no abre conexión, así que aquí no hace falta la
cadena:

```bash
# a) Tamaño > 0 (host)
ls -l "backups/$DUMP_NAME"

# b) Contenido real: pg_restore --list debe listar tablas con datos (Docker)
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/backups":/backups -e DUMP_NAME postgres:17 \
  sh -c 'pg_restore --list "/backups/$DUMP_NAME"' | grep -cE '\bTABLE DATA\b'   # > 0
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/backups":/backups -e DUMP_NAME postgres:17 \
  sh -c 'pg_restore --list "/backups/$DUMP_NAME"' | grep -cE '\bFUNCTION\b'     # > 0
```

Si el conteo de `TABLE DATA` es **0** → el dump es inservible: **detente**, borra
el archivo y repite. No sigas con un backup falso.

> `./scripts/backup-db.sh` hace esto mismo (version-check + verificación +
> registro) pero **asume `pg_dump` local** y lee `GMURA_DB_URL` de `.env.backup`;
> no aplica a este operador (sin tooling local). Usa los comandos Docker de arriba
> con `$GPULSO_DB_URL` en la sesión, **sin** escribir la cadena en ningún archivo.

### 1.4 Restore de emergencia (documentado ANTES, no se improvisa a las 11pm)

Si hay que revertir, el dump se restaura sobre la MISMA base, contenedorizado:

```bash
# ROMPE-CRISTAL. Deja la BD en el estado del backup (dropea y recrea objetos).
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W)/backups":/backups \
  -e GPULSO_DB_URL -e DUMP_NAME \
  postgres:17 \
  sh -c 'pg_restore --clean --if-exists --no-owner --no-acl -d "$GPULSO_DB_URL" "/backups/$DUMP_NAME"'
```

- `--clean --if-exists` → dropea cada objeto antes de recrearlo (idempotente).
- **Cuándo usarlo:** solo si una verificación post-migración revela que la BD
  quedó en un estado incoherente que no se puede arreglar hacia adelante. En la
  práctica esto es raro (cada migración es transaccional — ver §4).
- Tras un restore de emergencia: la BD vuelve a estar en `038`. **NO** se despliega
  el frontend de la Fase 2.

---

## 2. Orden estricto: BD antes que frontend

```
a) backup (§1)  →  b) aplicar 039→042 (§2.1)  →  c) verificar (§3)  →
d) SOLO si c) pasa: merge a develop  →  Vercel despliega el frontend
```

El frontend de la Fase 2 (POS escáner-first, unidades, fichas) se despliega al
**mergear a develop**. Ese merge es el ÚLTIMO paso y está condicionado a que
todas las verificaciones del §3 pasen.

### 2.1 Aplicar SOLO las migraciones pendientes (039→042)

`scripts/apply-migrations-fresh.sh` **NO sirve aquí**: está diseñado para una BD
**virgen** (aplica el set completo desde `001` y hace el pre-flight de la `006`).
Prod ya tiene `001→038` y datos. Para un apply incremental se corren solo las 4
nuevas, en orden, cada una con `ON_ERROR_STOP=1`:

`cat`/`echo` corren en el host (los archivos están en el repo del host) y se
**pipean por stdin** a `psql` dentro del contenedor (`docker run -i`, sin volumen):

```bash
set -e
for f in 039_serialized_units \
         040_receive_serialized_units \
         041_create_order \
         042_stock_movement_unit_link; do
  echo "▶ Aplicando $f …"
  { echo "SET check_function_bodies = false;"; cat "supabase/migrations/${f}.sql"; } \
    | MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
        sh -c 'psql "$GPULSO_DB_URL" -v ON_ERROR_STOP=1 -q'
  echo "  ✔ $f aplicada"
done
echo "✔ 039→042 aplicadas."
```

Notas:

- **Cada `.sql` se envuelve a sí mismo en `BEGIN;…COMMIT;`** (verificado). Con
  `ON_ERROR_STOP=1`, si una migración falla, su transacción **se revierte
  entera** y el loop se detiene ahí. No quedan a medias.
- `SET check_function_bodies = false` por sesión: mismo comportamiento que usa el
  runner de Supabase y `pg_restore`. Es el flag con el que se validó el chain en
  el lab. Inofensivo aquí (las tablas ya existen).
- **NO se necesita `--with-grants`.** Prod es un proyecto Supabase real: las
  `ALTER DEFAULT PRIVILEGES` de la plataforma otorgan a `authenticated` las tablas
  nuevas (`units`) automáticamente, y las funciones nuevas heredan `EXECUTE` a
  `public` por defecto de Postgres. (Fallback en §3.5 por si el smoke muestra
  "permission denied for table units".)
- **NO hay pre-flight de la 006** (ese conflicto es de una migración < 006; no
  aplica a 039→042).

---

## 3. Verificaciones post-migración (queries listas para pegar)

Corre las cinco. **Todas** deben dar el resultado esperado antes de mergear a
develop. Cada query va contenedorizada (heredoc `<<'SQL'` → stdin de `docker
run -i`); copia el bloque completo.

### 3.1 `units` existe y tiene RLS activo

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT relname, relrowsecurity AS rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND relname = 'units';
SQL
```
**Esperado:** 1 fila, `rls = t`.

### 3.2 Las 5 funciones de unidad + `create_order` + `receive_serialized_units` existen

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'claim_unit', 'reserve_unit', 'release_reserved_unit',
    'complete_reserved_unit', 'restore_returned_unit',
    'create_order', 'receive_serialized_units'
  )
ORDER BY proname;
SQL
```
**Esperado:** 7 filas exactas (5 de unidad + `create_order` + `receive_serialized_units`).

### 3.3 Los 6 triggers heredados quedaron redefinidos con la guardia de serializados

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT proname,
       pg_get_functiondef(oid) LIKE '%is_serialized_variant%' AS tiene_guardia
FROM pg_proc
WHERE proname IN (
  'deduct_stock_on_sale', 'restore_stock_on_return',
  'reserve_stock_on_layaway', 'release_stock_on_layaway_change',
  'fulfill_stock_on_layaway_completion', 'increase_stock_on_purchase'
)
ORDER BY proname;
SQL
```
**Esperado:** 6 filas, todas con `tiene_guardia = t`.

Spot-check pedido explícitamente (que `deduct_stock_on_sale` sí tiene la guardia):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT pg_get_functiondef('public.deduct_stock_on_sale'::regproc)
       LIKE '%is_serialized_variant%' AS deduct_guardado;
SQL
```
**Esperado:** `t`.

### 3.4 `stock_movements.unit_id` existe (rastro por unidad, migración 042)

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'stock_movements'
  AND column_name = 'unit_id';
SQL
```
**Esperado:** 1 fila, `unit_id | uuid`.

Y que `claim_unit` fue redefinida para estampar `unit_id` (042):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT pg_get_functiondef('public.claim_unit'::regproc) LIKE '%unit_id%' AS claim_estampa;
SQL
```
**Esperado:** `t`.

### 3.5 (Fallback) Acceso de `authenticated` a `units`

Solo si un smoke test posterior muestra `permission denied for table units`.
No debería hacer falta (§2.1), pero por si acaso:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
GRANT SELECT, INSERT, UPDATE, DELETE ON public.units TO authenticated;
SQL
```

---

## 4. Plan de contingencia (falla a mitad del chain)

Cada migración es transaccional; **el chain de 4 no lo es**. Si la `04x` falla,
la BD queda en el último `.sql` que hizo `COMMIT`.

| Falla en | Estado en que queda la BD | Decisión |
|----------|---------------------------|----------|
| 039 | Sigue en `038` (039 revirtió su tx) | Fix-forward: corrige el error y reintenta el loop desde 039. |
| 040 | En `039` (units + funciones ya viven) | Fix-forward desde 040. 039 es coherente por sí sola. |
| 041 | En `040` | Fix-forward desde 041. |
| 042 | En `041` | Fix-forward desde 042 (solo agrega `unit_id` + estampa). |

**Cómo decidir continuar vs. restore:**

1. Lee el error de psql (con `ON_ERROR_STOP=1` sale exacto en cuál `.sql` y por
   qué). El loop ya se detuvo solo.
2. Si el error es entendible y trivial (ej. un permiso, un typo de conexión) →
   **fix-forward**: reintenta el loop; empieza por la migración que falló (las ya
   aplicadas no se repiten porque cada una committeó). Cada migración es idempotente
   en lo estructural (`IF NOT EXISTS`, `CREATE OR REPLACE`).
3. Si el error deja dudas sobre coherencia de datos, o no se entiende → **NO
   improvises**. Restore de emergencia (§1.4) → la BD vuelve a `038` → reportar.

**Criterio DURO de no-deploy del frontend:**

> Si CUALQUIERA de las verificaciones del §3 no da el resultado esperado, o el
> chain no llegó a aplicar las 4 migraciones limpiamente, **NO se mergea a
> develop**. El frontend de la Fase 2 asume que `units`, `create_order` y los
> triggers redefinidos existen; desplegarlo contra una BD incompleta rompe el POS.

---

## 5. Checklist de ejecución (para el día D)

- [ ] `docker pull postgres:17` hecho (no depender de la red el día D).
- [ ] Ventana fuera de horario de CelFashion; sin turno abierto vendiendo (§0).
- [ ] `GPULSO_DB_URL` pegada en la sesión, NO en archivo (regla de seguridad).
- [ ] Servidor confirmado en mayor 17 (`SHOW server_version_num` → `1700xx`); si
      no, subir la imagen `postgres:N` en todo el doc (§1.1).
- [ ] Backup generado con timestamp, en `backups/` del host vía Docker (§1.2).
- [ ] Backup verificado: tamaño > 0 y `TABLE DATA` > 0 (§1.3).
- [ ] Comando de restore de emergencia a la vista (§1.4).
- [ ] 039→042 aplicadas con el loop `ON_ERROR_STOP=1` (§2.1).
- [ ] §3.1 `units` con RLS = t.
- [ ] §3.2 las 7 funciones presentes.
- [ ] §3.3 los 6 triggers con guardia + spot-check de `deduct_stock_on_sale`.
- [ ] §3.4 `stock_movements.unit_id` presente + `claim_unit` estampa.
- [ ] TODO verde → merge a develop → Vercel despliega el frontend.
- [ ] Smoke post-deploy en prod: escanear un serial, vender una unidad, ver su
      ficha con timeline.

---

### Resumen de las 4 migraciones (para tu revisión final del SQL)

| Migración | Qué hace |
|-----------|----------|
| `039_serialized_units` | `products.is_serialized` (inmutable por trigger); enum `unit_status`; tabla `units` (+ RLS, `org` derivada del `store`, `UNIQUE(org, serial)`); `is_serialized_variant()`; `sync_variant_stock_from_units()` (deriva `variants.stock_qty`); guardias de serializado en los **6 triggers heredados** de stock; funciones `claim_unit` / `reserve_unit` / `release_reserved_unit` / `complete_reserved_unit` / `restore_returned_unit` con guards de coherencia de `order_item`. |
| `040_receive_serialized_units` | RPC `receive_serialized_units(invoice_item, serials[])`: recepción parcial ≤N, `FOR UPDATE` anti-carrera, all-or-nothing, exige permiso `inventario.gestionar`. |
| `041_create_order` | RPC `create_order(...)`: venta atómica (orden + ítems + claims de unidad + pagos en UNA transacción). Turno **por tienda**; invariante "ningún serializado sin unidad"; guards de pertenencia (variante/cliente de la org y tienda); validación de valores y de suma de pagos. |
| `042_stock_movement_unit_link` | `stock_movements.unit_id` (+ índice); redefine `claim_unit` / `complete_reserved_unit` / `restore_returned_unit` para estampar la unidad en su movimiento → timeline por unidad (Bloque E). |

Tests SQL que respaldan cada una (verdes en lab, incluidas 4 pruebas de carrera):
`test-serialized-units.sql`, `test-receive-serialized.sql`, `test-create-order.sql`,
`test-unit-timeline.sql`.
