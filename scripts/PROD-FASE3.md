# Procedimiento de producción — Fase 3 (taller de reparaciones)

> **Estado: BLOQUEADO.** No se ejecuta NADA contra `gpulso-prod` hasta el visto
> del smoke test humano + este procedimiento. Prod ya tiene datos reales de
> CelFashion.
>
> **Migraciones a aplicar:** `043` → `044` → `045` → `046` → `047` (las cinco
> nuevas de la Fase 3). Prod ya está en `042` (Fase 2). Este es un **apply
> incremental sobre una BD CON datos**, NO un replay desde cero.

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
**`postgres:17`** (debe igualar la versión mayor del servidor — ver §1.1). El
patrón, presente en cada comando de este documento:

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
- Como la SQL viaja por **stdin** (heredoc `<<'SQL'` o pipe), no como argumento, no
  hay choque entre las comillas simples del `sh -c` y las comillas de los literales
  SQL (`'public'`, `'repair_orders'`, …).
- `-v "$(pwd -W)/backups":/backups` → monta la carpeta `backups/` del host; el
  dump SIEMPRE queda en el disco del host, nunca dentro del contenedor efímero.
- `-i` → cuando se le pipea/heredoc SQL por stdin (loop del §2.1 y queries del §3).

> **Primera vez:** `docker pull postgres:17` para no depender de la red el día D.

---

## 0. Ventana recomendada

- **Fuera del horario de CelFashion.** Idealmente después del cierre de caja del
  día.
- Motivo concreto: la `044` hace `CREATE OR REPLACE` de `deduct_stock_on_sale` y
  `restore_stock_on_return` (agrega la guardia `is_service`), y la `045` crea/
  reemplaza `deliver_repair` y compañía. Reemplazar la función de descuento de
  stock **mientras el POS está registrando ventas** es riesgo innecesario (un
  `CREATE OR REPLACE FUNCTION` toma un lock breve, y una venta en vuelo podría
  cruzarse con el swap).
- La `043` hace `ALTER TYPE movement_type ADD VALUE` — barato, pero igual mejor en
  ventana muerta.
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

`gpulso-prod` corría **PostgreSQL 17.x** en la Fase 2. Por la regla
`pg_dump ≥ servidor`, la herramienta debe ser **17+** → imagen **`postgres:17`**.
Confirma en el momento (no asumas):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL" -tAc "SHOW server_version_num;"'
# Esperado: 1700xx  (17.x). Si reporta 18xxxx → detente y sube la imagen a
# postgres:18 en TODO el documento antes de seguir.
```

### 1.2 Generar el dump (formato custom, con timestamp, contenedorizado)

```bash
mkdir -p backups
export DUMP_NAME="gpulso_$(date +%Y%m%d_%H%M)_pre-fase3.dump"   # host: hora local
# ↑ DEBE ir 'export': docker -e DUMP_NAME solo toma variables EXPORTADAS.

MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W)/backups":/backups \
  -e GPULSO_DB_URL -e DUMP_NAME \
  postgres:17 \
  sh -c 'pg_dump --no-owner --no-acl -F c -f "/backups/$DUMP_NAME" "$GPULSO_DB_URL"'

ls -l "backups/$DUMP_NAME"   # confirma el archivo recién creado en el HOST
```

### 1.3 Verificar que el dump NO está vacío (antes de tocar nada)

```bash
ls -l "backups/$DUMP_NAME"   # tamaño > 0 (host)

MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/backups":/backups -e DUMP_NAME postgres:17 \
  sh -c 'pg_restore --list "/backups/$DUMP_NAME"' | grep -cE '\bTABLE DATA\b'   # > 0
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/backups":/backups -e DUMP_NAME postgres:17 \
  sh -c 'pg_restore --list "/backups/$DUMP_NAME"' | grep -cE '\bFUNCTION\b'     # > 0
```

Si `TABLE DATA` es **0** → el dump es inservible: **detente**, borra el archivo y
repite. No sigas con un backup falso.

### 1.4 Restore de emergencia (documentado ANTES, no se improvisa a las 11pm)

```bash
# ROMPE-CRISTAL. Deja la BD en el estado del backup (dropea y recrea objetos).
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W)/backups":/backups \
  -e GPULSO_DB_URL -e DUMP_NAME \
  postgres:17 \
  sh -c 'pg_restore --clean --if-exists --no-owner --no-acl -d "$GPULSO_DB_URL" "/backups/$DUMP_NAME"'
```

- `--clean --if-exists` → dropea cada objeto antes de recrearlo (idempotente).
- **Cuándo usarlo:** solo si una verificación post-migración revela un estado
  incoherente que no se puede arreglar hacia adelante.
- Tras un restore de emergencia: la BD vuelve a `042`. **NO** se despliega el
  frontend de la Fase 3.

---

## 2. Orden estricto: BD antes que frontend

```
a) backup (§1)  →  b) aplicar 043→047 (§2.1)  →  c) verificar (§3)  →
d) SOLO si c) pasa: merge a develop  →  Vercel despliega el frontend
```

El frontend de la Fase 3 (taller, kanban, cobro, comprobantes) se despliega al
**mergear a develop**. Ese merge es el ÚLTIMO paso y está condicionado a que
todas las verificaciones del §3 pasen — en particular §3.6 (CelFashion).

### 2.1 Aplicar SOLO las migraciones pendientes (043→047)

`scripts/apply-migrations-fresh.sh` **NO sirve aquí**: está diseñado para una BD
**virgen**. Prod ya tiene `001→042` y datos. Se corren solo las 5 nuevas, en
orden, cada una con `ON_ERROR_STOP=1`. `cat`/`echo` corren en el host y se
**pipean por stdin** a `psql` dentro del contenedor:

```bash
set -e
for f in 043_stock_movement_repair_type \
         044_repair_orders \
         045_repair_rpcs \
         046_repair_roles \
         047_exclude_service_from_inventory; do
  echo "▶ Aplicando $f …"
  { echo "SET check_function_bodies = false;"; cat "supabase/migrations/${f}.sql"; } \
    | MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
        sh -c 'psql "$GPULSO_DB_URL" -v ON_ERROR_STOP=1 -q'
  echo "  ✔ $f aplicada"
done
echo "✔ 043→047 aplicadas."
```

Notas:

- **La 043 es AISLADA (sin `BEGIN/COMMIT`)**, a propósito: un
  `ALTER TYPE … ADD VALUE` no puede correr dentro de un bloque de transacción.
  psql sin `BEGIN` la autocommitea sola. **044→047 se auto-envuelven** en
  `BEGIN;…COMMIT;` (verificado). Con `ON_ERROR_STOP=1`, si una falla su
  transacción se revierte entera y el loop se detiene ahí.
- `SET check_function_bodies = false` por sesión: mismo comportamiento del runner
  de Supabase / `pg_restore`. Inofensivo (las tablas base ya existen).
- **NO se necesita `--with-grants`.** Prod es un proyecto Supabase real: las
  `ALTER DEFAULT PRIVILEGES` de la plataforma otorgan a `authenticated` las
  tablas nuevas y las funciones nuevas heredan `EXECUTE` según los `GRANT` de
  cada migración (045/046 ya hacen `GRANT … TO authenticated`).
- Prerrequisitos ya presentes en prod (Fase 1/2): `is_serialized_variant` (039),
  `get_my_store_id`/`get_my_organization_id` (013/020), `has_permission` (021),
  `canonical_role_permissions`/`seed_org_roles` (035). La 046 los REEMPLAZA
  (CREATE OR REPLACE) — no los crea de cero.

---

## 3. Verificaciones post-migración (queries listas para pegar)

Corre **todas**. Cada una debe dar el resultado esperado antes de mergear. Cada
query va contenedorizada (heredoc `<<'SQL'` → stdin de `docker run -i`).

### 3.1 Las 3 tablas nuevas existen y tienen RLS activo

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT relname, relrowsecurity AS rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND relname IN ('repair_orders','repair_status_history','repair_parts')
ORDER BY relname;
SQL
```
**Esperado:** 3 filas, `rls = t` en las tres.

### 3.2 Las 4 RPCs del taller existen

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('add_repair_part','remove_repair_part','deliver_repair','ensure_repair_service_variant')
ORDER BY proname;
SQL
```
**Esperado:** 4 filas exactas.

### 3.3 `products.is_service` + índice único parcial + enum del movimiento

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
-- Columna is_service
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='products' AND column_name='is_service';
-- Índice único parcial (invariante: un solo servicio por tienda)
SELECT indexname
FROM pg_indexes
WHERE schemaname='public' AND indexname='uq_products_one_service_per_store';
-- El enum de movimiento tiene 'repair_consumption'
SELECT 'repair_consumption' = ANY(enum_range(NULL::movement_type)::text[]) AS enum_ok;
SQL
```
**Esperado:** `is_service | boolean` (1 fila) · `uq_products_one_service_per_store`
(1 fila) · `enum_ok = t`.

### 3.4 `inventory_status` excluye `is_service`

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT pg_get_viewdef('public.inventory_status'::regclass) LIKE '%is_service%' AS excluye_servicio;
SQL
```
**Esperado:** `t` (la definición de la vista contiene el filtro `is_service`).

### 3.5 Verificación de CONTENIDO (lección de la Fase 2: no solo existencia)

Que las funciones tengan el blindaje que se probó en lab, no solo que existan:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
-- deliver_repair: busca el turno POR TIENDA, SIN opened_by (regla de create_order)
SELECT position('opened_by' in pg_get_functiondef('public.deliver_repair'::regproc)) = 0
       AS turno_sin_opened_by;
-- deliver_repair: tiene el FOR UPDATE de la orden (serializa la doble entrega)
SELECT pg_get_functiondef('public.deliver_repair'::regproc) LIKE '%FOR UPDATE%'
       AS deliver_tiene_for_update;
-- ensure_repair_service_variant: usa DO UPDATE RETURNING (no DO NOTHING + SELECT)
SELECT pg_get_functiondef('public.ensure_repair_service_variant'::regproc) LIKE '%DO UPDATE%'
       AS ensure_usa_do_update;
SQL
```
**Esperado:** `turno_sin_opened_by = t`, `deliver_tiene_for_update = t`,
`ensure_usa_do_update = t`. Si alguno da `f` → se aplicó una versión vieja de la
`045`: **detente**, revisa el archivo y re-aplica solo la `045`.

### 3.6 ⭐ LA MÁS IMPORTANTE — CelFashion recibió el rol Técnico y los permisos

La reconciliación aditiva de la `046` corre **sin filtro de organización**, así que
debe haber alcanzado a CelFashion (org ya sembrada en Fase 1). Si NO alcanzó, el
módulo queda **invisible para todos** (nadie tendría `reparaciones.gestionar`) y
**hay que resolverlo ANTES de deployar**.

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
-- a) Toda org tiene su rol Técnico
SELECT o.name AS org,
       EXISTS (SELECT 1 FROM public.roles r WHERE r.organization_id=o.id AND r.name='Técnico') AS tiene_tecnico
FROM public.organizations o
ORDER BY o.name;

-- b) Reparto de permisos reparaciones.* por rol y org
SELECT o.name AS org, r.name AS rol,
       r.permissions ? '*'                        AS comodin,
       r.permissions ? 'reparaciones.gestionar'   AS gestionar,
       r.permissions ? 'reparaciones.ver_costos'  AS ver_costos
FROM public.roles r
JOIN public.organizations o ON o.id = r.organization_id
WHERE r.name IN ('Dueño','Administrador','Vendedor','Técnico')
ORDER BY o.name, r.name;
SQL
```
**Esperado (para CelFashion y CUALQUIER otra org):**

- (a) `tiene_tecnico = t` en todas.
- (b) por rol:
  | rol | comodin | gestionar | ver_costos |
  |-----|:---:|:---:|:---:|
  | Dueño | t | (via *) | (via *) |
  | Administrador | f | **t** | **t** |
  | Vendedor | f | **t** | f |
  | Técnico | f | **t** | **t** |

Si CelFashion NO tiene el rol Técnico, o su Administrador/Vendedor **no** tienen
`reparaciones.gestionar`, la reconciliación no corrió. Re-aplica solo la `046`
(es idempotente y self-healing) y vuelve a correr esta query. Si aun así falla,
**detente** — no deployes el frontend contra una org sin permisos.

---

## 4. Plan de contingencia (falla a mitad del chain)

Cada migración es transaccional (salvo la 043, que es un solo `ALTER TYPE`); **el
chain de 5 no lo es**. Si una `04x` falla, la BD queda en el último `.sql` que
hizo `COMMIT`.

| Falla en | Estado en que queda la BD | Decisión |
|----------|---------------------------|----------|
| 043 | Sigue en `042` (o con el valor de enum agregado; `ADD VALUE IF NOT EXISTS` es idempotente) | Fix-forward: reintenta desde 043. |
| 044 | En `043` (el valor de enum ya vive; inofensivo) | Fix-forward desde 044. |
| 045 | En `044` (tablas + is_service ya viven) | Fix-forward desde 045. |
| 046 | En `045` (RPCs ya viven, pero SIN permisos → módulo invisible) | Fix-forward desde 046. **No deployes** hasta que §3.6 pase. |
| 047 | En `046` (solo falta excluir is_service de la vista) | Fix-forward desde 047. |

**Cómo decidir continuar vs. restore:**

1. Lee el error de psql (con `ON_ERROR_STOP=1` sale exacto en cuál `.sql` y por
   qué). El loop ya se detuvo solo.
2. Si el error es entendible y trivial → **fix-forward**: reintenta el loop; las
   ya aplicadas no se repiten (cada una committeó; son idempotentes en lo
   estructural: `IF NOT EXISTS`, `CREATE OR REPLACE`, `ADD VALUE IF NOT EXISTS`,
   reconciliación con guard de contención).
3. Si el error deja dudas sobre coherencia de datos → **NO improvises**. Restore
   de emergencia (§1.4) → la BD vuelve a `042` → reportar.

**Criterio DURO de no-deploy del frontend:**

> Si CUALQUIERA de las verificaciones del §3 no da el resultado esperado —muy en
> especial §3.6 (CelFashion con rol Técnico y permisos `reparaciones.*`)— o el
> chain no aplicó las 5 migraciones limpiamente, **NO se mergea a develop**. El
> frontend de la Fase 3 asume que las tablas/RPCs existen y que los roles tienen
> los permisos; desplegarlo contra una BD incompleta deja el taller invisible o
> roto.

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
- [ ] 043→047 aplicadas con el loop `ON_ERROR_STOP=1` (§2.1).
- [ ] §3.1 las 3 tablas con RLS = t.
- [ ] §3.2 las 4 RPCs presentes.
- [ ] §3.3 `is_service` + índice único parcial + enum `repair_consumption`.
- [ ] §3.4 `inventory_status` excluye is_service.
- [ ] §3.5 contenido: deliver_repair sin opened_by + FOR UPDATE; ensure con DO UPDATE.
- [ ] **§3.6 CelFashion con rol Técnico + Admin/Vendedor/Técnico con reparaciones.\*.**
- [ ] TODO verde → merge a develop → Vercel despliega el frontend.
- [ ] Smoke post-deploy en prod: recibir un equipo, avanzar a listo, cobrar la
      entrega (aparece como venta en el cuadre), imprimir los dos comprobantes.

---

### Resumen de las 5 migraciones (para tu revisión final del SQL)

| Migración | Qué hace |
|-----------|----------|
| `043_stock_movement_repair_type` | `movement_type += 'repair_consumption'` (aislada, sin BEGIN/COMMIT). |
| `044_repair_orders` | `products.is_service` + índice único parcial `uq_products_one_service_per_store`; guardias `is_service` en `deduct_stock_on_sale`/`restore_stock_on_return`; enums `repair_status`/`repair_part_source`; tablas `repair_orders` (org por trigger, `order_number` por trigger) / `repair_status_history` (bitácora por trigger) / `repair_parts`; RLS (parts SELECT gated a `reparaciones.ver_costos`). |
| `045_repair_rpcs` | RPCs `add_repair_part` (consumo atómico de inventario), `remove_repair_part` (reverso atómico), `ensure_repair_service_variant` (find-or-create race-safe, DO UPDATE RETURNING), `deliver_repair` (cobro atómico = venta de servicio, turno por tienda, FOR UPDATE, precio 0 = garantía). |
| `046_repair_roles` | `canonical_role_permissions` += `reparaciones.gestionar`/`ver_costos` (Admin, Vendedor sin ver_costos) + rol **Técnico**; `seed_org_roles` crea Técnico; reconciliación aditiva SIN filtro de org (alcanza a CelFashion). |
| `047_exclude_service_from_inventory` | `inventory_status` excluye `is_service` (el servicio de reparación no es inventario). |

Tests SQL que respaldan la fase (verdes en lab, incl. carrera de 2 sesiones):
`scripts/test-deliver-repair.sql`.
