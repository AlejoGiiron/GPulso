-- ============================================================
-- 051 — movement_type += 'opening'
--
-- El stock inicial de una variante (capturado AL CREAR el producto/variante)
-- deja de ser un valor mudo en variants.stock_qty: pasa a tener su RASTRO como
-- un movimiento de apertura. Es un evento de negocio propio, distinto de:
--   · 'adjustment' → corrección manual posterior (conteo, merma).
--   · 'purchase'   → entrada por factura de proveedor.
--   · 'sale'/'return'/'repair_consumption' → operación.
--
-- Decisión (mismo criterio que la 043 al agregar 'repair_consumption' en vez de
-- reusar 'adjustment'): se agrega un valor de enum propio. Razones:
--   · Rastro explícito: la apertura se lee como tal en la línea de tiempo de la
--     variante y en los reportes de movimientos, sin adivinar por el texto.
--   · 'adjustment' queda LIMPIO para correcciones manuales (no se ensucia el
--     reporte de ajustes con el stock inicial de cada alta).
--   · Costo mínimo: un valor de enum; el resto del sistema que lee movement_type
--     por 'sale'/'return'/'purchase' no se entera.
--
-- AISLADA (sin BEGIN/COMMIT, patrón de la 006/043): un ALTER TYPE ... ADD VALUE
--   se aplica solo y queda COMMITEADO antes de que la 052 (trigger de apertura)
--   lo use en un INSERT. Idempotente por IF NOT EXISTS.
--
-- Requiere: 001 (enum movement_type, tabla stock_movements).
-- ============================================================

ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'opening';

COMMENT ON TYPE movement_type IS
  'Tipos de movimiento de stock: sale, return, adjustment, purchase, repair_consumption, opening. opening = stock inicial capturado al crear la variante (qty positivo, reference_id NULL). No es compra ni ajuste manual.';
