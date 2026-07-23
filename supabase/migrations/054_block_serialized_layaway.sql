-- ============================================================
-- 054 — Guard de servidor: NO separar equipos serializados (aún)
--
-- RIESGO QUE CIERRA: la UI de separados nunca cableó reserve_unit/
-- release_reserved_unit/complete_reserved_unit (existen y están testeadas desde
-- la 039, pero NewLayawayModal/useLayawayMutations no las llaman). Consecuencia
-- HOY: se puede separar un celular sin que ninguna unidad quede reservada → el
-- equipo sigue 'disponible', otra venta se lo lleva, y al completar el separado
-- no hay unidad que entregar (sobreventa de un equipo caro).
--
-- Hasta cablear separados serializados (fase posterior), se BLOQUEA crear una
-- línea de separado sobre una variante de producto serializado. Guard en BD
-- (no solo UI): un BEFORE INSERT sobre layaway_items lo rechaza por cualquier
-- vía (UI, API directa, script). El mensaje es el mismo que muestra la UI.
--
-- Los accesorios (no serializados) pasan sin cambio.
--
-- Requiere: 008 (layaway_items), 039 (is_serialized_variant).
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reject_serialized_layaway_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_serialized_variant(NEW.variant_id) THEN
    RAISE EXCEPTION 'Los equipos con IMEI aún no se pueden separar.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_serialized_layaway_item ON public.layaway_items;
CREATE TRIGGER trg_reject_serialized_layaway_item
  BEFORE INSERT ON public.layaway_items
  FOR EACH ROW EXECUTE FUNCTION reject_serialized_layaway_item();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reject_serialized_layaway_item'
  ) THEN
    RAISE EXCEPTION '054: falta el trigger trg_reject_serialized_layaway_item.';
  END IF;
  RAISE NOTICE '054 OK: bloqueado separar equipos serializados (guard de servidor sobre layaway_items).';
END $$;

COMMIT;
