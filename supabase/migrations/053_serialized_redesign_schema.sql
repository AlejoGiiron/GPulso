-- ============================================================
-- 053 — Rediseño de serializados · FASE A (esquema aditivo, sin comportamiento)
--
-- Modelo objetivo (aprobado): el producto serializado es una PLANTILLA con un
-- PRECIO SUGERIDO; cada UNIDAD lleva su COSTO real, su etiqueta de variante en
-- TEXTO LIBRE y su PRECIO (arranca del sugerido, editable al vender). Ver
-- PROPUESTA-rediseno-serializados.md.
--
-- ESTA MIGRACIÓN ES SOLO ESQUEMA: agrega tres columnas ADITIVAS y NULLABLE y
-- siembra suggested_price. NADIE las lee todavía (eso es la Fase B). El
-- comportamiento del sistema NO cambia:
--   · Opción A: la unidad sigue colgando de variant_id (variante ancla técnica).
--   · variants.price / variants.cost_price siguen siendo la fuente de precio/costo
--     HOY (la Fase B moverá la lectura a unit.price ?? suggested_price y unit.cost).
--   · Accesorios (no serializados) INTACTOS: no reciben suggested_price (queda
--     NULL) ni crean filas en units → jamás tocan units.price/variant_label.
--
-- Columnas:
--   · products.suggested_price numeric(12,2) NULL  — precio sugerido de la
--     plantilla serializada. El producto NO gana columna de costo (el costo no
--     existe hasta que entra una unidad real; vive en units.cost, ya existente).
--   · units.price numeric(12,2) NULL  — precio de venta de ESA unidad (semilla =
--     suggested_price en la Fase C; editable al vender). CHECK (NULL o >= 0).
--   · units.variant_label text NULL  — "128GB Azul" en texto libre, opcional.
--
-- BACKFILL: para cada producto serializado que YA exista, suggested_price = price
--   de su variante ancla (size/color NULL preferida; si no, la más antigua). Así
--   ninguno queda sin precio el día que se porte G-Mura o aparezcan datos. En
--   prod HOY no hay serializados → 0 filas afectadas (inofensivo). Idempotente:
--   solo rellena donde suggested_price IS NULL.
--
-- Requiere: 001 (products, variants), 039 (units, products.is_serialized).
-- Idempotente: ADD COLUMN IF NOT EXISTS + guard de constraint + backfill acotado.
-- Aditiva y NULLABLE → sin ALTER TYPE, se envuelve en una transacción.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- A1. products.suggested_price
-- ------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS suggested_price numeric(12,2);

COMMENT ON COLUMN public.products.suggested_price IS
  'Precio sugerido de una plantilla serializada. NULL para accesorios (precian por variants.price). Semilla del precio de cada unidad; editable al vender (Fase B/C).';

-- ------------------------------------------------------------
-- A2. units.price + CHECK, units.variant_label
-- ------------------------------------------------------------
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS price numeric(12,2);

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS variant_label text;

-- CHECK con nombre explícito (ADD CONSTRAINT no tiene IF NOT EXISTS → guard).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.units'::regclass
       AND conname  = 'units_price_non_negative'
  ) THEN
    ALTER TABLE public.units
      ADD CONSTRAINT units_price_non_negative CHECK (price IS NULL OR price >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.units.price IS
  'Precio de venta de ESTA unidad. Arranca del suggested_price del producto y es editable al vender (Fase B/C). NULL = usar suggested_price.';
COMMENT ON COLUMN public.units.variant_label IS
  'Descripción de variante en texto libre de la unidad ("128GB Azul"), opcional. Reemplaza size/color para serializados en la UI de la Fase B.';

-- ------------------------------------------------------------
-- A3. Backfill de suggested_price para serializados existentes
--     Precio de la variante ancla (size/color NULL) si existe, si no la más
--     antigua. Solo donde aún es NULL (idempotente).
-- ------------------------------------------------------------
UPDATE public.products p
   SET suggested_price = sub.price
  FROM (
    SELECT DISTINCT ON (v.product_id) v.product_id, v.price
      FROM public.variants v
     ORDER BY v.product_id,
              (v.size IS NULL AND v.color IS NULL) DESC,  -- prefiere la ancla
              v.created_at ASC
  ) sub
 WHERE sub.product_id = p.id
   AND p.is_serialized = true
   AND p.suggested_price IS NULL;

-- ------------------------------------------------------------
-- Autoverificación
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='products' AND column_name='suggested_price'
  ) THEN RAISE EXCEPTION '053: falta products.suggested_price.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='units' AND column_name='price'
  ) THEN RAISE EXCEPTION '053: falta units.price.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='units' AND column_name='variant_label'
  ) THEN RAISE EXCEPTION '053: falta units.variant_label.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.units'::regclass AND conname='units_price_non_negative'
  ) THEN RAISE EXCEPTION '053: falta el CHECK units_price_non_negative.'; END IF;

  -- Ningún serializado con variante debe quedar sin suggested_price tras el backfill.
  IF EXISTS (
    SELECT 1 FROM public.products p
     WHERE p.is_serialized = true
       AND p.suggested_price IS NULL
       AND EXISTS (SELECT 1 FROM public.variants v WHERE v.product_id = p.id)
  ) THEN
    RAISE EXCEPTION '053: hay un producto serializado con variante y sin suggested_price tras el backfill.';
  END IF;

  RAISE NOTICE '053 OK: columnas aditivas (products.suggested_price, units.price+CHECK, units.variant_label) + backfill de sugerido.';
END $$;

COMMIT;
