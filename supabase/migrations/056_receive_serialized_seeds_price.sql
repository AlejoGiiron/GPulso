-- ============================================================
-- 056 — receive_serialized_units siembra units.price = suggested_price
--
-- Rediseño de serializados · Fase C, decisión #4: al recibir unidades por una
-- factura de compra, cada unidad nace con:
--   · cost  = unit_cost de la LÍNEA de factura (un hecho de la compra).
--   · price = suggested_price del PRODUCTO (sugerencia de venta; editable luego).
-- El precio es semilla: NULL también resolvería al sugerido al leer (Fase B),
-- pero sembrarlo deja el valor explícito y editable por unidad.
--
-- Es un CREATE OR REPLACE de la función de la 040 (que está en prod desde Fase 2):
-- IDÉNTICA salvo que el INSERT de units ahora setea price. El resto —guard de
-- permiso, recepción parcial ≤N, all-or-nothing, movimiento 'purchase' por
-- unidad— no cambia.
--
-- Requiere: 040 (versión previa), 053 (products.suggested_price, units.price).
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.receive_serialized_units(
  p_invoice_item_id uuid,
  p_serials         text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant   uuid;
  v_qty       integer;
  v_cost      numeric(12,2);
  v_invoice   uuid;
  v_store     uuid;
  v_received  integer;
  v_requested integer;
  v_suggested numeric(12,2);
BEGIN
  IF NOT has_permission('inventario.gestionar') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar unidades (inventario.gestionar).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Línea de factura + tienda. FOR UPDATE OF ii serializa recepciones parciales.
  SELECT ii.variant_id, ii.qty, ii.unit_cost, ii.invoice_id, pi.store_id
    INTO v_variant, v_qty, v_cost, v_invoice, v_store
    FROM public.purchase_invoice_items ii
    JOIN public.purchase_invoices pi ON pi.id = ii.invoice_id
   WHERE ii.id = p_invoice_item_id
   FOR UPDATE OF ii;

  IF v_variant IS NULL THEN
    RAISE EXCEPTION 'Línea de factura no encontrada. id=%', p_invoice_item_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_store IS DISTINCT FROM get_my_store_id() THEN
    RAISE EXCEPTION 'La factura no pertenece a tu tienda.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.is_serialized_variant(v_variant) THEN
    RAISE EXCEPTION 'La línea no es de un producto serializado; no lleva seriales.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_serials IS NULL OR array_length(p_serials, 1) IS NULL THEN
    RAISE EXCEPTION 'No se capturó ningún serial.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_serials) x WHERE btrim(x) = '') THEN
    RAISE EXCEPTION 'Hay seriales en blanco.' USING ERRCODE = 'check_violation';
  END IF;

  v_requested := array_length(p_serials, 1);

  SELECT count(*) INTO v_received
    FROM public.units WHERE purchase_invoice_item_id = p_invoice_item_id;

  IF v_received + v_requested > v_qty THEN
    RAISE EXCEPTION
      'Excede la cantidad de la línea. Cantidad=%, ya recibidas=%, intento=%.',
      v_qty, v_received, v_requested USING ERRCODE = 'check_violation';
  END IF;

  -- Precio sugerido del producto de la variante (semilla del precio de la unidad).
  SELECT p.suggested_price INTO v_suggested
    FROM public.variants vv
    JOIN public.products p ON p.id = vv.product_id
   WHERE vv.id = v_variant;

  -- Alta all-or-nothing. price ← sugerido; cost ← unit_cost de la línea.
  INSERT INTO public.units (store_id, variant_id, serial, cost, price, purchase_invoice_item_id, status)
  SELECT v_store, v_variant, btrim(x), v_cost, v_suggested, p_invoice_item_id, 'disponible'
    FROM unnest(p_serials) x;

  -- Movimiento 'purchase' por unidad (línea de tiempo del Bloque E).
  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, created_by)
  SELECT v_variant, v_store, 'purchase', 1, v_invoice, auth.uid()
    FROM unnest(p_serials) x;

  RETURN v_requested;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.receive_serialized_units(uuid, text[]) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.receive_serialized_units(uuid, text[]) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE '056 OK: receive_serialized_units siembra units.price = suggested_price (costo sigue de la línea).';
END $$;

COMMIT;
