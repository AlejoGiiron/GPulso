-- ============================================================
-- 050 — FASE 4 / Punto 2: corrección de comisiones (reverso + reasignación)
--
-- Se van a equivocar de trabajador o de monto. El ledger credit_commissions es
-- append-only (048): no se edita en sitio. La corrección tiene DOS vías, ambas
-- por RPC (la tabla sigue RPC-only para escritura), y ambas dejan TRAZA (es plata
-- repartida entre personas: nada desaparece sin rastro).
--
-- LA FRONTERA (regla única, no "¿es una corrección?"):
--   ¿La operación cambia el expectedCash de un turno YA CERRADO?
--     · SÍ  → PROHIBIDA (reescribiría un cuadre settled/impreso → el histórico de
--             caja empezaría a mentir).
--     · NO  → permitida.
--
--   Aplicado:
--   · reverse_credit_commission (ANULAR): quita la comisión.
--       - consignación (nunca tocó caja)         → permitido siempre.
--       - efectivo + turno ABIERTO               → permitido (el esperado se
--                                                    recalcula solo, nada settled).
--       - efectivo + turno CERRADO               → PROHIBIDO (baja el esperado de
--                                                    un cuadre cerrado).
--       El monto/método equivocado de una efectivo ya cerrada NO se corrige acá:
--       va por un ajuste explícito en la caja de HOY (vía gastos), sin tocar el
--       cuadre viejo.
--   · reassign_commission_worker (CAMBIAR BENEFICIARIO): permitido SIEMPRE, aun
--       con el turno cerrado, porque NO toca el expectedCash: la plata entró
--       igual y el reparto es el mismo; solo cambia a quién se le paga la
--       quincena. Es además el error más común ("me equivoqué de persona").
--
-- TRAZA (anulación con rastro, NO borrado): la fila revertida NO se elimina; se
--   marca reversed_at/reversed_by y queda VISIBLE como anulada (el trabajador que
--   la vio ayer entiende qué pasó). La reasignación guarda quién/cuándo y el
--   trabajador ORIGINAL. CRÍTICO: las revertidas se EXCLUYEN de TODO cálculo
--   (expectedCash del cuadre, reporte quincenal, total del trabajador, recibo) —
--   la exclusión se hace en cada fuente (ver shiftCommissions.ts, commissionCalc,
--   useCreditCommissions); acá solo se marca el estado.
--
-- Requiere: 048 (credit_commissions, register_credit_commission), 021
--   (has_permission), 026 (cash_shifts). Idempotente donde aplica.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Columnas de traza.
-- ------------------------------------------------------------
ALTER TABLE public.credit_commissions
  ADD COLUMN IF NOT EXISTS reversed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassigned_at      timestamptz,
  ADD COLUMN IF NOT EXISTS reassigned_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Trabajador ORIGINAL (el de la primera vez); worker_id es el beneficiario
  -- ACTUAL. Juntos dan "de quién (original) a quién (actual)".
  ADD COLUMN IF NOT EXISTS original_worker_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.credit_commissions.reversed_at IS
  'Marca de ANULACIÓN (soft-void). Si no es NULL la comisión NO cuenta en ningún cálculo (cuadre/quincena/total), pero SIGUE visible como anulada. La escribe reverse_credit_commission.';
COMMENT ON COLUMN public.credit_commissions.original_worker_id IS
  'Trabajador de la PRIMERA imputación (antes de cualquier reasignación). worker_id es el beneficiario actual.';

-- Ruta caliente del cuadre: solo efectivo ACTIVO (no anulado) imputado al turno.
DROP INDEX IF EXISTS idx_credit_commissions_shift;
CREATE INDEX IF NOT EXISTS idx_credit_commissions_shift_active
  ON public.credit_commissions(shift_id) WHERE shift_id IS NOT NULL AND reversed_at IS NULL;


-- ------------------------------------------------------------
-- 2. reverse_credit_commission — ANULAR (soft-void) con la regla de la frontera.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_credit_commission(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store       uuid;
  v_user        uuid;
  v_comm        public.credit_commissions%ROWTYPE;
  v_shift_closed timestamptz;
BEGIN
  v_store := get_my_store_id();
  v_user  := auth.uid();
  IF v_store IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT has_permission('comisiones.gestionar') THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar comisiones.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- La comisión es de MI tienda; se bloquea la fila para serializar reversos.
  SELECT * INTO v_comm
    FROM public.credit_commissions
   WHERE id = p_id AND store_id = v_store
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La comisión no existe en esta tienda. id=%', p_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_comm.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'La comisión ya está anulada.' USING ERRCODE = 'check_violation';
  END IF;

  -- FRONTERA: una efectivo imputada a un turno CERRADO no se puede anular (bajaría
  -- el expectedCash de un cuadre settled). Consignación y efectivo-turno-abierto sí.
  IF v_comm.metodo = 'efectivo' THEN
    SELECT closed_at INTO v_shift_closed
      FROM public.cash_shifts WHERE id = v_comm.shift_id;
    IF v_shift_closed IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede anular una comisión en efectivo de un turno ya cerrado (cambiaría un cuadre cerrado). Corrige por un ajuste en la caja de hoy.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.credit_commissions
     SET reversed_at = now(), reversed_by = v_user, updated_at = now()
   WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reverse_credit_commission(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.reverse_credit_commission(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 3. reassign_commission_worker — CAMBIAR BENEFICIARIO (caja-safe, siempre).
--    NO toca expectedCash (la plata entró igual, el reparto no cambia): solo
--    mueve a quién se le paga la quincena. Por eso se permite aun con el turno
--    cerrado. Deja traza propia (quién/cuándo + trabajador original).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_commission_worker(
  p_id         uuid,
  p_new_worker uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store uuid;
  v_org   uuid;
  v_user  uuid;
  v_comm  public.credit_commissions%ROWTYPE;
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

  SELECT * INTO v_comm
    FROM public.credit_commissions
   WHERE id = p_id AND store_id = v_store
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La comisión no existe en esta tienda. id=%', p_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_comm.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede reasignar una comisión anulada.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_comm.worker_id = p_new_worker THEN
    RAISE EXCEPTION 'La comisión ya está asignada a ese trabajador.' USING ERRCODE = 'check_violation';
  END IF;

  -- El nuevo trabajador debe ser de MI organización.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr
      JOIN public.stores s ON s.id = pr.store_id
     WHERE pr.id = p_new_worker AND s.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'El trabajador no pertenece a tu organización.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.credit_commissions
     SET worker_id          = p_new_worker,
         -- Preserva el trabajador de la PRIMERA vez (no se pisa en reasignaciones
         -- sucesivas): "de quién originalmente" a "quién ahora" (worker_id).
         original_worker_id = COALESCE(original_worker_id, worker_id),
         reassigned_at      = now(),
         reassigned_by      = v_user,
         updated_at         = now()
   WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reassign_commission_worker(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.reassign_commission_worker(uuid, uuid) TO authenticated;


-- ------------------------------------------------------------
-- 4. Autoverificación mínima.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='credit_commissions'
                    AND column_name='reversed_at') THEN
    RAISE EXCEPTION '050: falta credit_commissions.reversed_at.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='reverse_credit_commission') THEN
    RAISE EXCEPTION '050: falta reverse_credit_commission.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='reassign_commission_worker') THEN
    RAISE EXCEPTION '050: falta reassign_commission_worker.';
  END IF;
  RAISE NOTICE '050 OK: reverso (gateado por turno) + reasignación (caja-safe) con traza; revertidas se excluyen en cada cálculo.';
END $$;

COMMIT;
