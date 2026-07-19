-- ============================================================
-- 041 — FASE 2 / Bloque D: create_order (venta atómica en servidor)
--
-- TODA venta del POS pasa por esta RPC: contado, mixta o con equipos
-- serializados. En UNA transacción: orden + ítems + claims de unidades + pagos.
-- Si CUALQUIER paso falla (incl. un claim_unit que perdió la carrera), la
-- transacción entera hace rollback → sin orden fantasma, sin pago fantasma, y
-- el stock de accesorios descontado por el trigger deduct_stock_on_sale también
-- se revierte. Cierra el hueco de la deuda #2 PARA LA RUTA DE VENTAS.
--
-- ATOMICIDAD: la función corre en la transacción del llamador (una sola
--   sentencia SELECT create_order(...)). Sin bloque EXCEPTION → cualquier RAISE
--   aborta y revierte TODO. No hay rollback compensatorio manual (a diferencia
--   del useCreateOrder client-side heredado, que se retira del POS).
--
-- USA claim_unit (039), NO reimplementa el claim: la guardia atómica de la
--   unidad es la misma que protege separados y cualquier otra ruta.
--
-- PORTABLE A G-MURA: la rama de unidades es CONDICIONAL (solo si el ítem trae
--   unit_id). En G-Mura ningún ítem trae unit_id → claim_unit nunca se invoca
--   (plpgsql resuelve las llamadas en runtime) → la RPC funciona sin la capa de
--   unidades. La columna vertebral es orden+ítems+pagos; units es un opcional.
--
-- VALIDA turno abierto del usuario en la tienda (el POS exige turno para vender)
--   y permiso pos.usar. SECURITY DEFINER se salta el RLS, así que ambos se
--   chequean explícitamente acá.
--
-- ALCANCE: ventas COMPLETADAS (status='completed'), de contado/mixtas. El fiado
--   (is_credit) y los separados siguen su propio flujo → la deuda #2 sigue
--   pendiente ahí (ver FORKED_FROM.md).
--
-- Requiere: 001 (orders/order_items/deduct trigger), 005 (order_number),
--   026 (shift_id), 032 (order_payments), 039 (claim_unit), 021 (has_permission).
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_order(
  p_customer_id    uuid,
  p_cash_received  numeric,
  p_subtotal       numeric,
  p_discount       numeric,
  p_surcharge      numeric,
  p_total          numeric,
  p_primary_method payment_method,
  p_items          jsonb,   -- [{variant_id, product_id, qty, unit_price, list_price, is_gift, gift_reason, unit_id?}]
  p_payments       jsonb    -- [{method, amount}]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store   uuid;
  v_user    uuid;
  v_shift   uuid;
  v_order   uuid;
  v_item    jsonb;
  v_item_id uuid;
  v_unit    uuid;
  v_pay_sum numeric;
BEGIN
  v_store := get_my_store_id();
  v_user  := auth.uid();
  IF v_store IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT has_permission('pos.usar') THEN
    RAISE EXCEPTION 'No tienes permiso para vender (pos.usar).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Turno abierto del usuario en la tienda (el POS exige turno para vender).
  SELECT id INTO v_shift
    FROM public.cash_shifts
   WHERE store_id = v_store AND opened_by = v_user AND closed_at IS NULL
   ORDER BY opened_at DESC
   LIMIT 1;
  IF v_shift IS NULL THEN
    RAISE EXCEPTION 'Debes abrir turno para vender.' USING ERRCODE = 'check_violation';
  END IF;

  -- Validaciones estructurales.
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El carrito está vacío.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_total < 0 THEN
    RAISE EXCEPTION 'El total no puede ser negativo.' USING ERRCODE = 'check_violation';
  END IF;
  IF abs(p_total - (p_subtotal - p_discount + p_surcharge)) > 0.5 THEN
    RAISE EXCEPTION 'Totales incoherentes (total <> subtotal - descuento + recargo).'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum((p->>'amount')::numeric), 0)
    INTO v_pay_sum
    FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) p;
  IF abs(v_pay_sum - p_total) > 0.5 THEN
    RAISE EXCEPTION 'La suma de los pagos (%) no cuadra con el total (%).', v_pay_sum, p_total
      USING ERRCODE = 'check_violation';
  END IF;

  -- 1. Orden (order_number lo asigna el trigger de la 005). shift_id = turno abierto.
  INSERT INTO public.orders
    (store_id, customer_id, created_by, status, subtotal, discount, surcharge,
     total, payment_method, cash_received, shift_id)
  VALUES
    (v_store, p_customer_id, v_user, 'completed', p_subtotal, p_discount, p_surcharge,
     p_total, p_primary_method, p_cash_received, v_shift)
  RETURNING id INTO v_order;

  -- 2. Ítems (el trigger deduct_stock_on_sale descuenta accesorios; serializados
  --    no-op) + claim de la unidad EXACTA por línea serializada.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.order_items
      (order_id, variant_id, product_id, qty, unit_price, list_price, is_gift, gift_reason)
    VALUES (
      v_order,
      (v_item->>'variant_id')::uuid,
      (v_item->>'product_id')::uuid,
      (v_item->>'qty')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'list_price')::numeric,
      coalesce((v_item->>'is_gift')::boolean, false),
      nullif(v_item->>'gift_reason', '')
    )
    RETURNING id INTO v_item_id;

    v_unit := nullif(v_item->>'unit_id', '')::uuid;
    IF v_unit IS NOT NULL THEN
      -- Guardia atómica: si la unidad ya no está disponible (otra caja la tomó),
      -- claim_unit RAISE → toda la venta se revierte. NO se reimplementa el claim.
      PERFORM public.claim_unit(v_unit, v_item_id);
    END IF;
  END LOOP;

  -- 3. Pagos (order_payments hereda created_by/shift de la orden).
  INSERT INTO public.order_payments (order_id, store_id, method, amount)
  SELECT v_order, v_store, (p->>'method')::payment_method, (p->>'amount')::numeric
    FROM jsonb_array_elements(p_payments) p;

  RETURN v_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_order(uuid, numeric, numeric, numeric, numeric, numeric, payment_method, jsonb, jsonb) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.create_order(uuid, numeric, numeric, numeric, numeric, numeric, payment_method, jsonb, jsonb) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE '041 OK: create_order (venta atómica: orden + ítems + claims + pagos, todo o nada).';
END $$;

COMMIT;
