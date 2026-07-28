# FORKED_FROM — Trazabilidad del fork G-Mura → G-Pulso

G-Pulso es un fork de **G-Mura** (POS de ropa en producción). Este documento
es la fuente de verdad para portear fixes entre ambos proyectos A MANO. Su
exactitud es sagrada: sin él, un fix aplicado en G-Mura no puede rastrearse
hasta su equivalente en G-Pulso ni viceversa.

## Punto del fork

| Dato | Valor |
|------|-------|
| Commit exacto del fork (HEAD de `develop` de G-Mura al clonar) | **`c77213e`** — `feat: claridad del historial de ventas para el cuadre diario` |
| Fecha del fork | **2026-07-18** |
| Última migración de G-Mura incluida en el fork | **`036_require_shift_for_payments.sql`** |

> **Nota de detección:** el commit `af4d23d`
> (`chore: incorpora material de diseño y specs iniciales`) es POSTERIOR al
> clon — agrega el material de diseño de G-Pulso (`_design/gpulso/`, `docs/`,
> `FEATURES-CATALOG.md`, `INVENTORY-SPEC.md`) y por eso NO es el punto de fork.
> El punto de fork es el commit inmediatamente anterior, `c77213e`, que es el
> último commit heredado de G-Mura. **Verificar `c77213e` contra el SHA anotado
> al clonar.**

## Deudas heredadas conocidas

Deudas que G-Pulso arrastra de G-Mura. Se rastrean aquí para saber cuándo se
atacan en este proyecto.

1. **`is_active` no aplicado en servidor.**
   Un usuario desactivado conservaba acceso porque `is_active` solo se chequeaba
   en el cliente. **→ SE RESUELVE EN ESTA FASE (Fase 1, paso 4):** migración
   `037_active_user_enforcement.sql` + expulsión en el frontend.
   La migración se diseñó **portable a G-Mura** (mismas firmas de funciones, sin
   dependencias de G-Pulso) → **candidata a portear en sentido inverso** a
   G-Mura. Ver la tabla "Fixes porteados" cuando se haga.

2. **Escrituras financieras no atómicas** (multi-INSERT desde el navegador).
   Las órdenes se creaban con varios INSERT secuenciales desde el cliente y un
   rollback compensatorio manual, no en una transacción de servidor.
   **RESUELTA para la ruta de VENTAS** (Fase 2): la RPC `create_order`
   (migración 041) crea orden + ítems + claims de unidades + pagos en UNA
   transacción atómica; el POS ya cobra por ella y se retiró el multi-INSERT
   client-side de la venta. **PENDIENTE** en: devoluciones/cambios, separados
   (crear/abonar/completar), pagos de crédito (fiado) y demás operaciones de
   turno — siguen con escrituras client-side + rollback compensatorio.
   Candidata a portear a G-Mura (create_order es autocontenida; la rama de
   unidades es condicional).

3. **Tipado de Supabase decorativo** (~400 casts `as unknown as ...`).
   `src/types/database.types.ts` está hecho a mano y no infiere relaciones
   embebidas, obligando a castear en cada query con join.
   **Pendiente:** `supabase gen types typescript` + limpieza de casts.

4. **Imputación de turnos duplicada.**
   `useShiftClosing` y `useShiftHistory` reimplementan por separado la lógica de
   qué ventas/abonos/gastos caen en la ventana de un turno.
   **Pendiente:** unificar en una sola fuente (idealmente una vista o RPC).

6. **Avance de estado de reparaciones sin guard de servidor** (NATIVA de G-Pulso,
   Fase 3 — no heredada; se anota aquí para no perderla de vista, misma familia
   que la deuda #2). `useAdvanceRepairStatus` hace un `UPDATE repair_orders SET
   status` plano (no RPC). La regla "no marcar 'listo' sin precio" vive **solo en
   cliente**: la mutación relee `repair_orders.precio` de la BD y valida antes de
   escribir (fix `fix/repair-ready-price-validation`), pero es saltable por API
   directa (poner `status='listo'` con `precio` null). **Pendiente:** mover la
   regla a una RPC/trigger cuando se endurezca el taller (fuera del alcance del
   hotfix).

## Migraciones específicas de G-Pulso (NO portables a G-Mura)

Migraciones nuevas que solo tienen sentido en G-Pulso y **jamás** deben aplicarse
en G-Mura.

| Migración | Por qué NO es portable |
|-----------|------------------------|
| `038_drop_inherited_bootstrap_org.sql` | Elimina la org `La Bodega del Jeans`, que en una BD virgen de G-Pulso queda como cascarón vacío (la crea la heredada 020). **En G-Mura esa org es el tenant REAL en producción** → aplicarla allá borraría datos del cliente. Exclusiva de G-Pulso. Tiene guardas (solo borra si no hay tiendas ni profiles), pero el aislamiento es por diseño. |

> Contraste: la migración `037_active_user_enforcement.sql` SÍ es portable (ver
> "Deudas heredadas" #1) — es candidata a portear en sentido inverso a G-Mura.

### Aislamiento del stack LOCAL de Supabase (`project_id`)

El aislamiento del fork (Fase 1) cubrió repo, proyecto Supabase **cloud** y
Vercel, pero **NO el stack local**: `supabase/config.toml` heredó
`project_id = "gmura"`. Con ese id, `supabase start` en G-Pulso **reutilizaba el
mismo stack de contenedores y el mismo volumen de datos** que el G-Mura local
(puertos 54321/54322 compartidos) → la app de G-Pulso se conectaba a la BD local
de G-Mura (datos espejo de producción del cliente de ropa).

**Fix (2026-07-21):** `project_id = "gpulso"`. Ahora `supabase start` crea un
stack propio (`supabase_*_gpulso`) con volumen aislado. **Específico de G-Pulso,
NO portable** — G-Mura debe conservar su `project_id = "gmura"`. Verificado en su
momento que la BD local de G-Mura NO tenía objetos de G-Pulso (`units`,
`repair_orders`, `is_service`, etc.) → el escape nunca llegó a contaminar sus
datos espejo, solo hacía que G-Pulso leyera los de G-Mura.

### Aislamiento del TOOLCHAIN de backup/reset — INCIDENTE 2026-07-28

**Segundo escape del aislamiento de la Fase 1, misma familia que el `project_id`
de arriba: el aislamiento cubrió el CÓDIGO y los SERVICIOS, pero no las
HERRAMIENTAS de operación.**

**Qué pasó.** Con el cliente ya operando en producción desde el 2026-07-25, se
pidió un reset de la tienda de CelFashion. Al ir a tomar el backup previo se
descubrió que `.env.backup` definía `GMURA_DB_URL` apuntando al proyecto Supabase
de **G-Mura producción** (ref `ouzdjs…`, org `La Bodega del Jeans`, 2 tiendas
reales). Todo el toolchain heredado leía esa variable:

- `scripts/backup-db.sh` — respaldaba G-Mura creyendo respaldar G-Pulso; generaba
  dumps con prefijo `gmura_`.
- `backups/REGISTRO.md` — titulado "BD producción G-Mura", con el historial de
  backups del OTRO cliente.
- `scripts/lab-restore.sh` / `lab-apply-migration.sh` — con fallback ciego al
  primer contenedor `supabase_db_*` que estuviera corriendo. Al probarlo, el
  único lab levantado en la máquina era **`supabase_db_gmura`**: el restore
  (que dropea y recarga el schema `public`) habría caído sobre el lab de G-Mura.

**Qué NO protegía.** `reset-test-data.sql` ya tenía una doble guarda
(`i_understand=YES` + `confirm_store_name`), pero ambas validan la **tienda
dentro de la base**, no la **base**. Con un `store_id` y el nombre exacto de una
tienda de G-Mura, las dos guardas habrían pasado limpias y el script habría
borrado ventas, caja e inventario reales de un cliente ajeno al proyecto.

**Cómo se detectó.** No por las guardas: por verificar a mano qué organizaciones
existían en la base antes de ejecutar. El `SELECT` devolvió `La Bodega del Jeans`
en vez de `CelFashion`.

**Fix (rama `fix/db-tooling-isolation`).**

| Script | Guarda añadida |
|--------|----------------|
| `reset-test-data.sql` | **GUARDA 0** de base, antes de leer nada y sin parámetro que la salte |
| `reset-store-data.sql` | Misma GUARDA 0 |
| `backup-db.sh` | `GPULSO_DB_URL` (aborta si encuentra `GMURA_DB_URL`) + verificación de identidad: advierte y exige confirmación interactiva |
| `apply-migrations-fresh.sh` | Guarda **inversa**: aborta si el destino ya tiene un tenant ajeno |
| `lab-restore.sh`, `lab-apply-migration.sh` | Eliminado el fallback ciego de contenedor; override consciente vía `LAB_DB_CONTAINER` |

Criterio de la GUARDA 0 (doble, ambas obligatorias): objetos **estructurales**
exclusivos de G-Pulso (`units`, `repair_orders`, `credit_commissions`) **Y** la
organización `CelFashion`. El primero descarta una base con esquema de G-Mura
aunque le crearan una org homónima; el segundo descarta una base de G-Pulso
virgen o ajena. Verificado con una matriz de 4 casos contra bases reales.

**Lección (la que importa para el próximo fork).** El aislamiento de un fork no
termina en el repo, el proyecto Supabase y el Vercel. Hay que auditar
explícitamente **todo lo que sostiene una credencial o un identificador del
proyecto de origen**: variables de entorno, scripts de backup y restore,
registros de backups, `project_id` del stack local, nombres de contenedor y
prefijos de archivo. Y las guardas de un script destructivo deben validar
**primero la base y después el objetivo dentro de ella** — una guarda sobre el
objetivo da una falsa sensación de seguridad cuando la conexión es la equivocada.

## Hallazgos a reportar a G-Mura (porteo de conocimiento inverso)

Cosas descubiertas trabajando en G-Pulso que le sirven a G-Mura.

- **El set de migraciones NO se reconstruye desde cero sin un workaround.** Al
  replayar 001…036 en una BD virgen aparecen dos fricciones que el dump de prod
  de G-Mura oculta (su lab se restaura de dump, no replaya migraciones):
  1. **Conflicto de orden en la 006:** la 003 crea la vista
     `daily_sales_summary` que depende de `orders.payment_method`, y la 006 hace
     un swap del tipo de esa columna → Postgres rechaza el `ALTER` mientras la
     vista exista. Se resuelve con `DROP VIEW IF EXISTS public.daily_sales_summary
     CASCADE;` **justo antes** de la 006 (la 033 la recrea; estado final idéntico).
  2. **`check_function_bodies = false`:** la 001 define funciones SQL que
     referencian `public.profiles` antes de crear la tabla → hay que aplicar con
     ese flag en off (como hace pg_restore / el runner de Supabase).
  En G-Pulso ambos se encapsulan en `scripts/apply-migrations-fresh.sh` sin tocar
  migraciones. **Recomendación para G-Mura:** si alguna vez necesita bootstrap
  limpio (nuevo entorno sin dump), usar el mismo workaround; o considerar squashear
  el baseline. Es porteo de conocimiento, no de código.

## Fixes porteados

Registro de fixes movidos A MANO entre G-Mura y G-Pulso (en cualquier sentido).

| Fecha | Commit G-Mura | Commit G-Pulso | Descripción |
|-------|---------------|----------------|-------------|
| _(vacío)_ | | | |
