-- ============================================================
-- 042 — FASE 2 / Bloque E: stock_movements.unit_id (rastro por unidad)
--
-- PROBLEMA (hallazgo del Bloque E):
--   El Bloque E pide la línea de tiempo de UNA unidad: ingreso → venta →
--   devolución → reventa. Pero:
--     · stock_movements es por VARIANTE (qty), no identifica la unidad.
--     · units.order_item_id se LIMPIA al devolver (A6) → se pierde el vínculo
--       con la venta pasada.
--   Sin un enlace unidad↔movimiento no se puede reconstruir el historial de una
--   unidad que se vendió, se devolvió y se revendió. A6 asumía que el historial
--   "vive en stock_movements", pero le faltaba esta columna.
--
-- SOLUCIÓN:
--   stock_movements.unit_id (FK NULL → units). Los movimientos 'sale'/'return'
--   de unidades serializadas quedan estampados con SU unidad. La línea de tiempo
--   se reconstruye leyendo los movimientos de la unidad (ORDER BY created_at) y
--   uniéndolos a orders (cliente/vendedor) y returns (motivo). El INGRESO no
--   necesita el movimiento: sale de units.created_at + purchase_invoice_item_id.
--
--   NULL para movimientos de accesorios (por cantidad) y para los 'purchase' de
--   recepción (el origen ya vive en units.purchase_invoice_item_id). ON DELETE
--   SET NULL: borrar una unidad no borra su rastro contable.
--
-- Redefine claim_unit / complete_reserved_unit / restore_returned_unit (039)
--   para incluir unit_id en su INSERT de stock_movements. Cuerpos idénticos a la
--   039 salvo esa columna (se preservan TODOS los guards de coherencia).
--
-- El ingreso MANUAL (C2b, client-side) estampa unit_id desde el front (la
--   columna ya existe tras esta migración).
--
-- Requiere: 001 (stock_movements), 039 (units + las 3 funciones).
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.
-- ============================================================

BEGIN;

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.stock_movements.unit_id IS
  'Unidad serializada del movimiento (NULL para accesorios por cantidad y para los ''purchase'' de recepción, cuyo origen vive en units.purchase_invoice_item_id). Habilita la línea de tiempo por unidad del Bloque E.';

CREATE INDEX IF NOT EXISTS idx_stock_movements_unit_id ON public.stock_movements(unit_id);


-- ── claim_unit (venta directa): estampa unit_id en el movimiento 'sale' ──────
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
  IF NOT EXISTS (
    SELECT 1
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.units  u ON u.id = p_unit_id
     WHERE oi.id = p_order_item_id
       AND o.store_id = get_my_store_id()
       AND oi.variant_id = u.variant_id
  ) THEN
    RAISE EXCEPTION 'order_item inválido para esta unidad (tienda o variante no coinciden). unit_id=%, order_item_id=%',
      p_unit_id, p_order_item_id USING ERRCODE = 'check_violation';
  END IF;

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

  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, created_by, unit_id)
  VALUES (v_variant, v_store, 'sale', -1, v_order, auth.uid(), p_unit_id);
END;
$$;


-- ── complete_reserved_unit (completar separado): unit_id en 'sale' ───────────
CREATE OR REPLACE FUNCTION public.complete_reserved_unit(p_unit_id uuid, p_order_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant uuid; v_store uuid; v_order uuid; v_rows integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.units  u ON u.id = p_unit_id
     WHERE oi.id = p_order_item_id
       AND o.store_id = get_my_store_id()
       AND oi.variant_id = u.variant_id
  ) THEN
    RAISE EXCEPTION 'order_item inválido para esta unidad (tienda o variante no coinciden). unit_id=%, order_item_id=%',
      p_unit_id, p_order_item_id USING ERRCODE = 'check_violation';
  END IF;

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
  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, created_by, unit_id)
  VALUES (v_variant, v_store, 'sale', -1, v_order, auth.uid(), p_unit_id);
END;
$$;


-- ── restore_returned_unit (devolución): unit_id en 'return' ──────────────────
CREATE OR REPLACE FUNCTION public.restore_returned_unit(p_unit_id uuid, p_return_id uuid)
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

  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, created_by, unit_id)
  VALUES (v_variant, v_store, 'return', 1, p_return_id, auth.uid(), p_unit_id);
END;
$$;

DO $$ BEGIN
  RAISE NOTICE '042 OK: stock_movements.unit_id + sale/return estampan la unidad (rastro por unidad del Bloque E).';
END $$;

COMMIT;
