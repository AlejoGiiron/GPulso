-- ============================================================
-- 048 — FASE 4 / Bloque A: comisiones por crédito (módulo chico)
--
-- CelFashion es punto de venta de una financiera externa. Cuando se cierra un
-- crédito entra una comisión (hoy $100.000) que se reparte entre el LOCAL y el
-- TRABAJADOR que lo gestionó (por defecto 50/50). A fin de quincena se suma lo
-- del trabajador y se le paga. Hoy lo llevan en un CUADERNO; esta tabla lo
-- reemplaza.
--
-- LÍMITES del modelo (deliberados, NO expandir):
--   · El crédito NO es método de pago del POS, NO toca inventario, NO crea
--     órdenes de venta. Es un EVENTO independiente con su propia tabla.
--   · monto_total es CONFIGURABLE (las comisiones cambian). NUNCA se hardcodea:
--     el default de la columna es solo una red; el valor real lo pasa la RPC
--     desde la config de la tienda.
--
-- Decisión APROBADA (cómo entra el efectivo al cuadre) — Opción A:
--   La comisión en EFECTIVO es una fuente de cash-in PROPIA imputada al turno
--   abierto por shift_id, igual que un abono de separado/fiado (que ya suben el
--   efectivo esperado sin ser una venta). NO se modela como cash_expense (esa
--   tabla es solo SALIDAS, amount CHECK > 0). El cuadre la suma a cashSales y la
--   muestra en su propia sección del recibo. Si es CONSIGNACIÓN, shift_id NULL y
--   no toca caja (la plata no está en el cajón).
--
-- Patrones reusados:
--   · organization_id derivado del store por trigger (repair_orders, 044).
--   · turno abierto POR TIENDA en la RPC (deliver_repair/create_order, 045/041).
--   · RLS por store_id (cash_expenses, 007) + self-select del trabajador.
--
-- Requiere: 013 (get_my_store_id), 020 (get_my_organization_id), 021
--   (has_permission), 026 (cash_shifts por tienda), 007 (cash_expenses/shifts).
-- Atomicidad: todo en una transacción. Idempotente donde aplica.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Enum del método de la comisión.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commission_method') THEN
    CREATE TYPE commission_method AS ENUM ('efectivo', 'consignacion');
  END IF;
END $$;

COMMENT ON TYPE commission_method IS
  'Cómo entró la comisión: efectivo (al cajón → se imputa al turno vía shift_id) o consignacion (a la cuenta → no toca caja, shift_id NULL).';


-- ------------------------------------------------------------
-- Tabla credit_commissions.
--   Inmutable (sin UPDATE): un asiento del "cuaderno" no se edita, se corrige
--   borrando (comisiones.gestionar) y re-registrando. Trazabilidad como
--   cash_expenses (007).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_commissions (
  id               uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid              NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id         uuid              NOT NULL REFERENCES public.stores(id)        ON DELETE CASCADE,

  fecha            date              NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Bogota')::date),
  -- Quién gestionó el crédito (a quién se le paga en la quincena).
  worker_id        uuid              NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  -- Opcional: pueden no registrar el cliente.
  customer_id      uuid              REFERENCES public.customers(id) ON DELETE SET NULL,

  -- Monto total de la comisión. Default = red de seguridad; el valor real lo
  -- pasa la RPC desde stores.config (CONFIGURABLE, nunca hardcode en código).
  monto_total      numeric(12,2)     NOT NULL DEFAULT 100000,
  -- Reparto (derivado; por defecto 50/50 pero editable). local + trabajador =
  -- total (validado por CHECK con tolerancia de centavos).
  monto_local      numeric(12,2)     NOT NULL,
  monto_trabajador numeric(12,2)     NOT NULL,

  metodo           commission_method NOT NULL,
  -- SOLO si metodo='efectivo': turno abierto de la tienda al que se imputa (esa
  -- plata está en el cajón → el cuadre debe contarla). NULL en consignación.
  shift_id         uuid              REFERENCES public.cash_shifts(id) ON DELETE SET NULL,

  notas            text,
  created_by       uuid              NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at       timestamptz       NOT NULL DEFAULT now(),
  updated_at       timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT credit_commissions_total_positive     CHECK (monto_total > 0),
  CONSTRAINT credit_commissions_local_non_negative CHECK (monto_local >= 0),
  CONSTRAINT credit_commissions_worker_non_negative CHECK (monto_trabajador >= 0),
  -- Coherencia del reparto (tolerancia de medio peso por redondeos).
  CONSTRAINT credit_commissions_split_coherent
    CHECK (abs((monto_local + monto_trabajador) - monto_total) <= 0.5),
  -- Invariante estructural del efectivo: efectivo ⇒ imputado a un turno;
  -- consignación ⇒ nunca imputado. Cierra el agujero de un efectivo sin turno.
  CONSTRAINT credit_commissions_shift_coherent
    CHECK (
      (metodo = 'efectivo'     AND shift_id IS NOT NULL)
      OR
      (metodo = 'consignacion' AND shift_id IS NULL)
    )
);

COMMENT ON TABLE public.credit_commissions IS
  'Comisiones por crédito de la financiera externa. Evento independiente: NO es venta, NO toca inventario. La comisión en efectivo se imputa al turno (shift_id) y la cuenta el cuadre; en consignación no toca caja. Reemplaza el cuaderno de la quincena.';
COMMENT ON COLUMN public.credit_commissions.monto_total IS
  'Monto total de la comisión (CONFIGURABLE por tienda). El default es solo una red; la RPC pasa el valor de stores.config.';
COMMENT ON COLUMN public.credit_commissions.shift_id IS
  'Turno al que se imputa la comisión en EFECTIVO (está en el cajón). NULL en consignación. El cuadre suma estas comisiones a cashSales.';

CREATE INDEX IF NOT EXISTS idx_credit_commissions_store   ON public.credit_commissions(store_id);
CREATE INDEX IF NOT EXISTS idx_credit_commissions_worker  ON public.credit_commissions(worker_id);
CREATE INDEX IF NOT EXISTS idx_credit_commissions_fecha   ON public.credit_commissions(store_id, fecha);
-- Parcial: la ruta caliente del cuadre (efectivo imputado a un turno).
CREATE INDEX IF NOT EXISTS idx_credit_commissions_shift
  ON public.credit_commissions(shift_id) WHERE shift_id IS NOT NULL;

-- updated_at (set_updated_at ya existe desde 001).
DROP TRIGGER IF EXISTS trg_credit_commissions_updated_at ON public.credit_commissions;
CREATE TRIGGER trg_credit_commissions_updated_at
  BEFORE UPDATE ON public.credit_commissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- organization_id derivado del store (patrón repair_orders, 044).
CREATE OR REPLACE FUNCTION public.credit_commissions_set_org_from_store()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id
    FROM public.stores WHERE id = NEW.store_id;
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'credit_commissions: la tienda % no tiene organización.', NEW.store_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_commissions_set_org ON public.credit_commissions;
CREATE TRIGGER trg_credit_commissions_set_org
  BEFORE INSERT ON public.credit_commissions
  FOR EACH ROW EXECUTE FUNCTION credit_commissions_set_org_from_store();


-- ------------------------------------------------------------
-- RLS — ESCRITURA CERRADA A CLIENTE: solo lectura por política; TODA escritura
--   (crear/corregir) pasa por RPC SECURITY DEFINER. Sin esto, un cliente con
--   comisiones.gestionar podría INSERTAR directo un efectivo imputado a un turno
--   CERRADO o de otra tienda (el CHECK solo exige shift_id NOT NULL, no que el
--   turno esté abierto ni que sea suyo) → saltarse TODAS las validaciones de la
--   RPC. Por eso NO hay política INSERT/UPDATE/DELETE para authenticated.
--
--   SELECT: quien gestiona comisiones ve TODO lo de su tienda; un trabajador SIN
--     el permiso ve SOLO lo suyo (worker_id = auth.uid()) — nunca lo de otros
--     (BLOQUE C, decisión aprobada). Así el sistema no le quita al trabajador la
--     visibilidad que hoy le da el cuaderno.
--   INSERT: sin política → se registra SOLO vía register_credit_commission.
--   UPDATE: sin política → inmutable (ledger append-only, como cash_expenses).
--   DELETE: sin política → la corrección/reverso irá por una RPC dedicada que
--     valida el estado del turno (pendiente de aprobación, Fase 4 punto 2).
-- ------------------------------------------------------------
ALTER TABLE public.credit_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_commissions_select ON public.credit_commissions;
CREATE POLICY credit_commissions_select ON public.credit_commissions FOR SELECT
  USING (
    store_id = get_my_store_id()
    AND (
      has_permission('comisiones.gestionar')
      OR worker_id = auth.uid()
    )
  );


-- ------------------------------------------------------------
-- RPC register_credit_commission — registro ATÓMICO.
--   · Exige permiso comisiones.gestionar.
--   · Valida reparto coherente (local + trabajador = total) y montos.
--   · Valida que el trabajador pertenezca a la MISMA organización.
--   · Si metodo='efectivo': valida turno abierto POR TIENDA (misma regla que
--     create_order/deliver_repair) e imputa la comisión a ese turno. Si es
--     consignación, shift_id NULL.
--   Corre en la transacción del llamador (un solo SELECT), sin bloque EXCEPTION
--   → cualquier RAISE aborta y revierte TODO.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_credit_commission(
  p_worker_id        uuid,
  p_metodo           commission_method,
  p_monto_total      numeric,
  p_monto_local      numeric,
  p_monto_trabajador numeric,
  p_customer_id      uuid    DEFAULT NULL,
  p_fecha            date    DEFAULT NULL,
  p_notas            text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store      uuid;
  v_org        uuid;
  v_user       uuid;
  v_shift      uuid;
  v_open_count integer;
  v_notas      text;
  v_fecha      date;
  v_id         uuid;
BEGIN
  v_store := get_my_store_id();
  v_org   := get_my_organization_id();
  v_user  := auth.uid();
  IF v_store IS NULL OR v_org IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT has_permission('comisiones.gestionar') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar comisiones.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Montos.
  IF p_monto_total IS NULL OR p_monto_total <= 0 THEN
    RAISE EXCEPTION 'El monto total de la comisión debe ser mayor que 0.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_monto_local IS NULL OR p_monto_local < 0
     OR p_monto_trabajador IS NULL OR p_monto_trabajador < 0 THEN
    RAISE EXCEPTION 'El reparto de la comisión no puede ser negativo.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- El reparto debe cuadrar con el total (tolerancia de medio peso).
  IF abs((p_monto_local + p_monto_trabajador) - p_monto_total) > 0.5 THEN
    RAISE EXCEPTION 'El reparto (local % + trabajador %) no cuadra con el total %.',
      p_monto_local, p_monto_trabajador, p_monto_total
      USING ERRCODE = 'check_violation';
  END IF;

  -- El trabajador debe existir y pertenecer a MI organización (defensa en
  -- profundidad: no se comisiona a alguien de otra org).
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr
      JOIN public.stores s ON s.id = pr.store_id
     WHERE pr.id = p_worker_id
       AND s.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'El trabajador no pertenece a tu organización.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cliente (si se registró) debe ser de MI organización.
  IF p_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c
      JOIN public.stores s ON s.id = c.store_id
     WHERE c.id = p_customer_id
       AND s.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'El cliente no pertenece a tu organización.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Efectivo ⇒ turno abierto POR TIENDA (misma regla que create_order:
  -- exactamente uno, sin opened_by). Consignación ⇒ no toca caja.
  IF p_metodo = 'efectivo' THEN
    SELECT count(*) INTO v_open_count
      FROM public.cash_shifts WHERE store_id = v_store AND closed_at IS NULL;
    IF v_open_count = 0 THEN
      RAISE EXCEPTION 'Debes abrir turno para registrar una comisión en efectivo.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_open_count > 1 THEN
      RAISE EXCEPTION 'Hay más de un turno abierto en la tienda; contacta al administrador.'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT id INTO v_shift
      FROM public.cash_shifts WHERE store_id = v_store AND closed_at IS NULL;
  ELSE
    v_shift := NULL;  -- consignación: nunca imputa a caja
  END IF;

  v_notas := NULLIF(btrim(coalesce(p_notas, '')), '');
  v_fecha := COALESCE(p_fecha, (now() AT TIME ZONE 'America/Bogota')::date);

  INSERT INTO public.credit_commissions
    (store_id, fecha, worker_id, customer_id, monto_total, monto_local,
     monto_trabajador, metodo, shift_id, notas, created_by)
  VALUES
    (v_store, v_fecha, p_worker_id, p_customer_id, p_monto_total, p_monto_local,
     p_monto_trabajador, p_metodo, v_shift, v_notas, v_user)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_credit_commission(uuid, commission_method, numeric, numeric, numeric, uuid, date, text) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.register_credit_commission(uuid, commission_method, numeric, numeric, numeric, uuid, date, text) TO authenticated;


-- ------------------------------------------------------------
-- Autoverificación mínima.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.credit_commissions') IS NULL THEN
    RAISE EXCEPTION '048: falta credit_commissions.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.credit_commissions'::regclass) THEN
    RAISE EXCEPTION '048: credit_commissions sin RLS.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='register_credit_commission'
  ) THEN
    RAISE EXCEPTION '048: falta register_credit_commission.';
  END IF;
  RAISE NOTICE '048 OK: credit_commissions + RLS (self-select del trabajador) + register_credit_commission (atómica, turno por tienda en efectivo).';
END $$;

COMMIT;
