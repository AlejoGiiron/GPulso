-- ============================================================
-- seed.sql — Datos de LABORATORIO para el stack local de G-Pulso.
--
-- Lo aplica `supabase start` / `supabase db reset` (db.seed.enabled = true).
-- Crea una organización de prueba, una tienda y TRES usuarios con roles
-- distintos para poder probar los cortes de permiso (en especial el taller de
-- reparaciones de la Fase 3).
--
-- OBVIAMENTE de laboratorio: nombres "Lab", emails @lab.local. NADA que se
-- pueda confundir con datos reales de CelFashion.
--
-- Credenciales (todas con la misma contraseña):
--   admin@lab.local     / lab12345   → rol Administrador (todo)
--   vendedora@lab.local / lab12345   → rol Vendedor (POS, recibe/cobra taller,
--                                       NO ve costos de repuestos)
--   tecnico@lab.local   / lab12345   → rol Técnico (gestiona taller + ve costos,
--                                       NO vende: no puede cobrar entregas)
--
-- Idempotente: reaplicar (db reset) no duplica nada (ON CONFLICT DO NOTHING).
-- Requiere: migraciones 001→047 aplicadas (roles vía seed_org_roles de la 035/046).
-- ============================================================

-- IDs fijos de laboratorio (prefijo a0…) para que el seed sea determinista.
DO $$
DECLARE
  v_org   uuid := 'a0000000-0000-0000-0000-000000000001';
  v_store uuid := 'a0000000-0000-0000-0000-000000000010';
  v_admin uuid := 'a0000000-0000-0000-0000-0000000000a1';
  v_selle uuid := 'a0000000-0000-0000-0000-0000000000a2';
  v_tech  uuid := 'a0000000-0000-0000-0000-0000000000a3';
  v_pass  text := crypt('lab12345', gen_salt('bf'));
  r_admin uuid;
  r_selle uuid;
  r_tech  uuid;
BEGIN
  -- 1. Organización de laboratorio + roles base (seed_org_roles crea
  --    Dueño/Administrador/Vendedor/Técnico con sus permisos canónicos).
  INSERT INTO public.organizations (id, name)
  VALUES (v_org, 'Lab G-Pulso')
  ON CONFLICT (id) DO NOTHING;

  PERFORM public.seed_org_roles(v_org);

  SELECT id INTO r_admin FROM public.roles WHERE organization_id = v_org AND name = 'Administrador';
  SELECT id INTO r_selle FROM public.roles WHERE organization_id = v_org AND name = 'Vendedor';
  SELECT id INTO r_tech  FROM public.roles WHERE organization_id = v_org AND name = 'Técnico';

  -- 2. Tienda de laboratorio.
  INSERT INTO public.stores (id, name, organization_id)
  VALUES (v_store, 'Lab G-Pulso — Tienda', v_org)
  ON CONFLICT (id) DO NOTHING;

  -- 3. Usuarios auth (gotrue). email_confirmed_at para poder loguear sin correo.
  INSERT INTO auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
     'admin@lab.local', v_pass, now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_selle, 'authenticated', 'authenticated',
     'vendedora@lab.local', v_pass, now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_tech, 'authenticated', 'authenticated',
     'tecnico@lab.local', v_pass, now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  -- 3a. gotrue no tolera NULL en sus columnas de token: escanea a string y
  --     revienta ("Database error querying schema") en el login. Las normalizo a
  --     '' para los usuarios de laboratorio (idempotente).
  UPDATE auth.users SET
    confirmation_token = '', recovery_token = '', email_change = '',
    email_change_token_new = '', email_change_token_current = '',
    phone_change = '', phone_change_token = '', reauthentication_token = ''
  WHERE id IN (v_admin, v_selle, v_tech);

  -- 3b. Identidad email (gotrue la exige para login por contraseña).
  INSERT INTO auth.identities
    (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_admin, v_admin::text,
     json_build_object('sub', v_admin::text, 'email', 'admin@lab.local'), 'email', now(), now(), now()),
    (gen_random_uuid(), v_selle, v_selle::text,
     json_build_object('sub', v_selle::text, 'email', 'vendedora@lab.local'), 'email', now(), now(), now()),
    (gen_random_uuid(), v_tech, v_tech::text,
     json_build_object('sub', v_tech::text, 'email', 'tecnico@lab.local'), 'email', now(), now(), now())
  ON CONFLICT (provider_id, provider) DO NOTHING;

  -- 4. Profiles (perfil de negocio ligado a la tienda + rol RBAC).
  --    role legacy: admin para el Administrador; seller para los demás.
  INSERT INTO public.profiles
    (id, email, full_name, role, role_id, organization_id, store_id, current_store_id, is_active)
  VALUES
    (v_admin, 'admin@lab.local',     'Admin Lab',     'admin',  r_admin, v_org, v_store, v_store, true),
    (v_selle, 'vendedora@lab.local', 'Vendedora Lab', 'seller', r_selle, v_org, v_store, v_store, true),
    (v_tech,  'tecnico@lab.local',   'Técnico Lab',   'seller', r_tech,  v_org, v_store, v_store, true)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'seed OK: org Lab G-Pulso + tienda + 3 usuarios (admin/vendedora/tecnico @lab.local, pass lab12345).';
END $$;

-- ------------------------------------------------------------
-- Datos DEMO del taller: clientes + órdenes en varios estados/edades para que el
-- kanban se vea poblado (colores por columna, chips de días, costos). Idempotente.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_store uuid := 'a0000000-0000-0000-0000-000000000010';
  v_admin uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  -- Clientes demo.
  INSERT INTO public.customers (id, full_name, phone, store_id) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'Ana Torres',     '3005551201', v_store),
    ('b0000000-0000-0000-0000-000000000002', 'Miguel Sánchez', '3129084471', v_store),
    ('b0000000-0000-0000-0000-000000000003', 'Carlos Ruiz',    '3014429087', v_store),
    ('b0000000-0000-0000-0000-000000000004', 'Laura Gómez',    '3187742210', v_store),
    ('b0000000-0000-0000-0000-000000000005', 'Pedro Ramírez',  '3001285567', v_store),
    ('b0000000-0000-0000-0000-000000000006', 'Sofía Díaz',     '3156628890', v_store)
  ON CONFLICT (id) DO NOTHING;

  -- Órdenes de reparación (created_at controla los "días transcurridos").
  INSERT INTO public.repair_orders
    (id, store_id, customer_id, marca, modelo, imei_serial, falla_reportada, status, precio, received_by, created_at)
  VALUES
    ('c0000000-0000-0000-0000-000000000001', v_store, 'b0000000-0000-0000-0000-000000000001',
     'Apple', 'iPhone 12', '350100111222333', 'La pantalla no responde al tacto en la mitad inferior.',
     'recibido', NULL, v_admin, now()),
    ('c0000000-0000-0000-0000-000000000002', v_store, 'b0000000-0000-0000-0000-000000000002',
     'Samsung', 'Galaxy A32', '350100444555666', 'La batería se agota en pocas horas y se calienta.',
     'recibido', NULL, v_admin, now() - interval '1 day'),
    ('c0000000-0000-0000-0000-000000000003', v_store, 'b0000000-0000-0000-0000-000000000003',
     'Xiaomi', 'Redmi Note 12', '350100777888999', 'No carga aunque se conecte; el conector se siente flojo.',
     'en_reparacion', 150000, v_admin, now() - interval '3 days'),
    ('c0000000-0000-0000-0000-000000000004', v_store, 'b0000000-0000-0000-0000-000000000004',
     'Apple', 'MacBook Air 2019', 'C02XL0AAJGH5', 'No enciende ni da señales de carga.',
     'en_reparacion', 400000, v_admin, now() - interval '5 days'),
    ('c0000000-0000-0000-0000-000000000005', v_store, 'b0000000-0000-0000-0000-000000000005',
     'Apple', 'iPhone 11', '350100123123123', 'Pantalla rota tras caída; táctil intermitente.',
     'listo', 350000, v_admin, now() - interval '6 days'),
    ('c0000000-0000-0000-0000-000000000006', v_store, 'b0000000-0000-0000-0000-000000000006',
     'Motorola', 'Moto G60', '350100321321321', 'Puerto de carga suelto, no hace buen contacto.',
     'listo', 180000, v_admin, now() - interval '7 days')
  ON CONFLICT (id) DO NOTHING;

  -- Repuestos demo (compra externa) para las órdenes con costo.
  INSERT INTO public.repair_parts (id, repair_order_id, store_id, source, descripcion, costo, created_by) VALUES
    ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', v_store, 'compra_externa', 'Conector de carga', 38000, v_admin),
    ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', v_store, 'compra_externa', 'Placa de carga', 120000, v_admin),
    ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', v_store, 'compra_externa', 'Pantalla OLED', 210000, v_admin),
    ('d0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000006', v_store, 'compra_externa', 'Flex puerto de carga', 55000, v_admin)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'seed demo OK: 6 clientes + 6 órdenes (recibido/en_reparacion/listo) + repuestos.';
END $$;
