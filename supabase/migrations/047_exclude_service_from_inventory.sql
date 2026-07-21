-- ============================================================
-- 047 — FASE 3: el producto de servicio NO es inventario
--
-- El "Servicio de reparación" (products.is_service) es un producto de sistema
-- con variante de stock 0 permanente, existe solo para colgar el cobro en
-- order_items (decisión A4). NO debe aparecer en las superficies de INVENTARIO:
-- se mostraría como "agotado" todos los días y ensuciaría la valorización.
--
-- Esta migración lo excluye de la vista inventory_status (reporte de inventario
-- y su KPI de valorización). Las exclusiones de las queries client-side
-- (useStockLevels, usePOSSearch, useProducts) van en el mismo commit.
--
-- IMPORTANTE: NO se excluye de los reportes de VENTAS. La reparación cobrada SÍ
-- es una venta (ese es el punto de A4): sigue contando en cuadre y ventas.
--
-- Requiere: 003 (inventory_status), 044 (products.is_service).
-- Idempotente: CREATE OR REPLACE VIEW.
-- ============================================================

BEGIN;

CREATE OR REPLACE VIEW public.inventory_status
WITH (security_invoker = true)
AS
SELECT
  v.id                                                        AS variant_id,
  v.product_id,
  p.name                                                      AS product_name,
  p.brand,
  c.name                                                      AS category_name,
  v.size,
  v.color,
  v.sku,
  v.barcode,
  v.store_id,
  v.stock_qty,
  v.min_stock,
  v.price,
  v.cost_price,
  COALESCE(v.stock_qty::numeric * v.cost_price, 0)           AS stock_value,
  CASE
    WHEN v.stock_qty  = 0             THEN 'out'
    WHEN v.stock_qty <= v.min_stock   THEN 'low'
    ELSE                                   'ok'
  END::text                                                   AS stock_state
FROM public.variants v
JOIN  public.products    p ON p.id = v.product_id
LEFT JOIN public.categories c ON c.id = p.category_id
WHERE v.is_active = true
  AND p.is_service = false;   -- el servicio de reparación no es inventario

COMMENT ON VIEW public.inventory_status IS
  'Estado actual del inventario por variante activa (excluye productos is_service). '
  'stock_state: out = sin stock, low = stock ≤ min_stock, ok = stock suficiente. '
  'stock_value = stock_qty × cost_price (0 si cost_price es NULL).';

DO $$ BEGIN
  RAISE NOTICE '047 OK: inventory_status excluye is_service (el servicio de reparación no es inventario).';
END $$;

COMMIT;
