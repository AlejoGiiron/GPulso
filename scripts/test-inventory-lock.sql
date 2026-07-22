-- ============================================================
-- test-inventory-lock.sql — Tests de fix/inventory-lock-manual-stock (051/052)
--
-- Verifica que:
--   · El stock inicial capturado AL CREAR una variante genera su movimiento
--     'opening' con rastro (T1), y stock_qty queda correcto.
--   · Un alta con stock 0 NO genera apertura (T2).
--   · Una variante SERIALIZADA no genera apertura aunque nazca con stock > 0
--     (guard is_serialized; su stock lo llevan las unidades) (T3).
--   · NO-REGRESIÓN DE ACCESORIOS: venta / compra / devolución / ajuste manual
--     mueven stock_qty EXACTAMENTE como antes, y el conjunto de movimientos
--     reconcilia contra stock_qty (T4). La apertura es aditiva (nuevo rastro al
--     crear), las operaciones NO cambian un milímetro.
--   · Editar atributos de una variante NO toca stock_qty ni crea movimientos (T5).
--
-- Todo en una transacción con ROLLBACK final → no deja rastro.
--   docker exec -i supabase_db_<proj> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < scripts/test-inventory-lock.sql
--
-- Requiere: migraciones 051 y 052 aplicadas en el lab.
-- ============================================================

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures (como postgres; bypass RLS) ────────────────────────────────────
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'admin@inv.test');

INSERT INTO public.organizations (name) VALUES ('OrgINV') RETURNING id AS org \gset
SELECT public.seed_org_roles(:'org');
SELECT id AS role_admin FROM public.roles WHERE organization_id=:'org' AND name='Administrador' \gset
INSERT INTO public.stores (name, organization_id) VALUES ('StoreINV', :'org') RETURNING id AS store \gset

INSERT INTO public.profiles (id,email,full_name,role,role_id,organization_id,store_id,current_store_id,is_active)
VALUES ('00000000-0000-0000-0000-0000000000b1','admin@inv.test','Admin INV','admin',:'role_admin',:'org',:'store',:'store',true);

-- Producto ACCESORIO (no serializado) y producto SERIALIZADO.
INSERT INTO public.products (name, store_id, is_serialized) VALUES ('Cargador Test', :'store', false) RETURNING id AS pacc \gset
INSERT INTO public.products (name, store_id, is_serialized) VALUES ('iPhone Test',   :'store', true)  RETURNING id AS pser \gset

INSERT INTO public.customers (full_name, store_id) VALUES ('Cliente INV', :'store') RETURNING id AS cust \gset
INSERT INTO public.suppliers  (name, store_id)      VALUES ('Prov INV',   :'store') RETURNING id AS supp \gset

-- Contexto de auth: actuamos como el admin (así auth.uid() no es NULL y el
-- trigger de apertura sí registra el movimiento, como en el uso real).
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- ── T1 — Apertura con rastro al crear con stock inicial > 0 ──────────────────
INSERT INTO public.variants (product_id, store_id, size, color, price, stock_qty)
VALUES (:'pacc', :'store', 'Único', 'Negro', 50000, 10) RETURNING id AS vacc \gset

DO $$
DECLARE v_open int; v_open_qty int; v_stock int;
BEGIN
  SELECT stock_qty INTO v_stock FROM public.variants WHERE id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro');
  SELECT count(*), coalesce(sum(qty),0) INTO v_open, v_open_qty
    FROM public.stock_movements
   WHERE type='opening' AND variant_id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro');
  IF v_stock <> 10 THEN RAISE EXCEPTION 'T1 FALLO: stock_qty no es 10 (=%).', v_stock; END IF;
  IF v_open <> 1 THEN RAISE EXCEPTION 'T1 FALLO: se esperaba 1 movimiento opening (=%).', v_open; END IF;
  IF v_open_qty <> 10 THEN RAISE EXCEPTION 'T1 FALLO: la apertura no es +10 (=%).', v_open_qty; END IF;
  RAISE NOTICE 'T1 OK: alta con stock 10 → stock_qty=10 + 1 movimiento opening (+10).';
END $$;

-- ── T2 — Sin apertura cuando el stock inicial es 0 ──────────────────────────
INSERT INTO public.variants (product_id, store_id, size, color, price, stock_qty)
VALUES (:'pacc', :'store', 'Único', 'Blanco', 50000, 0) RETURNING id AS vzero \gset

DO $$
DECLARE v_open int;
BEGIN
  SELECT count(*) INTO v_open FROM public.stock_movements
   WHERE type='opening' AND variant_id=(SELECT id FROM public.variants WHERE size='Único' AND color='Blanco');
  IF v_open <> 0 THEN RAISE EXCEPTION 'T2 FALLO: no debía haber apertura para stock 0 (=%).', v_open; END IF;
  RAISE NOTICE 'T2 OK: alta con stock 0 → sin movimiento opening.';
END $$;

-- ── T3 — Serializado no abre (guard is_serialized), aun con stock > 0 ───────
INSERT INTO public.variants (product_id, store_id, size, color, price, stock_qty)
VALUES (:'pser', :'store', '128GB', 'Azul', 1000000, 5) RETURNING id AS vser \gset

DO $$
DECLARE v_open int;
BEGIN
  SELECT count(*) INTO v_open FROM public.stock_movements
   WHERE type='opening' AND variant_id=(SELECT id FROM public.variants WHERE size='128GB' AND color='Azul');
  IF v_open <> 0 THEN RAISE EXCEPTION 'T3 FALLO: un serializado no debe generar apertura (=%).', v_open; END IF;
  RAISE NOTICE 'T3 OK: variante serializada → sin apertura (su stock lo llevan las unidades).';
END $$;

-- ── T4 — NO-REGRESIÓN DE ACCESORIOS: venta/compra/devolución/ajuste ─────────
-- Venta de 3 (deduct_stock_on_sale).
INSERT INTO public.orders (store_id, created_by, payment_method, total)
VALUES (:'store','00000000-0000-0000-0000-0000000000b1','cash',150000) RETURNING id AS ord \gset
INSERT INTO public.order_items (order_id, variant_id, product_id, qty, unit_price, list_price)
VALUES (:'ord', :'vacc', :'pacc', 3, 50000, 50000);

DO $$ BEGIN
  IF (SELECT stock_qty FROM public.variants WHERE id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro')) <> 7 THEN
    RAISE EXCEPTION 'T4 FALLO (venta): stock_qty no bajó a 7.';
  END IF;
  RAISE NOTICE 'T4.1 OK: venta de 3 → stock_qty=7 + movimiento sale.';
END $$;

-- Compra de 5 (increase_stock_on_purchase).
INSERT INTO public.purchase_invoices (invoice_number, store_id, supplier_id, created_by, invoice_date, total)
VALUES ('INV-1', :'store', :'supp', '00000000-0000-0000-0000-0000000000b1', current_date, 200000) RETURNING id AS inv \gset
INSERT INTO public.purchase_invoice_items (invoice_id, variant_id, product_id, qty, unit_cost, subtotal, update_cost)
VALUES (:'inv', :'vacc', :'pacc', 5, 40000, 200000, false);

DO $$ BEGIN
  IF (SELECT stock_qty FROM public.variants WHERE id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro')) <> 12 THEN
    RAISE EXCEPTION 'T4 FALLO (compra): stock_qty no subió a 12.';
  END IF;
  RAISE NOTICE 'T4.2 OK: compra de 5 → stock_qty=12 + movimiento purchase.';
END $$;

-- Devolución de 2 (restore_stock_on_return).
INSERT INTO public.returns (original_order_id, store_id, created_by, type)
VALUES (:'ord', :'store', '00000000-0000-0000-0000-0000000000b1', 'return') RETURNING id AS ret \gset
INSERT INTO public.return_items (return_id, variant_id, qty, unit_price, action)
VALUES (:'ret', :'vacc', 2, 50000, 'refund');

DO $$ BEGIN
  IF (SELECT stock_qty FROM public.variants WHERE id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro')) <> 14 THEN
    RAISE EXCEPTION 'T4 FALLO (devolución): stock_qty no subió a 14.';
  END IF;
  RAISE NOTICE 'T4.3 OK: devolución de 2 → stock_qty=14 + movimiento return.';
END $$;

-- Ajuste manual de -4 (replica useInventoryMutations.adjustStock: update + movimiento).
UPDATE public.variants SET stock_qty = stock_qty - 4 WHERE id=:'vacc';
INSERT INTO public.stock_movements (variant_id, store_id, type, qty, notes, created_by)
VALUES (:'vacc', :'store', 'adjustment', -4, 'Ajuste por conteo', '00000000-0000-0000-0000-0000000000b1');

-- Invariante final: stock_qty = suma de TODOS los movimientos de la variante.
DO $$
DECLARE v_stock int; v_sum int; v_types text;
BEGIN
  SELECT stock_qty INTO v_stock FROM public.variants WHERE id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro');
  SELECT coalesce(sum(qty),0) INTO v_sum FROM public.stock_movements
   WHERE variant_id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro');
  SELECT string_agg(DISTINCT type::text, ',' ORDER BY type::text) INTO v_types FROM public.stock_movements
   WHERE variant_id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro');
  IF v_stock <> 10 THEN RAISE EXCEPTION 'T4 FALLO (ajuste): stock_qty final no es 10 (=%).', v_stock; END IF;
  IF v_sum <> v_stock THEN
    RAISE EXCEPTION 'T4 FALLO: los movimientos (%) no reconcilian con stock_qty (%).', v_sum, v_stock;
  END IF;
  IF v_types <> 'adjustment,opening,purchase,return,sale' THEN
    RAISE EXCEPTION 'T4 FALLO: tipos de movimiento inesperados (%).', v_types;
  END IF;
  RAISE NOTICE 'T4 OK: accesorio intacto. stock_qty=10 = Σ movimientos (opening+10, sale-3, purchase+5, return+2, adjustment-4). Tipos: %.', v_types;
END $$;

-- ── T5 — Editar atributos NO toca stock_qty ni crea movimientos ─────────────
-- Replica lo que hace el form de edición tras el fix: cambia precio/size/etc.,
-- nunca stock_qty.
DO $$
DECLARE v_movs_before int; v_movs_after int; v_stock_before int; v_stock_after int;
BEGIN
  SELECT stock_qty INTO v_stock_before FROM public.variants WHERE id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro');
  SELECT count(*) INTO v_movs_before FROM public.stock_movements
   WHERE variant_id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro');

  UPDATE public.variants
     SET price = 55000, color = 'Negro', min_stock = 2
   WHERE id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro');

  SELECT stock_qty INTO v_stock_after FROM public.variants WHERE id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro');
  SELECT count(*) INTO v_movs_after FROM public.stock_movements
   WHERE variant_id=(SELECT id FROM public.variants WHERE size='Único' AND color='Negro');

  IF v_stock_after <> v_stock_before THEN
    RAISE EXCEPTION 'T5 FALLO: editar la variante cambió stock_qty (% -> %).', v_stock_before, v_stock_after;
  END IF;
  IF v_movs_after <> v_movs_before THEN
    RAISE EXCEPTION 'T5 FALLO: editar la variante creó movimientos (% -> %).', v_movs_before, v_movs_after;
  END IF;
  RAISE NOTICE 'T5 OK: editar atributos no toca stock_qty (=%) ni crea movimientos.', v_stock_after;
END $$;

DO $$ BEGIN
  RAISE NOTICE '=== test-inventory-lock: TODOS LOS TESTS PASARON ===';
END $$;

ROLLBACK;
