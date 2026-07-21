-- ============================================================
-- 044 — FASE 3 / Bloque A1-A3: modelo del taller de reparaciones
--
-- El taller es un MUNDO APARTE del inventario: el equipo del cliente NO entra a
-- units ni a variants. Se modela con tres tablas propias:
--   · repair_orders          — la orden de reparación (equipo + falla + estado).
--   · repair_status_history  — bitácora inmutable de estados (el timeline sale de
--     acá, NO de campos mutables; misma lección de la 042).
--   · repair_parts           — costos de repuestos (inventario o compra externa).
--
-- Además habilita que el COBRO de un servicio entre al modelo de ventas
-- (decisión A4, aprobada): products.is_service = un producto "Servicio de
-- reparación" con variante única que NO descuenta stock. Con eso la reparación
-- entregada es una venta normal (aparece en cuadre y reportes) sin tocar la
-- lógica financiera. deliver_repair (045) crea esa venta.
--
-- Patrones reusados:
--   · organization_id derivado del store por trigger (units, 039).
--   · order_number consecutivo por tienda con advisory lock (orders, 005).
--   · RLS por store_id + permiso (039/024).
--
-- Requiere: 001 (products/variants/stock_movements/deduct_stock_on_sale/
--   restore_stock_on_return/set_updated_at), 013 (get_my_store_id), 020
--   (organizations, get_my_organization_id), 021 (has_permission), 039
--   (is_serialized_variant), 043 (movement_type 'repair_consumption').
-- Atomicidad: todo en una transacción. Idempotente donde aplica.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- A4 (parte 1): products.is_service — producto de servicio sin stock.
--   La variante de un producto is_service se vende sin descontar inventario
--   (el "Servicio de reparación" no tiene existencias). Mismo mecanismo de
--   early-return que is_serialized en los triggers de cantidad.
-- ------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_service boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.is_service IS
  'true = producto de servicio (ej. "Servicio de reparación"): se vende sin descontar stock. Su variante única existe solo para colgar el cobro en order_items. Lo crea/usa deliver_repair (045).';

-- INVARIANTE ESTRUCTURAL: un solo producto de servicio por tienda. Con esto la
-- carrera del find-or-create de deliver_repair (045) es imposible por
-- construcción — dos entregas simultáneas que intenten crearlo se serializan
-- contra este índice (una gana, la otra hace ON CONFLICT DO NOTHING y re-lee).
-- Preferido sobre un advisory lock: el invariante lo garantiza la BD para
-- cualquier ruta de código, no solo para quien recuerde tomar el lock.
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_one_service_per_store
  ON public.products(store_id) WHERE is_service;

CREATE OR REPLACE FUNCTION public.is_service_variant(p_variant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT p.is_service
       FROM public.variants v
       JOIN public.products p ON p.id = v.product_id
      WHERE v.id = p_variant_id),
    false);
$$;

-- deduct_stock_on_sale (001, redefinida en 039): serializado O servicio → no
--   descuenta ni loguea. Cuerpo idéntico a la 039 salvo el OR is_service_variant.
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
  IF public.is_serialized_variant(NEW.variant_id)
     OR public.is_service_variant(NEW.variant_id) THEN
    RETURN NEW;  -- serializado = capa de unidades; servicio = sin stock
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

-- restore_stock_on_return (001/039): serializado O servicio → no incrementa (un
--   servicio no vuelve a stock). Defensa por si una venta de reparación pasara
--   por el flujo de devoluciones (no hay UI para eso, pero no dejamos stock
--   fantasma en la variante de servicio).
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
  IF public.is_serialized_variant(NEW.variant_id)
     OR public.is_service_variant(NEW.variant_id) THEN
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


-- ------------------------------------------------------------
-- Enums del taller
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'repair_status') THEN
    CREATE TYPE repair_status AS ENUM ('recibido', 'en_reparacion', 'listo', 'entregado');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'repair_part_source') THEN
    CREATE TYPE repair_part_source AS ENUM ('inventario', 'compra_externa');
  END IF;
END $$;

COMMENT ON TYPE repair_status IS
  'Estados del flujo del taller: recibido → en_reparacion → listo → entregado. La transición a entregado la hace SOLO deliver_repair (045).';
COMMENT ON TYPE repair_part_source IS
  'Origen del repuesto: inventario (variante propia, descuenta stock) o compra_externa (comprado al momento, solo descripción + costo).';


-- ------------------------------------------------------------
-- A1. repair_orders
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_orders (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id        uuid          NOT NULL REFERENCES public.stores(id)        ON DELETE CASCADE,
  order_number    integer,      -- lo asigna el trigger (por tienda)
  customer_id     uuid          NOT NULL REFERENCES public.customers(id)     ON DELETE RESTRICT,

  -- Equipo (texto libre, SIN validación de formato de IMEI/serial).
  marca           text          NOT NULL,
  modelo          text          NOT NULL,
  imei_serial     text,
  color           text,

  falla_reportada text          NOT NULL,
  -- Dos listas separadas: {"danos": {...bool}, "verificaciones": {...bool}}.
  checklist       jsonb         NOT NULL DEFAULT '{}'::jsonb,
  observaciones   text,
  accesorios      text,
  -- CONFIDENCIAL: la contraseña del equipo NUNCA va en el comprobante del cliente.
  password_equipo text,

  status          repair_status NOT NULL DEFAULT 'recibido',
  -- Lo que se cobra al retirar (se define antes de pasar a 'listo'; 0 = garantía).
  precio          numeric(12,2),

  received_by     uuid          NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  delivered_by    uuid          REFERENCES public.profiles(id)          ON DELETE RESTRICT,
  delivered_at    timestamptz,
  order_id        uuid          REFERENCES public.orders(id)            ON DELETE SET NULL,

  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT repair_orders_precio_non_negative CHECK (precio IS NULL OR precio >= 0),
  CONSTRAINT repair_orders_marca_not_blank     CHECK (length(btrim(marca)) > 0),
  CONSTRAINT repair_orders_modelo_not_blank    CHECK (length(btrim(modelo)) > 0),
  CONSTRAINT repair_orders_falla_not_blank     CHECK (length(btrim(falla_reportada)) > 0)
);

COMMENT ON TABLE public.repair_orders IS
  'Órdenes del taller de reparaciones. El equipo del cliente es un mundo aparte: NO entra a units ni al inventario. La venta al cobrar se liga en order_id.';
COMMENT ON COLUMN public.repair_orders.password_equipo IS
  'CONFIDENCIAL. Visible solo en el detalle para el personal del taller; jamás en el comprobante del cliente.';
COMMENT ON COLUMN public.repair_orders.precio IS
  'Precio a cobrar al retirar. NULL hasta que se defina; 0 = garantía/sin cobro. Debe estar definido antes de pasar a estado listo (validado en UI + deliver_repair).';

CREATE INDEX IF NOT EXISTS idx_repair_orders_store_id    ON public.repair_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_customer_id ON public.repair_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_status      ON public.repair_orders(status);
CREATE INDEX IF NOT EXISTS idx_repair_orders_order_id    ON public.repair_orders(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_repair_orders_store_number
  ON public.repair_orders(store_id, order_number) WHERE order_number IS NOT NULL;

-- updated_at
DROP TRIGGER IF EXISTS trg_repair_orders_updated_at ON public.repair_orders;
CREATE TRIGGER trg_repair_orders_updated_at
  BEFORE UPDATE ON public.repair_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- organization_id derivado del store (patrón units, 039).
CREATE OR REPLACE FUNCTION public.repair_orders_set_org_from_store()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id
    FROM public.stores WHERE id = NEW.store_id;
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'repair_orders: la tienda % no tiene organización.', NEW.store_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_repair_orders_set_org ON public.repair_orders;
CREATE TRIGGER trg_repair_orders_set_org
  BEFORE INSERT ON public.repair_orders
  FOR EACH ROW EXECUTE FUNCTION repair_orders_set_org_from_store();

-- order_number consecutivo por tienda (patrón orders, 005; namespace propio).
CREATE OR REPLACE FUNCTION public.assign_repair_order_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('repair_orders_seq_' || NEW.store_id::text));
  SELECT COALESCE(MAX(order_number), 0) + 1 INTO v_next
    FROM public.repair_orders WHERE store_id = NEW.store_id;
  NEW.order_number := v_next;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_repair_order_number ON public.repair_orders;
CREATE TRIGGER trg_assign_repair_order_number
  BEFORE INSERT ON public.repair_orders
  FOR EACH ROW EXECUTE FUNCTION assign_repair_order_number();


-- ------------------------------------------------------------
-- A2. repair_status_history — bitácora inmutable (el timeline sale de acá).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_status_history (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id uuid          NOT NULL REFERENCES public.repair_orders(id) ON DELETE CASCADE,
  store_id        uuid          NOT NULL REFERENCES public.stores(id)        ON DELETE CASCADE,
  status          repair_status NOT NULL,
  changed_by      uuid          REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.repair_status_history IS
  'Bitácora inmutable de estados de una orden de reparación. La escribe SOLO el trigger log_repair_status_change (SECURITY DEFINER); los usuarios solo pueden leerla.';

CREATE INDEX IF NOT EXISTS idx_repair_status_history_order
  ON public.repair_status_history(repair_order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_repair_status_history_store
  ON public.repair_status_history(store_id);

-- Loguea el estado inicial (INSERT) y cada cambio de estado (UPDATE). changed_by
--   = auth.uid() (funciona incluso desde deliver_repair, que es SECURITY DEFINER:
--   auth.uid() lee el JWT del llamador, no cambia con el DEFINER).
CREATE OR REPLACE FUNCTION public.log_repair_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.repair_status_history (repair_order_id, store_id, status, changed_by)
    VALUES (NEW.id, NEW.store_id, NEW.status, auth.uid());
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.repair_status_history (repair_order_id, store_id, status, changed_by)
    VALUES (NEW.id, NEW.store_id, NEW.status, auth.uid());
  END IF;
  RETURN NULL;  -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_log_repair_status_change ON public.repair_orders;
CREATE TRIGGER trg_log_repair_status_change
  AFTER INSERT OR UPDATE OF status ON public.repair_orders
  FOR EACH ROW EXECUTE FUNCTION log_repair_status_change();


-- ------------------------------------------------------------
-- A3. repair_parts — costos de repuestos (inventario | compra_externa).
--   Los INSERT los hace SOLO la RPC add_repair_part (045): inventario descuenta
--   stock de forma atómica; compra_externa solo guarda descripción + costo. Los
--   usuarios NO insertan directo (no hay política INSERT).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_parts (
  id              uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id uuid               NOT NULL REFERENCES public.repair_orders(id) ON DELETE CASCADE,
  store_id        uuid               NOT NULL REFERENCES public.stores(id)        ON DELETE CASCADE,
  source          repair_part_source NOT NULL,
  variant_id      uuid               REFERENCES public.variants(id) ON DELETE SET NULL,
  qty             integer,
  descripcion     text,
  costo           numeric(12,2)      NOT NULL,
  created_by      uuid               REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz        NOT NULL DEFAULT now(),

  CONSTRAINT repair_parts_costo_non_negative CHECK (costo >= 0),
  CONSTRAINT repair_parts_source_coherent CHECK (
    (source = 'inventario'
       AND variant_id IS NOT NULL AND qty IS NOT NULL AND qty > 0)
    OR
    (source = 'compra_externa'
       AND descripcion IS NOT NULL AND length(btrim(descripcion)) > 0)
  )
);

COMMENT ON TABLE public.repair_parts IS
  'Costos de repuestos por orden de reparación. Suman al costo total (margen = precio - sum(costo)). SELECT restringido a reparaciones.ver_costos: el Vendedor no ve costos.';

CREATE INDEX IF NOT EXISTS idx_repair_parts_order ON public.repair_parts(repair_order_id);
CREATE INDEX IF NOT EXISTS idx_repair_parts_store ON public.repair_parts(store_id);


-- ------------------------------------------------------------
-- RLS
--   repair_orders / repair_status_history: quien gestiona reparaciones ve/gestiona.
--   repair_parts: SELECT solo con reparaciones.ver_costos (Vendedor no ve costos,
--     ni siquiera por API). INSERT/UPDATE/DELETE solo vía RPC (SECURITY DEFINER).
-- ------------------------------------------------------------
ALTER TABLE public.repair_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_parts          ENABLE ROW LEVEL SECURITY;

-- repair_orders
DROP POLICY IF EXISTS repair_orders_select ON public.repair_orders;
CREATE POLICY repair_orders_select ON public.repair_orders FOR SELECT
  USING (store_id = get_my_store_id() AND has_permission('reparaciones.gestionar'));

DROP POLICY IF EXISTS repair_orders_insert ON public.repair_orders;
CREATE POLICY repair_orders_insert ON public.repair_orders FOR INSERT
  WITH CHECK (store_id = get_my_store_id() AND has_permission('reparaciones.gestionar'));

DROP POLICY IF EXISTS repair_orders_update ON public.repair_orders;
CREATE POLICY repair_orders_update ON public.repair_orders FOR UPDATE
  USING (store_id = get_my_store_id() AND has_permission('reparaciones.gestionar'))
  WITH CHECK (store_id = get_my_store_id() AND has_permission('reparaciones.gestionar'));

DROP POLICY IF EXISTS repair_orders_delete ON public.repair_orders;
CREATE POLICY repair_orders_delete ON public.repair_orders FOR DELETE
  USING (store_id = get_my_store_id() AND has_permission('reparaciones.gestionar'));

-- repair_status_history (solo lectura para usuarios; la escribe el trigger DEFINER)
DROP POLICY IF EXISTS repair_status_history_select ON public.repair_status_history;
CREATE POLICY repair_status_history_select ON public.repair_status_history FOR SELECT
  USING (store_id = get_my_store_id() AND has_permission('reparaciones.gestionar'));

-- repair_parts (SELECT gated a ver_costos; escritura solo por RPC)
DROP POLICY IF EXISTS repair_parts_select ON public.repair_parts;
CREATE POLICY repair_parts_select ON public.repair_parts FOR SELECT
  USING (store_id = get_my_store_id() AND has_permission('reparaciones.ver_costos'));


-- ------------------------------------------------------------
-- Autoverificación mínima
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.repair_orders') IS NULL THEN
    RAISE EXCEPTION '044: falta repair_orders.';
  END IF;
  IF to_regclass('public.repair_status_history') IS NULL THEN
    RAISE EXCEPTION '044: falta repair_status_history.';
  END IF;
  IF to_regclass('public.repair_parts') IS NULL THEN
    RAISE EXCEPTION '044: falta repair_parts.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.repair_orders'::regclass) THEN
    RAISE EXCEPTION '044: repair_orders sin RLS.';
  END IF;
  RAISE NOTICE '044 OK: is_service + guardias, repair_orders/history/parts + triggers (org/número/bitácora) + RLS.';
END $$;

COMMIT;
