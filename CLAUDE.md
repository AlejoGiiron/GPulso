# G-Pulso — contexto del proyecto

## Descripción
G-Pulso es un sistema POS para tiendas de tecnología (celulares, cómputo,
accesorios) **con taller de reparaciones**. Maneja inventario por variantes,
códigos de barras, devoluciones y CRM de clientes.

> **Fork de G-Mura.** G-Pulso nace como fork del POS de ropa G-Mura (en
> producción). La trazabilidad del fork (commit de origen, última migración
> heredada, deudas heredadas y fixes porteados A MANO) vive en
> [`FORKED_FROM.md`](FORKED_FROM.md) en la raíz. Aislamiento total: repo,
> proyecto Supabase y proyecto Vercel PROPIOS; nada compartido con G-Mura en
> runtime.

## Stack tecnológico
- Frontend: React 18, TypeScript (strict), Tailwind CSS, Vite
- Base de datos: Supabase (PostgreSQL + Auth + Realtime + Storage)
- Estado global: Zustand
- Fetching: React Query (@tanstack/react-query)
- Validación: Zod
- Íconos: lucide-react
- Fechas: date-fns
- Códigos de barras: quagga2 (lectura), JsBarcode (generación)

## Diferencias clave (tienda de tecnología)
- Los productos tienen variantes (ej. capacidad + color: "128GB · Azul").
  Estructuralmente la variante sigue siendo `talla + color` en BD (heredado de
  G-Mura); la UI la etiqueta genéricamente como "Variante".
- **Unidades serializadas (IMEI/serial) sobre las variantes — PRÓXIMAMENTE en
  fase 2.** Un celular no se vende "por cantidad" sino como una unidad única con
  su IMEI. La capa de unidades se montará ENCIMA del esquema de variantes actual;
  en Fase 1 no existe todavía.
- **Taller de reparaciones — PRÓXIMAMENTE en fase 3** (órdenes de reparación,
  estados tipo kanban, rol Técnico).
- **Accesorios por cantidad**: cargadores, forros, etc. se manejan por stock de
  cantidad como hoy (sin serial).
- El stock se maneja por variante, no por producto.
- Los clientes son registrados para historial y CRM.
- Las devoluciones y cambios son flujos críticos.
- Los códigos de barras son fundamentales para ventas rápidas.
- Los separados (layaways) se CONSERVAN: son práctica común para equipos
  costosos.

## Convenciones de código
- Componentes: PascalCase en archivos .tsx
- Hooks: camelCase con prefijo "use"
- Tipos: PascalCase, sin prefijo I ni T
- Strings UI: en español (Colombia)
- Precios: siempre en COP con Intl.NumberFormat('es-CO')
- Fechas: siempre en zona horaria America/Bogota
- IDs: UUID v4 generados por Supabase

## Patrones establecidos
- Componentes funcionales con React hooks
- No usar any en TypeScript
- Errores de Supabase con react-hot-toast
- Mutaciones de BD en hooks custom (useXMutations)
- Queries de Supabase solo en hooks, nunca en componentes
- Canales Realtime con nombre único:
  supabase.channel("nombre-${Math.random().toString(36).slice(2)}")

## RBAC / permisos por rol (multi-org)
- Fuente única de verdad de los permisos de los roles base:
  `canonical_role_permissions(name)` en la migración 035. Los roles de una org
  NUEVA se crean con `seed_org_roles(org_id)` (la usa create-lab-org.sql y el
  futuro flujo de "crear org desde la app").
- Para AGREGAR un permiso nuevo a un rol base:
  1. Editar el array del rol en `canonical_role_permissions()` (035).
  2. Nueva migración con reconciliación ADITIVA **sin filtro de organización**
     (patrón de la 034): `WHERE name IN ('Administrador','Vendedor') AND NOT
     permissions ? '*' AND NOT (permissions @> canonical_role_permissions(name))`.
  3. Actualizar `src/lib/permissionsCatalog.ts` (catálogo de la UI) si el
     permiso es nuevo en el sistema.
- NUNCA asignar permisos filtrando por `organizations.name = '...'`. Las
  migraciones 023/027/029 lo hicieron (hardcode a 'La Bodega del Jeans') y por
  eso una org futura nacía sin esos permisos. Ese patrón está PROHIBIDO; el
  molde correcto es la 034/035.

## Design system
- Sidebar: slate-900 (#0f172a)
- Acento primario: **cian #06b6d4** (hover/activos #0891b2, fondos suaves
  #ecfeff, borde suave #a5f3fc). En Tailwind: `cyan-500/600` y familia `cyan-*`.
- Fondo principal: blanco / gris muy claro
- Tipografía de UI: **IBM Plex Sans**
- IMEI/seriales y precios: **JetBrains Mono**
- Logo: componente inline `src/components/layout/Logo.tsx` (cuadro cian con
  trazo de electrocardiograma en slate-900). Es placeholder hasta el asset
  final; se reemplaza cambiando solo ese SVG.

## Archivos de diseño
- Los diseños de referencia están en _design/
- Siempre leer el archivo de diseño correspondiente antes de construir una página
- Usar como guía visual, no copiar código directamente
- Convertir siempre a TypeScript estricto y convenciones del proyecto

## Variables de entorno
VITE_GPULSO_SUPABASE_URL=
VITE_GPULSO_SUPABASE_ANON_KEY=

## Git
- Rama de desarrollo: develop
- Nunca commit directo a main
- Commits en Conventional Commits
- Un commit por funcionalidad completa

## Numeración de migraciones
- **Hasta la 056: numeración secuencial** (`056_nombre.sql`). Congelada, no se
  renumera nada de lo existente.
- **De ahí en adelante: prefijo de timestamp** `AAAAMMDD_HHMM_nombre.sql`
  (ej. `20260728_1630_repair_status_rpc_only.sql`).
- **Por qué:** con ramas largas en paralelo, dos features toman el mismo número
  siguiente y colisionan al mergear (pasó el 2026-07-28: el rediseño de
  serializados tenía 053–056 y otra rama creó su propia 053). El timestamp hace
  la colisión imposible y el orden refleja el momento real de creación.
- Los dos formatos **conviven sin tocar nada**: ordenan bien lexicográficamente
  (`0…` < `2…`), así que el glob de `apply-migrations-fresh.sh` aplica primero
  todas las secuenciales y después las de timestamp. Verificado.

## Estado actual del proyecto
Última fase completada: 07 - Configuración ✅ + hotfix/qa-pre-deploy ✅
  - src/types/config.types.ts: StoreConfig, StoreColorConfig, LabelFields, LabelFormat
  - src/hooks/useConfig.ts: useStoreConfig, useStoreUsers, resolveConfig, DEFAULT_CONFIG
    staleTime: 5min en ambas queries
  - src/hooks/useConfigMutations.ts: updateStore, updateStoreConfig, uploadLogo,
    uploadNequiQR, createUser (Edge Function), updateUserRole, toggleUserActive
  - supabase/functions/create-user/index.ts: Deno Edge Function con admin client
  - ConfigPage.tsx: layout nav w-56 + 5 secciones (Tienda, Usuarios, Productos, Caja, Etiquetas)
  - StoreSection: nombre/dirección/teléfono, logo upload circular, zona horaria
  - UsersSection: lista con avatar gradiente, badges de rol, toggles activo/inactivo, modal crear usuario
  - ProductsSection: drag-and-drop de tallas, color picker nativo, marcas, días devolución
  - CajaSection: motivos de ajuste, métodos de pago checkboxes, QR Nequi upload (con try/catch)
  - EtiquetasSection: formato radio (3 tamaños), campos checkboxes, preview JsBarcode en vivo
  - stores.config (jsonb) centraliza: sizes, colors, brands, return_days_limit,
    adjustment_reasons, payment_methods, nequi_qr_url, label_format, label_fields

Hotfix QA pre-deploy (hotfix/qa-pre-deploy) ✅
  - SEGURIDAD: store_id en useOrderDetail y adjustStock (SELECT + UPDATE)
  - SEGURIDAD: useVariantSearch reescrito con 2 queries server-side + LIMIT 50
  - CONFIG→POS: payment_methods de StoreConfig conectado a PaymentModal
  - CONFIG→Returns: return_days_limit de StoreConfig conectado a ReturnsPage
  - useCustomerSearch extraído a useCustomers.ts (eliminado inline de POSPage)
  - AuthContext: catch en fetchProfile con toast.error + signOut
  - useOrderSearch: toast.error en rutas de error silenciosas
  - CategoriesManager: skeleton loading, tokens border/radius corregidos
  - LabelPrintModal: dimensiones de formato dinámicas desde StoreConfig

Última fase completada: 08 - Bug fixes críticos (v1.1.0) ✅
En progreso: 09 - Parametrización (v1.2)
Versión actual en producción: v1.0.0

Fix de impresión de etiquetas (feature/08-bugfixes-criticos) ✅
  - LabelPrintModal: isValidCode() valida CODE128 antes de renderizar
  - Autogeneración de barcode temporal cuando la variante no tiene; se
    persiste en BD vía useVariantMutations.update
  - useRef en contenedor de impresión + chequeo de montaje antes de
    window.print()
  - Guard contra inyección duplicada del @media print (getElementById)
  - Fallback a '38x25' cuando stores.config.label_format es inválido
  - try/catch en JsBarcode con toast.error agregado por sesión del modal
  - LabelCard usa dimensiones reales del formato configurado (38x25 / 50x30 / 58x40)

Fix de flujo de devoluciones y cambios (feature/08-bugfixes-criticos) ✅
  - useReturnMutations: validación de inputs (returnItems vacío, qty<=0,
    exchangeItems vacío en cambio)
  - Chequeo de auth (profile.store_id / profile.id) antes de tocar BD
  - Pre-check de stock agrega cantidades por variant_id y filtra por
    store_id para defensa en profundidad
  - Rollback compensatorio: DELETE de returns huérfano si return_items falla
  - Rollback compensatorio: DELETE de orden huérfana si order_items de cambio falla
  - Mensaje accionable cuando "devolución se commiteó pero cambio falló"
  - Invalidación ampliada de queries: variants, products, stock-movements,
    orders, inventory, pos-products, returns
  - trim() de notes para que strings vacíos se persistan como NULL

Feature de turno de caja (feature/08-bugfixes-criticos) ✅
  - useCashShift: useCurrentShift (turno abierto del usuario, closed_at IS NULL)
    y useCashShiftSales (suma de ventas cash desde opened_at)
  - useCashShiftMutations: openShift (rechaza si ya hay turno abierto del
    usuario) y closeShift (setea closing_amount, closed_at, closed_by)
  - CashShiftModals: OpenShiftModal (input monto inicial COP) y
    CloseShiftModal (resumen apertura + ventas cash + esperado + contado +
    diferencia sobrante/faltante con colores)
  - Header: badge verde "Turno abierto · HH:mm" + botón "Cerrar turno"
    cuando hay turno; CTA violeta "Abrir turno" cuando no
  - POSPage: bloqueo full-screen "Debes abrir turno para vender" con
    botón "Abrir turno ahora" si el usuario no tiene turno abierto

Tipos de talla configurables + delete de categorías (feature/09-parametrizacion) ✅
  - Migración 004_size_types: products.size_type text NOT NULL DEFAULT 'letter'
  - src/lib/sizeTypes.ts: catálogo letter / pants_co / shoes_co / baby /
    unique / custom + SizeTypeKey, resolveSizeType, isValidSizeType
  - Product type extendido con size_type
  - ProductModal: select "Tipo de talla" (default 'letter')
  - VariantsPanel: selector de talla dinámico según product.size_type;
    'custom' = input libre, otros = <select> con catálogo predefinido;
    preserva tallas legacy fuera del catálogo al editar
  - useCategoryMutations: agregado remove + countProducts;
    delete usa ON DELETE SET NULL de products.category_id;
    invalida queries de products tras delete
  - CategoriesManager: botón papelera + modal de confirmación que muestra
    cuántos productos quedarán sin categoría antes de eliminar

Historial de ventas + reparación de useCreateOrder (feature/10-historial-ventas) ✅
  - useCreateOrder reescrito con validación de inputs (auth, items, qty,
    unit_price), logging detallado y rollback compensatorio: si falla el
    insert de order_items se elimina la orden recién creada para evitar
    huérfanas. Invalidación amplia post-éxito: orders, sales-history,
    variants, products, pos-products, stock-movements, customers, cash-shift
  - src/hooks/useSalesHistory.ts: useSalesHistory (paginado 50/pág con
    filtros server-side), useSalesSummary (revenue, count, ticket promedio,
    devoluciones del período), useSaleDetail (orden + items + cliente +
    devoluciones asociadas)
  - SalesHistoryPage: cards resumen, filtros (búsqueda debounced, presets
    fecha hoy/semana/mes/custom, método pago, estado), tabla con fila
    expandible para detalle inline, paginación anterior/siguiente,
    empty state hacia POS
  - Ruta /ventas/historial dentro de ProtectedRoute + entrada Sidebar
    "Historial" con icono History (visible para admin y seller)
  - ReturnsPage: lee ?orderId=xxx, precarga la orden con validación
    (return_days_limit, items ya devueltos) y salta al paso 2; limpia el
    URL param tras consumirlo

Numeración secuencial + copyable cells + búsqueda mejorada (feature/10-historial-ventas) ✅
  - Migración 005_sequential_order_numbers: orders.order_number int NOT NULL,
    índice único (store_id, order_number), trigger BEFORE INSERT
    assign_order_number con pg_advisory_xact_lock por tienda + backfill
    cronológico de filas existentes
  - Order type extendido con order_number; Insert type lo deja opcional
    porque el trigger lo asigna
  - useSalesHistory/useSaleDetail/useOrderSearch/useOrderDetail fetch
    order_number; useReturnHistory JOIN orders:original_order_id para
    mostrar Ord. #N en el panel de historial
  - useOrderSearch reescrito: mínimo 1 char, debounce 300ms, detecta
    /^#?\d+$/ (numérico → eq order_number) vs texto (≥2 chars → JOIN
    customers full_name/phone). Filtra siempre por store_id como defensa
    en profundidad además de RLS
  - SalesHistoryPage: muestra #order_number (no UUID), celdas copiables
    (#, cliente, total) con CopyableCell + toast.success 1.5s; detalle
    expandido muestra UUID completo + botón "Copiar UUID" para soporte
  - POSPage TicketModal y ReturnsPage (stepper + ticket + search cards
    + historial) muestran #order_number en todos los lugares
  - Search cards de ReturnsPage rediseñadas: avatar 48px con #N grande,
    cliente arriba, fecha+items+total a la derecha; empty state
    "No se encontraron ventas para X" + sugerencia



Reemplazo de Nequi por Addi en métodos de pago (feature/11-payment-methods) ✅
  - Migración 006_payment_methods_cleanup: ADD VALUE 'addi' al enum
    payment_method, UPDATE orders SET 'transfer' WHERE 'nequi', recrear
    enum payment_method_new sin 'nequi', swap de columnas y rename.
    Líneas para supplier_payments y layaway_payments comentadas (tablas
    aún no existen)
  - src/lib/paymentMethods.ts: helper centralizado con label, color
    token, hex y LucideIcon por método; PAYMENT_METHOD_KEYS const,
    migrateLegacyPaymentMethods() convierte arrays con 'nequi' a 'transfer'
  - PaymentMethod type actualizado en database.types.ts: 'cash' | 'card'
    | 'transfer' | 'addi'
  - StoreConfig.nequi_qr_url → payment_qr_url; resolveConfig migra el
    valor legacy al leer; updateStoreConfig limpia la clave legacy del
    jsonb cuando se actualiza payment_qr_url
  - useConfigMutations.uploadNequiQR → uploadPaymentQR, path
    storeId/payment-qr.ext
  - CajaSection: checkboxes con ícono color por método, sección QR
    "QR para pagos" (visible cuando transfer está habilitado), helper
    de migración aplicado al leer config
  - POSPage PaymentModal: cards muestran ícono con color del método;
    transfer → muestra QR si payment_qr_url existe; addi → nota
    "Pago en cuotas con Addi — confirma desde la app del cliente"
  - SalesHistoryPage, ReturnsPage, CustomersPage, ReportsPage: labels
    y filtros actualizados con Addi en lugar de Nequi
  - ReportsPage: PAYMENT_COLORS, DailyBarRow type, Bar de la gráfica
    apilada y pivotDailySales usan 'addi' (color #ec4899 pink)
  - design-system.md y ConfigPage subtitle: referencias a Nequi
    reemplazadas por Addi / "QR para pagos"
  - POSPage PaymentModal: chips de monto rápido para efectivo —
    "Exacto" + denominaciones COP reales (20k/50k/100k) + round-ups
    al próximo $10k (ajuste fino) y al próximo $100k (un billete más).
    Filtra ≤ total, dedupe via Set; click reemplaza el valor del input

Sistema de gastos de caja durante el turno (feature/12-caja-completa) ✅
  - Migración 007_cash_expenses: tabla cash_expenses con shift_id /
    store_id / amount numeric(12,2) > 0 / reason / notes / created_by /
    created_at. ON DELETE CASCADE desde cash_shifts y stores. RLS:
    SELECT/INSERT por store_id, DELETE solo admin. Inmutable (sin UPDATE)
    para trazabilidad
  - CashExpense type + tabla en Database['public']['Tables'] de
    database.types.ts
  - StoreConfig.expense_reasons (string[]) + defaults
    ['Mercado', 'Servicios', 'Domicilio', 'Imprevisto', 'Otro'] en
    DEFAULT_CONFIG; resolveConfig usa defaults cuando es undefined o array
    vacío
  - useShiftExpenses(shiftId): lista de gastos del turno DESC.
    useExpenseCountByReason(reason): conteo via head:true para validar
    borrado desde Config
  - useRegisterExpense: valida auth + turno abierto + amount > 0 + reason
    no vacío; INSERT con shift_id del useCurrentShift; invalida
    ['shift-expenses', shiftId]; toast con monto y motivo
  - CajaSection: nueva sección "Motivos de egreso" con add/remove inline,
    validación case-insensitive de duplicados, mínimo 2 motivos,
    ConfirmDeleteReasonModal que muestra cuántos gastos quedarían
    "huérfanos" (no rompe históricos, solo deshabilita para nuevos)
  - ExpenseModal en CashShiftModals.tsx: input monto con prefijo $,
    motivos como pills clickables (violeta cuando activo), textarea
    notas opcional (max 200 chars), Esc para cerrar, Enter para enviar
  - Header: botón "Gasto" (icono Receipt) entre badge de turno y "Cerrar
    turno", abre ExpenseModal
  - CloseShiftModal: nueva sección "Gastos del turno" antes del cuadre
    (oculta si no hay), recálculo Esperado = apertura + ventas - egresos
    con líneas separadas y colores (emerald +, rojo -), modal con
    max-h-[90vh] + overflow para listas largas

Cuadre de caja imprimible + historial de turnos (feature/12-caja-completa) ✅
  - src/hooks/useShiftClosing.ts: agrega shift + expenses + ventas por
    método (JOIN profiles para userName, JOIN stores para storeName);
    cashSales, totalSales, totalExpenses, expectedCash, orderCount,
    avgTicket. Window de orders por opened_by + opened_at..closed_at
    (o sin tope si turno abierto)
  - src/components/cash/CashShiftReceipt.tsx: ticket 80mm con secciones
    metadatos / VENTAS POR MÉTODO (oculta líneas con 0) / EGRESOS (oculta
    si no hay) / CUADRE DE EFECTIVO con badge dinámico CUADRADO/
    SOBRANTE/FALTANTE; CashShiftReceiptPrint render hidden con id único
    + useShiftReceiptPrintStyle inyecta @media print (80mm, monospace
    11px, oculta resto del body, @page size 80mm)
  - CloseShiftModal refactor: input contado arriba, preview live del
    recibo abajo, recálculo en vivo; botones "Cerrar sin imprimir"
    (secondary) y "Imprimir y cerrar" (primary) con cleanup en
    afterprint + fallback timeout 60s
  - src/hooks/useShiftHistory.ts: useShiftHistory(filters) paginado
    50/pág, JOIN profiles para cajero, agrupa ventas y gastos client-side
    en una sola query por batch (IN sobre opened_by + ventana mínima/
    máxima del page) para evitar N+1; useStoreCashiers para el filtro
  - src/pages/CashShiftsHistoryPage.tsx: tabla con apertura→cierre,
    cajero, montos y DifferenceBadge (slate cuadrado / emerald sobrante
    / rojo faltante); filtros cajero + rango de fechas; ReprintReceiptModal
    reusa CashShiftReceipt + CashShiftReceiptPrint
  - Ruta /caja/historial bajo ProtectedRoute allowedRoles=['admin'];
    entrada Sidebar "Historial de caja" (Wallet icon) admin-only

Sidebar agrupado en secciones colapsables (feature/12-caja-completa) ✅
  - 4 grupos: Operación (Ventas/Historial/Devoluciones), Inventario
    (Productos/Inventario), Clientes, Análisis y admin
    (Reportes/Historial de caja/Configuración — admin only)
  - Iconos: grupo ShoppingCart/Package/Users/BarChart3; items Store/
    History/Undo2/Tag/Layers/Users/BarChart2/Wallet/Settings
  - CollapsibleGroup subcomponente con animación grid-template-rows
    1fr↔0fr 200ms ease-out (sin medir alturas); chevron rota 0↔-90deg
  - Persistencia por usuario en localStorage
    'gmura-sidebar-groups-{userId}' con try/catch
  - Estado inicial: localStorage si existe; sino expande SOLO el grupo
    que contiene la ruta actual al montar (no re-expande en navegación)
  - Indicador de selección oculta: dot violet-400 antes del chevron
    cuando grupo colapsado y contiene la ruta activa
  - filterByRole filtra grupos y items por adminOnly; descarta grupos
    vacíos. Accesibilidad: aria-expanded / aria-controls / aria-label

## Módulos disponibles
- POS / Ventas, Historial de ventas, Separados (layaways), Devoluciones
- Productos / Variantes, Inventario (con reservado por separados)
- Clientes (CRM), Reportes (ventas, inventario, separados, **compras**)
- Caja (turnos, gastos, cuadre imprimible, historial)
- **Proveedores y compras**: CRUD de proveedores, facturas de compra con
  ítems, pagos y cuentas por pagar
  · Las compras INCREMENTAN stock vía trigger (stock_movements type='purchase');
    cada ítem puede actualizar cost_price de la variante si update_cost=true
  · Los pagos a proveedor EN EFECTIVO durante un turno abierto generan un
    cash_expense automático (trigger) → afectan el cuadre de caja como egreso
    "Pago a proveedor: X". useShiftClosing ya los cuenta en totalExpenses sin
    doble conteo (el pago no es una orden ni un abono de separado)
- **Comisiones por crédito (Fase 4)**: CelFashion es punto de venta de una
  financiera; cada crédito cerrado deja una comisión (configurable, hoy
  $100.000) repartida local/trabajador (default 50/50 editable) que se paga al
  trabajador por quincena. Es un EVENTO independiente: NO es método de pago del
  POS, NO toca inventario, NO crea órdenes.
  · La comisión en EFECTIVO entra al cuadre como fuente de cash-in propia
    imputada al turno por `credit_commissions.shift_id` (Opción A), igual que un
    abono de separado/fiado — NO como cash_expense. Vive en un solo lugar
    compartido `src/lib/shiftCommissions.ts` (usado por useShiftClosing y
    useShiftHistory). shiftCalc la suma a cashSales y la expone como
    `commissionsIncome` (sección "COMISIONES DE CRÉDITO" del recibo). La
    consignación NO toca caja (shift_id NULL).
  · Permiso `comisiones.gestionar` (Dueño/Administrador). Un trabajador sin el
    permiso ve SOLO sus comisiones (RLS self-select), lectura.
  · El pago quincenal al trabajador se asienta como EGRESO por la vía de gastos
    existente (no hay nómina); el reporte quincenal por trabajador dice cuánto.
- Configuración (tienda, usuarios, productos, caja, etiquetas)

## Estado actual del proyecto
Última fase completada: Fase 4 — comisiones por crédito (BD+UI, gate verde;
migraciones 048–050 PENDIENTES de aplicar en prod, ver scripts/PROD-FASE4.md)
Previo: claridad del historial de ventas para el cuadre
(tipo de venta + dinero real entrado por día)
Previo: tarjeta de producto con marca, rango de precios y descripción
(diferenciar productos del mismo nombre)
En progreso: feature - marca (autocompletar + en todos los documentos)
Siguiente: Addi recargo, historial de gastos, descuento por ítem

Fase 4 — Comisiones por crédito (feature/fase-4-comisiones) ✅
  - Migración 048_credit_commissions: enum commission_method
    (efectivo|consignacion); tabla credit_commissions (organization_id por
    trigger desde store; worker_id FK profiles; customer_id FK NULL; monto_total
    numeric DEFAULT 100000 CONFIGURABLE; monto_local/monto_trabajador con CHECK
    de reparto coherente ±0.5; shift_id FK cash_shifts con CHECK estructural
    efectivo⇒shift_id NOT NULL / consignacion⇒NULL; inmutable, sin UPDATE).
    Índices (store, worker, store+fecha, shift parcial). RLS: SELECT
    gestionar-ve-todo OR worker_id=auth.uid() (self-select); DELETE gestionar;
    sin INSERT/UPDATE directo (solo RPC). RPC register_credit_commission
    (SECURITY DEFINER, atómica): valida sesión, permiso comisiones.gestionar,
    montos, reparto coherente, worker/cliente de MI org, y turno abierto POR
    TIENDA en efectivo (misma regla que create_order/deliver_repair) → imputa
    shift_id; consignación shift_id NULL.
  - Migración 049_comisiones_permission: canonical_role_permissions +=
    comisiones.gestionar a Administrador (Dueño via *); reconciliación aditiva
    SIN filtro de org (patrón 034/035/046); self-verify. permissionsCatalog.ts
    grupo "Comisiones" + ALL_PERMISSIONS (23 permisos).
  - CUADRE (Opción A, decisión aprobada): la comisión en efectivo es fuente de
    cash-in PROPIA imputada por shift_id, NO un cash_expense. src/lib/
    shiftCommissions.ts (fetchShiftCashCommissions) = ÚNICA fuente compartida por
    useShiftClosing y useShiftHistory (no reincide en la deuda heredada #4).
    shiftCalc: input commissionIncomes → suma a cashSales (sube expectedCash) +
    output commissionsIncome (NO entra a salesByMethod ni regularSalesTotal).
    CashShiftReceipt: sección "COMISIONES DE CRÉDITO"; CloseShiftModal y
    CashShiftsHistoryPage pasan commissionsIncome. INVARIANTE testeado: agregar
    una comisión efectivo solo suma su monto al esperado, no infla ventas.
  - Config: StoreConfig.commission_default_amount (100000) +
    commission_worker_share (0.5) en DEFAULT_CONFIG; CajaSection sección
    "Comisiones por crédito" (monto default + % trabajador).
  - src/lib/commissionCalc.ts (puro): splitCommission (reparto, el local absorbe
    el redondeo → suma exacta), quincenaRange (corte 1–15 / 16–fin de mes).
  - useCreditCommissions: useCommissionsList (período, respeta RLS),
    summarizeByWorker (reporte quincenal), useStoreWorkers (selector),
    useRegisterCommission (RPC, invalida shift-closing/history si efectivo),
    useDeleteCommission. CommissionsPage (/comisiones, sin permission en sidebar/
    ruta → gestor ve/registra todo + reporte quincenal; trabajador ve "Mis
    comisiones" solo lectura). NewCommissionModal (worker, método con aviso de
    turno, monto + reparto editable, cliente opcional, fecha, notas) +
    ConfirmDeleteCommissionModal (aviso si efectivo afecta cuadre).
  - Pago al trabajador = EGRESO por la vía de gastos existente (no nómina);
    documentado en PROD-FASE4.md.
  - SEGURIDAD (RPC-only): credit_commissions solo tiene política SELECT; sin
    INSERT/UPDATE/DELETE → authenticated no escribe directo, la RPC (SECURITY
    DEFINER) es la única vía. Cierra el bypass de las validaciones (turno/tienda).
  - CORRECCIÓN / REVERSO (Migración 050): ledger append-only con traza.
    · reverse_credit_commission ANULA con traza (reversed_at/by; la fila NO se
      borra, sigue visible marcada). FRONTERA: "¿toca el expectedCash de un turno
      CERRADO?" — consignación y efectivo-turno-ABIERTO se pueden anular;
      efectivo-turno-CERRADO NO (no reescribir un cuadre settled; el monto/método
      mal de una cerrada se corrige por ajuste en la caja de hoy).
    · reassign_commission_worker cambia el beneficiario, permitido SIEMPRE (aun
      con turno cerrado) porque es CAJA-SAFE (no toca expectedCash); deja traza
      (reassigned_at/by + original_worker_id).
    · Las ANULADAS se excluyen de TODO cálculo: shiftCommissions (expectedCash),
      commissionCalc.summarizeByWorker/sumActive (reporte quincenal + totales) y
      el recibo. En la UI la anulada se VE marcada (con fecha), no desaparece.
  - Tests: commissionCalc.test.ts (reparto, quincena, anuladas no suman) + casos
    de comisión en shiftCalc.test.ts; scripts/test-credit-commission.sql (12
    casos: registro/turno/permiso/RLS/escritura-RPC-only + reverso gateado +
    reasignación caja-safe, verde en lab). Gate verde: tsc + eslint + 295 tests +
    build.
  - PENDIENTE: aplicar 048–050 en prod (scripts/PROD-FASE4.md); no requiere Edge
    Functions (todo va por migración).

Claridad del historial de ventas (feature/sales-history-cash-clarity) ✅
  - PROBLEMA: el cuadre diario dolía porque el historial mostraba el TOTAL de
    cada venta, y en un separado o un fiado ese total NO es el dinero que entró
    al cajón ese día (separado: solo el pago de cierre; fiado: solo el abono
    inicial, o $0). El sistema ya calculaba bien — el cuadre excluye la orden de
    conversión y cuenta cada abono en su día — pero el historial no lo COMUNICABA
  - src/lib/salesHistoryCash.ts: lógica pura resolveSaleCash(input) →
    { kind, enteredToday, showEnteredLine }, con resolveSaleKind y
    sumPaymentsOnSaleDay. 19 tests (incl. separado con 2 abonos el mismo día,
    separado saldado el mismo día → sin línea, fiado $0, is_historical, y
    agrupación por día CIVIL de Bogotá: una venta 23:30 y su abono 23:00 son el
    mismo día aunque en UTC ya sea el siguiente)
  - NO usa orders.paid_amount (acumulado histórico de todos los abonos: incluiría
    otros días y otros turnos). Por construcción: SaleCashInput ni siquiera tiene
    el campo. paid_amount sigue solo donde corresponde: el badge Debe $X / Pagado
  - Identificación del tipo: fiado = orders.is_credit; separado = cruce INVERSO
    layaways.converted_order_id → orders.id (no existe orders.layaway_id);
    directa = por descarte
  - useSalesHistory: SalesHistoryRow += kind / entered_today / show_entered_line /
    layaway_number. Tres queries por página acotadas a las órdenes VISIBLES (sin
    N+1): layaways por converted_order_id IN (ids), sus layaway_payments y los
    credit_payments de las fiadas. is_historical=false en el servidor y otra vez
    en la lógica pura (defensa en profundidad). pageDayBounds() acota el fetch de
    abonos a la ventana UTC de los días Bogotá de la página
  - src/lib/dateRange.ts: bogotaDayOf(instant) extraído (día civil de Bogotá de
    un timestamptz); todayInBogota delega en él. Sin duplicar el modelo de tz
  - UI (SalesHistoryPage): columna propia "Entró ese día" entre Total y Pago —
    empezó como línea de 10.5px bajo el total y en el lab no se leía; en columna
    y con el mismo peso que el Total, "185.000 → 40.000" se cuenta solo. Solo se
    muestra cuando difiere del total; en una directa va un guion (repetir el
    total sería ruido). Chip violeta "Separado"; el fiado ya se marca con
    [Fiado][Debe $X] via PaymentBadge (payment_method='credit') → no se duplica
  - Columna Pago con chips APILADOS (método arriba, tipo/saldo abajo); en línea
    se pisaban. ROW_GRID extraído a constante: el encabezado y las filas definían
    la grilla por duplicado
  - FIX de alineación (bug PREVIO, visible al agregar la 8ª columna): el
    encabezado vivía FUERA del contenedor con overflow-y-auto → la barra de
    scroll angostaba solo a las filas, la columna Cliente (1fr) absorbía la
    diferencia y de Ítems en adelante los títulos no caían sobre su columna.
    Ahora el encabezado va DENTRO del mismo contenedor y es sticky: comparten
    ancho por construcción y quedan visibles al scrollear
  - Alcance deliberado: el historial EXPLICA por fila; NO promete sumar el
    efectivo del cuadre. Los abonos de separados activos y los de fiados de días
    previos entran a la caja sin ser ventas → no tienen fila en el historial
  - Sin migración. Validado en lab con separados y fiados reales

P5 — Devoluciones aparte en el cuadre (feature/returns-in-cash-shift) ✅
  - Migración 017: cash_expenses.kind ('expense'|'return', text+CHECK — no ENUM,
    consistente con los CHECK existentes de la tabla y extensible a
    'supplier_payment' sin ALTER TYPE) + cash_expenses.return_id; orders.return_id
    (ON DELETE SET NULL); índices; backfill de salidas históricas por prefijo
    (reason LIKE 'Devolución%' → kind='return'). Entradas forward-only (sin señal
    confiable para backfillear orders.return_id). RLS sin cambios
  - database.types: CashExpense += kind/return_id, Order += return_id, Inserts
    con los campos opcionales
  - useReturnMutations: la orden del cambio setea return_id=ret.id; el cash_expense
    del reembolso setea kind='return' + return_id (reason legible se mantiene)
  - shiftCalc.calculateShiftSummary: clasifica returnsIncome (órdenes con
    return_id), returnsExpense (cash_expenses kind='return'), returnsNet y
    regularExpensesTotal. INVARIANTE: cashSales, totalExpenses y expectedCash son
    IDÉNTICOS (la clasificación solo reagrupa para el display); regularSalesTotal/
    salesByMethod/orderCount excluyen los ingresos por devolución. Blindado con
    test de no-regresión de expectedCash
  - useShiftClosing: fetch de orders.return_id y cash_expenses.kind; pasa a la
    función pura y expone los nuevos campos. useShiftHistory NO se tocó (solo
    alimenta la tabla con valores invariantes; el recibo del historial sale de
    useShiftClosing)
  - CashShiftReceipt: sección "DEVOLUCIONES" (+Ingresos / -Reembolsos / Neto),
    visible solo si hay; VENTAS y EGRESOS excluyen lo mostrado ahí; el CUADRE DE
    EFECTIVO queda aritméticamente idéntico. Mismo cambio en CloseShiftModal
    (preview) y CashShiftsHistoryPage (reimpresión)
  - 54 tests (16 de cuadre previos + 6 nuevos P5)

Hotfix feedback v2 — anti-duplicados en factura + descuento separados libre
Hotfix feedback v2 — anti-duplicados en factura + descuento separados libre
(hotfix/feedback-v2-barcode-users-returns) — parcial
  - PROBLEMA 2 (productos duplicados al comprar): NewInvoiceModal muestra el
    barcode en los resultados de búsqueda; el botón "Crear producto" precarga el
    término buscado como nombre (ProductModal initialName) y antes de abrir el
    modal busca productos con nombre similar (ilike). Si hay coincidencias abre
    DuplicateProductWarning con "Usar este" (abre VariantsPanel del producto
    existente para agregar SOLO la variante faltante; preexistingVariantIds
    evita volcar todo el catálogo del producto a la factura) / "Crear de todas
    formas" / Cancelar. generateBarcode y selección normal (update_cost=false)
    intactos. Sin migración, sin UNIQUE en products.name
  - PROBLEMA 3 (descuento separados): eliminado el tope máximo configurable;
    CajaSection deja solo el toggle "Permitir descuento en separados".
    calculateMaxDiscount devuelve el subtotal como máximo cuando está permitido
    ('fixed') y 0 cuando no ('none'). NewLayawayModal: campo de descuento LIBRE
    en pesos, showDiscount solo depende del modo; advertencia ámbar si supera el
    50% del subtotal (permite) y bloqueo si supera el subtotal. useCreateLayaway
    valida solo discount>=0 y discount<=subtotal (quitado max_discount).
    layaway_discount_value queda como legacy en el tipo. Tests de layawayCalc
    actualizados al modelo libre (18 tests)
  - PROBLEMA 1 (usuarios multi-tienda al crear): Edge Function create-user
    acepta store_ids[] (antes store_id único): valida ≥1 tienda (400), vendedor
    usa solo store_ids[0], admin inserta una fila por tienda en user_stores
    (incl. base); profiles.store_id y current_store_id = primera tienda (base +
    activa); rollback completo (user_stores → profiles → auth) y status 500 en
    fallos internos del admin client. useConfigMutations: payload store_ids[].
    UsersSection: selección de tienda según rol (vendedor = una/radio; admin =
    múltiple/checkboxes con badge "principal" en la primera + ayuda); validación
    ≥1 tienda; badge de conteo "Tiendas (N)" por admin vía useUserStoreAccess.
    REQUIERE re-deploy: supabase functions deploy create-user
  - Pendiente del hotfix: P4 devoluciones de compra (feature nueva), P5 separar
    devoluciones en el cuadre (migración campo estructurado en cash_expenses)

Fixes de lógica financiera (test/financial-coverage) ✅
  - FIX 1 — Cuadre Lógica B (esperado tope en $0): cuando los egresos superan el
    efectivo disponible, el cuadre ya NO muestra sobrante falso. En shiftCalc.ts:
    reconcileCash(disponible, egresos) → { expectedCash: max(0, disp-egr),
    overdraft: max(0, egr-disp) }; shiftDifference(contado, rec) = contado -
    esperado - sobregiro. calculateShiftSummary devuelve overdraft. useShiftClosing
    y useShiftHistory lo propagan; CashShiftReceipt muestra línea "Sobregiro: -$X"
    (rojo) cuando aplica; CloseShiftModal/CashShiftsHistoryPage calculan la
    diferencia con sobregiro. Caso foto (ap 162k, egreso 180k, contado 0) →
    FALTANTE $18.000
  - FIX 2 — Netear cambios (no inflar ventas ni caja): la orden de un cambio
    registra SOLO la diferencia de precio. src/lib/returnCalc.ts:
    calculateExchangeAmounts(returnItems, exchangeItems) → orderSubtotal =
    valor nuevos, orderDiscount = min(devueltos, nuevos), orderTotal =
    max(0, diferencia), refundDue = max(0, -diferencia). En useReturnMutations
    el cambio crea la orden con subtotal/discount/total neteados pero mantiene
    los order_items de los ítems nuevos (su stock baja por el trigger
    deduct_stock_on_sale; los devueltos suben por el trigger de return_items).
    El reembolso en efectivo (cambio más barato) genera cash_expense por
    refundDue; el cobro de diferencia ya entra como venta en la orden.
    Decisión: se conserva una orden de total $0 cuando no hay diferencia para
    reusar el trigger de stock en vez de un movimiento manual (más limpio/seguro)
  - Tests: shiftCalc.test.ts cubre la tabla de casos del cuadre (incl. caso foto
    y sobregiro); returnCalc.test.ts cubre cambio mismo precio / más caro / más
    barato y que el total nunca sea el valor completo del ítem nuevo

## Testing
- Framework: Vitest (v2.x, compatible con Vite 5) + jsdom + @testing-library/*.
  Gestor de paquetes del proyecto: pnpm (hay pnpm-lock.yaml; NO usar npm install)
- vitest.config.ts: environment jsdom, globals true, alias '@' → src
- Scripts: test (watch), test:run (CI), test:ui; "check" = typecheck + lint +
  test:run (gate de pre-commit)
- Convención: tests junto al código (src/**/*.test.ts), descripciones en español
- Lógica financiera pura aislada para poder testearla sin React ni red:
  · src/lib/shiftCalc.ts → calculateShiftSummary (extraída de useShiftClosing;
    el hook ahora solo hace las queries y le pasa los datos). Cubre cuadre:
    ventas por método, solo efectivo afecta expectedCash, gastos, abonos de
    separados, devoluciones (cash_expense) y exclusión de órdenes de separados
    completados (converted_order_id) para no duplicar
  · src/lib/returnCalc.ts → calculateExchangeAmounts (netea cambios)
  · cartStore.cartTotals, layawayCalc.calculateMaxDiscount /
    calculateRequiredInitialPayment / isLayawayOverdue / daysUntilExpiry
- 50 tests (4 archivos): src/lib/shiftCalc.test.ts, src/lib/returnCalc.test.ts,
  src/lib/layawayCalc.test.ts, src/stores/cartStore.test.ts

Refactor de calidad (refactor/quality-cleanup) ✅
  - Lint sin deuda: AuthContext (catch sin binding, directiva eslint-disable
    sobrante, contexto movido a src/contexts/auth-context.ts para react-refresh),
    ReturnsPage (dep returnDaysLimit). package.json: lint con --max-warnings 0,
    scripts typecheck y check (tsc + lint) listos para pre-commit
  - useResolvedConfig() en useConfig.ts unifica las ~12 repeticiones de
    resolveConfig(store?.config) y elimina el cast innecesario
    "as unknown as { config }" (Store.config ya era Record<string,unknown>|null);
    memoiza por referencia de la tienda
  - config.sizes (lista plana) eliminado de StoreConfig/DEFAULT_CONFIG/resolveConfig
    (huérfano tras 15.1; lo reemplazó size_types)
  - VariantsPanel: catalogSizes envuelto en useMemo (dep estable)
  - src/lib/receiptPrint.ts: hook useReceiptPrintStyle(styleId, containerId)
    compartido; CashShiftReceipt/SaleReceipt/LayawayReceipt dejan de exportar
    constantes/hooks (silencia react-refresh) y reusan el helper (DRY)

Nota: las migraciones 011_suppliers y 012_purchase_views quedan pendientes de
aplicar en Supabase + verificar triggers/vistas antes del despliegue.
Migración 013_multistore ya aplicada y verificada. Pendiente aplicar
014_user_stores_admin_select (habilita la gestión de accesos en Config).
FIX 2 de devoluciones en caja NO requiere migración: reusa la tabla
cash_expenses existente (motivo "Devolución venta/por cambio #N").

Hotfix feedback v2 — descuento separados solo fijo + devoluciones en caja
(hotfix/feedback-v2-tallas-caja) ✅
  - FIX 1 — Descuento en separados, solo monto fijo:
    · config.types.ts: LayawayDiscountMode reducido a 'none' | 'fixed'
    · layawayCalc.calculateMaxDiscount: eliminada la rama 'percent'
    · CajaSection: el control de descuento de separados pasó de pills
      none/fixed/percent a un toggle "Permitir descuento" + input de monto
      máximo en COP; quitada la validación de % de descuento en handleSave
    · NewLayawayModal ya mostraba el descuento (input + máximo + desglose
      subtotal/descuento/total + recálculo del abono mínimo sobre el total con
      descuento) y useCreateLayaway ya persiste subtotal/discount/total; solo
      requería que la config quedara en 'fixed' para que showDiscount sea true
  - FIX 2 — Devoluciones afectan el cuadre de caja:
    · useReturnMutations.createReturn: CreateReturnInput += original_order_number;
      tras crear el return (y la orden de cambio si aplica), si refundMethod==='cash'
      y hay turno abierto, INSERT cash_expense (shift_id del turno, amount = valor
      de los ítems devueltos, motivo "Devolución venta #N" o "Devolución por
      cambio #N"). Best-effort: si el egreso falla no revierte la devolución,
      solo toast. Pagos no-efectivo no tocan la caja
    · Modelo neto correcto: en un cambio, la orden de los ítems nuevos ya cuenta
      como venta (entra dinero) y el egreso acredita los ítems devueltos →
      el "Esperado" del cuadre queda correcto en ambos sentidos
    · onSuccess invalida shift-expenses / shift-closing / cash-shifts
    · ReturnsPage pasa original_order_number al mutate
    · useShiftClosing y CashShiftReceipt ya suman/listan cash_expenses: las
      devoluciones aparecen en la sección EGRESOS sin cambios adicionales

Hotfix feedback v2 — tallas gestionables, marca, sin ticket promedio ni %
(hotfix/feedback-v2-tallas-caja) ✅
  - FIX 1 — Tipos de talla gestionables desde Config (sin migración, viven en
    stores.config.size_types jsonb):
    · config.types.ts: SizeTypeConfig { id, label, sizes[] } + StoreConfig.size_types
    · sizeTypes.ts reescrito: DEFAULT_SIZE_TYPES (letter, pants_men, pants_women NEW,
      shoes_men, shoes_women NEW, baby, kids NEW, unique, custom) como fallback/seed;
      helpers findSizeType, isCustomSizeType, newSizeTypeId (id opaco st_xxxxxxxx,
      inmutable para no romper referencias de products.size_type)
    · useConfig: DEFAULT_CONFIG.size_types + resolveConfig usa defaults si vacío
    · ProductsSection: nueva sección "Tipos de talla" (SizeTypesManager) con label
      editable, chips de tallas add/remove, crear/eliminar tipo, reordenar por drag;
      delete bloqueado si hay productos usándolo (count server-side por size_type)
    · ProductModal y VariantsPanel leen size_types desde la config; preservan tipos
      legacy no listados (input libre) al editar
  - FIX 2 — Marca visible en venta y factura:
    · CartItem.brand agregado; los 3 addItem (scan, enter, picker) lo pasan;
      ítem del carrito muestra marca en línea superior uppercase
    · NewInvoiceModal: resultados de búsqueda muestran la marca primero
      (PurchaseVariantOption.brand + products(name, brand) en la query)
  - FIX 3 — Ticket promedio eliminado por completo: useShiftClosing (avgTicket
    fuera del cálculo y del return), CashShiftReceipt (línea "Ticket prom"),
    CashShiftModals y CashShiftsHistoryPage (prop), ReportsPage (KPI + grid 6→5)
    y SalesHistoryPage (card + grid 4→3)
  - FIX 4 — Descuento en caja solo monto fijo: Discount simplificado a { value }
    (sin type); cartTotals clampa al subtotal; CartPanel sin toggle %/$, input
    con prefijo $ y clamp a subtotal en onChange

Multi-store — switcher y gestión de accesos (feature/15-multistore) ✅
  - get_my_store_id() ahora devuelve la tienda ACTIVA (current_store_id) →
    todo el RLS opera sobre la tienda seleccionada; switcher = solo admins
    con >1 tienda en user_stores; vendedores siguen con una sola
  - AuthContext: refreshProfile() para recargar el perfil tras el switch
  - useStores: useMyStores (RPC get_my_stores), useSwitchStore (RPC
    switch_active_store + invalidateQueries() global + refreshProfile + toast)
  - useUserStores: useUserStoreAccess / useGrantStoreAccess / useRevokeStoreAccess
  - StoreSwitcher en Header: texto estático si una sola tienda; dropdown con
    check violeta + spinner si varias; confirma antes de cambiar si hay turno
    abierto (sigue abierto) o carrito en curso (se limpia)
  - UsersSection: panel "Tiendas con acceso" por usuario admin (checkboxes
    sobre las tiendas del admin actual; la tienda base no se puede quitar)
  - Migración 014_user_stores_admin_select: política admin SELECT en
    user_stores (necesaria para leer accesos de otros usuarios en Config)

Reportes de compras e integración final (feature/14-proveedores) ✅
  - Migración 012_purchase_views: vistas purchase_summary (compras por mes y
    proveedor, excluye canceladas) y supplier_balance (saldo consolidado por
    proveedor, activos e inactivos — una deuda es deuda) con security_invoker = true
  - Tipos PurchaseSummary + SupplierBalance en Database['public']['Views']
  - useReports ampliado: usePurchaseReport (byMonth/bySupplier + totales +
    avgDaysToPay desde supplier_payments), useSupplierBalances (totales
    consolidados), useInvoicesForExport (filas planas para Excel)
  - ReportsPage sección "Compras": 4 KPIs (comprado/pagado/pendiente/días
    de pago), BarChart compras mensuales, PieChart top 5 proveedores + "Otros",
    LineChart compras vs ventas, tablas Top proveedores y Cuentas por pagar
    (click → /proveedores?supplier=id). Excel: hojas "Compras" y "Saldos
    proveedores"
  - SuppliersPage Cuentas por pagar: cards desde supplier_balance (total
    adeudado violeta, proveedores con saldo) + banner rojo de vencidas;
    deep-link ?tab=payables y ?supplier=id (preselección de proveedor)
  - Header: SupplierNotifications admin-only (campana FileText) con facturas
    vencidas o por vencer ≤3 días → /proveedores?tab=payables
  - Integración de caja verificada: pagos efectivo a proveedor ya entran al
    cuadre vía cash_expense, sin cambios en useShiftClosing
  - Pendiente: aplicar migración 012 en Supabase y verificar vistas

Módulo de proveedores y compras — schema (feature/14-proveedores) ✅
  - Migración 011_suppliers: enum invoice_status (pending/partial/paid/cancelled);
    tablas suppliers, purchase_invoices (UNIQUE store+supplier+invoice_number),
    purchase_invoice_items (update_cost), supplier_payments (shift_id nullable)
  - Trigger increase_stock_on_purchase: +stock_qty y opcional cost_price si
    update_cost; registra stock_movement type='purchase'
  - Trigger update_invoice_payment_status: suma paid_amount y recalcula status
  - Trigger register_supplier_payment_as_expense: pago efectivo en turno abierto
    crea cash_expense automático para el cuadre
  - Tipos TS: InvoiceStatus + Supplier/PurchaseInvoice/PurchaseInvoiceItem/
    SupplierPayment + entradas en Database['public']['Tables']

Módulo de proveedores y compras — UI (feature/14-proveedores) ✅
  - src/lib/invoices.ts: INVOICE_STATUS_META, daysOverdue/daysUntilDue,
    addDaysToDate, todayDateString, fmtInvoiceDate (Bogotá)
  - useSuppliers: useSupplierList (search por name/nit/phone, toggle activos,
    stats total_purchased/pending/last_invoice), useSupplierDetail (+ facturas)
  - usePurchaseInvoices: useInvoiceList (paginado 50/pág, filtros proveedor/
    estado/fechas + keepPreviousData, days_overdue), useInvoiceDetail (items+pagos),
    usePendingInvoices (cuentas por pagar, due_date ASC), usePurchaseVariantSearch
    (2 queries, devuelve cost_price para precargar costo)
  - useSupplierMutations: create/update/toggleActive
  - useInvoiceMutations: useCreateInvoice (valida, INSERT cabecera+items con
    rollback DELETE si falla, abono inicial con shift_id de useCurrentShift,
    captura 23505 → "factura duplicada"), useRegisterPayment (valida saldo),
    useCancelInvoice (solo paid=0 y sin items). Invalida purchase-invoices,
    suppliers, variants, products, pos-products, stock-movements, shift-expenses,
    shift-closing
  - SuppliersPage: tabs Proveedores (35/65 estilo CustomersPage) / Facturas
    (filtros + tabla + paginación, fila roja si vencida) / Cuentas por pagar
    (4 cards resumen + tabla ordenada por días vencidos)
  - Modales: SupplierModal (crear/editar), NewInvoiceModal (selector proveedor +
    crear rápido, buscador de variante, crear producto+variante al vuelo vía
    ProductModal→VariantsPanel con update_cost=true auto, items editables,
    totales con IVA, pago inicial opcional con aviso de caja), InvoiceDetailModal
    (items + pagos + progreso + impresión aislada @media print), PaymentModal
    (saldo, método, aviso efectivo/turno, referencia)
  - Sidebar: grupo "Compras" admin-only (icono Truck) con Proveedores (Building2)
    entre Clientes y Análisis; ruta /proveedores admin-only en App.tsx
  - Pendiente: aplicar migración 011 en Supabase y validar los 4 triggers + QA UI

Hotfix feedback v2.0 — separados en cuadre + descuento + 90 días (hotfix/feedback-v20-separados-caja) ✅
  - Migración 010_layaway_discount: agrega layaways.subtotal y
    layaways.discount (default 0, CHECK >= 0) + constraint de coherencia
    total = subtotal - discount (tolerancia 0.5). Backfill subtotal = total
    para layaways existentes
  - StoreConfig extendido con layaway_discount_mode ('none'|'fixed'|'percent')
    y layaway_discount_value. DEFAULT_CONFIG: discount_mode='none', value=0,
    default_days=90 (antes 30 — feedback del cliente)
  - Layaway type extendido con subtotal y discount; Insert type lo deja
    opcional. useCompleteLayaway mapea la.subtotal/discount al INSERT de la
    orden para preservar el desglose
  - src/lib/layawayCalc.ts: calculateMaxDiscount(subtotal, config) con cap
    al subtotal; soporta modos fixed (Math.round del valor) y percent
    (clamp 0-100)
  - useCreateLayaway acepta input.discount y input.max_discount; valida
    discount <= max y discount <= subtotal; inserta subtotal + discount +
    total = subtotal - discount
  - NewLayawayModal ConfirmStep refactorizado:
    · Card de "Resumen" con desglose Subtotal / Descuento / Total
    · Sección "Descuento aplicado" visible solo si config !== 'none'
      con cap por max y botón "Aplicar máximo" / "Quitar descuento"
    · Card destacado violeta "Abono mínimo requerido: $XXX" antes del
      input (feedback del cliente)
    · Botón "Mínimo" en el input de abono inicial
    · canSubmit valida discount <= max y muestra toast.error
      "Abono mínimo requerido: $XXX" en handleSubmit si falla
  - CajaSection: nueva sección "Separados" con
    · Modo de abono inicial (pills none/fixed/percent + input)
    · Descuento aplicable (pills none/fixed/percent + input)
    · Días vencimiento default (input numérico, max 180, default 90)
    Todos persistidos vía updateStoreConfig.mutateAsync
  - useShiftClosing reescrito para integrar abonos de separados al cuadre:
    · Fetch layaways.converted_order_id con completed_at en la ventana
      del turno → excluye esas órdenes del salesByMethod (evita doble cuenta)
    · Fetch layaway_payments del turno (por created_by + ventana) con
      JOIN layaways(layaway_number) para el detalle
    · SalesByMethod ahora incluye regularTotal y layawayTotal por método;
      total = orders.total + abonos.amount del método
    · cashSales = ventas efectivo + abonos efectivo
    · totalSales = regularSalesTotal + layawayPaymentsTotal
    · avgTicket sobre transacciones combinadas (orders + abonos)
    · Devuelve layawayPayments, layawayPaymentsTotal, regularSalesTotal
  - useShiftHistory aplica la misma lógica para que la columna "Esperado"
    en el historial coincida con el recibo impreso: excluye orders
    convertidas de layaways y suma layaway_payments cash al cashByShift
  - CashShiftReceipt:
    · "VENTAS POR MÉTODO" ahora muestra cada método combinado y debajo
      la línea "Ventas directas: $X" + "Abonos de separados: $Y"
      (solo si lpTotal > 0) antes del "Total ventas"
    · Nueva sección "ABONOS DE SEPARADOS" con detalle [HH:mm] #N método
      por abono + total, oculta si no hay abonos
    · Label cambiado de "Órdenes" a "Transacciones" para reflejar la
      mezcla orders + abonos
  - CloseShiftModal pasa layawayPayments, layawayPaymentsTotal y
    regularSalesTotal al CashShiftReceipt y CashShiftReceiptPrint

Hotfix feedback v2.0 — impresión aislada + scroll en modales (hotfix/feedback-v20-separados-caja) ✅
  - src/components/sales/SaleReceipt.tsx (nuevo): SaleReceipt (80mm
    térmico), SaleReceiptPrint (contenedor oculto con id único) y
    useSaleReceiptPrintStyle (inyecta @media print una sola vez con
    guard por id, cleanup en unmount). Mismo patrón que CashShiftReceipt
    y LayawayReceipt
  - SalesHistoryPage: SaleDetailRow mapea SaleDetail → SaleReceiptData
    y monta SaleReceiptPrint dentro de la fila expandida; botón
    "Reimprimir ticket" llama window.print() en try/catch con toast
    de error. Ahora el preview de impresión muestra solo el ticket
    aislado (sidebar, header y tabla quedan visibility: hidden)
  - POSPage TicketModal refactorizado para usar SaleReceipt como
    vista previa + SaleReceiptPrint en paralelo; recibe customer y
    storeName, snapshot incluye selectedCustomer al momento del pago
    para que el recibo muestre cliente y teléfono. Modal con
    max-h-[90vh] + flex flex-col + body overflow-y-auto
  - AddPaymentModal refactorizado a flex max-h-[90vh] flex-col con
    header sticky (border-b + flex-shrink-0), body central
    overflow-y-auto y footer sticky (border-t + flex-shrink-0). El
    contenido scrollea correctamente en viewports pequeños
  - CancelLayawayModal mismo refactor; el motivo de cancelación queda
    visible mientras los avisos amber/red de la parte superior
    scrollean si hace falta
  - NewLayawayModal y CompleteLayawayModal ya tenían el patrón
    (max-h-[92vh] + flex-col + body overflow-y-auto), no requirieron
    cambios

Integración fina de separados (feature/13-separados) ✅
  - Migración 009_layaway_views: vistas layaway_summary
    (KPIs por estado) y layaway_expiring_soon (activos que vencen
    en 7 días, ordenados ASC) con security_invoker = true
  - LayawaySummary y LayawayExpiringSoon agregados a
    Database['public']['Views']
  - useInventory.ts: VariantRow extendido con available
    (stock_qty - reserved_qty, mínimo 0) y stock_state
    ('out'|'low'|'ok') calculado sobre available. Todas las
    comprobaciones de inventario heredan el descuento por
    separados automáticamente
  - InventoryPage: tabla con 3 columnas separadas
    Total/Reservado/Disponible (Reservado en violeta cuando > 0);
    5 summary cards (Total / Sin disponible / Stock bajo / Con
    reservas / Valor); filtro de estado agrega "Con reservas";
    Excel export incluye columnas Reservado y Disponible
  - VariantsPanel: tabla con 3 cols Total/Reservado/Disponible
    para variantes activas; cuando available = 0 pero stock > 0
    muestra badge rojo "Sin disponible" con tooltip aclarando
    que todo está reservado
  - usePOSSearch: POSVariant.stock_qty sigue siendo available
    (cart compatibility); se agregan total_stock_qty y
    reserved_qty informativos
  - VariantPickerModal: muestra "X total · Y reservados" en
    violeta cuando hay reserva; tooltip en botón cuando todo
    está reservado
  - useReports.ts: useLayawaysSummary (KPIs por status + tasa
    conversión completed/closed); useExpiringLayaways
    (próximos a vencer 7d); useLayawaysForExport (flat para
    Excel detallado)
  - ReportsPage: nueva sección "Separados" con 4 KPIs (activos
    pendientes / por vencer 7d / recaudado / tasa conversión),
    pie de estados (violeta/verde/gris/rojo), tabla próximos
    a vencer (días en color rojo<3 / amarillo 3-7 / verde >7,
    click → /separados?id=X); Excel agrega hojas
    "Separados — Resumen" y "Separados" (una fila por separado)
  - LayawayNotifications: campana en Header con badge rojo
    cuando hay separados venciendo en ≤3 días; dropdown
    320px con lista navegable; solo se renderiza para roles
    admin y seller; click en item → /separados?id=X
  - CustomersPage: tab nuevo "Separados" en el perfil (junto a
    Compras y Devoluciones) que usa useCustomerLayaways para
    listar todos los estados con barra de progreso, badge
    por estado y click → /separados?id=X
  - LayawaysPage: useSearchParams lee ?id= al cargar y
    limpia el query param tras consumirlo (replace:true)
  - Edge Function supabase/functions/expire-layaways: ejecuta
    la RPC expire_overdue_layaways() y devuelve count;
    README con deploy (supabase functions deploy) y cron
    via Dashboard o pg_cron + pg_net (3am Bogotá = 8am UTC)
  - Fallback en cliente preservado: useExpireOverdueLayaways
    sigue ejecutándose al montar LayawaysPage como red de
    seguridad si el cron falla

Sistema de separados completo (feature/13-separados) ✅
  - Migración 008_layaways: enum layaway_status, variants.reserved_qty,
    tablas layaways/layaway_items/layaway_payments con triggers
    (assign_layaway_number, reserve_stock_on_layaway,
    release_stock_on_layaway_change, fulfill_stock_on_layaway_completion
    SOLO libera reserved_qty -- el descuento real lo hace
    deduct_stock_on_sale cuando la UI crea la orden,
    update_layaway_paid_amount), función SQL expire_overdue_layaways(),
    índices y RLS por store_id + delete admin
  - StoreConfig.layaway_initial_payment_mode ('none'|'fixed'|'percent') +
    layaway_initial_payment_value + layaway_default_days (default 30)
  - src/lib/layawayCalc.ts: calculateRequiredInitialPayment +
    isLayawayOverdue + daysUntilExpiry
  - src/hooks/useLayaways.ts: useLayawayList (paginado 50/pág, tabs por
    status + 'expiring_soon' <7d, búsqueda por #N o nombre/teléfono cliente
    vía 2-queries con .in), useLayawayDetail (JOIN customer/profile/items/
    payments + balance_pending), useActiveLayawaysCount (badge sidebar),
    useLayawayStatusCounts (counts por tab via head:true)
  - src/hooks/useLayawayMutations.ts: useCreateLayaway (pre-check de
    stock disponible, rollback DELETE si items insert falla, abono inicial
    opcional), useAddLayawayPayment (valida saldo), useCancelLayaway
    (valida active, reason min 5 chars, toast recordatorio de abonos),
    useCompleteLayaway (INSERT orders + order_items + UPDATE layaway,
    payment_method = final_payment.method o último abono, rollback DELETE
    de orden si order_items falla), useExpireOverdueLayaways (RPC)
  - src/hooks/usePOSSearch.ts: usePOSProducts ahora mapea stock_qty como
    "available real" (stock_qty - reserved_qty); todas las validaciones
    de stock en POS heredan automáticamente el descuento por separados
  - LayawaysPage layout 35/65 con tabs filtrables, lista de cards con
    avatar #N + barra progreso + días restantes coloreados, detalle con
    DetailHeader (CopyableCell #N, badge status), ProgressCard, ItemsCard,
    PaymentsCard, DetailActions adaptativo por status, expiración
    automática vía useExpireOverdueLayaways al montar
  - NewLayawayModal: wizard 3 pasos (cliente con CustomerStep inline +
    QuickCreateInline, items con búsqueda + VariantPicker + lista
    editable, confirmar con abono inicial y método). Acepta prefill
    desde POS (cliente + items del carrito). Tras crear: vista previa
    LayawayReceipt + "Imprimir y continuar" o "Continuar sin imprimir"
  - AddPaymentModal: pills de monto rápido (saldo completo), checkbox
    "Completar venta con este pago" cuando monto = saldo (llama
    useCompleteLayaway con final_payment en lugar de useAddPayment)
  - CompleteLayawayModal: solo cuando paid >= total; advertencia de
    descuento de stock y resumen de ítems
  - CancelLayawayModal: motivo requerido (min 5 chars), avisos
    destacados de liberación de stock y abonos no reembolsados
  - LayawayReceipt: ticket 80mm con secciones SEPARADO #N / Cliente+Tel /
    Fecha+Vence+Creado por / ÍTEMS con T:talla C:color / ABONOS por
    método / Saldo destacado / "Cobra antes de" fecha grande /
    IMPORTANTE; useLayawayReceiptPrintStyle + LayawayReceiptPrint
    (oculto en pantalla, visible en print) siguiendo patrón de
    CashShiftReceipt
  - POSPage: handleLayawayFromPOS valida selectedCustomer + items y
    abre NewLayawayModal con prefill; PaymentModal con botón violeta
    secundario "Crear separado" + divider "o"; al crear, navega a
    /separados y limpia carrito
  - Sidebar: entrada "Separados" (Bookmark icon) en grupo "Operación"
    antes de Devoluciones; ActiveLayawaysBadge integrado al NavItem
    via slot opcional Badge?: React.FC (badge violeta con count o 99+)
  - Router: ruta /separados dentro de ProtectedRoute + AppLayout
    (visible para admin y seller)