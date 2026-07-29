# Procedimiento de producción — `repair_orders.status` RPC-only

> **Estado: BLOQUEADO.** No se ejecuta NADA contra `gpulso-prod` hasta el visto
> del smoke test humano. Prod tiene datos reales de CelFashion desde el
> 2026-07-25.
>
> **Migración a aplicar:** `20260728_1630_repair_status_rpc_only.sql` (una sola).
> Es un **apply incremental sobre una BD CON datos**, NO un replay desde cero.

---

## ⚠ ORDEN DE DESPLIEGUE (leer antes que nada)

Esta migración va **DESPUÉS** del rediseño de serializados:

```
053 → 054 → 055 → 056   (feature/rediseno-serializados)   ← PRIMERO
20260728_1630_repair_status_rpc_only                       ← DESPUÉS
```

Es la primera migración con **prefijo de timestamp** (ver `CLAUDE.md` §
Numeración de migraciones). No depende funcionalmente del rediseño, pero el
orden importa para que el historial de migraciones quede coherente con el orden
lexicográfico que usa `apply-migrations-fresh.sh`.

---

## ⚠ VENTANA DE INCOMPATIBILIDAD BD ↔ FRONTEND (lo más importante)

**La migración y el frontend nuevo NO son intercambiables.** El frontend que
está publicado hoy avanza el estado con un `UPDATE` directo sobre
`repair_orders`; la migración le revoca ese privilegio.

| Momento | Qué pasa |
|---|---|
| Migración aplicada, Vercel **aún con el build viejo** | "Pasar a …" falla con *permission denied*. Recepción, edición de precio, repuestos y **Entregar y cobrar siguen funcionando** (deliver_repair no cambió). |
| Build nuevo publicado, migración **sin aplicar** | Peor: la RPC no existe → **todo** avance de estado falla. |

**Por eso el orden es: migración PRIMERO, deploy de Vercel INMEDIATAMENTE
DESPUÉS.** La exposición se limita a un botón, unos minutos, y en ventana muerta.

> **Si quieres cero ventana** (opcional, no recomendado por complejidad): la
> migración está escrita para poder partirse en dos. El bloque **1** (crear la
> RPC) es compatible hacia atrás y se puede aplicar días antes; los bloques
> **2 / 2b / 3** (revocar privilegio + trigger + CHECK) se aplican después de que
> el build nuevo esté publicado. Si eliges esto, córtalo en dos archivos y
> vuelve a correr el gate: NO improvises el corte en caliente.

---

## ⚠ Regla de seguridad (vigente)

La cadena de conexión de `gpulso-prod` **NO se escribe en ningún archivo**. Se
pega en la sesión de terminal y se usa solo en línea de comandos:

```bash
export GPULSO_DB_URL='postgresql://…'
```

Mismo patrón Docker que `PROD-FASE3.md` / `PROD-FASE4.md`:
`MSYS_NO_PATHCONV=1 docker run --rm [-i] -e GPULSO_DB_URL postgres:17 sh -c 'psql "$GPULSO_DB_URL" …'`
con comillas SIMPLES.

> Si tienes `psql` local (PostgreSQL 17 en `C:\Program Files\PostgreSQL\17\bin`)
> puedes usarlo directamente en vez de Docker; el resto del procedimiento es
> idéntico.

---

## 0. Ventana recomendada

- **Fuera del horario de CelFashion**, tras el cierre de caja.
- Riesgo de swap **bajo**: la migración CREA objetos (RPC, trigger, CHECK) y
  cambia GRANTs. **No** reescribe `deliver_repair`, ni el trigger de historial,
  ni nada de la ruta de ventas o de stock.
- Verifica que no haya turno abierto:
  ```bash
  MSYS_NO_PATHCONV=1 docker run --rm -e GPULSO_DB_URL postgres:17 \
    sh -c 'psql "$GPULSO_DB_URL" -c "SELECT id, store_id, opened_at FROM public.cash_shifts WHERE closed_at IS NULL;"'
  ```
- Verifica que no haya reparaciones a medio flujo que alguien esté moviendo:
  ```bash
  MSYS_NO_PATHCONV=1 docker run --rm -e GPULSO_DB_URL postgres:17 \
    sh -c 'psql "$GPULSO_DB_URL" -c "SELECT status, count(*) FROM public.repair_orders GROUP BY status ORDER BY status;"'
  ```

---

## 1. BACKUP PREVIO (obligatorio — no negociable)

```bash
mkdir -p backups
export DUMP_NAME="gpulso_$(date +%Y%m%d_%H%M)_pre-repair-status-rpc.dump"

MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd -W)/backups":/backups \
  -e GPULSO_DB_URL -e DUMP_NAME \
  postgres:17 \
  sh -c 'pg_dump --no-owner --no-acl -F c -f "/backups/$DUMP_NAME" "$GPULSO_DB_URL"'

ls -l "backups/$DUMP_NAME"
```

Verifica que el dump tenga contenido real (debe imprimir un número > 0):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/backups":/backups -e DUMP_NAME postgres:17 \
  sh -c 'pg_restore --list "/backups/$DUMP_NAME" | grep -c "TABLE DATA"'
```

> Alternativa con tooling local: `./scripts/backup-db.sh pre-repair-status-rpc`
> (ya verifica identidad de la base, tamaño, `pg_restore --list` y registra en
> `backups/REGISTRO.md`). Requiere `GPULSO_DB_URL` en `.env.backup` o exportada.

---

## 2. PRE-CHEQUEO DE DATOS (la migración aborta sola si falla, pero mejor saberlo antes)

El paso 3 de la migración añade un CHECK que exige precio en `listo`/`entregado`.
Si hay filas que ya lo violan —datos que el propio hueco permitió crear— la
migración **aborta y revierte** con instrucciones. Compruébalo antes:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL" -c "
    SELECT id, marca, modelo, status, created_at
      FROM public.repair_orders
     WHERE status IN (''listo'',''entregado'') AND precio IS NULL
     ORDER BY created_at;"'
```

- **0 filas** → adelante.
- **Con filas** → ponles precio antes de aplicar (son órdenes reales sin precio;
  decide el valor con el negocio, no inventes uno):
  ```sql
  UPDATE public.repair_orders SET precio = <valor> WHERE id = '<uuid>';
  ```

---

## 3. APLICAR LA MIGRACIÓN

Va entera en una transacción (`BEGIN … COMMIT`) con autoverificación al final:
si algo queda mal, revierte todo y no deja nada a medias.

```bash
MSYS_NO_PATHCONV=1 docker run --rm -i -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL" -v ON_ERROR_STOP=1 -f -' \
  < supabase/migrations/20260728_1630_repair_status_rpc_only.sql
```

**Salida esperada** (la última línea de NOTICE es la autoverificación):

```
NOTICE:  20260728_1630 OK: status es RPC-only (advance_repair_status + deliver_repair);
         authenticated conserva precio y datos del equipo; CHECK de precio activo.
COMMIT
```

Si ves `ROLLBACK` o cualquier `ERROR`, **detente**: no se aplicó nada. Lee el
mensaje (está redactado para decir qué falta) y resuelve antes de reintentar.

---

## 4. VERIFICACIONES (correr TODAS)

### 4.1 ⭐ LA CRÍTICA — el hueco está cerrado

Las dos que pediste. **`authenticated` no debe poder escribir `status`, y el
trigger de segunda capa debe existir.**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL" -c "
    SELECT
      has_column_privilege(''authenticated'',''public.repair_orders'',''status'',''UPDATE'')   AS status_escribible,
      has_column_privilege(''authenticated'',''public.repair_orders'',''order_id'',''UPDATE'') AS order_id_escribible,
      EXISTS (SELECT 1 FROM pg_trigger
               WHERE tgname = ''trg_guard_repair_status_write''
                 AND tgrelid = ''public.repair_orders''::regclass
                 AND NOT tgisinternal)                                                        AS trigger_capa2,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = ''public'' AND p.proname = ''advance_repair_status''
                 AND p.prosecdef)                                                             AS rpc_definer;"'
```

**Esperado — las cuatro columnas exactamente así:**

| status_escribible | order_id_escribible | trigger_capa2 | rpc_definer |
|:---:|:---:|:---:|:---:|
| **f** | **f** | **t** | **t** |

> Si `status_escribible` sale **t**, el hueco sigue abierto: **no continúes**,
> revisa si algo re-otorgó `GRANT UPDATE` sobre la tabla completa.

### 4.2 La UI legítima no se rompió

`authenticated` debe conservar la escritura de precio y datos del equipo:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL" -c "
    SELECT
      has_column_privilege(''authenticated'',''public.repair_orders'',''precio'',''UPDATE'')        AS precio,
      has_column_privilege(''authenticated'',''public.repair_orders'',''observaciones'',''UPDATE'') AS observaciones,
      has_column_privilege(''authenticated'',''public.repair_orders'',''imei_serial'',''UPDATE'')   AS imei;"'
```

**Esperado:** las tres en **t**.

### 4.3 El CHECK de precio está activo

```bash
MSYS_NO_PATHCONV=1 docker run --rm -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL" -c "
    SELECT conname, pg_get_constraintdef(oid) AS definicion
      FROM pg_constraint
     WHERE conrelid = ''public.repair_orders''::regclass
       AND conname = ''repair_orders_precio_required_when_ready'';"'
```

**Esperado:** 1 fila, con la definición literal (verificada en lab):

```
CHECK (((status <> ALL (ARRAY['listo'::repair_status, 'entregado'::repair_status])) OR (precio IS NOT NULL)))
```

### 4.4 Los datos quedaron intactos

La migración no toca filas. El conteo por estado debe ser **idéntico** al del
paso 0:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -e GPULSO_DB_URL postgres:17 \
  sh -c 'psql "$GPULSO_DB_URL" -c "SELECT status, count(*) FROM public.repair_orders GROUP BY status ORDER BY status;"'
```

---

## 5. DEPLOY DEL FRONTEND (inmediatamente después)

Mergear `fix/repair-status-rpc-only` → `develop` y dejar que Vercel publique.
**Hasta que el build nuevo esté vivo, el botón de avanzar estado falla** (ver
§ Ventana de incompatibilidad).

Confirma que el deploy terminó antes de dar por cerrado el procedimiento.

---

## 6. SMOKE EN PRODUCCIÓN (con la UI nueva ya publicada)

Con un usuario real que tenga `reparaciones.gestionar`:

1. **Avance normal.** Recibir un equipo de prueba → "Pasar a En reparación" →
   ponerle precio → "Pasar a Listo". Debe funcionar sin errores.
2. **Precio faltante.** En otra orden sin precio, intentar "Pasar a Listo".
   → Debe decir *"Define el precio antes de marcar como listo."*
3. ⭐ **Retroceso.** En la orden en `listo`, pulsar **"Devolver a reparación"**.
   → Confirmación corta → vuelve a *En reparación* → toast *"Devuelta a
   reparación"* → el tablero se refresca solo.
4. **El retroceso quedó auditado.** Abrir el historial de esa orden: debe
   aparecer el paso a `en_reparacion` **dos veces**, con usuario y hora.
5. **La entrega sigue funcionando.** Volver la orden a `listo` y usar
   **"Entregar y cobrar"** → crea la venta, el pago entra al turno, la orden
   queda `entregado`.
6. **Limpieza.** La orden de prueba queda como venta real en el historial: usa
   un monto simbólico y anótalo, o hazlo con una reparación real del día.

---

## 7. ROLLBACK (si algo sale mal)

### 7.1 Rollback quirúrgico (preferido)

Deshace solo esta migración, sin tocar datos:

```sql
BEGIN;
  DROP TRIGGER IF EXISTS trg_guard_repair_status_write ON public.repair_orders;
  DROP FUNCTION IF EXISTS public.guard_repair_status_write();
  ALTER TABLE public.repair_orders
    DROP CONSTRAINT IF EXISTS repair_orders_precio_required_when_ready;
  GRANT UPDATE ON public.repair_orders TO authenticated;
  DROP FUNCTION IF EXISTS public.advance_repair_status(uuid, public.repair_status);
COMMIT;
```

> ⚠ **Esto REABRE el hueco de caja**: `status` vuelve a ser escribible por API
> directa y se puede marcar `entregado` sin cobrar. Solo hazlo si el avance de
> estado quedó bloqueado en producción y hay que operar ya. Si haces rollback de
> la BD, **también hay que revertir el deploy del frontend** (el build nuevo
> llama a una RPC que ya no existiría).

### 7.2 Restore completo (último recurso)

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)/backups":/backups \
  -e GPULSO_DB_URL -e DUMP_NAME postgres:17 \
  sh -c 'pg_restore --clean --if-exists --no-owner --no-acl -d "$GPULSO_DB_URL" "/backups/$DUMP_NAME"'
```

Pierde todo lo ocurrido desde el backup. Por eso la ventana es fuera de horario.

---

## 8. Checklist de cierre

- [ ] Backup tomado y verificado (`TABLE DATA` > 0)
- [ ] Pre-chequeo de datos: 0 órdenes en listo/entregado sin precio
- [ ] Migración aplicada con `COMMIT` y NOTICE de autoverificación
- [ ] § 4.1 — `status_escribible = f`, `order_id_escribible = f`, `trigger_capa2 = t`, `rpc_definer = t`
- [ ] § 4.2 — precio / observaciones / imei siguen escribibles (`t`)
- [ ] § 4.3 — CHECK presente
- [ ] § 4.4 — conteo por estado idéntico al inicial
- [ ] Frontend desplegado en Vercel
- [ ] Smoke § 6 completo, incluido el retroceso y su rastro en el historial
- [ ] Anotado en `CLAUDE.md` (estado del proyecto) y en `FORKED_FROM.md` si aplica
