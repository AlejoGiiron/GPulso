-- ============================================================
-- 045 — FASE 3 / Bloque A3-A4: RPCs atómicas del taller
--
--   · add_repair_part(...)  — agrega un repuesto a la orden. Si es de inventario,
--     DESCUENTA stock de forma ATÓMICA (UPDATE con guardia de rowcount, nunca
--     multi-INSERT) y registra un stock_movement 'repair_consumption'. Es un
--     CONSUMO, no una venta: no hay order_item.
--   · deliver_repair(...)   — el cobro al RETIRAR, ATÓMICO. En UNA transacción:
--     valida turno abierto DE LA TIENDA, crea la VENTA del servicio (decisión
--     A4: producto is_service, sin descuento de stock) con sus pagos imputados
--     al turno, marca la orden 'entregado', liga order_id y el trigger de la 044
--     registra el historial. Cualquier RAISE aborta y revierte TODO.
--
-- PERMISOS:
--   · add_repair_part: reparaciones.gestionar (el trabajo del Técnico).
--   · deliver_repair : pos.usar + reparaciones.gestionar. El Técnico NO tiene
--     pos.usar → no puede cobrar/vender (regla "el técnico no vende"). El
--     Vendedor sí (recibe equipos y cobra entregas).
--
-- Ambas SECURITY DEFINER: se saltan el RLS, así que validan tienda/permiso/turno
--   explícitamente. Corren en la transacción del llamador (un solo SELECT), sin
--   bloque EXCEPTION → todo o nada.
--
-- Requiere: 044 (repair_orders/parts, is_service_variant), 041 (patrón de venta),
--   039 (is_serialized_variant), 043 (movement_type 'repair_consumption'), 026
--   (cash_shifts por tienda), 032 (order_payments), 021 (has_permission).
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- add_repair_part — consumo de inventario (atómico) o compra externa.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_repair_part(
  p_repair_id   uuid,
  p_source      repair_part_source,
  p_variant_id  uuid,     -- solo 'inventario'
  p_qty         integer,  -- solo 'inventario'
  p_descripcion text,     -- 'compra_externa' (o etiqueta libre en 'inventario')
  p_costo       numeric   -- solo 'compra_externa' (en 'inventario' se toma de la variante)
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store     uuid;
  v_user      uuid;
  v_status    repair_status;
  v_rows      integer;
  v_unit_cost numeric;
  v_costo     numeric;
  v_desc      text;
  v_part      uuid;
BEGIN
  v_store := get_my_store_id();
  v_user  := auth.uid();
  IF v_store IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT has_permission('reparaciones.gestionar') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar reparaciones.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- La orden es de MI tienda y aún no está entregada (no se agregan repuestos a
  -- algo ya cobrado/cerrado). Se bloquea la fila para coherencia.
  SELECT status INTO v_status
    FROM public.repair_orders
   WHERE id = p_repair_id AND store_id = v_store
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden de reparación no existe en esta tienda. repair_id=%', p_repair_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_status = 'entregado' THEN
    RAISE EXCEPTION 'No se pueden agregar repuestos a una reparación ya entregada.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_source = 'inventario' THEN
    IF p_variant_id IS NULL OR p_qty IS NULL OR p_qty <= 0 THEN
      RAISE EXCEPTION 'Repuesto de inventario requiere variante y cantidad > 0.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Un repuesto de inventario es un producto por CANTIDAD; un equipo serializado
    -- no se "consume" como pieza.
    IF public.is_serialized_variant(p_variant_id) THEN
      RAISE EXCEPTION 'No se puede consumir una variante serializada como repuesto. variant=%', p_variant_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- Descuento ATÓMICO con guardia de stock: si no alcanza, rowcount 0 → RAISE.
    UPDATE public.variants
       SET stock_qty = stock_qty - p_qty
     WHERE id = p_variant_id
       AND store_id = v_store
       AND stock_qty >= p_qty
    RETURNING cost_price INTO v_unit_cost;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'Stock insuficiente o variante inválida para consumir como repuesto. variant=%, qty=%',
        p_variant_id, p_qty USING ERRCODE = 'check_violation';
    END IF;

    v_costo := COALESCE(v_unit_cost, 0) * p_qty;  -- costo tomado de la variante
    v_desc  := NULLIF(btrim(coalesce(p_descripcion, '')), '');

    -- Rastro del consumo (qty negativo, referencia a la orden de reparación).
    INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, notes, created_by)
    VALUES (p_variant_id, v_store, 'repair_consumption', -p_qty, p_repair_id,
            'Repuesto reparación', v_user);

    INSERT INTO public.repair_parts (repair_order_id, store_id, source, variant_id, qty, descripcion, costo, created_by)
    VALUES (p_repair_id, v_store, 'inventario', p_variant_id, p_qty, v_desc, v_costo, v_user)
    RETURNING id INTO v_part;

  ELSIF p_source = 'compra_externa' THEN
    v_desc := NULLIF(btrim(coalesce(p_descripcion, '')), '');
    IF v_desc IS NULL THEN
      RAISE EXCEPTION 'Repuesto de compra externa requiere descripción.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF p_costo IS NULL OR p_costo < 0 THEN
      RAISE EXCEPTION 'Costo de compra externa inválido (debe ser >= 0).'
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.repair_parts (repair_order_id, store_id, source, descripcion, costo, created_by)
    VALUES (p_repair_id, v_store, 'compra_externa', v_desc, p_costo, v_user)
    RETURNING id INTO v_part;

  ELSE
    RAISE EXCEPTION 'Origen de repuesto desconocido: %', p_source USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_part;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_repair_part(uuid, repair_part_source, uuid, integer, text, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.add_repair_part(uuid, repair_part_source, uuid, integer, text, numeric) TO authenticated;


-- ------------------------------------------------------------
-- Helper: variante única del producto de servicio de la tienda (find-or-create).
--   SECURITY DEFINER (lo llama deliver_repair; crea el producto de sistema sin
--   depender del RLS de products/variants). Un solo "Servicio de reparación" por
--   tienda; su variante cuelga el cobro en order_items sin descontar stock.
-- ------------------------------------------------------------
--   RACE-SAFE con DO UPDATE ... RETURNING (no DO NOTHING + SELECT). El patrón
--   DO NOTHING + SELECT tiene el agujero clásico de READ COMMITTED: si otra
--   transacción concurrente ya insertó el producto pero aún no commiteó, el
--   RETURNING de DO NOTHING no devuelve nada y el SELECT posterior puede no ver
--   esa fila (según el snapshot) → v_product NULL → el INSERT de variants revienta
--   con un NOT NULL incomprensible. DO UPDATE (un no-op: SET col = tabla.col)
--   BLOQUEA hasta que la otra transacción commitea y DEVUELVE la fila existente
--   en el mismo statement, atómicamente. El índice único parcial
--   uq_products_one_service_per_store (044) garantiza que nunca haya dos.
CREATE OR REPLACE FUNCTION public.ensure_repair_service_variant(p_store_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product uuid;
  v_variant uuid;
BEGIN
  -- Producto de servicio (uno por tienda, garantizado por índice único parcial).
  INSERT INTO public.products (name, store_id, is_service, is_active)
  VALUES ('Servicio de reparación', p_store_id, true, true)
  ON CONFLICT (store_id) WHERE is_service
  DO UPDATE SET is_service = products.is_service   -- no-op: fuerza lock + RETURNING
  RETURNING id INTO v_product;

  -- Variante única del producto de servicio (unicidad por variants_combo_unique:
  -- (product_id, NULL, NULL) es único NULLS NOT DISTINCT).
  INSERT INTO public.variants (product_id, store_id, price, stock_qty)
  VALUES (v_product, p_store_id, 0, 0)
  ON CONFLICT ON CONSTRAINT variants_combo_unique
  DO UPDATE SET product_id = variants.product_id   -- no-op: fuerza lock + RETURNING
  RETURNING id INTO v_variant;

  RETURN v_variant;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_repair_service_variant(uuid) FROM public, anon, authenticated;


-- ------------------------------------------------------------
-- deliver_repair — cobro atómico al retirar.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deliver_repair(
  p_repair_id     uuid,
  p_payments      jsonb,    -- [{method, amount}]  (vacío si precio = 0)
  p_cash_received numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store      uuid;
  v_user       uuid;
  v_shift      uuid;
  v_open_count integer;
  v_repair     public.repair_orders%ROWTYPE;
  v_price      numeric;
  v_pay_count  integer;
  v_pay_sum    numeric;
  v_method     payment_method;
  v_svc_var    uuid;
  v_svc_prod   uuid;
  v_order      uuid;
  v_item       uuid;
  v_rows       integer;
BEGIN
  v_store := get_my_store_id();
  v_user  := auth.uid();
  IF v_store IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = 'check_violation';
  END IF;

  -- Cobrar una entrega ES vender: exige pos.usar (el Técnico NO lo tiene) además
  -- de gestionar reparaciones.
  IF NOT has_permission('pos.usar') THEN
    RAISE EXCEPTION 'No tienes permiso para cobrar entregas (pos.usar).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT has_permission('reparaciones.gestionar') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar reparaciones.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Turno abierto POR TIENDA (misma regla que create_order: sin opened_by).
  SELECT count(*) INTO v_open_count
    FROM public.cash_shifts WHERE store_id = v_store AND closed_at IS NULL;
  IF v_open_count = 0 THEN
    RAISE EXCEPTION 'Debes abrir turno para cobrar la entrega.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_open_count > 1 THEN
    RAISE EXCEPTION 'Hay más de un turno abierto en la tienda; contacta al administrador.'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT id INTO v_shift
    FROM public.cash_shifts WHERE store_id = v_store AND closed_at IS NULL;

  -- La orden es de MI tienda y está 'listo' (solo se entrega lo que está listo).
  -- FOR UPDATE serializa contra una segunda entrega concurrente.
  SELECT * INTO v_repair
    FROM public.repair_orders
   WHERE id = p_repair_id AND store_id = v_store
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La orden de reparación no existe en esta tienda. repair_id=%', p_repair_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_repair.status <> 'listo' THEN
    RAISE EXCEPTION 'Solo se entrega una reparación en estado listo (estado actual: %).', v_repair.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_repair.precio IS NULL THEN
    RAISE EXCEPTION 'Define el precio antes de entregar la reparación.' USING ERRCODE = 'check_violation';
  END IF;
  v_price := v_repair.precio;

  -- Cliente de la orden pertenece a MI organización (defensa en profundidad).
  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
      JOIN public.stores s ON s.id = c.store_id
     WHERE c.id = v_repair.customer_id
       AND s.organization_id = get_my_organization_id()
  ) THEN
    RAISE EXCEPTION 'El cliente de la reparación no pertenece a tu organización.' USING ERRCODE = 'check_violation';
  END IF;

  -- Pagos vs precio.
  SELECT count(*), coalesce(sum((p->>'amount')::numeric), 0)
    INTO v_pay_count, v_pay_sum
    FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) p;

  IF v_price = 0 THEN
    -- Garantía / sin cobro: no debe haber pagos.
    IF v_pay_count > 0 THEN
      RAISE EXCEPTION 'La reparación es de garantía (precio 0): no debe llevar pagos.' USING ERRCODE = 'check_violation';
    END IF;
    v_method := 'cash';  -- método nominal para la orden de $0
  ELSE
    IF v_pay_count = 0 THEN
      RAISE EXCEPTION 'Falta el pago de la entrega.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_payments) p WHERE (p->>'amount')::numeric <= 0
    ) THEN
      RAISE EXCEPTION 'Hay un pago con monto no positivo.' USING ERRCODE = 'check_violation';
    END IF;
    IF abs(v_pay_sum - v_price) > 0.5 THEN
      RAISE EXCEPTION 'La suma de los pagos (%) no cuadra con el precio (%).', v_pay_sum, v_price
        USING ERRCODE = 'check_violation';
    END IF;
    v_method := (p_payments->0->>'method')::payment_method;  -- método primario = primer pago
  END IF;

  -- Producto/variante de servicio de la tienda (find-or-create).
  v_svc_var := public.ensure_repair_service_variant(v_store);
  SELECT product_id INTO v_svc_prod FROM public.variants WHERE id = v_svc_var;

  -- 1. Venta (order_number por trigger; imputada al turno abierto).
  INSERT INTO public.orders
    (store_id, customer_id, created_by, status, subtotal, discount, surcharge,
     total, payment_method, cash_received, shift_id)
  VALUES
    (v_store, v_repair.customer_id, v_user, 'completed', v_price, 0, 0,
     v_price, v_method, p_cash_received, v_shift)
  RETURNING id INTO v_order;

  -- 2. Línea de servicio (is_service → deduct_stock_on_sale no descuenta stock).
  INSERT INTO public.order_items
    (order_id, variant_id, product_id, qty, unit_price, list_price, is_gift, gift_reason)
  VALUES
    (v_order, v_svc_var, v_svc_prod, 1, v_price, v_price, false, NULL)
  RETURNING id INTO v_item;

  -- 3. Pagos (solo si hay cobro).
  IF v_pay_count > 0 THEN
    INSERT INTO public.order_payments (order_id, store_id, method, amount)
    SELECT v_order, v_store, (p->>'method')::payment_method, (p->>'amount')::numeric
      FROM jsonb_array_elements(p_payments) p;
  END IF;

  -- 4. Marcar entregado (guardia atómica: solo si sigue 'listo'; el trigger de la
  --    044 registra el historial 'entregado'). Un rowcount 0 = ya la entregaron.
  UPDATE public.repair_orders
     SET status = 'entregado', delivered_by = v_user, delivered_at = now(), order_id = v_order
   WHERE id = p_repair_id AND store_id = v_store AND status = 'listo';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'La reparación ya fue entregada (otra caja la cobró). repair_id=%', p_repair_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deliver_repair(uuid, jsonb, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.deliver_repair(uuid, jsonb, numeric) TO authenticated;


-- ------------------------------------------------------------
-- remove_repair_part — reverso atómico de un repuesto mal cargado.
--   Si es de inventario, RESTAURA el stock y registra el movimiento inverso
--   (repair_consumption con qty POSITIVA). Borra la fila del repuesto. Exige
--   reparaciones.gestionar. RECHAZA si la orden ya está 'entregado' (la historia
--   de una reparación cobrada no se toca). Todo en una transacción.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_repair_part(p_part_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store  uuid;
  v_user   uuid;
  v_part   public.repair_parts%ROWTYPE;
  v_status repair_status;
BEGIN
  v_store := get_my_store_id();
  v_user  := auth.uid();
  IF v_store IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT has_permission('reparaciones.gestionar') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar reparaciones.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_part
    FROM public.repair_parts
   WHERE id = p_part_id AND store_id = v_store
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El repuesto no existe en esta tienda. part_id=%', p_part_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- La orden no puede estar entregada (bloqueamos su fila para coherencia).
  SELECT status INTO v_status
    FROM public.repair_orders WHERE id = v_part.repair_order_id FOR UPDATE;
  IF v_status = 'entregado' THEN
    RAISE EXCEPTION 'No se pueden quitar repuestos de una reparación ya entregada.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Restaura stock solo si era de inventario y la variante aún existe
  -- (variant_id se pone NULL si la variante fue borrada → no hay qué restaurar).
  IF v_part.source = 'inventario' AND v_part.variant_id IS NOT NULL THEN
    UPDATE public.variants
       SET stock_qty = stock_qty + v_part.qty
     WHERE id = v_part.variant_id AND store_id = v_store;

    INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, notes, created_by)
    VALUES (v_part.variant_id, v_store, 'repair_consumption', v_part.qty, v_part.repair_order_id,
            'Reverso repuesto reparación', v_user);
  END IF;

  DELETE FROM public.repair_parts WHERE id = p_part_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_repair_part(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.remove_repair_part(uuid) TO authenticated;


DO $$ BEGIN
  RAISE NOTICE '045 OK: add_repair_part / remove_repair_part (consumo y reverso atómicos) + ensure_repair_service_variant + deliver_repair (cobro atómico).';
END $$;

COMMIT;
