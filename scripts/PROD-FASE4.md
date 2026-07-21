# Procedimiento de producción — Fase 4 (comisiones por crédito)

> **Estado: BLOQUEADO.** No se ejecuta NADA contra `gpulso-prod` hasta el visto
> del smoke test humano + este procedimiento. Prod tiene datos reales de
> CelFashion.
>
> **Migraciones a aplicar:** `048` → `049` (las dos nuevas de la Fase 4). Prod ya
> está en `047` (Fase 3). Es un **apply incremental sobre una BD CON datos**, NO
> un replay desde cero.

---

## ⚠ Regla de seguridad (vigente)

La cadena de conexión de `gpulso-prod` **NO se escribe en ningún archivo**. Se
pega en la sesión de terminal como variable y se usa solo en línea de comandos:

```bash
export GPULSO_DB_URL='postgresql://…'   # la cadena real la das tú por chat
```

Todo se ejecuta vía Docker (`postgres:17`), igual que en `PROD-FASE3.md` §"TODO
se ejecuta vía Docker" — mismo patrón `MSYS_NO_PATHCONV=1 docker run --rm [-i]
-e GPULSO_DB_URL postgres:17 sh -c 'psql "$GPULSO_DB_URL" …'` con comillas
SIMPLES. No se repite aquí; consúltalo allá si hace falta.

---

## 0. Ventana recomendada

- **Fuera del horario de CelFashion**, idealmente tras el cierre de caja.
- La Fase 4 es de **bajo riesgo de swap**: la `048` solo CREA objetos nuevos
  (tabla, enum, RPC, triggers) y la `049` hace `CREATE OR REPLACE` de
  `canonical_role_permissions` + una reconciliación aditiva de permisos. **NO**
  toca funciones de la ruta de ventas ni de stock (a diferencia de la 044/045).
- Aun así, mejor en ventana muerta. Verifica que no haya turno abierto vendiendo:
  ```bash
  MSYS_NO_PATHCONV=1 docker run --rm -e GPULSO_DB_URL postgres:17 \
    sh -c 'psql "$GPULSO_DB_URL" -c "SELECT id, store_id, opened_at FROM public.cash_shifts WHERE closed_at IS NULL;"'
  ```

---

## 1. BACKUP PREVIO (obligatorio — no negociable)

Idéntico a `PROD-FASE3.md` §1 (verificar versión del servidor, dump `-F c` con
timestamp vía Docker a `backups/`, verificar `TABLE DATA > 0`, y tener el comando
de restore de emergencia a la vista). Usa el sufijo `pre-fase4`:

```bash
mkdir -p backups
export DUMP_NAME="gpulso_$(date +%Y%m%d_%H%M)_pre-fase4.dump"

MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W)/backups":/backups \
  -e GPULSO_DB_URL -e DUMP_NAME \
  postgres:17 \
  sh -c 'pg_dump --no-owner --no-acl -F c -f "/backups/$DUMP_NAME" "$GPULSO_DB_URL"'

ls -l "backups/$DUMP_NAME"
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/backups":/backups -e DUMP_NAME postgres:17 \
  sh -c 'pg_restore --list "/backups/$DUMP_NAME"' | grep -cE '\bTABLE DATA\b'   # > 0
```

Restore de emergencia (rompe-cristal, deja la BD en `047`): ver `PROD-FASE3.md`
§1.4 (mismo comando, tu dump `pre-fase4`).

---

## 2. Orden estricto: BD antes que frontend

```
a) backup (§1)  →  b) aplicar 048→049 (§2.1)  →  c) verificar (§3)  →
d) SOLO si c) pasa: merge a develop  →  Vercel despliega el frontend
```

### 2.1 Aplicar SOLO las migraciones pendientes (048→049)

```bash
set -e
for f in 048_credit_commissions \
         049_comisiones_permission; do
  echo "▶ Aplicando $f …"
  { echo "SET check_function_bodies = false;"; cat "supabase/migrations/${f}.sql"; } \
    | MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
        sh -c 'psql "$GPULSO_DB_URL" -v ON_ERROR_STOP=1 -q'
  echo "  ✔ $f aplicada"
done
echo "✔ 048→049 aplicadas."
```

Notas:

- **Ambas se auto-envuelven en `BEGIN;…COMMIT;`** (verificado). Con
  `ON_ERROR_STOP=1`, si una falla su transacción se revierte entera y el loop se
  detiene. No hay `ALTER TYPE … ADD VALUE` (el enum `commission_method` se CREA
  entero), así que **no** hay el caso aislado de la 043.
- **NO se necesita `--with-grants`**: prod es un proyecto Supabase real; las
  `ALTER DEFAULT PRIVILEGES` de la plataforma otorgan `authenticated` sobre la
  tabla nueva, y la RPC hereda `EXECUTE` de su `GRANT … TO authenticated` (048).
- Prerrequisitos ya presentes en prod: `get_my_store_id`/`get_my_organization_id`
  (013/020), `has_permission` (021), `cash_shifts` por tienda (026),
  `canonical_role_permissions`/`seed_org_roles` (035/046), `set_updated_at` (001).

---

## 3. Verificaciones post-migración (queries listas para pegar)

### 3.1 La tabla existe y tiene RLS activo

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT relname, relrowsecurity AS rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND relname = 'credit_commissions';
SQL
```
**Esperado:** 1 fila, `rls = t`.

### 3.2 La RPC existe + enum + CHECK de coherencia del efectivo

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
-- RPC
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND proname='register_credit_commission';
-- Enum
SELECT enum_range(NULL::commission_method)::text AS metodos;
-- CHECK: efectivo ⇒ shift_id NOT NULL / consignación ⇒ shift_id NULL
SELECT conname FROM pg_constraint
WHERE conrelid='public.credit_commissions'::regclass
  AND conname='credit_commissions_shift_coherent';
SQL
```
**Esperado:** `register_credit_commission` (1 fila) · `{efectivo,consignacion}` ·
`credit_commissions_shift_coherent` (1 fila).

### 3.3 CONTENIDO de la RPC (blindaje probado en lab, no solo existencia)

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
-- El turno se busca POR TIENDA (store_id + closed_at), SIN opened_by (regla de
-- create_order). Se ignoran los comentarios (líneas que tras recortar empiezan
-- por --) para no dar falso positivo con el texto "sin opened_by".
WITH code AS (
  SELECT btrim(l) AS l
  FROM regexp_split_to_table(
         pg_get_functiondef('public.register_credit_commission'::regproc), E'\n') AS l
  WHERE btrim(l) NOT LIKE '--%'
)
SELECT
  NOT EXISTS (SELECT 1 FROM code WHERE l ILIKE '%opened_by%')          AS turno_sin_opened_by,
  EXISTS (SELECT 1 FROM code
           WHERE l ILIKE '%cash_shifts%'
             AND l ILIKE '%store_id%'
             AND l ILIKE '%closed_at%')                                AS turno_por_tienda,
  EXISTS (SELECT 1 FROM code WHERE l ILIKE '%has_permission%comisiones.gestionar%') AS exige_permiso;
SQL
```
**Esperado:** los tres en `t`. Si `turno_por_tienda` diera `f` → la regla del
turno está rota: **detente**.

### 3.4 Política RLS de self-select del trabajador

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT polname,
       pg_get_expr(polqual, polrelid) LIKE '%worker_id%'      AS filtra_worker,
       pg_get_expr(polqual, polrelid) LIKE '%comisiones.gestionar%' AS filtra_permiso
FROM pg_policy
WHERE polrelid='public.credit_commissions'::regclass AND polname='credit_commissions_select';
SQL
```
**Esperado:** 1 fila con `filtra_worker = t` y `filtra_permiso = t` (el
trabajador ve lo suyo O quien gestiona ve todo).

### 3.5 ⭐ LA MÁS IMPORTANTE — CelFashion recibió comisiones.gestionar

La reconciliación de la `049` corre **sin filtro de organización**. Si NO alcanzó
a CelFashion, el Administrador no podría registrar comisiones y el reporte
quincenal quedaría vacío. Resolverlo **ANTES de deployar**.

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL"' <<'SQL'
SELECT o.name AS org, r.name AS rol,
       r.permissions ? '*'                     AS comodin,
       r.permissions ? 'comisiones.gestionar'  AS comisiones
FROM public.roles r
JOIN public.organizations o ON o.id = r.organization_id
WHERE r.name IN ('Dueño','Administrador','Vendedor','Técnico')
ORDER BY o.name, r.name;
SQL
```
**Esperado (para CelFashion y cualquier org):**

| rol | comodin | comisiones |
|-----|:---:|:---:|
| Dueño | t | (via *) |
| Administrador | f | **t** |
| Vendedor | f | f |
| Técnico | f | f |

Si el Administrador de CelFashion **no** tiene `comisiones.gestionar`, re-aplica
solo la `049` (idempotente/self-healing) y repite. Si aun así falla, **detente**.

---

## 4. Plan de contingencia (falla a mitad del chain)

| Falla en | Estado en que queda la BD | Decisión |
|----------|---------------------------|----------|
| 048 | Sigue en `047` | Fix-forward: reintenta desde 048. |
| 049 | En `048` (tabla + RPC ya viven, pero SIN permiso → módulo invisible para el Admin) | Fix-forward desde 049. **No deployes** hasta que §3.5 pase. |

**Criterio DURO de no-deploy:** si CUALQUIER verificación del §3 —muy en especial
§3.5 (CelFashion con `comisiones.gestionar`)— no da el esperado, **NO se mergea a
develop**.

---

## 5. Checklist de ejecución (día D)

- [ ] `docker pull postgres:17` hecho.
- [ ] Ventana fuera de horario; sin turno abierto vendiendo (§0).
- [ ] `GPULSO_DB_URL` pegada en la sesión, NO en archivo.
- [ ] Servidor confirmado en mayor 17.
- [ ] Backup `pre-fase4` generado y verificado (`TABLE DATA` > 0).
- [ ] Comando de restore de emergencia a la vista.
- [ ] 048→049 aplicadas con el loop `ON_ERROR_STOP=1` (§2.1).
- [ ] §3.1 tabla con RLS = t.
- [ ] §3.2 RPC + enum + CHECK de coherencia.
- [ ] §3.3 contenido: turno por tienda sin opened_by + exige permiso.
- [ ] §3.4 RLS self-select del trabajador.
- [ ] **§3.5 CelFashion Administrador con comisiones.gestionar.**
- [ ] TODO verde → merge a develop → Vercel despliega el frontend.
- [ ] Smoke post-deploy: registrar una comisión en efectivo bajo turno abierto →
      aparece en el cuadre como "COMISIONES DE CRÉDITO" y sube el efectivo
      esperado; registrar una de consignación → NO toca la caja; ver el reporte
      quincenal por trabajador.

---

## Cómo se paga al trabajador (NO hay módulo de nómina)

El pago quincenal al trabajador se registra como un **EGRESO de caja por la vía de
gastos ya existente** (no se inventó nómina):

1. En la barra superior, con turno abierto, botón **"Gasto"**.
2. Monto = el total que arroja el **reporte quincenal por trabajador** en
   Comisiones (columna "A pagar", `monto_trabajador` sumado del período).
3. Motivo: usar/crear uno como **"Pago comisiones"** (los motivos de egreso se
   gestionan en Configuración → Caja). En notas, el nombre del trabajador y la
   quincena.

Ese egreso baja el efectivo esperado del turno (es plata que sale del cajón),
igual que cualquier otro gasto. El módulo de Comisiones **no** genera el egreso
automáticamente: el reporte dice CUÁNTO, y el pago se asienta a mano por la caja
para que quede en el cuadre del día en que efectivamente se paga.

---

### Resumen de las 2 migraciones (para tu revisión final del SQL)

| Migración | Qué hace |
|-----------|----------|
| `048_credit_commissions` | enum `commission_method`; tabla `credit_commissions` (org por trigger, reparto con CHECK de coherencia, `shift_id` con CHECK efectivo⇒turno / consignación⇒NULL); índices; RLS (SELECT self-select del trabajador + gestionar; DELETE gestionar; sin INSERT/UPDATE directo); RPC `register_credit_commission` (atómica: valida permiso, reparto, org del trabajador/cliente, turno por tienda en efectivo). |
| `049_comisiones_permission` | `canonical_role_permissions` += `comisiones.gestionar` (Administrador; Dueño via *); reconciliación aditiva SIN filtro de org (alcanza a CelFashion). |

Tests que respaldan la fase:
- SQL (verde en lab): `scripts/test-credit-commission.sql` (atomicidad, turno,
  consignación, reparto, permiso, RLS self-select).
- Puros (Vitest): `src/lib/commissionCalc.test.ts` (reparto 50/50 y editable,
  redondeo, corte quincenal) y los casos de comisión en
  `src/lib/shiftCalc.test.ts` (efectivo sube el esperado sin inflar ventas;
  invariante del cuadre).
