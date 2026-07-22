-- ============================================================
-- 052 — Trigger de apertura de stock + rastro del stock inicial
--
-- CONTEXTO (fix/inventory-lock-manual-stock): variants.stock_qty SIGUE siendo la
-- única fuente de verdad del stock (INVENTORY-SPEC). NO se recalcula desde
-- movimientos. Lo que cambia es que deja de editarse A MANO desde el formulario
-- de producto: el stock solo lo mueven compra / ajuste / venta / devolución /
-- apertura, y todos dejan rastro en stock_movements.
--
-- Este trigger cierra el ÚNICO caso que hasta ahora movía stock_qty SIN rastro:
-- el stock inicial capturado AL CREAR una variante (createSimple del producto de
-- variante única, y el alta de variantes reales). Ahora ese stock inicial genera
-- un movimiento 'opening' (051), igual que una compra deja su 'purchase'.
--
-- INVARIANTES:
--   · Solo registra apertura para stock físico POSITIVO (stock_qty > 0). Un alta
--     con 0 no genera movimiento (no hay nada que abrir).
--   · SERIALIZADOS EXCLUIDOS: su stock_qty es DERIVADO de units por el trigger de
--     sincronización (039); su variante ancla nace en 0 y las unidades registran
--     su propio 'opening'/'purchase' por unidad. Guard explícito por is_serialized
--     (defensa en profundidad; con stock_qty=0 igual no entraría).
--   · SIN SESIÓN (auth.uid() NULL): seeds y restauraciones de dump insertan
--     variantes sin usuario. Ahí NO se registra apertura — stock_movements.created_by
--     es NOT NULL y no hay a quién imputar; el stock inicial de un seed no necesita
--     auditoría. En uso real de la app SIEMPRE hay sesión (el alta pasa por RLS).
--   · NO toca variants.stock_qty: solo INSERTA el movimiento. El stock ya lo puso
--     el INSERT de la variante (sigue siendo la fuente de verdad).
--
-- SECURITY DEFINER: para escribir en stock_movements sorteando su RLS de INSERT
--   (mismo patrón que deduct_stock_on_sale/increase_stock_on_purchase de la 001/039).
--   auth.uid() sigue devolviendo el usuario de la sesión aunque la función sea
--   definer (lee el claim del JWT, no el owner).
--
-- Requiere: 001 (variants, stock_movements), 039 (products.is_serialized), 051
--   (enum 'opening', ya commiteado en su propia migración).
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
--
-- FORWARD-ONLY: no se backfillean aperturas de variantes ya existentes (no hay
--   señal confiable de cuál fue su stock inicial vs. sus movimientos posteriores;
--   inventarlo ensuciaría el rastro). Aplica desde su despliegue en adelante.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.log_opening_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_serialized boolean;
  v_user          uuid;
BEGIN
  -- Sin stock físico inicial no hay apertura que registrar.
  IF NEW.stock_qty IS NULL OR NEW.stock_qty <= 0 THEN
    RETURN NEW;
  END IF;

  -- Serializados: el stock lo llevan las unidades; la variante ancla no abre.
  SELECT p.is_serialized INTO v_is_serialized
    FROM public.products p WHERE p.id = NEW.product_id;
  IF COALESCE(v_is_serialized, false) THEN
    RETURN NEW;
  END IF;

  -- Sin sesión (seed/restore): no se puede imputar created_by (NOT NULL) → skip.
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.stock_movements
    (variant_id, store_id, type, qty, reference_id, notes, created_by)
  VALUES
    (NEW.id, NEW.store_id, 'opening', NEW.stock_qty, NULL, 'Apertura de inventario', v_user);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_opening_stock_movement ON public.variants;
CREATE TRIGGER trg_log_opening_stock_movement
  AFTER INSERT ON public.variants
  FOR EACH ROW EXECUTE FUNCTION log_opening_stock_movement();

-- Autoverificación mínima.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_log_opening_stock_movement'
  ) THEN
    RAISE EXCEPTION '052: falta el trigger trg_log_opening_stock_movement.';
  END IF;
  RAISE NOTICE '052 OK: apertura de stock con rastro (movimiento opening en alta con stock > 0, no serializado, con sesión).';
END $$;

COMMIT;
