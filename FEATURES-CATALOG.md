# FEATURES-CATALOG — Inventario de funcionalidades de G-Mura

> Catálogo completo de funcionalidades de **G-Mura** (POS de ropa, React 18 +
> TypeScript + Supabase) para decidir qué **portar a un POS de coctelería**
> (mismo stack, multi-tenant con organizaciones/sedes/RBAC).
>
> **Cómo leer la columna "Portabilidad":**
> - 🟢 **Genérica** — sirve a cualquier POS casi sin cambios.
> - 🟡 **Adaptable** — el concepto es genérico pero hay que limpiar supuestos de ropa.
> - 🔴 **Específica de ropa** — atada al dominio (variantes talla/color, etiquetas, etc.).
>
> **Complejidad de port:** baja / media / alta (esfuerzo de reconstrucción).
>
> **Sobre tests E2E:** ⚠️ **El proyecto NO tiene suite E2E** (ni Playwright ni
> Cypress). Solo hay **tests unitarios con Vitest** sobre lógica pura financiera
> y de configuración. Por eso la columna "Tests" indica si la feature tiene
> cobertura **unitaria**; en E2E la respuesta es **No** para todo el sistema.
> Archivos de test existentes: `shiftCalc.test.ts`, `returnCalc.test.ts`,
> `layawayCalc.test.ts`, `cartStore.test.ts`, `labelSizes.test.ts`,
> `products.test.ts`, `useConfig.test.ts` (7 archivos, ~50+ casos).

---

## Mapa de migraciones (referencia transversal)

| # | Archivo | Aporta |
|---|---|---|
| 001 | `001_initial_schema.sql` | Esquema base: stores, profiles, categories, products, variants, customers, orders, order_items, stock_movements, returns, return_items, cash_shifts + triggers de stock + RLS |
| 002 | `002_products_extensions.sql` | Extensiones de catálogo de productos |
| 003 | `003_reports_views.sql` | Vistas SQL para reportes de ventas/inventario |
| 004 | `004_size_types.sql` | `products.size_type` (tipos de talla) 🔴 |
| 005 | `005_sequential_order_numbers.sql` | `orders.order_number` secuencial por tienda (trigger + advisory lock) |
| 006 | `006_payment_methods_cleanup.sql` | Enum `payment_method`: nequi→addi |
| 007 | `007_cash_expenses.sql` | Tabla `cash_expenses` (gastos de caja) |
| 008 | `008_layaways.sql` | Separados: `variants.reserved_qty`, layaways/items/payments + triggers de reserva |
| 009 | `009_layaway_views.sql` | Vistas de separados |
| 010 | `010_layaway_discount.sql` | Descuento + subtotal en separados |
| 011 | `011_suppliers.sql` | Proveedores, facturas de compra, pagos + triggers de stock/caja |
| 012 | `012_purchase_views.sql` | Vistas de compras y saldos de proveedor |
| 013 | `013_multistore.sql` | `user_stores`, `profiles.current_store_id`, RPCs de tienda activa |
| 014 | `014_user_stores_admin_select.sql` | Política admin para leer accesos de otros |
| 015 | `015_store_management.sql` | `stores.is_active`, `create_store_with_access()`, RLS multi-sede |
| 016 | `016_profiles_self_select.sql` | Política self-select en profiles |
| 017 | `017_returns_in_cash_shift.sql` | `cash_expenses.kind`, `orders.return_id` (devoluciones en cuadre) |
| 018 | `018_order_surcharge.sql` | `orders.surcharge` (recargo, ej. Addi) |
| 019 | `019_item_level_discount.sql` | `order_items.list_price` (descuento por ítem) |

Edge Functions (Deno): `create-user` (alta de usuarios con admin client),
`expire-layaways` (cron de expiración de separados).

---

## 1. Autenticación y usuarios

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Login con Supabase Auth** | Email+password contra `auth.users`; sesión persistida. | `auth.users` (Supabase), `profiles` (001) | `LoginPage.tsx`, `useAuth.ts`, `contexts/auth-context.ts` | 🟢 Genérica | Baja | No |
| **Perfil extendido** | `profiles` enlaza `auth.users` con negocio (nombre, rol, tienda, activo). | `profiles` (001), `016` self-select | `useAuth.ts` | 🟢 Genérica | Baja | No |
| **Rutas protegidas + por rol** | `ProtectedRoute` exige sesión; algunas rutas son `allowedRoles=['admin']`. | RLS por rol | `components/layout/ProtectedRoute.tsx`, `App.tsx` | 🟢 Genérica | Baja | No |
| **Alta de usuarios (Edge Function)** | Crea usuario con admin client (service role) sin desloguear al admin; multi-tienda en el alta. | `profiles`, `user_stores` (013) | `supabase/functions/create-user/index.ts`, `UsersSection.tsx`, `useConfigMutations.ts` | 🟢 Genérica | Media | No |
| **Activar/desactivar usuario** | Toggle `is_active`; gating de acceso sin borrar histórico. | `profiles.is_active` | `UsersSection.tsx` | 🟢 Genérica | Baja | No |
| **Manejo de error de perfil** | Si falla `fetchProfile`: `toast.error` + `signOut` (no deja sesión a medias). | — | `auth-context.ts` | 🟢 Genérica | Baja | No |

> **Nota de detalle valioso:** el alta vía Edge Function evita el bug clásico de
> "crear usuario te desloguea" (Supabase cambia la sesión al `signUp`). Usa el
> admin client del lado servidor. Vale la pena portarlo tal cual.

---

## 2. Multi-tenant / organizaciones / sedes

> El target quiere **organizaciones → sedes → RBAC**. G-Mura tiene un modelo más
> plano (**tienda = tenant**, sin nivel "organización"), pero el mecanismo de
> tienda activa + RLS es directamente reutilizable como capa "sede".

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Tienda como tenant** | Cada `store` es un tenant aislado; TODAS las tablas llevan `store_id`. | `stores` (001) | transversal | 🟢 Genérica | Media | No |
| **Aislamiento por RLS** | `get_my_store_id()` (SECURITY DEFINER) alimenta todas las políticas: cada usuario solo ve su tienda. | funciones + policies (001, 013) | RLS en todas las tablas | 🟢 Genérica | Media | No |
| **Tienda activa (switcher)** | Admin con varias tiendas cambia la "tienda activa" (`current_store_id`); el RLS entero opera sobre ella. | `profiles.current_store_id`, `switch_active_store()`, `get_my_stores()` (013) | `StoreSwitcher.tsx`, `useStores.ts`, `useActiveStoreId.ts` | 🟢 Genérica | **Alta** | No |
| **Accesos admin↔tiendas** | `user_stores` (N:M) define a qué tiendas accede un admin; vendedores quedan atados a una. | `user_stores` (013), `014` | `useUserStores.ts`, `UsersSection.tsx` | 🟢 Genérica | Media | No |
| **Crear sucursal desde la app** | RPC atómica crea tienda + da acceso al admin creador (no se autobloquea por RLS). | `create_store_with_access()` (015) | `StoresSection.tsx`, `useStores.ts` | 🟢 Genérica | Media | No |
| **Sucursal activa/inactiva** | Soft-flag `stores.is_active` para sedes fuera de operación. | `stores.is_active` (015) | `StoresSection.tsx` | 🟢 Genérica | Baja | No |
| **Confirmación al cambiar de tienda** | Avisa si hay turno abierto (sigue abierto) o carrito en curso (se limpia) antes de cambiar. | — | `StoreSwitcher.tsx` | 🟢 Genérica | Baja | No |

> **Recomendación para el target:** añadí una tabla `organizations` por encima de
> `stores` (sede), y cambiá `get_my_store_id()` por un par
> `get_my_org_id()` / `get_my_store_id()`. El patrón "función SECURITY DEFINER
> que resuelve el tenant activo + RLS que la consume" es el núcleo a copiar. El
> `COALESCE(current_store_id, store_id)` como defensa contra estado nulo es un
> detalle fino que evita dejar a un usuario sin datos.

---

## 3. RBAC / roles y permisos

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Roles admin/seller** | Enum `user_role` de 2 niveles; `get_my_role()` (DEFINER) en políticas. | `user_role` enum, `get_my_role()` (001) | RLS + `useAuth` | 🟡 Adaptable | Baja | No |
| **Gating en RLS** | Mutaciones sensibles (catálogo, ajustes, config) exigen `get_my_role()='admin'` en la política. | policies (001, 011…) | todas las tablas | 🟢 Genérica | Baja | No |
| **Gating en UI** | Sidebar/rutas filtran ítems admin-only (`adminOnly`, `allowedRoles`). | — | `Sidebar.tsx`, `ProtectedRoute.tsx` | 🟢 Genérica | Baja | No |

> **Limitación a considerar:** RBAC es **hardcodeado a 2 roles**, sin tabla de
> permisos granular. Si el target necesita roles configurables (bartender,
> cajero, supervisor, dueño…), esto hay que **rediseñarlo** (tabla
> `roles`/`permissions` o claims). No es portable tal cual; es el punto más débil
> para tu caso de uso. Complejidad de rediseño: **alta**.

---

## 4. POS / ventas

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Carrito (Zustand)** | Estado de carrito con totales derivados; persiste ítems con variante. | — | `stores/cartStore.ts` | 🟡 Adaptable | Media | ✅ `cartStore.test.ts` |
| **Crear venta (orden + ítems)** | Inserta `orders` + `order_items`; el stock baja por trigger; rollback de la orden si fallan los ítems. | `orders`, `order_items` (001) | `useCreateOrder.ts` | 🟡 Adaptable | Media | Parcial (totales) |
| **Búsqueda de productos en POS** | Búsqueda server-side con LIMIT; respeta disponible (stock−reservado). | `variants` + `008` | `usePOSSearch.ts`, `POSPage.tsx` | 🟡 Adaptable | Media | No |
| **Modal de pago multi-método** | cash/card/transfer/addi configurables por tienda; muestra QR en transfer. | `payment_method` enum (006) | `POSPage.tsx` (PaymentModal), `lib/paymentMethods.ts` | 🟢 Genérica | Media | No |
| **Chips de monto rápido (efectivo)** | "Exacto" + denominaciones COP reales (20k/50k/100k) + round-ups; filtra ≤ total, dedupe. | — | `POSPage.tsx` | 🟡 Adaptable | Baja | No |
| **Cálculo de cambio** | `cash_received` permite calcular vuelto. | `orders.cash_received` (001) | PaymentModal | 🟢 Genérica | Baja | No |
| **Descuento por ítem** | Precio final por línea con tope configurable; `list_price` vs `unit_price`; clamp al catálogo. | `order_items.list_price` (019) | `ItemPriceField.tsx`, `cartStore.ts`, `useCreateOrder.ts` | 🟢 Genérica | Media | Parcial |
| **Recargo manual (Addi)** | Suma al total (ej. recargo por cuotas); va en cabecera. | `orders.surcharge` (018) | PaymentModal, `useCreateOrder.ts` | 🟢 Genérica | Baja | No |
| **Numeración secuencial de orden** | `order_number` int legible por tienda vía trigger con advisory lock (no UUID al usuario). | `orders.order_number` (005) | `useSalesHistory.ts`, recibos | 🟢 Genérica | Media | No |
| **Bloqueo de venta sin turno** | POS muestra full-screen "Debes abrir turno" si no hay turno abierto. | `cash_shifts` (001) | `POSPage.tsx`, `useCashShift.ts` | 🟢 Genérica | Baja | No |
| **Ticket de venta 80mm** | Recibo térmico imprimible con impresión aislada (`@media print` oculta el resto). | — | `components/sales/SaleReceipt.tsx`, `lib/receiptPrint.ts` | 🟢 Genérica | Media | No |
| **Validación anti-sobreventa** | Doble barrera: filtro UI + `CHECK(stock_qty>=0)` y validación en trigger. | triggers (001) | `deduct_stock_on_sale()` | 🟡 Adaptable | Baja | No |

> **Detalle de UX con valor desproporcionado:** los **chips de denominaciones COP
> reales** y los round-ups ("al próximo $10k / $100k") aceleran el cobro en
> efectivo (lo más común en barra). Pequeño pero muy valioso. La **impresión
> aislada** (`lib/receiptPrint.ts`, hook compartido que inyecta `@media print`
> una sola vez con guard por id) es un patrón reutilizable para todos los recibos.

---

## 5. Caja / turnos

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Abrir/cerrar turno** | Turno por usuario (`closed_at IS NULL` = abierto); monto inicial y cierre. | `cash_shifts` (001) | `useCashShift.ts`, `useCashShiftMutations.ts`, `CashShiftModals.tsx` | 🟢 Genérica | Media | No |
| **Gastos de caja (egresos)** | Registra salidas de efectivo del turno con motivo; inmutable (sin UPDATE) para trazabilidad. | `cash_expenses` (007) | `useCashExpenses.ts`, `useCashExpenseMutations.ts`, `ExpenseModal` | 🟢 Genérica | Media | No |
| **Motivos de egreso configurables** | Lista editable en config; valida duplicados y mínimo 2 motivos. | `stores.config.expense_reasons` | `CajaSection.tsx` | 🟢 Genérica | Baja | No |
| **Cuadre de caja (cálculo)** | Esperado = apertura + ventas − egresos; clasifica devoluciones; tope en $0 con sobregiro. | — | `lib/shiftCalc.ts`, `useShiftClosing.ts` | 🟢 Genérica | **Alta** | ✅ `shiftCalc.test.ts` (16+ casos) |
| **Cuadre imprimible 80mm** | Ticket de cierre con ventas por método, egresos, devoluciones, badge cuadrado/sobrante/faltante. | — | `components/cash/CashShiftReceipt.tsx` | 🟢 Genérica | Media | No |
| **Header con estado de turno** | Badge "Turno abierto · HH:mm" + botones Gasto/Cerrar; CTA "Abrir turno" si no hay. | — | `Header.tsx`, `CashShiftModals.tsx` | 🟢 Genérica | Baja | No |
| **Historial de turnos** | Tabla paginada con cajero, montos, diferencia; reimpresión del recibo. | `cash_shifts` + JOINs | `CashShiftsHistoryPage.tsx`, `useShiftHistory.ts` | 🟢 Genérica | Media | No |
| **Historial de gastos** | Página dedicada a egresos históricos. | `cash_expenses` (007) | `ExpenseHistoryPage.tsx` | 🟢 Genérica | Baja | No |

> **Funcionalidad estrella (ver abajo).** El cuadre es la lógica más densa y
> mejor testeada del sistema. Casos cubiertos: solo efectivo afecta esperado,
> sobregiro (egresos > disponible → no inventa sobrante), devoluciones netas,
> abonos de separados sin doble conteo. **Altamente portable y crítico para barra**
> (los turnos de bartender necesitan cuadre exacto). La lógica pura está aislada
> en `lib/shiftCalc.ts` sin React ni red → se reusa casi literal.

---

## 6. Inventario y stock

> Detalle profundo en `INVENTORY-SPEC.md`. Resumen aquí.

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Stock por unidad vendible** | `stock_qty` (entero) como única fuente de verdad; lo mueven triggers, no el cliente. | `variants.stock_qty` (001) | `useInventory.ts` | 🟡 Adaptable | Media | No |
| **Auditoría de movimientos** | `stock_movements` append-only, `qty` con signo, `reference_id` al documento origen. | `stock_movements` (001) | `InventoryPage.tsx` (tab Movimientos) | 🟢 Genérica | Media | No |
| **Descuento automático al vender** | Trigger `deduct_stock_on_sale` valida y resta + audita. | trigger (001) | — | 🟡 Adaptable | Media | No |
| **Ajuste manual** | UPDATE + INSERT desde cliente; tipos-etiqueta (Ingreso/Conteo/Merma/Otro); motivo obligatorio. | — | `useInventoryMutations.ts`, `AdjustModal` | 🟢 Genérica | Baja | No |
| **Alertas de stock** | `out`/`low`/`ok` sobre disponible (stock−reservado) vs `min_stock`. | `variants.min_stock` | `useInventory.ts`, `InventoryPage.tsx` | 🟢 Genérica | Baja | No |
| **Valor de inventario** | `Σ stock_qty * cost_price` en cliente (costo último conocido). | `variants.cost_price` | `InventoryPage.tsx` | 🟢 Genérica | Baja | No |
| **Stock reservado** | `reserved_qty` para separados; disponible = stock−reservado. | `variants.reserved_qty` (008) | `useInventory.ts` | 🟡 Adaptable | Media | No |
| **Export a Excel** | Inventario completo a `.xlsx` (exceljs, carga dinámica), filas tintadas por estado. | — | `InventoryPage.tsx` | 🟢 Genérica | Baja | No |
| **Composición / recetas** | ❌ **NO existe.** Crítico para coctelería (cóctel→insumos). Diseño en `INVENTORY-SPEC.md §1.5`. | — | — | 🔴 (a construir) | **Alta** | — |

> ⚠️ Para coctelería el gran faltante es la **composición** (un trago consume
> 45ml de ron). Ver `INVENTORY-SPEC.md`. Además `stock_qty` debería ser `numeric`
> (fracciones), no `integer`.

---

## 7. Productos / catálogo

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **CRUD de productos** | Alta/edición con nombre, descripción, marca, categoría, activo. | `products` (001, 002) | `ProductsPage.tsx`, `ProductModal.tsx`, `useProductMutations.ts` | 🟢 Genérica | Media | No |
| **Categorías** | CRUD con color y orden; delete con `ON DELETE SET NULL` y conteo de afectados. | `categories` (001) | `CategoriesManager.tsx`, `useCategoryMutations.ts` | 🟢 Genérica | Baja | No |
| **Marca con autocompletar** | Campo marca reutilizado en venta/factura/etiqueta. | `products.brand` | `ProductModal.tsx` | 🟡 Adaptable | Baja | No |
| **Tarjeta con rango de precios** | Catálogo muestra marca, rango de precios y descripción (diferenciar homónimos). | `variants.price` | `ProductsPage.tsx` | 🟡 Adaptable | Baja | No |
| **Variantes (talla + color)** | Stock por variante; selector dinámico por tipo de talla. | `variants` (001, 004) | `VariantsPanel.tsx` | 🔴 **Ropa** | Alta | No |
| **Tipos de talla configurables** | Catálogos letter/pants/shoes/baby… gestionables desde config. | `stores.config.size_types` (004) | `lib/sizeTypes.ts`, `ProductsSection.tsx` | 🔴 **Ropa** | Media | No |
| **Anti-duplicados al crear** | Al crear producto busca nombres similares (ilike) y ofrece usar el existente. | — | `NewInvoiceModal.tsx`, `DuplicateProductWarning` | 🟢 Genérica | Media | No |
| **Helpers de color** | `getColorHex` mapea nombre de color a HEX para chips. | — | `lib/products.ts` | 🔴 **Ropa** | Baja | ✅ `products.test.ts` |

---

## 8. Clientes / CRM

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **CRUD de clientes** | Nombre, teléfono, email, documento, notas. | `customers` (001) | `CustomersPage.tsx`, `useCustomers.ts`, `useCustomerMutations.ts` | 🟢 Genérica | Baja | No |
| **Búsqueda de clientes** | Server-side por nombre/teléfono; alta rápida inline desde POS. | `customers` + índices | `useCustomers.ts`, POS QuickCreate | 🟢 Genérica | Baja | No |
| **Perfil con historial** | Tabs Compras / Devoluciones / Separados por cliente. | JOINs | `CustomersPage.tsx` | 🟡 Adaptable | Media | No |
| **Venta rápida sin cliente** | `orders.customer_id` nullable. | `orders` (001) | POS | 🟢 Genérica | Baja | No |

---

## 9. Compras / proveedores

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **CRUD de proveedores** | Datos + condiciones (NIT, términos de pago, contacto). | `suppliers` (011) | `SuppliersPage.tsx`, `SupplierModal.tsx`, `useSuppliers.ts` | 🟢 Genérica | Media | No |
| **Facturas de compra** | Cabecera + ítems; cada ítem **incrementa stock** por trigger; opción `update_cost`. | `purchase_invoices`, `purchase_invoice_items` (011) | `NewInvoiceModal.tsx`, `useInvoiceMutations.ts` | 🟢 Genérica | **Alta** | No |
| **Pagos a proveedor** | Abonos; recalculan estado (pending/partial/paid) por trigger. | `supplier_payments` (011) | `PaymentModal.tsx`, `useSupplierPayments.ts` | 🟢 Genérica | Media | No |
| **Cuentas por pagar** | Saldos consolidados, vencidas, banner rojo, deep-link. | `supplier_balance` view (012) | `SuppliersPage.tsx`, `useReports.ts` | 🟢 Genérica | Media | No |
| **Pago efectivo → cuadre** | Pago en efectivo en turno abierto genera `cash_expense` automático. | trigger (011) | `useShiftClosing.ts` | 🟢 Genérica | Media | No |
| **Notificaciones de vencimiento** | Campana admin con facturas vencidas o por vencer ≤3 días. | `due_date` (011) | `SupplierNotifications.tsx` | 🟢 Genérica | Baja | No |
| **Crear producto al vuelo en factura** | Desde la factura crea producto+variante con `update_cost=true`. | — | `NewInvoiceModal.tsx` | 🟡 Adaptable | Media | No |
| **Detalle imprimible de factura** | Ítems + pagos + progreso con impresión aislada. | — | `InvoiceDetailModal.tsx` | 🟢 Genérica | Baja | No |

> Módulo grande y **muy portable**: una barra compra licores/insumos a
> proveedores igual que una tienda compra ropa. El **trigger compra→stock** y el
> **pago efectivo→egreso de caja** son justo lo que necesita coctelería.

---

## 10. Devoluciones / cambios

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Devolución (refund)** | Devuelve dinero; repone stock por trigger; valida `return_days_limit`. | `returns`, `return_items` (001) | `ReturnsPage.tsx`, `useReturnMutations.ts`, `useReturns.ts` | 🔴 **Ropa** | Alta | No |
| **Cambio (exchange)** | Cambia por otro artículo; netea la diferencia de precio (no infla ventas). | `returns` + orden de cambio | `useReturnMutations.ts`, `lib/returnCalc.ts` | 🔴 **Ropa** | **Alta** | ✅ `returnCalc.test.ts` |
| **Devolución en el cuadre** | Reembolso efectivo genera `cash_expense kind='return'`; afecta caja sin doble conteo. | `cash_expenses.kind`, `orders.return_id` (017) | `useReturnMutations.ts`, `shiftCalc.ts` | 🟡 Adaptable | Alta | ✅ (cubierto en shiftCalc) |
| **Precarga desde historial** | `?orderId=` precarga orden y salta al paso 2 del flujo. | — | `ReturnsPage.tsx` | 🟢 Genérica | Baja | No |
| **Rollback compensatorio** | Si la devolución se commitea pero el cambio falla, DELETE compensatorio + mensaje accionable. | — | `useReturnMutations.ts` | 🟡 Adaptable | Alta | No |

> Las devoluciones de ropa son flujo crítico, pero en **coctelería casi no
> existen** (no devolvés un trago consumido). Probablemente **no portar** el flujo
> completo; sí conservar el concepto de "egreso de caja por reembolso" para
> anulaciones/cortesías. La lógica de **netear cambios** (`returnCalc.ts`) es un
> buen ejemplo de aislamiento testeable, pero el caso de uso no aplica.

---

## 11. Separados (layaway) — *módulo extra no listado en el pedido*

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Apartado con abonos** | Cliente aparta mercancía, reserva stock y paga en cuotas. | `layaways`, `layaway_items`, `layaway_payments` (008) | `LayawaysPage.tsx`, `useLayaways.ts`, `useLayawayMutations.ts` | 🔴 **Ropa/retail** | **Alta** | No |
| **Reserva de stock** | Triggers suben/bajan `reserved_qty` sin tocar stock físico hasta completar. | triggers (008) | — | 🟡 Adaptable | Alta | No |
| **Descuento en separado** | Monto fijo configurable; valida ≤ subtotal. | `010` | `NewLayawayModal.tsx`, `lib/layawayCalc.ts` | 🔴 Retail | Media | ✅ `layawayCalc.test.ts` |
| **Expiración automática** | Edge Function + cron (3am Bogotá) libera separados vencidos; fallback en cliente. | `expire_overdue_layaways()` (008) | `supabase/functions/expire-layaways` | 🟡 Adaptable | Media | No |
| **Recibo de separado** | Ticket 80mm con saldo y fecha de vencimiento. | — | `LayawayReceipt.tsx` | 🟢 Genérica | Baja | No |

> **No portar** a coctelería (nadie aparta tragos). Mencionado por completitud.

---

## 12. Códigos de barras

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Lectura por cámara** | Escaneo con quagga2 en POS para venta rápida. | `variants.barcode` (001) | `BarcodeScanner.tsx`, `useBarcode.ts` | 🟡 Adaptable | Media | No |
| **Generación (JsBarcode)** | Genera CODE128; autogenera barcode temporal si la variante no tiene. | — | `LabelPrintModal.tsx` | 🟡 Adaptable | Media | No |
| **Búsqueda por barcode** | Index dedicado; escaneo agrega al carrito. | `idx_variants_barcode` | `usePOSSearch.ts` | 🟢 Genérica | Baja | No |

> Útil si la barra escanea botellas (EAN del proveedor). El lector de cámara es
> 🟢; la generación de etiquetas propias es más de retail.

---

## 13. Etiquetas / impresión de precios — 🔴 específico de ropa

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Impresión de etiquetas** | Etiquetas con barcode+precio+marca; 3 tamaños configurables (38x25/50x30/58x40). | `stores.config.label_*` | `LabelPrintModal.tsx`, `EtiquetasSection.tsx`, `lib/labelSizes.ts` | 🔴 **Ropa** | Alta | ✅ `labelSizes.test.ts` |
| **Campos de etiqueta configurables** | Checkboxes de qué mostrar; preview JsBarcode en vivo; escala de fuente afinable. | `stores.config.label_fields` | `EtiquetasSection.tsx` | 🔴 **Ropa** | Media | No |

> Botellas ya vienen etiquetadas; **no portar** salvo que imprimas etiquetas de
> estantería.

---

## 14. Reportes y dashboards

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Reporte de ventas** | KPIs, ventas por método/día, gráficas apiladas. | vistas (003) | `ReportsPage.tsx`, `useReports.ts` | 🟢 Genérica | Media | No |
| **Reporte de inventario** | Valor, bajo stock, reservas. | `003` | `ReportsPage.tsx` | 🟡 Adaptable | Media | No |
| **Reporte de compras** | Compras por mes/proveedor, días de pago, cuentas por pagar; gráficas + Excel. | `purchase_summary`, `supplier_balance` (012) | `ReportsPage.tsx`, `useReports.ts` | 🟢 Genérica | Media | No |
| **Reporte de separados** | Estados, por vencer, tasa de conversión. | `009` | `ReportsPage.tsx` | 🔴 Retail | Media | No |
| **Historial de ventas** | Paginado con filtros (fecha, método, estado), detalle expandible, celdas copiables, reimpresión. | `orders` + `005` | `SalesHistoryPage.tsx`, `useSalesHistory.ts` | 🟢 Genérica | Media | No |
| **Export a Excel (multi-hoja)** | exceljs con hojas por dominio (ventas, saldos, separados). | — | `ReportsPage.tsx`, `InventoryPage.tsx` | 🟢 Genérica | Baja | No |

> **Patrón reutilizable clave:** los reportes se apoyan en **vistas SQL con
> `security_invoker=true`** (003/009/012), no en queries crudas en cliente. Es la
> forma correcta de escalar reportes respetando RLS. Copiá el patrón.

---

## 15. Configuración

| Feature | Descripción | SQL | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|---|
| **Config como JSONB** | `stores.config` centraliza parámetros (métodos de pago, motivos, formatos…) con `resolveConfig` + defaults. | `stores.config` (001) | `useConfig.ts`, `config.types.ts` | 🟢 Genérica | Media | ✅ `useConfig.test.ts` |
| **Sección Tienda** | Nombre/dirección/teléfono, logo circular, zona horaria. | `stores` | `StoreSection.tsx`, `useConfigMutations.ts` | 🟢 Genérica | Baja | No |
| **Sección Usuarios** | Lista con roles, toggles activo, modal alta multi-tienda. | `profiles`, `user_stores` | `UsersSection.tsx` | 🟢 Genérica | Media | No |
| **Sección Sucursales** | Crear/editar/activar sedes. | `stores` (015) | `StoresSection.tsx` | 🟢 Genérica | Media | No |
| **Sección Caja** | Motivos de ajuste/egreso, métodos de pago, QR de pago, descuento de separados. | `stores.config` | `CajaSection.tsx` | 🟢 Genérica | Media | No |
| **Sección Productos** | Tallas, colores, marcas, días de devolución. | `stores.config` | `ProductsSection.tsx` | 🔴 Parcial ropa | Media | No |
| **Sección Etiquetas** | Formato y campos de etiqueta con preview. | `stores.config` | `EtiquetasSection.tsx` | 🔴 **Ropa** | Media | No |
| **Upload de imágenes** | Logo y QR de pago a Supabase Storage con try/catch. | Storage | `useConfigMutations.ts` | 🟢 Genérica | Baja | No |

> **`resolveConfig` + `DEFAULT_CONFIG` + `useResolvedConfig`** (memoizado) es un
> patrón muy limpio para parámetros por tenant con migración de claves legacy al
> leer. Portalo: te ahorra una tabla de settings y mil columnas.

---

## 16. Navegación / layout / UX transversal

| Feature | Descripción | Implementación | Portabilidad | Complejidad | Tests |
|---|---|---|---|---|---|
| **Sidebar agrupado colapsable** | 4 grupos colapsables con persistencia por usuario en localStorage; auto-expande el grupo activo; indicador de selección oculta. | `Sidebar.tsx` | 🟢 Genérica | Media | No |
| **Notificaciones en header** | Campanas de separados por vencer y facturas por pagar (admin/seller). | `LayawayNotifications.tsx`, `SupplierNotifications.tsx` | 🟡 Adaptable | Baja | No |
| **Celdas copiables** | `CopyableCell` con toast 1.5s (copiar #orden, UUID, total para soporte). | `SalesHistoryPage.tsx` | 🟢 Genérica | Baja | No |
| **Debounce de búsqueda** | Hook `useDebounce` para búsquedas server-side (300ms). | `useDebounce.ts` | 🟢 Genérica | Baja | No |
| **Formato COP / fechas Bogotá** | `Intl.NumberFormat('es-CO')` y helpers de zona horaria America/Bogota. | `lib/formatters.ts`, `lib/dates.ts` | 🟡 Adaptable | Baja | No |
| **Impresión aislada reutilizable** | Hook `useReceiptPrintStyle(styleId, containerId)` inyecta `@media print` una vez; reusado por todos los recibos. | `lib/receiptPrint.ts` | 🟢 Genérica | Media | No |
| **Realtime con canal único** | Convención de canal con sufijo aleatorio para evitar colisiones. | `lib/supabase.ts` | 🟢 Genérica | Baja | No |

> Detalles chicos de **alto retorno**: debounce, celdas copiables, impresión
> aislada, formato/zona horaria centralizados, sidebar persistente. Copiar estos
> primero da sensación de producto pulido por poco esfuerzo.

---

## Funcionalidades estrella

Las que más valor de negocio aportaron en G-Mura y conviene **reconstruir
temprano** en el POS de coctelería:

1. **Cuadre de caja con lógica de sobregiro y devoluciones** (`lib/shiftCalc.ts`)
   — el corazón financiero. Bien testeado, lógica pura aislada, maneja casos
   reales (egresos > efectivo, abonos, netos). Una barra **vive o muere** por el
   cuadre exacto del turno del bartender. 🏆 Lo más portable y valioso.

2. **Stock movido 100% por triggers en BD** — atomicidad y auditoría imposible de
   desincronizar. Es el patrón sobre el que se construye TODO el inventario;
   reusarlo evita una clase entera de bugs de stock.

3. **Multi-tenant por RLS + tienda activa** (`get_my_store_id()` +
   `switch_active_store()`) — exactamente la base que tu modelo
   organizaciones/sedes necesita. El switcher con confirmación y el COALESCE
   defensivo son detalles maduros.

4. **Módulo de compras con stock y caja integrados** — comprar a proveedor sube
   stock y, si es efectivo, impacta el cuadre, sin doble conteo. Una barra compra
   licores constantemente; esto le da control de costos y cuentas por pagar.

5. **Config JSONB por tenant** (`resolveConfig`/`DEFAULT_CONFIG`) — parametriza
   métodos de pago, motivos, formatos sin migraciones por cada ajuste. Acelera
   muchísimo iterar parámetros por sede.

6. **Impresión térmica aislada reutilizable** (`lib/receiptPrint.ts`) — un hook
   resuelve todos los tickets (venta, cuadre, factura). Imprimir comandas/tickets
   es pan de cada día en barra.

7. **Turnos de caja con bloqueo de venta** — no se puede vender sin turno abierto;
   fuerza disciplina de caja. Directamente aplicable a un bartender por turno.

8. **Numeración secuencial legible + historial con celdas copiables** — `#1234`
   en vez de UUID, búsqueda y reimpresión. UX de soporte que se agradece a diario.

9. **Alta de usuarios sin desloguear (Edge Function)** — evita el bug clásico de
   Supabase. Pequeño pero ahorra dolor real.

10. **Detalles de cobro en efectivo** (chips de denominaciones + round-ups) —
    aceleran el cobro más frecuente en barra. Esfuerzo mínimo, uso constante.

---

## Específicas de ropa (probablemente NO portables)

Dependen tanto del dominio de ropa que en coctelería no aportan o estorban:

1. **Variantes talla + color** (`variants.size/color`, `VariantsPanel`) — un
   cóctel no tiene tallas. El stock debe colapsar a producto/insumo. Es la
   diferencia estructural #1 (ver `INVENTORY-SPEC.md`).

2. **Tipos de talla configurables** (`lib/sizeTypes.ts`, `004`) — catálogos
   letter/pants/shoes/baby. Sin sentido en barra.

3. **Etiquetas de precio imprimibles** (`LabelPrintModal`, `labelSizes`,
   `EtiquetasSection`) — botellas ya vienen etiquetadas; el sistema de etiquetas
   con barcode propio es retail puro.

4. **Devoluciones y cambios** (`returns`, `return_items`, `ReturnsPage`,
   `returnCalc`) — no devolvés un trago consumido. Conservá solo el concepto de
   "egreso por reembolso/cortesía" para anulaciones.

5. **Separados / layaway** (todo el módulo `008`–`010`, `LayawaysPage`) — nadie
   aparta tragos para pagar en cuotas. Con él se va `reserved_qty` y sus 3
   triggers de reserva.

6. **Helpers de color** (`getColorHex`) y la **tarjeta de producto con rango de
   precios para diferenciar homónimos** — resuelven problemas específicos de
   catálogo de ropa.

7. **Días de devolución / marcas como eje de catálogo** (`ProductsSection`) —
   parámetros centrados en prendas. Las "marcas" podrían reinterpretarse como
   destilería, pero no es 1:1.

---

### Resumen de decisión rápida

- **Portar casi tal cual (🟢):** auth/usuarios, multi-tenant+RLS, caja/turnos,
  cuadre, compras/proveedores, config JSONB, reportes (vía vistas), historial de
  ventas, impresión térmica, UX transversal.
- **Adaptar (🟡):** carrito/venta y stock (colapsar variantes, `numeric`),
  códigos de barras, CRM, RBAC (si necesitás roles granulares → rediseño).
- **Construir nuevo:** **composición/recetas de productos** (lo más importante y
  ausente — `INVENTORY-SPEC.md §1.5`).
- **Omitir (🔴):** variantes, tallas, etiquetas, devoluciones, separados.
- **Recordá:** ninguna feature tiene **E2E**; si el target los quiere, es trabajo
  desde cero (la base de tests unitarios financieros sí es reusable).
