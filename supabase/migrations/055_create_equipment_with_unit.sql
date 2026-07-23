-- ============================================================
-- 055 — Rediseño de serializados · FASE C: create_equipment_with_unit
--
-- "Puerta 1": crear una PLANTILLA serializada + su variante ancla + la PRIMERA
-- unidad + el movimiento de ingreso de esa unidad, TODO EN UNA TRANSACCIÓN.
-- Reemplaza el flujo de dos pasos (createSimple + addManualUnit) que podía dejar
-- una plantilla huérfana si el alta de la unidad fallaba (deuda R5).
--
-- ATOMICIDAD: corre en la transacción del llamador (un solo SELECT). Sin bloque
--   EXCEPTION → cualquier RAISE (incl. serial duplicado 23505) aborta y revierte
--   TODO: ni producto, ni variante, ni unidad huérfanos. Cierra R5.
--
-- GUARDS (SECURITY DEFINER se salta el RLS → se chequean explícitos, sin relajar):
--   · Sesión válida (get_my_store_id + auth.uid()).
--   · Permiso: productos.gestionar Y inventario.gestionar (la operación crea
--     producto+variante —RLS productos.gestionar— y unidad+movimiento —RLS
--     inventario.gestionar—; se exigen AMBOS, igual que por las vías separadas).
--   · suggested_price OBLIGATORIO y > 0 (decisión aprobada: mitiga R1, ninguna
--     plantilla sin precio).
--   · serial no vacío; costo/precio de unidad no negativos si vienen.
--   · La categoría (si viene) es de MI tienda.
--
-- MODELO (Opción A): la unidad cuelga de la variante ancla (size/color NULL). El
--   precio de la unidad (p_unit_price) es opcional: NULL ⇒ se resuelve al
--   suggested_price al leer (Fase B). El costo vive en la unidad (units.cost); la
--   plantilla NO tiene costo. variants.price espeja el sugerido (vestigial, pero
--   variants.price es NOT NULL); variants.cost_price queda NULL (el costo es por
--   unidad).
--
-- Stock: la unidad nace 'disponible' → el trigger de sincronización (039) pone
--   variants.stock_qty = 1. El movimiento 'adjustment' con unit_id es el rastro
--   del ingreso (misma semántica que el alta manual, addManualUnit). El trigger
--   de apertura (052) NO dispara (variante serializada + stock_qty 0 al insertar).
--
-- Requiere: 001 (products/variants/stock_movements), 020/013 (get_my_*),
--   021 (has_permission), 039 (units + sync), 042 (stock_movements.unit_id),
--   053 (products.suggested_price, units.price, units.variant_label).
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_equipment_with_unit(
  p_name            text,
  p_brand           text,
  p_category_id     uuid,
  p_description     text,
  p_suggested_price numeric,
  p_serial          text,
  p_unit_cost       numeric,
  p_variant_label   text,
  p_unit_price      numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store   uuid;
  v_user    uuid;
  v_product uuid;
  v_variant uuid;
  v_unit    uuid;
BEGIN
  v_store := get_my_store_id();
  v_user  := auth.uid();
  IF v_store IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT has_permission('productos.gestionar') OR NOT has_permission('inventario.gestionar') THEN
    RAISE EXCEPTION 'No tienes permiso para crear equipos (productos.gestionar + inventario.gestionar).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Validaciones de entrada.
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'El nombre del equipo es obligatorio.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_suggested_price IS NULL OR p_suggested_price <= 0 THEN
    RAISE EXCEPTION 'El precio sugerido es obligatorio y debe ser mayor que 0.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_serial IS NULL OR btrim(p_serial) = '' THEN
    RAISE EXCEPTION 'El serial/IMEI de la primera unidad es obligatorio.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN
    RAISE EXCEPTION 'El costo no puede ser negativo.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_unit_price IS NOT NULL AND p_unit_price < 0 THEN
    RAISE EXCEPTION 'El precio de la unidad no puede ser negativo.' USING ERRCODE = 'check_violation';
  END IF;

  -- La categoría, si viene, debe ser de MI tienda (SECURITY DEFINER → chequeo explícito).
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories WHERE id = p_category_id AND store_id = v_store
  ) THEN
    RAISE EXCEPTION 'La categoría no pertenece a tu tienda.' USING ERRCODE = 'check_violation';
  END IF;

  -- 1. Plantilla serializada. size_type 'unique': sin catálogo de variantes.
  INSERT INTO public.products
    (store_id, name, brand, category_id, description, size_type, is_serialized, is_active, suggested_price)
  VALUES
    (v_store, btrim(p_name), nullif(btrim(coalesce(p_brand, '')), ''), p_category_id,
     nullif(btrim(coalesce(p_description, '')), ''), 'unique', true, true, p_suggested_price)
  RETURNING id INTO v_product;

  -- 2. Variante ancla (size/color NULL). price espeja el sugerido (vestigial,
  --    NOT NULL); cost_price NULL (el costo es por unidad). stock_qty 0 → lo pone
  --    el trigger de sincronización al crear la unidad.
  INSERT INTO public.variants
    (product_id, store_id, size, color, sku, barcode, price, cost_price, stock_qty, min_stock, is_active)
  VALUES
    (v_product, v_store, NULL, NULL, NULL, NULL, p_suggested_price, NULL, 0, 0, true)
  RETURNING id INTO v_variant;

  -- 3. Primera unidad. organization_id lo deriva un trigger desde la tienda; el
  --    trigger de sincronización pone variants.stock_qty = 1. Un serial duplicado
  --    (UNIQUE org, serial) aborta TODO acá (sin huérfanos).
  INSERT INTO public.units
    (store_id, variant_id, serial, status, cost, price, variant_label)
  VALUES
    (v_store, v_variant, btrim(p_serial), 'disponible', p_unit_cost, p_unit_price,
     nullif(btrim(coalesce(p_variant_label, '')), ''))
  RETURNING id INTO v_unit;

  -- 4. Rastro del ingreso de la unidad (misma semántica que addManualUnit).
  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, notes, created_by, unit_id)
  VALUES (v_variant, v_store, 'adjustment', 1, 'Ingreso inicial: equipo + primera unidad', v_user, v_unit);

  RETURN jsonb_build_object(
    'product_id', v_product,
    'variant_id', v_variant,
    'unit_id',    v_unit
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_equipment_with_unit(text, text, uuid, text, numeric, text, numeric, text, numeric) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.create_equipment_with_unit(text, text, uuid, text, numeric, text, numeric, text, numeric) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE '055 OK: create_equipment_with_unit (plantilla + ancla + 1ra unidad + movimiento, atómica, guards de tienda/permiso/precio).';
END $$;

COMMIT;
