# apps/pos — Panel POS (G-Pulso)

## Propósito
Panel principal de la tienda de tecnología. Lo usan:
- Administradores: configuración, reportes, inventario
- Vendedores: ventas, devoluciones, consultas de stock

## Estructura de carpetas
src/
  components/
    layout/     → AppLayout, Sidebar, Header
    ui/         → botones, modals, inputs reutilizables
    pos/        → componentes del módulo de ventas
    products/   → cards, modales, selector de variantes
    inventory/  → movimientos, ajustes de stock
    returns/    → flujo de devoluciones y cambios
  pages/
    LoginPage.tsx
    POSPage.tsx          → ventas con escaner
    ProductsPage.tsx     → CRUD productos y variantes
    InventoryPage.tsx    → movimientos y ajustes
    ReturnsPage.tsx      → devoluciones y cambios
    CustomersPage.tsx    → CRM clientes
    ReportsPage.tsx      → dashboard y reportes
    ConfigPage.tsx       → configuración admin
  hooks/
    useAuth.ts
    useProducts.ts
    useVariants.ts
    useInventory.ts
    useReturns.ts
    useCustomers.ts
    useCashShift.ts
  stores/
    cartStore.ts         → carrito con variantes
    uiStore.ts
  lib/
    supabase.ts
    barcode.ts           → quagga2 y JsBarcode
    printer.ts           → tickets de venta

## Roles
- admin: acceso total
- seller: ventas, devoluciones, consultas

## Patrones específicos
- El carrito siempre incluye variant_id además de product_id
- El stock se descuenta por variante, nunca por producto
- Antes de vender verificar stock > 0 de la variante
- Las devoluciones siempre generan un movimiento de stock