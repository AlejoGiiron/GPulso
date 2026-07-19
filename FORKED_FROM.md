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
   Las órdenes se crean con varios INSERT secuenciales desde el cliente y un
   rollback compensatorio manual, no en una transacción de servidor.
   **Pendiente:** RPC `create_order` (transacción atómica en Postgres).

3. **Tipado de Supabase decorativo** (~400 casts `as unknown as ...`).
   `src/types/database.types.ts` está hecho a mano y no infiere relaciones
   embebidas, obligando a castear en cada query con join.
   **Pendiente:** `supabase gen types typescript` + limpieza de casts.

4. **Imputación de turnos duplicada.**
   `useShiftClosing` y `useShiftHistory` reimplementan por separado la lógica de
   qué ventas/abonos/gastos caen en la ventana de un turno.
   **Pendiente:** unificar en una sola fuente (idealmente una vista o RPC).

## Migraciones específicas de G-Pulso (NO portables a G-Mura)

Migraciones nuevas que solo tienen sentido en G-Pulso y **jamás** deben aplicarse
en G-Mura.

| Migración | Por qué NO es portable |
|-----------|------------------------|
| `038_drop_inherited_bootstrap_org.sql` | Elimina la org `La Bodega del Jeans`, que en una BD virgen de G-Pulso queda como cascarón vacío (la crea la heredada 020). **En G-Mura esa org es el tenant REAL en producción** → aplicarla allá borraría datos del cliente. Exclusiva de G-Pulso. Tiene guardas (solo borra si no hay tiendas ni profiles), pero el aislamiento es por diseño. |

> Contraste: la migración `037_active_user_enforcement.sql` SÍ es portable (ver
> "Deudas heredadas" #1) — es candidata a portear en sentido inverso a G-Mura.

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
