-- ============================================================
-- 043 — FASE 3 / Bloque A3: movement_type += 'repair_consumption'
--
-- El taller consume repuestos del inventario (categoría Repuestos, por
-- cantidad) al reparar. Ese consumo NO es una venta (no hay order_item) ni un
-- ajuste manual: es un evento de negocio propio. Decisión (A3 pedía elegir y
-- justificar entre 'repair_consumption' nuevo vs reusar 'adjustment'):
--
--   Se agrega 'repair_consumption'. Razones:
--     · Rastro explícito: el movimiento de una pieza usada en una reparación se
--       lee como tal en la línea de tiempo de la variante y en cualquier reporte
--       de movimientos, sin adivinar por el texto de notas.
--     · 'adjustment' queda LIMPIO para lo suyo (correcciones manuales de stock
--       con motivos configurables). Mezclar consumos de taller ahí ensuciaría
--       los reportes de ajustes y el cuadre mental del dueño.
--     · Costo mínimo: un valor de enum. El resto del sistema que lee
--       movement_type por 'sale'/'return'/'purchase' no se entera.
--
-- AISLADA (sin BEGIN/COMMIT, patrón de la 006): un ALTER TYPE ... ADD VALUE se
--   aplica solo y queda COMMITEADO antes de que la 045 (consume/add_repair_part)
--   lo use en un INSERT. Idempotente por IF NOT EXISTS.
--
-- Requiere: 001 (enum movement_type, tabla stock_movements).
-- ============================================================

ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'repair_consumption';

COMMENT ON TYPE movement_type IS
  'Tipos de movimiento de stock: sale, return, adjustment, purchase, repair_consumption. repair_consumption = pieza del inventario consumida por una orden de reparación (qty negativo, reference_id = repair_order). No es venta ni ajuste.';
