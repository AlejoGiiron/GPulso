-- ============================================================
-- 20260728_1630 — repair_orders.status pasa a ser RPC-only (cierre de hueco de caja)
--
-- EL HUECO QUE CIERRA:
--   La política `repair_orders_update` (044) permite UPDATE de la fila completa
--   con solo `reparaciones.gestionar` + tienda propia. Nada impide escribir
--   `status` directamente. Con un PATCH por API:
--
--       PATCH /rest/v1/repair_orders?id=eq.<uuid>   { "status": "entregado" }
--
--   se salta `deliver_repair` POR COMPLETO: no crea la orden de venta, no
--   registra pagos, no imputa el turno. El equipo sale y el dinero nunca entra
--   al sistema. Además permite saltos ilegales (recibido → entregado directo):
--   el trigger `trg_log_repair_status_change` solo REGISTRA el cambio, no lo
--   valida, y no existe ningún CHECK de transición.
--
--   Es la misma clase de hueco que se cerró en `credit_commissions` (048) con
--   escritura RPC-only, y que quedó abierta acá. La guarda de precio para
--   'listo' vive solo en cliente (useRepairMutations) — saltable igual.
--
-- QUÉ HACE (tres piezas):
--   1. RPC `advance_repair_status(repair_id, nuevo_estado)` — SECURITY DEFINER,
--      atómica: permiso + tienda + TRANSICIÓN VÁLIDA + precio para 'listo' +
--      guarda de rowcount. RECHAZA 'entregado': a entregado solo se llega por
--      `deliver_repair`, que crea la venta y el pago.
--   2. Privilegios POR COLUMNA sobre repair_orders: `authenticated` deja de
--      poder escribir `status` (y `delivered_*` / `order_id`) por UPDATE
--      directo, conservando la edición de datos del equipo y `precio`.
--   3. CHECK `precio` obligatorio cuando el estado es 'listo' o 'entregado'
--      (cierra el bug de dejar el precio en NULL después de marcar 'listo').
--
-- POR QUÉ PRIVILEGIOS POR COLUMNA Y NO UNA POLÍTICA RLS:
--   Una política de UPDATE tiene USING (fila ANTIGUA) y WITH CHECK (fila NUEVA),
--   pero una expresión de política NO puede referenciar ambas: no hay OLD/NEW en
--   RLS. Por eso "status no puede cambiar" es INEXPRESABLE como policy. El
--   mecanismo nativo de Postgres para "este rol no puede escribir esta columna"
--   son los privilegios por columna (GRANT UPDATE (col,…)), que se COMPONEN con
--   RLS: hay que pasar los dos. La RPC es SECURITY DEFINER → corre como owner →
--   no la afecta el grant de columnas. Resultado: NINGÚN camino de cliente
--   escribe `status`.
--   (La alternativa era un trigger BEFORE UPDATE con un GUC de "vengo de la RPC";
--   se descartó: más frágil, y un GUC de sesión lo puede setear el propio
--   cliente, con lo que no cerraría nada.)
--
-- NO TOCA: deliver_repair (ya valida estado y precio, dos veces), el trigger de
--   historial, repair_parts, ni el flujo de recepción (INSERT).
--
-- Requiere: 044 (tablas + RLS) y 045 (RPCs del taller) aplicadas.
--
-- Cómo aplicar (lab): ./scripts/lab-apply-migration.sh 20260728_1630_repair_status_rpc_only.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0. Pre-chequeo de datos: el CHECK del paso 3 no puede nacer violado.
--    Si hay órdenes en 'listo'/'entregado' sin precio, aborta con instrucciones
--    en vez de fallar con un mensaje críptico de constraint.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_malas int;
BEGIN
  SELECT count(*) INTO v_malas
    FROM public.repair_orders
   WHERE status IN ('listo', 'entregado') AND precio IS NULL;

  IF v_malas > 0 THEN
    RAISE EXCEPTION E'ABORTADO: hay % orden(es) en listo/entregado con precio NULL.\n'
      '  Son datos que el hueco de esta migración permitió crear.\n'
      '  Revísalas y ponles precio ANTES de aplicar:\n'
      '    SELECT id, marca, modelo, status, created_at\n'
      '      FROM public.repair_orders\n'
      '     WHERE status IN (''listo'',''entregado'') AND precio IS NULL;',
      v_malas;
  END IF;
END
$$;


-- ------------------------------------------------------------
-- 1. RPC advance_repair_status — único camino de cliente para mover el estado.
--
--    Transiciones permitidas (sin saltos; un solo retroceso, auditado):
--      recibido      → en_reparacion
--      listo         → en_reparacion   (RETROCESO auditado)
--      en_reparacion → listo           (exige precio NOT NULL, releído de BD)
--      listo         → entregado       ✗ RECHAZADO acá (usar deliver_repair)
--
--    El precio se relee de la BD, no se acepta del llamador: la regla no depende
--    de que cada punto de avance (modal, kanban, o uno futuro) recuerde pasarlo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_repair_status(
  p_repair_id uuid,
  p_new_status public.repair_status
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_store    uuid := get_my_store_id();
  v_repair   record;
  v_allowed  public.repair_status[];
  v_rows     int;
BEGIN
  -- Sesión y permiso.
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT has_permission('reparaciones.gestionar') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar reparaciones.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_store IS NULL THEN
    RAISE EXCEPTION 'No hay tienda activa en tu sesión.' USING ERRCODE = 'check_violation';
  END IF;

  -- 'entregado' NO se alcanza por esta vía: la entrega crea venta + pago + turno.
  -- Se rechaza ANTES de leer nada, con un mensaje que dice a dónde ir.
  IF p_new_status = 'entregado' THEN
    RAISE EXCEPTION 'La entrega se registra con el cobro, no cambiando el estado. Usa la acción "Entregar y cobrar" (deliver_repair): crea la venta, el pago y lo imputa al turno.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- La orden debe ser de MI tienda. FOR UPDATE: bloquea la fila hasta el commit
  -- para que dos avances concurrentes no se pisen.
  SELECT * INTO v_repair
    FROM public.repair_orders
   WHERE id = p_repair_id AND store_id = v_store
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden de reparación no existe en esta tienda. repair_id=%', p_repair_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- No se toca una orden ya entregada (su historia está cobrada y asentada).
  IF v_repair.status = 'entregado' THEN
    RAISE EXCEPTION 'La reparación ya fue entregada: su estado no se modifica.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- VALIDACIÓN DE TRANSICIÓN: de qué estado(s) se PUEDE venir para llegar al
  -- pedido. `en_reparacion` admite DOS orígenes:
  --   · recibido → en_reparacion   (avance normal)
  --   · listo    → en_reparacion   (RETROCESO: el técnico marcó listo y al
  --                                 empacar detecta que algo quedó mal)
  -- El retroceso NO es un caso raro y sin él la única salida sería tocar la BD
  -- a mano. Queda AUDITADO: el trigger de historial (044) registra el paso con
  -- el usuario, igual que un avance.
  --
  -- Deliberadamente NO existe en_reparacion → recibido (no aporta nada
  -- operativo) ni ningún retroceso desde 'entregado' (ya está cobrado: se
  -- rechaza antes, en la guarda de arriba).
  v_allowed := CASE p_new_status
                 WHEN 'en_reparacion' THEN
                   ARRAY['recibido', 'listo']::public.repair_status[]
                 WHEN 'listo' THEN
                   ARRAY['en_reparacion']::public.repair_status[]
                 ELSE NULL
               END;

  IF v_allowed IS NULL THEN
    RAISE EXCEPTION 'Estado destino no válido para esta operación: %.', p_new_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (v_repair.status = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'Transición no permitida: % → %. Válidas: recibido → en_reparacion → listo, el retroceso listo → en_reparacion, y la entrega por cobro.',
      v_repair.status, p_new_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Guarda de precio para 'listo': la fuente de verdad es la BD, no el llamador.
  IF p_new_status = 'listo' AND v_repair.precio IS NULL THEN
    RAISE EXCEPTION 'Define el precio antes de marcar como listo.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Escritura con guarda atómica de rowcount (mismo patrón que deliver_repair).
  -- Se ata al estado EXACTO que leímos y validamos —no a "cualquiera de los
  -- permitidos"—: si algo lo movió entremedio, rowcount 0 → abortamos.
  UPDATE public.repair_orders
     SET status = p_new_status
   WHERE id = p_repair_id AND store_id = v_store AND status = v_repair.status;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'El estado de la reparación cambió mientras avanzabas. Recarga y reintenta. repair_id=%', p_repair_id
      USING ERRCODE = 'check_violation';
  END IF;
  -- El trigger trg_log_repair_status_change (044) registra el paso en el
  -- historial con auth.uid() — que sigue siendo el usuario real aunque la
  -- función sea SECURITY DEFINER (lee el claim del JWT, no el rol de ejecución).
END;
$$;

COMMENT ON FUNCTION public.advance_repair_status(uuid, public.repair_status) IS
  'Único camino de cliente para mover repair_orders.status. Valida permiso, tienda, transición (recibido→en_reparacion→listo, más el retroceso listo→en_reparacion; sin saltos) y precio para listo. RECHAZA entregado: eso lo hace deliver_repair, que crea venta y pago.';

REVOKE EXECUTE ON FUNCTION public.advance_repair_status(uuid, public.repair_status) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.advance_repair_status(uuid, public.repair_status) TO authenticated;


-- ------------------------------------------------------------
-- 2. Privilegios por columna: authenticated deja de escribir `status`.
--
--    Se revoca el UPDATE de tabla completa y se re-otorga SOLO sobre las
--    columnas que la UI edita legítimamente (useUpdateRepair: datos del equipo
--    + precio). Quedan FUERA, además de status:
--      · delivered_by / delivered_at / order_id → los escribe deliver_repair
--      · store_id / customer_id / received_by / created_at / id → inmutables
--
--    La RLS de la 044 sigue vigente y se sigue aplicando: son dos filtros
--    independientes que hay que pasar (columna permitida Y política).
-- ------------------------------------------------------------
REVOKE UPDATE ON public.repair_orders FROM authenticated;

GRANT UPDATE (
  marca,
  modelo,
  imei_serial,
  color,
  falla_reportada,
  checklist,
  observaciones,
  accesorios,
  password_equipo,
  precio
) ON public.repair_orders TO authenticated;

COMMENT ON COLUMN public.repair_orders.status IS
  'Estado de la reparación. NO escribible por authenticated (migración 20260728_1630): se mueve por advance_repair_status() y, para entregado, por deliver_repair().';


-- ------------------------------------------------------------
-- 2b. SEGUNDA CAPA — trigger que rechaza el cambio de `status` hecho por un rol
--     de cliente, independientemente de los GRANT.
--
--     POR QUÉ HACE FALTA SI YA ESTÁN LOS PRIVILEGIOS POR COLUMNA:
--       Los grants son revocables por accidente. En concreto,
--       `scripts/apply-migrations-fresh.sh --with-grants` ejecuta
--         GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES … TO authenticated;
--       DESPUÉS de aplicar las migraciones → un UPDATE de tabla completa que
--       PISA la restricción por columna del paso 2 y reabre el hueco sin que
--       nadie se entere. Lo mismo haría cualquier `GRANT ALL` futuro.
--
--     CÓMO DISTINGUE la RPC de un PATCH del cliente, sin GUCs:
--       Dentro de una función SECURITY DEFINER, `current_user` es el DUEÑO de la
--       función (postgres), no el rol de la sesión. En una petición de PostgREST
--       es `authenticated` (o `anon`). Por eso basta con rechazar el cambio de
--       status cuando current_user es un rol de cliente. No se puede falsear:
--       el cliente no puede cambiar su propio current_user.
--       (Un GUC de sesión SÍ sería falseable por el cliente — por eso se descartó.)
--
--     No estorba a: advance_repair_status y deliver_repair (SECURITY DEFINER →
--     current_user = postgres), las migraciones, ni el mantenimiento por psql.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_repair_status_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'El estado de una reparación no se cambia por escritura directa. Usa advance_repair_status() para avanzar, o deliver_repair() para entregar y cobrar.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_repair_status_write() IS
  'Segunda capa del cierre de la migración 20260728_1630: rechaza cambios de repair_orders.status hechos por un rol de cliente (authenticated/anon). Sobrevive a un GRANT ALL que reabra el privilegio de columna. Las RPCs SECURITY DEFINER corren como postgres y no la disparan.';

DROP TRIGGER IF EXISTS trg_guard_repair_status_write ON public.repair_orders;
CREATE TRIGGER trg_guard_repair_status_write
  BEFORE UPDATE OF status ON public.repair_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_repair_status_write();


-- ------------------------------------------------------------
-- 3. CHECK: precio obligatorio en 'listo' y 'entregado'.
--    Cierra el bug de useUpdateRepair (podía dejar precio en NULL una orden ya
--    marcada 'listo'). Es un invariante de tabla: protege también a las RPCs y a
--    cualquier camino futuro, no solo a la UI actual.
-- ------------------------------------------------------------
ALTER TABLE public.repair_orders
  DROP CONSTRAINT IF EXISTS repair_orders_precio_required_when_ready;

ALTER TABLE public.repair_orders
  ADD CONSTRAINT repair_orders_precio_required_when_ready
  CHECK (status NOT IN ('listo', 'entregado') OR precio IS NOT NULL);


-- ------------------------------------------------------------
-- 4. Autoverificación (aborta y revierte TODO si algo quedó mal)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_has_col_priv boolean;
  v_has_tbl_priv boolean;
BEGIN
  -- La RPC existe y es SECURITY DEFINER.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'advance_repair_status' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'advance_repair_status no quedó creada como SECURITY DEFINER.';
  END IF;

  -- authenticated NO puede escribir status…
  v_has_col_priv := has_column_privilege('authenticated', 'public.repair_orders', 'status', 'UPDATE');
  IF v_has_col_priv THEN
    RAISE EXCEPTION 'authenticated TODAVÍA puede escribir repair_orders.status — el hueco sigue abierto.';
  END IF;

  -- …ni delivered_at / order_id…
  IF has_column_privilege('authenticated', 'public.repair_orders', 'order_id', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated todavía puede escribir repair_orders.order_id.';
  END IF;

  -- …pero SÍ sigue pudiendo editar precio y datos del equipo (no rompimos la UI).
  IF NOT has_column_privilege('authenticated', 'public.repair_orders', 'precio', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated perdió el UPDATE sobre precio: rompería useUpdateRepair.';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.repair_orders', 'observaciones', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated perdió el UPDATE sobre observaciones: rompería useUpdateRepair.';
  END IF;

  -- El UPDATE de tabla completa NO debe existir (si existiera, cubriría status).
  v_has_tbl_priv := has_table_privilege('authenticated', 'public.repair_orders', 'UPDATE');
  IF v_has_tbl_priv AND has_column_privilege('authenticated', 'public.repair_orders', 'status', 'UPDATE') THEN
    RAISE EXCEPTION 'Quedó un UPDATE de tabla completa que reabre el hueco.';
  END IF;

  -- El CHECK de precio existe.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'repair_orders_precio_required_when_ready'
       AND conrelid = 'public.repair_orders'::regclass
  ) THEN
    RAISE EXCEPTION 'No quedó el CHECK repair_orders_precio_required_when_ready.';
  END IF;

  -- La segunda capa (trigger) está activa.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_guard_repair_status_write'
       AND tgrelid = 'public.repair_orders'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'No quedó el trigger trg_guard_repair_status_write (segunda capa).';
  END IF;

  RAISE NOTICE '20260728_1630 OK: status es RPC-only (advance_repair_status + deliver_repair); authenticated conserva precio y datos del equipo; CHECK de precio activo.';
END
$$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (correr como un usuario con reparaciones.gestionar,
-- NO como postgres: el owner no está sujeto ni a RLS ni a grants de columna)
-- ============================================================
-- 1. El hueco está cerrado — este UPDATE debe fallar con "permission denied":
--      UPDATE public.repair_orders SET status = 'entregado' WHERE id = '<uuid>';
--
-- 2. La edición legítima sigue viva — debe funcionar:
--      UPDATE public.repair_orders SET precio = 150000, observaciones = 'x'
--       WHERE id = '<uuid-de-una-recibida>';
--
-- 3. Avance legal:
--      SELECT public.advance_repair_status('<uuid>', 'en_reparacion');  -- OK
--      SELECT public.advance_repair_status('<uuid>', 'listo');          -- OK si hay precio
--
-- 4. Salto ilegal (debe abortar):
--      SELECT public.advance_repair_status('<uuid-recibida>', 'listo');
--      -- ERROR: Transición no permitida: recibido → listo
--
-- 5. Entrega por la vía equivocada (debe abortar con mensaje que redirige):
--      SELECT public.advance_repair_status('<uuid-lista>', 'entregado');
--      -- ERROR: La entrega se registra con el cobro…
--
-- 6. Precio nulo en una orden lista (debe abortar por el CHECK):
--      UPDATE public.repair_orders SET precio = NULL WHERE status = 'listo';
--      -- ERROR: viola la restricción repair_orders_precio_required_when_ready
--
-- 7. La entrega real sigue funcionando por su RPC:
--      SELECT public.deliver_repair('<uuid-lista>', '[{"method":"cash","amount":150000}]'::jsonb, 150000);
-- ============================================================


-- ============================================================
-- REVERSIÓN (si hiciera falta deshacer)
-- ============================================================
-- BEGIN;
--   ALTER TABLE public.repair_orders
--     DROP CONSTRAINT IF EXISTS repair_orders_precio_required_when_ready;
--   GRANT UPDATE ON public.repair_orders TO authenticated;   -- reabre el hueco
--   DROP FUNCTION IF EXISTS public.advance_repair_status(uuid, public.repair_status);
-- COMMIT;
-- ⚠ Revertir deja `status` escribible por API directa otra vez. Solo hacerlo si
--   el avance de estado quedó bloqueado en producción y hace falta operar ya.
-- ============================================================
