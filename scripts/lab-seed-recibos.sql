-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  lab-seed-recibos.sql — datos de ejemplo para probar los COMPROBANTES     ║
-- ║  (ticket de venta, separado, cuadre, taller y devolución) en el LAB.      ║
-- ║                                                                            ║
-- ║  SOLO LAB. Aborta si no corre por el socket local del contenedor de       ║
-- ║  Supabase (en prod la conexión es por red → inet_server_addr() no es NULL).║
-- ║                                                                            ║
-- ║  Uso (después de ./scripts/lab-restore.sh):                                ║
-- ║    MSYS_NO_PATHCONV=1 docker exec -i supabase_db_gpulso \                  ║
-- ║      psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/lab-seed-recibos.sql
-- ║                                                                            ║
-- ║  Qué deja (tienda CelFashion — Principal, usuario qa.admin):               ║
-- ║   · stores.config.receipt_width_mm = 58                                    ║
-- ║   · contraseña de LAB para qa.admin@celfashion.co: lab58mm                 ║
-- ║   · el turno abierto heredado del dump se cierra; se abre uno HOY          ║
-- ║   · cliente de nombre largo, equipo serializado con IMEI                   ║
-- ║   · venta MIXTA (efectivo + transferencia) con IMEI → reimprimible y       ║
-- ║     devolvible desde Devoluciones (es de hoy, dentro del límite)           ║
-- ║   · separado con abono MIXTO + abono histórico → reimprimible              ║
-- ║   · egreso con motivo largo en el turno de hoy                             ║
-- ║   · reparación LISTA con IMEI y checklist → para imprimir la entrega       ║
-- ║  Al cerrar el turno desde la app se imprime el cuadre con todo lo anterior.║
-- ╚══════════════════════════════════════════════════════════════════════════╝

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'ABORTADO: lab-seed-recibos.sql solo corre dentro del contenedor del lab (socket local). Esta conexión es por red (%).', inet_server_addr();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE name = 'CelFashion — Principal') THEN
    RAISE EXCEPTION 'ABORTADO: no está la tienda del dump (CelFashion — Principal). Corre antes ./scripts/lab-restore.sh.';
  END IF;
END
$guard$;

BEGIN;

CREATE TEMP TABLE seed_ctx ON COMMIT DROP AS
SELECT s.id AS store_id, s.organization_id AS org_id, p.id AS admin_id
  FROM public.stores s
  JOIN public.profiles p ON p.email = 'qa.admin@celfashion.co'
 WHERE s.name = 'CelFashion — Principal';

-- 1. Ancho de recibo 58mm + contraseña de lab ─────────────────────────────────
UPDATE public.stores s
   SET config = coalesce(s.config, '{}'::jsonb) || '{"receipt_width_mm": 58}'::jsonb
  FROM seed_ctx c WHERE s.id = c.store_id;

UPDATE auth.users u
   SET encrypted_password = extensions.crypt('lab58mm', extensions.gen_salt('bf'))
  FROM seed_ctx c WHERE u.id = c.admin_id;

-- 2. Turno: cerrar el heredado y abrir uno hoy ────────────────────────────────
UPDATE public.cash_shifts sh
   SET closed_at = now() - interval '2 hours', closing_amount = 0, closed_by = c.admin_id
  FROM seed_ctx c
 WHERE sh.store_id = c.store_id AND sh.closed_at IS NULL;

INSERT INTO public.cash_shifts (store_id, opened_by, opening_amount, opened_at)
SELECT store_id, admin_id, 100000, now() - interval '1 hour' FROM seed_ctx;

-- 3. Cliente de nombre largo ──────────────────────────────────────────────────
INSERT INTO public.customers (store_id, full_name, phone, notes)
SELECT store_id, 'María Fernanda Castaño Villalobos', '3001234567', 'Cliente de prueba (lab-seed-recibos)'
  FROM seed_ctx;

-- 4-5. Equipo serializado y venta mixta, por las RPCs reales como qa.admin ────
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', admin_id, 'role', 'authenticated')::text, true)
  FROM seed_ctx;
SET LOCAL ROLE authenticated;

SELECT public.create_equipment_with_unit(
  'Samsung Galaxy A15 (lab)', 'Samsung', NULL, 'Equipo de prueba de comprobantes',
  650000, '356938035643809', 480000, '128GB · Negro', 650000);

SELECT public.create_order(
  (SELECT id FROM public.customers WHERE full_name = 'María Fernanda Castaño Villalobos' ORDER BY created_at DESC LIMIT 1),
  400000,            -- efectivo recibido (porción efectivo)
  680000, 0, 0, 680000,
  'cash',
  jsonb_build_array(
    (SELECT jsonb_build_object('variant_id', u.variant_id, 'product_id', v.product_id, 'qty', 1,
                               'unit_price', 650000, 'list_price', 650000, 'unit_id', u.id)
       FROM public.units u JOIN public.variants v ON v.id = u.variant_id
      WHERE u.serial = '356938035643809'),
    (SELECT jsonb_build_object('variant_id', v.id, 'product_id', v.product_id, 'qty', 2,
                               'unit_price', v.price, 'list_price', v.price)
       FROM public.variants v JOIN public.products p ON p.id = v.product_id
      WHERE p.name = 'CABLE USB-TC 5A' AND v.price = 15000 LIMIT 1)
  ),
  '[{"method":"cash","amount":400000},{"method":"transfer","amount":280000}]'::jsonb
);

RESET ROLE;

-- 6. Separado con abono MIXTO (turno de hoy) + abono HISTÓRICO ───────────────
WITH c AS (SELECT * FROM seed_ctx),
cust AS (SELECT id FROM public.customers WHERE full_name = 'María Fernanda Castaño Villalobos' ORDER BY created_at DESC LIMIT 1),
item AS (
  SELECT v.id AS variant_id, v.product_id, v.price
    FROM public.variants v JOIN public.products p ON p.id = v.product_id
   WHERE p.name = 'AROS DE LUZ' AND v.price = 160000 LIMIT 1
),
lay AS (
  INSERT INTO public.layaways (store_id, customer_id, created_by, subtotal, discount, total, expires_at, notes)
  SELECT c.store_id, cust.id, c.admin_id, item.price, 0, item.price, now() + interval '90 days', 'lab-seed-recibos'
    FROM c, cust, item
  RETURNING id, store_id
)
INSERT INTO public.layaway_items (layaway_id, variant_id, product_id, qty, unit_price, list_price)
SELECT lay.id, item.variant_id, item.product_id, 1, item.price, item.price FROM lay, item;

INSERT INTO public.layaway_payments (layaway_id, store_id, amount, payment_method, created_by, shift_id, is_historical, created_at)
SELECT l.id, c.store_id, x.amount, x.method::payment_method, c.admin_id,
       CASE WHEN x.hist THEN NULL ELSE sh.id END, x.hist, x.at
  FROM seed_ctx c
  JOIN public.layaways l ON l.store_id = c.store_id AND l.notes = 'lab-seed-recibos'
  JOIN public.cash_shifts sh ON sh.store_id = c.store_id AND sh.closed_at IS NULL
  CROSS JOIN (VALUES
    (20000::numeric, 'cash',     true,  now() - interval '20 days'),  -- histórico
    (50000::numeric, 'cash',     false, now() - interval '30 minutes'),  -- mixto (mismo instante)
    (30000::numeric, 'transfer', false, now() - interval '30 minutes')
  ) AS x(amount, method, hist, at);

-- 7. Egreso con motivo largo en el turno de hoy ───────────────────────────────
INSERT INTO public.cash_expenses (shift_id, store_id, amount, reason, created_by, kind)
SELECT sh.id, c.store_id, 45000, 'Pago a proveedor: Distribuidora Accesorios del Valle', c.admin_id, 'expense'
  FROM seed_ctx c JOIN public.cash_shifts sh ON sh.store_id = c.store_id AND sh.closed_at IS NULL;

-- 8. Reparación LISTA con IMEI + checklist (para imprimir la ENTREGA) ────────
INSERT INTO public.repair_orders (organization_id, store_id, customer_id, marca, modelo, imei_serial, color,
                                  falla_reportada, checklist, accesorios, observaciones, status, precio, received_by)
SELECT c.org_id, c.store_id,
       (SELECT id FROM public.customers WHERE full_name = 'María Fernanda Castaño Villalobos' ORDER BY created_at DESC LIMIT 1),
       'Samsung', 'Galaxy A32', '352099001761481', 'Azul',
       'Pantalla partida y no carga con el cable original',
       '{"danos":{"pantalla_rota":true,"golpes":true,"mojado":true},"verificaciones":{"enciende":true,"botones_ok":true}}'::jsonb,
       'Cargador, forro transparente y SIM Claro',
       'Cambio de display, flex de carga y limpieza por humedad',
       'listo', 180000, c.admin_id
  FROM seed_ctx c;

COMMIT;

-- Resumen ─────────────────────────────────────────────────────────────────────
\echo '--- lab-seed-recibos: resumen'
SELECT (SELECT config->>'receipt_width_mm' FROM public.stores WHERE name = 'CelFashion — Principal') AS receipt_width_mm,
       (SELECT order_number FROM public.orders ORDER BY created_at DESC LIMIT 1) AS venta_mixta_n,
       (SELECT layaway_number FROM public.layaways WHERE notes = 'lab-seed-recibos') AS separado_n,
       (SELECT order_number FROM public.repair_orders WHERE imei_serial = '352099001761481') AS reparacion_lista_n,
       (SELECT to_char(opened_at AT TIME ZONE 'America/Bogota', 'HH24:MI') FROM public.cash_shifts WHERE closed_at IS NULL) AS turno_abierto_desde;
