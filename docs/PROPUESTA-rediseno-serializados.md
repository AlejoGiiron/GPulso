# Propuesta — Rediseño del modelo de equipos serializados

> **Estado:** BORRADOR para revisión. NADA implementado, ninguna rama tocada.
> No implementar hasta aprobación conjunta.
> **Fecha:** 2026-07-22 · **Autor:** Claude (investigación sobre `develop`)

---

## 0. TL;DR (lo que decides en una página)

**Modelo objetivo aprobado con el cliente:**
- El **producto serializado es una PLANTILLA**: marca, modelo, categoría y un
  **precio sugerido**. Sin variante definida por adelantado, sin costo.
- La **unidad** lleva su detalle: `serial`, **`cost` real**, **variante en texto
  libre** opcional ("128GB Azul"), y **`price`** que arranca del sugerido pero es
  editable al vender.
- Crear **"equipo + primera unidad" en UN gesto**, en Productos y en el POS.

**Recomendación central (pregunta 3):** las unidades **siguen colgando de
`variant_id`**; la "variante única invisible" se queda como **esqueleto técnico
(ancla)** explícito, no desaparece. El rediseño mueve *dónde vive el precio, el
costo y la etiqueta de variante* (producto/unidad) — que es **ortogonal** a de
qué cuelga la unidad. Colgar directo de `product_id` (Opción B) NO ahorra
migración (no hay datos), pero **bifurca permanentemente** `order_items`,
`stock_movements`, reportes, devoluciones y separados — justo lo que comparten
los accesorios y que el requisito 4 exige dejar intacto.

**Cambios de esquema (todos aditivos, nullable):**
- `products.suggested_price numeric(12,2)` (solo lo usa lo serializado).
- `units.price numeric(12,2)` (precio de venta de ESA unidad; semilla = sugerido).
- `units.variant_label text` (texto libre "128GB Azul", opcional).
- `units.cost` **ya existe**. `products` **NO** gana columna de costo.

**Ventaja de timing:** CelFashion no tiene ni un celular serializado en prod →
`units` está vacía → **cero migración de datos**. El único backfill es copiar
`variants.price → products.suggested_price` de los productos serializados que ya
existan (para que ninguno quede sin precio).

**Por qué es barato:** con la Opción A, `create_order` (la RPC atómica de venta,
el corazón riesgoso) **no cambia de firma ni de lógica**. El carrito ya manda
`unit_price`/`list_price` editables. Solo cambian los caminos de **lectura de
precio/etiqueta** y los de **alta**.

---

## 1. Mapa de impacto

Leyenda: 🟢 sin cambio · 🟡 cambio de lectura/UI · 🔴 cambio de escritura/esquema · ➕ nuevo

### 1.1 Migraciones (BD)

| Objeto | Hoy | Cambio |
|---|---|---|
| `products.suggested_price` | no existe | 🔴➕ `numeric(12,2) NULL`. Precio sugerido de la plantilla. Backfill = `variants.price` de la variante única de cada producto serializado existente. |
| `products` costo | no existe | 🟢 **no se agrega**. El costo no existe hasta que entra una unidad. |
| `units.price` | no existe | 🔴➕ `numeric(12,2) NULL`, `CHECK (price IS NULL OR price >= 0)`. Precio de venta de la unidad; semilla = `suggested_price`. |
| `units.variant_label` | no existe | 🔴➕ `text NULL`. Texto libre "128GB Azul". |
| `units.cost` | existe | 🟢 ya cumple el rol de "costo real por unidad". |
| `units.variant_id` | `NOT NULL FK` | 🟢 **se conserva** (Opción A: ancla técnica). |
| `variants` (serializados) | `price`, `cost_price` | 🟡 quedan **vestigiales** para serializados (dejan de ser la fuente). Se conservan para accesorios. |
| `variants.stock_qty` | derivado por trigger | 🟢 sin cambio (sigue = `COUNT(units disponible)`). |
| Enum `unit_status` | `disponible/reservada/vendida` | 🟢 sin cambio. |

Sin `DROP COLUMN`: eliminar `variants.price/cost_price` para serializados
obligaría a bifurcar el mundo de accesorios. Se dejan y se marcan como no-fuente.

### 1.2 RPCs / triggers

| Función | Hoy | Cambio |
|---|---|---|
| `create_order` (041) | recibe `unit_price/list_price` del carrito; valida variante↔producto↔tienda; `claim_unit` por línea serializada | 🟢 **sin cambio de firma ni lógica**. El precio ya viene del carrito. |
| `claim_unit` / `reserve_unit` / `release_reserved_unit` / `complete_reserved_unit` / `restore_returned_unit` (039) | operan sobre `status` + `variant_id` | 🟢 sin cambio (Opción A). |
| `sync_variant_stock_from_units` (039) | `stock_qty = COUNT(units disp.)` | 🟢 sin cambio. |
| `enforce_is_serialized_immutable` (039) | bloquea cambio si hay units/ventas | 🟢 sin cambio. |
| Guardas heredadas (`deduct_stock_on_sale`, `restore_stock_on_return`, `reserve/release/fulfill_layaway`, `increase_stock_on_purchase`) | early-return si `is_serialized_variant` | 🟢 sin cambio. Los accesorios pasan derecho. |
| `receive_serialized_units` (040) | crea units con `cost = línea.unit_cost` | 🟡 opcional: sembrar `units.price = suggested_price` y aceptar `variant_label` por serial. |
| ➕ `create_equipment_with_unit` | no existe | 🔴➕ RPC atómica: producto(plantilla) + variante ancla + primera unidad + `stock_movement 'adjustment'`, todo o nada. Reemplaza el `createSimple`+`addManualUnit` en dos pasos (evita plantillas huérfanas). |

### 1.3 Tipos TS (`src/types/database.types.ts`)

- 🔴 `Product += suggested_price: number | null`.
- 🔴 `Unit += price: number | null`, `variant_label: string | null`.
- 🔴 `Database.Tables.products.Insert/Update`, `units.Insert/Update` con los campos nuevos opcionales.
- 🟡 `UnitForSale` (en `useUnits.ts`): reemplaza `size/color` por `variant_label`; `price` pasa a salir de `unit.price ?? product.suggested_price`.

### 1.4 Hooks

| Hook | Cambio |
|---|---|
| `useUnits.ts` · `lookupUnitBySerial`, `useUnitsForVariants` | 🟡 seleccionar `units.price, variant_label` y `products.suggested_price` en vez de `variants.price/size/color`. Precio = `unit.price ?? suggested_price`. |
| `useUnits.ts` · `useUnitDetail`, `useCustomerUnits`, `useOrderItemUnits`, `useVariantUnits` | 🟡 exponer `variant_label` y `price` en la ficha/listas. |
| `useUnitMutations.ts` · `addManualUnit` | 🔴 acepta `price` y `variant_label`. |
| `useProductMutations.ts` · `createSimple` | 🟡 rama serializada: guarda `suggested_price` en el producto y NO precio/stock en la variante ancla. |
| ➕ `useProductMutations.ts` · `createEquipmentWithUnit` | 🔴➕ llama la RPC nueva. |
| `usePOSSearch.ts` (`POSProduct/POSVariant`) | 🟡 exponer `suggested_price` del producto para sembrar el precio en el POS. |
| `useCreateOrder.ts` | 🟢 sin cambio (ya manda `unit_price/list_price`). |

### 1.5 Componentes UI

| Componente | Cambio |
|---|---|
| `products/ProductModal.tsx` | 🔴 rama serializada: "Precio sugerido" (en vez de precio de variante) + bloque **"Primera unidad"** (serial, costo, `variant_label` opcional). Es la **puerta 1** en Productos. |
| `pos/QuickAddUnitModal.tsx` | 🟡 ya es casi el objetivo (ingreso rápido). Agrega `variant_label`; el precio se **siembra** del sugerido y es editable; permite crear el producto inline. Es la **puerta 1 en el POS**. |
| `inventory/AddUnitModal.tsx` | 🟡 se re-encuadra como **"agregar OTRA unidad a este equipo"**: siempre entra pre-atado a una plantilla existente (sin buscador de producto). Agrega `variant_label` y `price`. |
| `inventory/SerialCapturePanel.tsx` + `suppliers/InvoiceDetailModal.tsx` | 🟡 recepción por compra: `variant_label` opcional por serial, costo desde la línea. |
| `pos/UnitPickerModal.tsx` | 🟡 muestra `variant_label` y precio de la unidad en vez de `size/color`. |
| `products/VariantsPanel.tsx` (`ExpandedUnitsRow`) | 🟡 para serializados, la variante ancla se presenta como la plantilla + lista de unidades; se oculta la edición de precio/stock de la variante. |
| `inventory/UnitList.tsx`, `inventory/UnitDetailModal.tsx` | 🟡 columna/campo `variant_label`, `price`, `cost`. |
| `sales/SaleReceipt.tsx`, `LayawayReceipt`, `CashShiftReceipt` | 🟡 línea serializada muestra `serial` + `variant_label` en vez de `size/color`. |
| `pages/POSPage.tsx` (`addUnitToCart`, `handleScan`) | 🟡 arma la línea con `unit.price` y `variant_label`. |

### 1.6 Tests

- 🟡 `cartStore.test.ts`: la línea de unidad ya soporta `unit_price` editable; agregar caso de semilla desde sugerido.
- ➕ `scripts/test-create-equipment-with-unit.sql`: atomicidad producto+unidad, permiso, tienda.
- ➕ Invariante de reportes: agregar una unidad y venderla no altera el cálculo de inventario derivado (sigue por `stock_qty`).
- 🟡 `test-serialized-units.sql`, `test-receive-serialized.sql`: `variant_label`/`price` por unidad.

---

## 2. La "variante única invisible": qué le pasa

**Se queda como esqueleto técnico (ancla), explícito y documentado.** No
desaparece y no se reemplaza. Razón: `order_items`, `stock_movements`,
`layaway_items`, devoluciones y todos los reportes están anclados a `variant_id`
(NOT NULL) y ese anclaje se **comparte con los accesorios**. Romperlo para
serializados obligaría a `variant_id` nullable en toda esa cadena.

Lo que **cambia** es su *contenido semántico* para serializados:
- `size/color` siguen en `NULL` (ya era invisible en la UI).
- `price`/`cost_price` **dejan de ser la fuente**: el precio autoritativo es
  `unit.price ?? product.suggested_price`; el costo es `unit.cost`.
- Se documenta en el código su rol de **ancla 1:1 con el producto** (una plantilla
  serializada = producto + exactamente una variante ancla sin atributos visibles;
  la unidad carga todo).

Resultado: el modelo objetivo se logra **sin** fork estructural. La plantilla la
percibe el usuario como "producto + unidades"; la variante ancla vive por debajo
como detalle de implementación.

---

## 3. Decisión clave: `units.variant_id` vs `units.product_id`

### Opción A — se conserva `variant_id` (variante = ancla técnica) · **RECOMENDADA**

- **`create_order`:** 🟢 intacto. La línea serializada sigue siendo
  `order_item(variant_id → ancla, product_id)` + `claim_unit`. El precio ya viaja
  editable en el carrito.
- **Stock derivado:** 🟢 `variants.stock_qty = COUNT(units disp.)` sin cambios;
  inventario y POS heredan el descuento por reservas sin tocar nada.
- **Reportes:** 🟢 agrupan por variante como hoy; la ancla es 1:1 con el producto.
- **Devoluciones/separados/movimientos:** 🟢 sin cambios (todos por `variant_id`).
- **Costo:** el modelo objetivo se cumple igual — precio → producto/unidad, costo
  → unidad — porque eso son columnas, no depende del anclaje.
- **Contra:** persiste una fila "vacía" por producto (la ancla). Es deuda
  cosmética, no funcional, y queda documentada.

### Opción B — `units.product_id` directo (se elimina la variante para serializados)

- **`create_order`:** 🔴 necesita una rama nueva: líneas serializadas sin
  `variant_id`. Como `order_items.variant_id` es NOT NULL y es el eje de stock,
  devoluciones y reportes, habría que volverlo nullable **en toda la cadena**.
- **Stock derivado:** 🔴 `variants.stock_qty` deja de aplicar a serializados →
  segundo camino `COUNT(units WHERE product_id)` en cada pantalla de inventario y
  reporte. Dos modelos de stock conviviendo.
- **`stock_movements.variant_id`:** 🔴 NOT NULL hoy → nullable + rama por unidad.
- **Reportes/devoluciones/separados:** 🔴 cada consumidor que asume `variant_id`
  debe manejar NULL.
- **A favor:** modelo conceptualmente "más limpio" (sin fila fantasma).
- **Contra:** **bifurca permanentemente** el mundo serializado del de accesorios.
  El costo real no es la migración (no hay datos) sino el **fork estructural que
  queda para siempre** y que choca con el requisito 4.

**Recomendación:** **Opción A.** El "sin datos que migrar" tienta a la B, pero lo
caro de la B no es migrar: es la divergencia estructural indefinida de
`order_items`/`stock_movements`/reportes/devoluciones/separados —todos NOT NULL en
`variant_id` y compartidos con accesorios—. La A entrega el modelo objetivo
(precio→plantilla, costo+etiqueta→unidad) manteniendo **un** modelo de stock,
**una** forma de `order_items` y **un** camino de reportes.

---

## 4. Los productos NO serializados (accesorios) quedan intactos

Confirmado. Mecanismo de aislamiento:

1. **Discriminante único:** `products.is_serialized`. Un accesorio tiene `false`.
2. **Todas las guardas** de los triggers heredados hacen `early-return` solo
   cuando `is_serialized_variant(...)` es `true`. Para un accesorio **no se
   dispara ninguna rama nueva**: `deduct_stock_on_sale`, `increase_stock_on_purchase`,
   `reserve/release/fulfill_layaway`, `restore_stock_on_return` corren idénticos a
   hoy sobre `variants.stock_qty/price/cost_price`.
3. **Columnas nuevas son aditivas y nullable:** un accesorio deja
   `products.suggested_price = NULL` y **nunca** crea filas en `units` → jamás toca
   `units.price/variant_label`. Su precio sigue en `variants.price`.
4. **`create_order`** no cambia → la ruta de venta de accesorios es byte-idéntica.
5. **UI:** las ramas nuevas de `ProductModal`/`VariantsPanel`/POS están detrás de
   `is_serialized`. El flujo talla/color/capacidad real de accesorios no se toca.

Invariante a testear: una venta/compra/devolución de accesorio produce
exactamente los mismos `stock_movements` y `stock_qty` antes y después del cambio.

---

## 5. Las tres puertas de ingreso (fin de la confusión)

Hoy conviven `createSimple` (producto+variante, 0 unidades), `receiveSerials`
(RPC por factura) y `addManualUnit` (unidad suelta desde inventario **y** desde
POS). El problema del cliente: demasiadas puertas que hacen cosas parecidas. Se
reencuadran en **tres roles que no se solapan**:

| Puerta | Cuándo | Dónde | Qué hace |
|---|---|---|---|
| **1. Crear equipo + primera unidad** | "modelo que nunca había vendido; tengo la unidad física en mano" | Productos (botón) **y** POS (escaneo de IMEI que no existe) | RPC `create_equipment_with_unit`: plantilla (marca/modelo/categoría/sugerido) + primera unidad (serial, costo, etiqueta) en un gesto. |
| **2. Recibir por compra** | "restock formal con factura de proveedor" | Facturas de compra | `receive_serialized_units` por línea: costo desde la factura, liga la unidad a la factura (cuentas por pagar / rastro). |
| **3. Ingreso manual** | "me llegó otra igual, sin factura, de un equipo que YA existe" | Inventario, **desde la ficha del equipo** | `addManualUnit`, **pre-atado a la plantilla** (sin buscador de producto): solo serial, costo, etiqueta, precio. |

Reglas para que no se pisen:
- La puerta 1 es la **única** que crea plantillas nuevas. Las puertas 2 y 3
  **siempre** agregan unidades a una plantilla existente.
- La puerta 3 deja de ser una "puerta ciega" que arranca en blanco: siempre se
  entra desde un equipo concreto, así que nunca compite con la puerta 1.
- Regla mental para el usuario: **¿tienes factura? → puerta 2. ¿El modelo ya
  existe? → puerta 3. ¿Modelo nuevo? → puerta 1.**

---

## 6. Plan por fases (con gates y validación en lab)

Cada fase es **desplegable y validable sola**. El núcleo riesgoso (`create_order`)
no se mueve en ninguna, gracias a la Opción A.

### Fase A — Esquema aditivo (sin cambio de comportamiento)
- Migración: `products.suggested_price`, `units.price`, `units.variant_label`.
- Backfill: `suggested_price = variants.price` para serializados existentes.
- Tipos TS.
- **Gate:** `tsc + eslint + tests + build` verdes. Lab: accesorios y serializados
  actuales se comportan idénticos (nada lee aún las columnas nuevas).

### Fase B — Camino de lectura (fuente de precio/etiqueta pasa a la unidad)
- `lookupUnitBySerial`, `useUnitsForVariants`, fichas, `UnitPickerModal`,
  recibos y POS leen `unit.price ?? suggested_price` y `variant_label`.
- **Gate:** lab — vender una unidad muestra **su** precio y **su** etiqueta;
  accesorios sin cambio. Se voltean **todos** los lectores juntos (evita el estado
  a-medias del riesgo R4).

### Fase C — Camino de escritura (crear equipo + primera unidad en un gesto)
- RPC `create_equipment_with_unit` + `createEquipmentWithUnit`.
- `ProductModal` rama serializada (sugerido + primera unidad) = puerta 1 Productos.
- `QuickAddUnitModal` extendido = puerta 1 POS.
- `AddUnitModal` re-encuadrado a puerta 3 (pre-atado).
- **Gate:** lab — crear plantilla+unidad desde Productos y desde escaneo en POS;
  agregar 2ª unidad por puerta 3; recibir por factura por puerta 2.

### Fase D — Limpieza y cierre
- Dejar de escribir `variants.price/cost_price` para serializados; `suggested_price`
  como única superficie de precio de plantilla.
- Docs (CLAUDE.md, este archivo → "aplicado"), `PROD-*.md`.
- **Gate:** regresión completa (venta directa/mixta, separado, devolución, compra,
  cuadre) con serializados y accesorios.

---

## 7. Riesgos y cómo se evita el "a medias"

| # | Riesgo (dónde queda a medias) | Mitigación |
|---|---|---|
| R1 | Unidad sin `price` **y** producto sin `suggested_price` → venta cae a $0. | Puerta 1/3 **exigen** precio sugerido al crear la plantilla y siembran `unit.price`. Regla `price = unit.price ?? suggested_price`; guard en UI + validación en la RPC de venta ya existente (total > 0). |
| R2 | Tres fuentes de precio (`variant.price`, `suggested_price`, `unit.price`) divergen. | **Invariante único** para serializados: fuente = `unit.price ?? suggested_price`; se **deja de escribir** `variant.price`. Documentado + test. |
| R3 | Productos serializados creados **antes** (precio en variante) mezclados con nuevos. | Backfill en Fase A copia `variant.price → suggested_price`: ninguno queda sin precio. |
| R4 | Rollout parcial: recibos/pickers leen `variant.price` mientras la venta usa `unit.price` → display inconsistente. | Fase B voltea **todos** los lectores en un mismo despliegue; no se libera a mitad. |
| R5 | Crear equipo+unidad no atómico (cliente): producto creado, unidad falla → plantilla huérfana. | RPC `create_equipment_with_unit` en **una** transacción (todo o nada), no dos `INSERT` de cliente. |
| R6 | Accesorios afectados por descuido. | Columnas aditivas/nullable + ramas detrás de `is_serialized` + invariante de `stock_movements` idénticos (test de no-regresión). |
| R7 | Tentación de Opción B "porque no hay datos". | Registrado en §3: el costo de B es el fork estructural permanente, no la migración. Se elige A conscientemente. |

**Puntos donde el sistema NO puede quedar a medias por diseño:** el eje de stock
(`variants.stock_qty` derivado), `order_items` y `create_order` **no se tocan** en
todo el plan → la ruta crítica de venta nunca vive entre dos modelos.

---

## 8. Preguntas abiertas para ti antes de implementar

1. **Etiqueta de variante:** ¿texto 100% libre, o quieres además **sugerencias**
   (capacidades/colores frecuentes por config) para acelerar captura? Propuesta:
   libre + datalist de sugerencias (no obligatorio).
2. **`suggested_price` obligatorio** al crear plantilla serializada, o permitir
   plantilla sin precio y exigirlo recién al ingresar la primera unidad. Propuesta:
   obligatorio en la puerta 1 (evita R1).
3. **RPC nueva `create_equipment_with_unit`** vs. reusar `createSimple + addManualUnit`
   con rollback de cliente. Propuesta: RPC (atómica, evita R5).
4. **`units.price` en recepción por compra:** ¿sembrar del sugerido, o dejar NULL
   y resolver al vender? Propuesta: sembrar del sugerido (editable al vender).
