-- ============================================================
-- 039 — FASE 2: Inventario serializado (unidades IMEI/serial)
--
-- Monta una CAPA DE UNIDADES sobre las variantes existentes. Cada equipo
-- serializado (celular con IMEI, cómputo con serial) es una fila en `units`.
-- Los accesorios NO cambian: siguen por cantidad (variants.stock_qty editado
-- por los triggers heredados).
--
-- PRINCIPIOS (no negociables):
--   · Las unidades cuelgan de variants; order_items/stock/reportes NO se
--     reescriben.
--   · UNA fuente de verdad del stock serializado = tabla `units`.
--     variants.stock_qty de una variante SERIALIZADA es DERIVADO: lo mantiene
--     el trigger de sincronización como COUNT(*) de unidades 'disponible'.
--     Nunca se edita a mano para serializados → toda la UI/reportes heredados
--     siguen leyendo variants.stock_qty sin cambios.
--   · Ningún equipo serializado se vende sin unidad asignada (guardia atómica
--     claim_unit).
--
-- DECISIÓN DE MODELADO PARA REVISIÓN (no listada en A2, necesaria para A5):
--   units.layaway_id (FK NULL). Sin un vínculo unidad↔separado no se puede
--   implementar el ciclo reservar→cancelar→completar de A5 de forma robusta
--   (el trigger de liberación necesita saber qué unidades soltar). Se agrega
--   siguiendo el mismo patrón que order_item_id. Si preferís otro modelado,
--   avisá antes de prod.
--
-- Requiere: 001 (variants, order_items, stock_movements, movement_type,
--   deduct/restore triggers), 008 (layaways, reserved_qty, triggers de
--   reserva), 011 (purchase_invoice_items, increase_stock_on_purchase),
--   020 (get_my_organization_id), 013 (get_my_store_id), 021 (has_permission).
--
-- Atomicidad: todo en una transacción. Idempotente donde aplica (IF NOT EXISTS,
--   CREATE OR REPLACE, DROP POLICY IF EXISTS).
--
-- Cómo aplicar (lab): ./scripts/apply-migrations-fresh.sh (chain completo) o
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/039_serialized_units.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- A1. products.is_serialized
-- ------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_serialized boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.is_serialized IS
  'true = cada unidad es única y rastreable (IMEI/serial), stock por units. false = accesorio por cantidad. No editable si el producto ya tiene unidades o ventas (trigger enforce_is_serialized_immutable).';

-- Guardia en BD: is_serialized no cambia si el producto ya tiene unidades o
-- ventas (order_items de sus variantes). No solo en UI.
CREATE OR REPLACE FUNCTION public.enforce_is_serialized_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_serialized IS DISTINCT FROM OLD.is_serialized THEN
    IF EXISTS (
      SELECT 1 FROM public.units u
        JOIN public.variants v ON v.id = u.variant_id
       WHERE v.product_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'No se puede cambiar is_serialized: el producto ya tiene unidades.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.order_items oi
        JOIN public.variants v ON v.id = oi.variant_id
       WHERE v.product_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'No se puede cambiar is_serialized: el producto ya tiene ventas.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_is_serialized_immutable ON public.products;
CREATE TRIGGER trg_enforce_is_serialized_immutable
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION enforce_is_serialized_immutable();


-- ------------------------------------------------------------
-- A2. Enum unit_status + tabla units
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unit_status') THEN
    CREATE TYPE unit_status AS ENUM ('disponible', 'reservada', 'vendida');
  END IF;
END $$;

COMMENT ON TYPE unit_status IS
  'Estado de una unidad serializada. Enum EXTENSIBLE (a futuro p.ej. en_revision); no agregar valores hasta que se necesiten.';

CREATE TABLE IF NOT EXISTS public.units (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id                 uuid        NOT NULL REFERENCES public.stores(id)        ON DELETE CASCADE,
  variant_id               uuid        NOT NULL REFERENCES public.variants(id)      ON DELETE CASCADE,
  serial                   text        NOT NULL,
  status                   unit_status NOT NULL DEFAULT 'disponible',
  cost                     numeric(12,2),
  purchase_invoice_item_id uuid        REFERENCES public.purchase_invoice_items(id) ON DELETE SET NULL,
  order_item_id            uuid        REFERENCES public.order_items(id)            ON DELETE SET NULL,
  layaway_id               uuid        REFERENCES public.layaways(id)               ON DELETE SET NULL,
  notas                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT units_cost_non_negative CHECK (cost IS NULL OR cost >= 0),
  CONSTRAINT units_serial_not_blank  CHECK (length(btrim(serial)) > 0),
  -- El serial vive UNA sola vez por organización. Devolver una unidad REUSA su
  -- fila (vuelve a 'disponible'); nunca se crea otra con el mismo serial.
  CONSTRAINT units_serial_unique_per_org UNIQUE (organization_id, serial)
);

COMMENT ON TABLE public.units IS
  'Unidades serializadas (IMEI/serial) sobre variantes. Fuente de verdad del stock de productos serializados; variants.stock_qty se deriva por trigger.';

CREATE INDEX IF NOT EXISTS idx_units_variant_id      ON public.units(variant_id);
CREATE INDEX IF NOT EXISTS idx_units_store_id        ON public.units(store_id);
CREATE INDEX IF NOT EXISTS idx_units_status          ON public.units(status);
CREATE INDEX IF NOT EXISTS idx_units_order_item_id   ON public.units(order_item_id);
CREATE INDEX IF NOT EXISTS idx_units_layaway_id      ON public.units(layaway_id);
-- Búsqueda global por serial (Bloque C3): serial vive una vez por org.
CREATE INDEX IF NOT EXISTS idx_units_serial          ON public.units(serial);

-- updated_at
DROP TRIGGER IF EXISTS trg_units_updated_at ON public.units;
CREATE TRIGGER trg_units_updated_at
  BEFORE UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- organization_id se DERIVA de la tienda (evita inconsistencias org<->store).
CREATE OR REPLACE FUNCTION public.units_set_org_from_store()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id
    FROM public.stores WHERE id = NEW.store_id;
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'units: la tienda % no tiene organización.', NEW.store_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_units_set_org ON public.units;
CREATE TRIGGER trg_units_set_org
  BEFORE INSERT ON public.units
  FOR EACH ROW EXECUTE FUNCTION units_set_org_from_store();


-- ------------------------------------------------------------
-- RLS de units (aislamiento por tienda + gestión por permiso)
-- ------------------------------------------------------------
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS units_select ON public.units;
CREATE POLICY units_select ON public.units FOR SELECT
  USING (store_id = get_my_store_id());

DROP POLICY IF EXISTS units_insert ON public.units;
CREATE POLICY units_insert ON public.units FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('inventario.gestionar'));

DROP POLICY IF EXISTS units_update ON public.units;
CREATE POLICY units_update ON public.units FOR UPDATE
  USING (store_id = get_my_store_id() AND has_permission('inventario.gestionar'))
  WITH CHECK (store_id = get_my_store_id() AND has_permission('inventario.gestionar'));

DROP POLICY IF EXISTS units_delete ON public.units;
CREATE POLICY units_delete ON public.units FOR DELETE
  USING (store_id = get_my_store_id() AND has_permission('inventario.gestionar'));


-- ------------------------------------------------------------
-- Helper: ¿la variante pertenece a un producto serializado?
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_serialized_variant(p_variant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT p.is_serialized
       FROM public.variants v
       JOIN public.products p ON p.id = v.product_id
      WHERE v.id = p_variant_id),
    false);
$$;


-- ------------------------------------------------------------
-- A3. Sincronización: variants.stock_qty = COUNT(unidades 'disponible')
--     Se dispara en cualquier INSERT/UPDATE/DELETE de units.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_variant_stock_from_units()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant uuid;
BEGIN
  v_variant := COALESCE(NEW.variant_id, OLD.variant_id);

  UPDATE public.variants
     SET stock_qty = (
           SELECT count(*) FROM public.units
            WHERE variant_id = v_variant AND status = 'disponible'
         )
   WHERE id = v_variant;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_variant_stock_from_units ON public.units;
CREATE TRIGGER trg_sync_variant_stock_from_units
  AFTER INSERT OR UPDATE OR DELETE ON public.units
  FOR EACH ROW EXECUTE FUNCTION sync_variant_stock_from_units();


-- ------------------------------------------------------------
-- Guardas en los triggers de cantidad heredados: NO tocar variants de
-- productos serializados (su stock lo maneja la capa de unidades). Para
-- accesorios (no serializados) el comportamiento es IDÉNTICO al de G-Mura.
-- Se redefinen con CREATE OR REPLACE (patrón sancionado; sin editar archivos
-- heredados). Solo se agrega un early-return al inicio.
-- ------------------------------------------------------------

-- deduct_stock_on_sale (001): serializado → no descuenta ni loguea; el
-- movimiento y el descuento los maneja claim_unit / complete_reserved_unit.
CREATE OR REPLACE FUNCTION deduct_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id      uuid;
  v_created_by    uuid;
  v_current_stock integer;
BEGIN
  IF public.is_serialized_variant(NEW.variant_id) THEN
    RETURN NEW;  -- stock serializado = capa de unidades
  END IF;

  SELECT store_id, created_by INTO v_store_id, v_created_by
    FROM public.orders WHERE id = NEW.order_id;

  SELECT stock_qty INTO v_current_stock
    FROM public.variants WHERE id = NEW.variant_id;

  IF v_current_stock < NEW.qty THEN
    RAISE EXCEPTION 'Stock insuficiente para la variante %. Disponible: %, Requerido: %',
      NEW.variant_id, v_current_stock, NEW.qty;
  END IF;

  UPDATE public.variants SET stock_qty = stock_qty - NEW.qty WHERE id = NEW.variant_id;

  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, created_by)
  VALUES (NEW.variant_id, v_store_id, 'sale', -NEW.qty, NEW.order_id, v_created_by);

  RETURN NEW;
END;
$$;

-- restore_stock_on_return (001): serializado → no incrementa; restore_returned_unit
-- maneja la unidad y su movimiento (necesita el unit_id, que el trigger no tiene).
CREATE OR REPLACE FUNCTION restore_stock_on_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id   uuid;
  v_created_by uuid;
BEGIN
  IF public.is_serialized_variant(NEW.variant_id) THEN
    RETURN NEW;
  END IF;

  SELECT store_id, created_by INTO v_store_id, v_created_by
    FROM public.returns WHERE id = NEW.return_id;

  UPDATE public.variants SET stock_qty = stock_qty + NEW.qty WHERE id = NEW.variant_id;

  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, created_by)
  VALUES (NEW.variant_id, v_store_id, 'return', NEW.qty, NEW.return_id, v_created_by);

  RETURN NEW;
END;
$$;

-- reserve_stock_on_layaway (008): serializado → no toca reserved_qty; la reserva
-- de una unidad se hace con reserve_unit (status='reservada').
CREATE OR REPLACE FUNCTION reserve_stock_on_layaway()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available integer;
BEGIN
  IF public.is_serialized_variant(NEW.variant_id) THEN
    RETURN NEW;
  END IF;

  SELECT (stock_qty - reserved_qty) INTO v_available
    FROM public.variants WHERE id = NEW.variant_id;

  IF v_available < NEW.qty THEN
    RAISE EXCEPTION 'Stock insuficiente para la variante %. Disponible: %, requerido: %',
      NEW.variant_id, v_available, NEW.qty;
  END IF;

  UPDATE public.variants SET reserved_qty = reserved_qty + NEW.qty WHERE id = NEW.variant_id;
  RETURN NEW;
END;
$$;

-- release_stock_on_layaway_change (008): serializado → no toca reserved_qty; las
-- unidades reservadas de ESE separado vuelven a 'disponible' (por units.layaway_id).
CREATE OR REPLACE FUNCTION release_stock_on_layaway_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status IN ('cancelled', 'expired') THEN
    -- Cantidad (accesorios): descuenta reserved_qty solo de variantes NO serializadas.
    UPDATE public.variants v
       SET reserved_qty = reserved_qty - li.qty
      FROM public.layaway_items li
     WHERE li.layaway_id = NEW.id
       AND li.variant_id = v.id
       AND NOT public.is_serialized_variant(li.variant_id);

    -- Serializado: las unidades reservadas para este separado vuelven a disponible.
    UPDATE public.units
       SET status = 'disponible', layaway_id = NULL
     WHERE layaway_id = NEW.id AND status = 'reservada';
  END IF;
  RETURN NEW;
END;
$$;

-- fulfill_stock_on_layaway_completion (008): serializado → no toca reserved_qty
-- (las unidades se marcan 'vendida' con complete_reserved_unit cuando la UI crea
-- la orden). Para accesorios, comportamiento heredado.
CREATE OR REPLACE FUNCTION fulfill_stock_on_layaway_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'completed' THEN
    UPDATE public.variants v
       SET reserved_qty = reserved_qty - li.qty
      FROM public.layaway_items li
     WHERE li.layaway_id = NEW.id
       AND li.variant_id = v.id
       AND NOT public.is_serialized_variant(li.variant_id);
  END IF;
  RETURN NEW;
END;
$$;

-- increase_stock_on_purchase (011): serializado → NO incrementa stock_qty (lo hará
-- la sincronización al insertar las unidades). Opcionalmente actualiza cost_price
-- si update_cost. NO loguea 'purchase' aquí (la recepción de seriales lo hará por
-- unidad en el Bloque C). Para accesorios, comportamiento heredado.
CREATE OR REPLACE FUNCTION increase_stock_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id   uuid;
  v_created_by uuid;
BEGIN
  IF public.is_serialized_variant(NEW.variant_id) THEN
    IF NEW.update_cost THEN
      UPDATE variants SET cost_price = NEW.unit_cost WHERE id = NEW.variant_id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT store_id, created_by INTO v_store_id, v_created_by
  FROM purchase_invoices WHERE id = NEW.invoice_id;

  IF NEW.update_cost THEN
    UPDATE variants SET stock_qty = stock_qty + NEW.qty, cost_price = NEW.unit_cost
     WHERE id = NEW.variant_id;
  ELSE
    UPDATE variants SET stock_qty = stock_qty + NEW.qty WHERE id = NEW.variant_id;
  END IF;

  INSERT INTO stock_movements (variant_id, store_id, type, qty, reference_id, created_by)
  VALUES (NEW.variant_id, v_store_id, 'purchase', NEW.qty, NEW.invoice_id, v_created_by);

  RETURN NEW;
END;
$$;


-- ------------------------------------------------------------
-- A4. claim_unit — guardia de venta ATÓMICA (el blindaje de la fase).
--   Marca una unidad 'disponible' → 'vendida'. Si otro POS ya la tomó, el
--   rowcount es 0 y RAISE: la línea de venta DEBE fallar, nunca continuar.
--   SECURITY DEFINER + chequeo de tienda (get_my_store_id). Registra el
--   movimiento 'sale' para el rastro de la unidad (Bloque E).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_unit(p_unit_id uuid, p_order_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant uuid;
  v_store   uuid;
  v_order   uuid;
  v_rows    integer;
BEGIN
  UPDATE public.units
     SET status = 'vendida', order_item_id = p_order_item_id, layaway_id = NULL
   WHERE id = p_unit_id
     AND status = 'disponible'
     AND store_id = get_my_store_id()
  RETURNING variant_id, store_id INTO v_variant, v_store;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'La unidad ya no está disponible (otra caja la tomó o no existe en esta tienda). unit_id=%', p_unit_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT order_id INTO v_order FROM public.order_items WHERE id = p_order_item_id;

  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, created_by)
  VALUES (v_variant, v_store, 'sale', -1, v_order, auth.uid());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_unit(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.claim_unit(uuid, uuid) TO authenticated;


-- ------------------------------------------------------------
-- A5. Ciclo de separado por unidad.
-- ------------------------------------------------------------

-- reserve_unit: 'disponible' → 'reservada' (atómico), fija layaway_id.
CREATE OR REPLACE FUNCTION public.reserve_unit(p_unit_id uuid, p_layaway_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE public.units
     SET status = 'reservada', layaway_id = p_layaway_id
   WHERE id = p_unit_id
     AND status = 'disponible'
     AND store_id = get_my_store_id();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'La unidad ya no está disponible para separar. unit_id=%', p_unit_id
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_unit(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.reserve_unit(uuid, uuid) TO authenticated;

-- release_reserved_unit: 'reservada' → 'disponible' (cancelar/expirar separado).
CREATE OR REPLACE FUNCTION public.release_reserved_unit(p_unit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE public.units
     SET status = 'disponible', layaway_id = NULL
   WHERE id = p_unit_id
     AND status = 'reservada'
     AND store_id = get_my_store_id();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'La unidad no estaba reservada. unit_id=%', p_unit_id
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_reserved_unit(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.release_reserved_unit(uuid) TO authenticated;

-- complete_reserved_unit: 'reservada' → 'vendida' (completar separado), fija
-- order_item_id y registra el movimiento 'sale'.
CREATE OR REPLACE FUNCTION public.complete_reserved_unit(p_unit_id uuid, p_order_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant uuid; v_store uuid; v_order uuid; v_rows integer;
BEGIN
  UPDATE public.units
     SET status = 'vendida', order_item_id = p_order_item_id, layaway_id = NULL
   WHERE id = p_unit_id
     AND status = 'reservada'
     AND store_id = get_my_store_id()
  RETURNING variant_id, store_id INTO v_variant, v_store;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'La unidad no estaba reservada para completar la venta. unit_id=%', p_unit_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT order_id INTO v_order FROM public.order_items WHERE id = p_order_item_id;
  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, created_by)
  VALUES (v_variant, v_store, 'sale', -1, v_order, auth.uid());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.complete_reserved_unit(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.complete_reserved_unit(uuid, uuid) TO authenticated;


-- ------------------------------------------------------------
-- A6. Devolución por unidad: 'vendida' → 'disponible', limpia order_item_id.
--   El rastro histórico se conserva en orders/returns/stock_movements (Bloque E);
--   la fila de la unidad se REUSA. Registra el movimiento 'return'.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_returned_unit(p_unit_id uuid, p_return_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant uuid; v_store uuid; v_rows integer;
BEGIN
  UPDATE public.units
     SET status = 'disponible', order_item_id = NULL
   WHERE id = p_unit_id
     AND status = 'vendida'
     AND store_id = get_my_store_id()
  RETURNING variant_id, store_id INTO v_variant, v_store;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'La unidad no estaba vendida para devolver. unit_id=%', p_unit_id
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, created_by)
  VALUES (v_variant, v_store, 'return', 1, p_return_id, auth.uid());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.restore_returned_unit(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.restore_returned_unit(uuid, uuid) TO authenticated;


-- ------------------------------------------------------------
-- Autoverificación mínima
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'unit_status') THEN
    RAISE EXCEPTION '039: falta el enum unit_status.';
  END IF;
  IF to_regclass('public.units') IS NULL THEN
    RAISE EXCEPTION '039: falta la tabla units.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.units'::regclass) THEN
    RAISE EXCEPTION '039: units sin RLS.';
  END IF;
  RAISE NOTICE '039 OK: units + enum + RLS + triggers de sincronización y guardias + claim/reserve/release/complete/restore.';
END $$;

COMMIT;
