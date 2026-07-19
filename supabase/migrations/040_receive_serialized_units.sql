-- ============================================================
-- 040 — FASE 2 / Bloque C2a: receive_serialized_units (captura de seriales)
--
-- Registra las unidades serializadas de una LÍNEA de factura de compra a partir
-- de los seriales capturados. Soporta RECEPCIÓN PARCIAL (≤N): se puede confirmar
-- con menos seriales que la cantidad de la línea y completar el resto después.
--
-- INVARIANTES:
--   · No excede la cantidad N de la línea: recibidas_previas + nuevas <= qty.
--     Guard EN SERVIDOR (no solo UI) — SECURITY DEFINER se salta el RLS.
--   · All-or-nothing por lote: si algún serial choca con el UNIQUE(org, serial)
--     (ya existe, o duplicado dentro del mismo lote), el INSERT entero revierte;
--     no queda media captura.
--   · Crear unidades exige inventario.gestionar (mismo requisito que el RLS de
--     units; como esta función es SECURITY DEFINER, el permiso se chequea acá
--     explícitamente para NO relajarlo).
--   · Cada unidad nace 'disponible', con cost = unit_cost de la línea y
--     purchase_invoice_item_id = la línea (origen para el rastro del Bloque E).
--     El trigger de sincronización pone variants.stock_qty. Se registra un
--     stock_movement 'purchase' por unidad para la línea de tiempo.
--
-- El "pendiente" de una línea NO se guarda en columnas: se DERIVA como
--   qty − COUNT(units WHERE purchase_invoice_item_id = línea).
--
-- Requiere: 039 (units, is_serialized_variant, sync trigger, has_permission).
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
BEGIN
  IF NOT has_permission('inventario.gestionar') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar unidades (inventario.gestionar).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Línea de factura + tienda.
  -- FOR UPDATE OF ii: bloquea la fila de la LÍNEA para SERIALIZAR sus recepciones.
  -- Sin esto, dos recepciones parciales concurrentes de la misma línea (seriales
  -- distintos) leerían el mismo COUNT, ambas pasarían el guard anti-exceso y
  -- juntas superarían N. Con el lock, la segunda espera y ve el COUNT ya
  -- actualizado. También protege contra edición concurrente del qty durante la
  -- recepción. Lock de una fila, vida corta (hasta el COMMIT de la llamada).
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

  -- Validación de la lista.
  IF p_serials IS NULL OR array_length(p_serials, 1) IS NULL THEN
    RAISE EXCEPTION 'No se capturó ningún serial.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_serials) x WHERE btrim(x) = '') THEN
    RAISE EXCEPTION 'Hay seriales en blanco.' USING ERRCODE = 'check_violation';
  END IF;

  v_requested := array_length(p_serials, 1);

  -- Guard anti-exceso: previas + nuevas no puede superar la cantidad de la línea.
  SELECT count(*) INTO v_received
    FROM public.units WHERE purchase_invoice_item_id = p_invoice_item_id;

  IF v_received + v_requested > v_qty THEN
    RAISE EXCEPTION
      'Excede la cantidad de la línea. Cantidad=%, ya recibidas=%, intento=%.',
      v_qty, v_received, v_requested USING ERRCODE = 'check_violation';
  END IF;

  -- Alta all-or-nothing. Un choque de UNIQUE(org, serial) (existente o duplicado
  -- en el lote) revierte todo el INSERT.
  INSERT INTO public.units (store_id, variant_id, serial, cost, purchase_invoice_item_id, status)
  SELECT v_store, v_variant, btrim(x), v_cost, p_invoice_item_id, 'disponible'
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
  RAISE NOTICE '040 OK: receive_serialized_units (recepción parcial ≤N, guard anti-exceso, all-or-nothing).';
END $$;

COMMIT;
