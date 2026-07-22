# INVENTORY-SPEC — Sistema de inventario de G-Mura

> Documento de referencia para **portar el inventario a otro proyecto** (un POS
> de coctelería sin variantes). Describe cómo está implementado el inventario en
> G-Mura (POS de ropa, React + Supabase/PostgreSQL) y qué adaptar.
>
> **Aviso de alcance crítico:** este documento OMITE deliberadamente la
> dimensión de variantes (talla/color) porque el proyecto destino no las usa.
> En G-Mura **el stock NO vive en `products`, vive en `variants`**. Para el
> proyecto destino, mentalmente colapsá `variant == product`: la tabla con
> stock es la unidad vendible. Cada vez que abajo digo "variante", traducí a
> "producto/SKU" en tu proyecto.
>
> **Segundo aviso, igual de importante:** la **composición de productos**
> (un producto que contiene/consume otros productos — bundles, recetas,
> insumos) **NO existe hoy en G-Mura**. El stock se descuenta 1 unidad vendida
> = 1 unidad de inventario, sin explosión de componentes. Como esa es la pieza
> más importante para tu POS de coctelería (un cóctel consume insumos), la
> **sección 1.5 propone un diseño nuevo** coherente con el resto del sistema.
> No la copies de G-Mura porque no está allí.

---

## 0. Resumen ejecutivo

| Concepto | Cómo está resuelto en G-Mura |
|---|---|
| Dónde vive el stock | Columna `variants.stock_qty` (entero, una sola fuente de verdad) |
| Cómo se descuenta al vender | Trigger `AFTER INSERT` en `order_items` → `deduct_stock_on_sale()` |
| Cómo entra stock | Compras (trigger en `purchase_invoice_items`), devoluciones (trigger en `return_items`), ajustes manuales (hook cliente) |
| Auditoría | Tabla append-only `stock_movements` (un renglón por movimiento, con signo) |
| Reservas | Columna `variants.reserved_qty` (separados/layaway); `disponible = stock_qty - reserved_qty` |
| Composición / recetas | **No existe.** Ver §1.5 para el diseño recomendado |
| Valor de inventario | Calculado en cliente: `Σ stock_qty * cost_price` |
| Alertas | Calculadas en cliente sobre `disponible`: `out` (=0), `low` (≤ `min_stock`), `ok` |
| Multi-tienda | Todo lleva `store_id`; RLS aísla por tienda vía `get_my_store_id()` |

Patrón central: **el stock se modifica SIEMPRE por trigger en la BD, no desde
el cliente** (excepto el ajuste manual). Insertás un `order_item` y el stock
baja solo. Esto garantiza atomicidad y que la auditoría nunca se desincronice.

---

## 1. Modelo de datos

Migración base: [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql).
Compras: [`011_suppliers.sql`](supabase/migrations/011_suppliers.sql).
Reservas: [`008_layaways.sql`](supabase/migrations/008_layaways.sql).

### 1.1 Tabla de stock — `variants` (≈ tu `products`)

Es la unidad con stock. En tu proyecto sería directamente el producto vendible.

```sql
CREATE TABLE public.variants (
  id           uuid           PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id   uuid           NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- omitible si colapsás
  store_id     uuid           NOT NULL REFERENCES stores(id)   ON DELETE CASCADE,
  size         text,          -- OMITIR en tu proyecto
  color        text,          -- OMITIR en tu proyecto
  sku          text,
  barcode      text,
  price        numeric(12,2)  NOT NULL DEFAULT 0,   -- precio de venta
  cost_price   numeric(12,2),                       -- costo (para valorizar inventario)
  stock_qty    integer        NOT NULL DEFAULT 0,   -- ← STOCK REAL. Lo mueven los triggers
  reserved_qty integer        NOT NULL DEFAULT 0,   -- stock comprometido (separados); §1.4
  min_stock    integer        NOT NULL DEFAULT 0,   -- umbral de alerta de stock bajo
  created_at   timestamptz    NOT NULL DEFAULT now(),
  updated_at   timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT variants_price_non_negative      CHECK (price >= 0),
  CONSTRAINT variants_cost_non_negative       CHECK (cost_price IS NULL OR cost_price >= 0),
  CONSTRAINT variants_stock_non_negative      CHECK (stock_qty >= 0),
  CONSTRAINT variants_min_stock_non_negative  CHECK (min_stock >= 0),
  CONSTRAINT variants_barcode_unique          UNIQUE (barcode),
  CONSTRAINT variants_sku_unique_per_store    UNIQUE (store_id, sku)
  -- (en G-Mura también UNIQUE (product_id, size, color) — no aplica sin variantes)
);
```

Notas de diseño relevantes para portar:
- **`stock_qty` es la única fuente de verdad del stock.** No se recalcula desde
  `stock_movements`; los movimientos son auditoría paralela. Se mantienen en
  sincronía porque el MISMO trigger que toca `stock_qty` inserta el movimiento.
- **`stock_qty` NO se edita a mano.** (fix/inventory-lock-manual-stock) Sigue
  siendo la fuente de verdad, pero solo lo mueven operaciones que dejan rastro en
  `stock_movements`:
  - **apertura** (`opening`, 051/052): el stock inicial capturado AL CREAR la
    variante; el trigger `log_opening_stock_movement` lo registra.
  - **compra** (`purchase`): entrada por factura de proveedor.
  - **ajuste manual** (`adjustment`): corrección posterior (conteo, merma) desde
    Inventario → Ajuste manual; actualiza `stock_qty` y registra el movimiento.
  - **venta / devolución** (`sale`/`return`): operación del POS.
  - **consumo de taller** (`repair_consumption`): pieza usada en una reparación.
  El formulario de edición de producto/variante muestra el stock en SOLO LECTURA;
  la matriz de inventario de la ficha de producto también es solo lectura. No hay
  ninguna ruta de cliente que escriba `stock_qty` fuera de esas operaciones.
- **Serializados:** su `stock_qty` es DERIVADO de `units` por el trigger de
  sincronización (039); nunca se edita ni se abre a mano (la variante ancla nace
  en 0 y las unidades llevan el conteo).
- `CHECK (stock_qty >= 0)` previene stock negativo a nivel BD (red de seguridad
  contra sobreventa por carrera; ver §2.4).
- `cost_price` es **nullable** (no siempre se conoce el costo). El cálculo de
  valor de inventario lo trata como 0 si es NULL.
- `barcode` es UNIQUE global (no por tienda). En coctelería el código de barras
  suele ser de la botella/insumo; mantenelo si escaneás.

### 1.2 Auditoría — `stock_movements` (la pieza más reutilizable)

```sql
-- Valores agregados después: 'repair_consumption' (043), 'opening' (051).
CREATE TYPE movement_type AS ENUM ('sale', 'return', 'adjustment', 'purchase',
                                   'repair_consumption', 'opening');

CREATE TABLE public.stock_movements (
  id           uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  variant_id   uuid          NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  store_id     uuid          NOT NULL REFERENCES stores(id)   ON DELETE RESTRICT,
  type         movement_type NOT NULL,
  qty          integer       NOT NULL,   -- CON SIGNO: negativo = salida, positivo = entrada
  reference_id uuid,                      -- FK "suelta" al documento origen (orden, devolución, factura)
  notes        text,                      -- usado sobre todo por ajustes manuales
  created_by   uuid          NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at   timestamptz   NOT NULL DEFAULT now()
);
```

Características clave:
- **Append-only / inmutable.** No hay UPDATE ni DELETE de movimientos. Toda
  corrección es un movimiento nuevo (un ajuste compensatorio).
- **`qty` lleva signo.** Venta = `-qty`, devolución/compra = `+qty`. Sumar la
  columna reconstruye el stock teórico de una variante en cualquier momento.
- **`reference_id` es un FK lógico, no declarado** (apunta a `order_id`,
  `return_id` o `invoice_id` según `type`). Es deliberado: una sola columna sirve
  para todos los orígenes. El costo es que no hay integridad referencial sobre
  ella (ver §5, deuda técnica).
- Los 4 tipos: `sale` (venta), `return` (devolución), `purchase` (compra),
  `adjustment` (ajuste manual). Para coctelería agregá `consumption` o
  `production` si separás merma/preparación (ver §1.5).

### 1.3 Tablas que disparan movimientos de stock

**Salida por venta** — `order_items`:
```sql
CREATE TABLE public.order_items (
  id          uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    uuid          NOT NULL REFERENCES orders(id)   ON DELETE CASCADE,
  variant_id  uuid          NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  product_id  uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,  -- desnormalizado p/ historial
  qty         integer       NOT NULL CHECK (qty > 0),
  unit_price  numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  created_at  timestamptz   NOT NULL DEFAULT now()
);
```
> En migraciones posteriores se agregó `list_price` (precio de catálogo) además
> de `unit_price` (precio final vendido) para soportar descuento por ítem.

**Entrada por compra** — `purchase_invoice_items` (de `011_suppliers.sql`):
```sql
CREATE TABLE public.purchase_invoice_items (
  id          uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id  uuid          NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  variant_id  uuid          NOT NULL REFERENCES variants(id)          ON DELETE RESTRICT,
  product_id  uuid          NOT NULL REFERENCES products(id)          ON DELETE RESTRICT,
  qty         integer       NOT NULL CHECK (qty > 0),
  unit_cost   numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  subtotal    numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  update_cost boolean       NOT NULL DEFAULT false  -- si true, el trigger pisa variants.cost_price
);
```

**Entrada por devolución** — `return_items`:
```sql
CREATE TABLE public.return_items (
  id         uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_id  uuid          NOT NULL REFERENCES returns(id)  ON DELETE CASCADE,
  variant_id uuid          NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  qty        integer       NOT NULL CHECK (qty > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  action     return_action NOT NULL  -- 'refund' | 'exchange'; en ambos el ítem vuelve al stock
);
```

Patrón común: **cada tabla "ítem" inserta y un trigger mueve el stock.** Nunca
se hace `UPDATE variants SET stock_qty = ...` desde la app (salvo ajuste manual).

### 1.4 Reservas — `reserved_qty` (separados / layaway)

Agregado en `008_layaways.sql`. Modela stock **comprometido pero aún no
vendido** (un cliente apartó mercancía y abona en cuotas):

- `variants.reserved_qty` (integer, default 0, CHECK ≥ 0).
- **Disponible real = `stock_qty - reserved_qty`** (clamp a 0). Se calcula en
  cliente, no es columna.
- Al crear el separado, el trigger `reserve_stock_on_layaway()` valida
  `(stock_qty - reserved_qty) >= qty` e **incrementa `reserved_qty`** (no toca
  `stock_qty`).
- Al cancelar/editar → `release_stock_on_layaway_change()` baja `reserved_qty`.
- Al completar la venta → `fulfill_stock_on_layaway_completion()` baja
  `reserved_qty`; el descuento real de `stock_qty` lo hace `deduct_stock_on_sale`
  cuando la UI crea la orden normal. **Importante:** completar NO descuenta
  stock directamente, solo libera la reserva, para no duplicar la baja.

> Para coctelería probablemente NO necesités reservas (no hay layaway). Podés
> omitir `reserved_qty` y toda la maquinaria de separados. Lo documento para que
> entiendas que la fórmula `disponible = stock - reservado` no es trivial.

### 1.5 Composición de productos (NO EXISTE — diseño propuesto)

> **G-Mura no tiene esto.** Lo siguiente es un diseño nuevo, alineado con sus
> patrones, para que un cóctel descuente sus insumos. Es la pieza que vas a
> construir desde cero.

Modelo recomendado: **lista de materiales (BOM) de un nivel** con una tabla de
unión auto-referenciada sobre la tabla de stock.

```sql
-- Tipo de unidad vendible: simple (se vende tal cual) vs compuesto (receta)
ALTER TABLE products ADD COLUMN kind text NOT NULL DEFAULT 'simple'
  CHECK (kind IN ('simple', 'composite'));
-- 'simple'    → tiene su propio stock_qty (botella, snack, gaseosa suelta)
-- 'composite' → NO maneja stock propio; su disponibilidad se deriva de insumos
--               (un cóctel, un combo). Su stock_qty se ignora.

-- Receta / lista de insumos. Un renglón = "el producto X consume N de Y".
CREATE TABLE public.product_components (
  id              uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id        uuid          NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  parent_id       uuid          NOT NULL REFERENCES products(id) ON DELETE CASCADE,   -- el cóctel/combo
  component_id    uuid          NOT NULL REFERENCES products(id) ON DELETE RESTRICT,  -- el insumo
  qty             numeric(12,3) NOT NULL CHECK (qty > 0),   -- cantidad consumida por 1 unidad del padre
  unit            text,                                     -- 'ml','oz','u' (informativo; ver nota abajo)
  created_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pc_no_self        CHECK (parent_id <> component_id),
  CONSTRAINT pc_unique_pair    UNIQUE (parent_id, component_id)
);
CREATE INDEX idx_pc_parent ON product_components(parent_id);
```

Decisiones recomendadas (y por qué):

1. **`qty` es `numeric`, no `integer`.** Un cóctel lleva 45 ml de ron. El stock
   del insumo debe poder llevarse en la misma unidad base (p. ej. mililitros): si
   comprás una botella de 750 ml, ingresás `stock_qty = 750` para ese insumo y
   defenís el cóctel con `qty = 45`. Mantené UNA unidad base por insumo y hacé
   las conversiones (botella→ml) al momento de comprar, no en la receta.
   → Esto obliga a que el `stock_qty` de los insumos también sea `numeric`, no
   `integer` como en G-Mura. Decidilo temprano: es un cambio de tipo costoso
   después.

2. **Un solo nivel de explosión (sin recursión).** Un cóctel consume insumos
   simples, no otros cócteles. Mantenelo plano: es más simple, más rápido y
   cubre el 99% de coctelería. Si algún día necesitás sub-recetas (un "mix" que
   entra en varios cócteles), explotás recursivamente — pero no lo construyas
   hasta necesitarlo.

3. **Los productos `composite` no tienen stock propio.** Su "disponibilidad" es
   derivada: `min( floor(stock_insumo_i / qty_i) )` sobre todos sus insumos. Se
   calcula on-the-fly, no se almacena. (No pongas un trigger que mantenga un
   stock_qty falso en el cóctel; lleva a inconsistencias.)

**Lógica de venta de un compuesto** (reemplaza al trigger 1:1 actual): cuando se
vende un `order_item` cuyo producto es `composite`, en lugar de descontar 1 de
ese producto, el trigger debe **explotar la receta y descontar cada insumo**:

```sql
-- Pseudocódigo del trigger AFTER INSERT en order_items (versión composición)
IF (producto es 'composite') THEN
  FOR comp IN SELECT component_id, qty FROM product_components WHERE parent_id = NEW.product_id LOOP
    -- validar disponible >= comp.qty * NEW.qty
    UPDATE variants SET stock_qty = stock_qty - (comp.qty * NEW.qty) WHERE id = comp.component_id;
    INSERT INTO stock_movements(variant_id, type, qty, reference_id, ...) 
      VALUES (comp.component_id, 'sale', -(comp.qty * NEW.qty), NEW.order_id, ...);
  END LOOP;
ELSE
  -- camino simple idéntico a G-Mura (descuenta el propio producto)
END IF;
```

Ventaja de reusar `stock_movements`: cada insumo consumido por un cóctel queda
auditado con su `reference_id = order_id`, igual que una venta directa. El
reporte de "qué consumió la noche" sale gratis.

---

## 2. Lógica de negocio

### 2.1 Descuento de stock al vender

Función [`deduct_stock_on_sale()`](supabase/migrations/001_initial_schema.sql)
(trigger `AFTER INSERT ON order_items`):

```sql
CREATE OR REPLACE FUNCTION deduct_stock_on_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store_id uuid; v_created_by uuid; v_current_stock integer;
BEGIN
  SELECT store_id, created_by INTO v_store_id, v_created_by
    FROM public.orders WHERE id = NEW.order_id;

  SELECT stock_qty INTO v_current_stock
    FROM public.variants WHERE id = NEW.variant_id;

  IF v_current_stock < NEW.qty THEN
    RAISE EXCEPTION 'Stock insuficiente para la variante %. Disponible: %, Requerido: %',
      NEW.variant_id, v_current_stock, NEW.qty;
  END IF;

  UPDATE public.variants SET stock_qty = stock_qty - NEW.qty WHERE id = NEW.variant_id;

  INSERT INTO public.stock_movements (variant_id, store_id, type, qty, reference_id, created_by)
  VALUES (NEW.variant_id, v_store_id, 'sale', -NEW.qty, NEW.order_id, v_created_by);

  RETURN NEW;
END; $$;
```

Puntos a replicar:
- **Atomicidad gratis.** El trigger corre dentro de la transacción del INSERT.
  Si lanza EXCEPTION, todo se revierte (la orden, el ítem, el movimiento). No hay
  estado a medias.
- **Valida stock antes de descontar** y lanza error legible. El cliente no
  pre-chequea para "permitir vender": confía en el trigger (aunque la UI sí
  filtra agotados por UX, ver §2.4).
- **El movimiento se inserta en el mismo trigger** → `stock_qty` y
  `stock_movements` nunca divergen.

### 2.2 Producto compuesto al vender

**No implementado en G-Mura.** Ver §1.5 para el algoritmo de explosión de
receta. Resumen: un `order_item` de un producto `composite` no descuenta ese
producto, descuenta cada insumo `qty_receta * qty_vendida`, validando
disponibilidad de cada insumo, y registra un `stock_movement` por insumo.

Casos borde que tu implementación debe cubrir y G-Mura no tiene resueltos:
- **Insumo agotado en medio de un combo:** la venta entera debe fallar
  atómicamente (RAISE EXCEPTION dentro del loop revierte todo). No vendas un
  cóctel "a medias".
- **Insumo que también se vende suelto** (ron por trago y ron en botella): es el
  mismo registro de stock; ambos caminos lo descuentan. Correcto y deseado.
- **Receta editada después de vender:** los movimientos históricos ya quedaron
  registrados con las cantidades de ese momento; no recalcules hacia atrás.

### 2.3 Ajustes manuales de inventario

Único camino donde el **cliente** toca `stock_qty` directamente, no un trigger.
Hook [`useInventoryMutations.ts`](src/hooks/useInventoryMutations.ts),
mutación `adjustStock`:

1. Lee `stock_qty` actual de la variante (filtrando por `store_id`).
2. Calcula `newQty = currentQty + qty` (qty con signo: `+10` entrada, `-5` salida).
3. Rechaza si `newQty < 0`.
4. `UPDATE variants SET stock_qty = newQty`.
5. `INSERT stock_movements (type='adjustment', qty, notes, ...)`.

La UI ([`InventoryPage.tsx`](src/pages/InventoryPage.tsx), `AdjustModal`) ofrece
4 "tipos de ajuste" que son **solo etiquetas de texto** que se anteponen a las
notas — no son tipos de movimiento en BD (el `type` siempre es `'adjustment'`):
- `Ingreso de mercancía`, `Ajuste por conteo`, `Merma`, `Otro`.
- El motivo (`notes`) es **obligatorio**.

> ⚠️ Esta mutación hace UPDATE + INSERT en **dos llamadas separadas desde el
> cliente, sin transacción**. Si la app muere entre ambas, el stock cambia sin
> auditoría. Ver §5 — recomiendo moverlo a una RPC/trigger como el resto.

### 2.4 Alertas: stock bajo / sin stock / sobreventa

Calculadas en cliente en [`useInventory.ts`](src/hooks/useInventory.ts)
(`useStockLevels`), sobre **disponible**, no sobre stock físico:

```ts
const available = Math.max(0, (v.stock_qty ?? 0) - (v.reserved_qty ?? 0))
const stock_state =
  available === 0 ? 'out'
  : available <= v.min_stock ? 'low'
  : 'ok'
```

- **`out`** (sin disponible): badge rojo, fila tintada, filtro dedicado.
- **`low`** (≤ `min_stock`): badge ámbar.
- **`ok`**: badge verde.
- `min_stock` es por variante (umbral configurable). No hay punto de reorden ni
  cálculo de cuánto pedir.

**Sobreventa:** doble barrera. (1) La UI filtra/deshabilita productos sin
disponible (UX). (2) El `CHECK (stock_qty >= 0)` + la validación dentro de
`deduct_stock_on_sale` lo impiden a nivel BD ante carreras. La segunda es la que
realmente protege; la primera es cosmética.

### 2.5 Valor del inventario (costo)

Calculado 100% en cliente, no en BD (`InventoryPage.tsx`):

```ts
const totalValue = allVariants.reduce(
  (sum, v) => sum + v.stock_qty * (v.cost_price ?? 0), 0)
```

- Usa **stock físico** (`stock_qty`), no disponible: las unidades reservadas
  siguen siendo capital inmovilizado.
- `cost_price` nullable → se trata como 0.
- Es un **costo "último conocido"**, no promedio ponderado ni FIFO/LIFO. Cuando
  una compra trae `update_cost = true`, `cost_price` se **pisa** con el último
  `unit_cost`. Simple pero impreciso si los costos fluctúan (ver §5).

---

## 3. Funciones SQL / RPCs relacionadas con inventario

Todas las funciones que tocan stock son **triggers**, no RPCs invocadas desde el
cliente (excepto las auxiliares de RLS). Todas son `SECURITY DEFINER`.

| Función | Disparador | Qué hace | SECURITY DEFINER · por qué |
|---|---|---|---|
| `deduct_stock_on_sale()` | `AFTER INSERT ON order_items` | Valida y resta `stock_qty`; inserta movimiento `sale` (qty negativo) | ✅ Un vendedor (rol `seller`) no tiene INSERT en `stock_movements` por RLS; el DEFINER le permite escribir la auditoría sin abrir la política |
| `restore_stock_on_return()` | `AFTER INSERT ON return_items` | Suma `stock_qty`; inserta movimiento `return` (qty positivo). Aplica a refund y exchange | ✅ Igual: escribir `stock_movements` desde contexto de vendedor |
| `increase_stock_on_purchase()` | `AFTER INSERT ON purchase_invoice_items` | Suma `stock_qty`; si `update_cost` pisa `cost_price`; inserta movimiento `purchase` | ✅ Igual |
| `reserve_stock_on_layaway()` | `AFTER INSERT ON layaway_items` | Valida disponible y sube `reserved_qty` | ✅ Escribe sobre `variants` validando reglas de negocio |
| `release_stock_on_layaway_change()` | cambio de estado del separado | Baja `reserved_qty` al cancelar | ✅ |
| `fulfill_stock_on_layaway_completion()` | completar separado | Baja `reserved_qty` (el stock real lo baja la venta) | ✅ |
| `get_my_store_id()` | (llamada en políticas RLS) | Devuelve `store_id`/tienda activa del usuario autenticado | ✅ Lee `profiles` sin recursión de RLS |
| `get_my_role()` | (RLS) | Devuelve el rol del usuario | ✅ Igual |
| `set_updated_at()` | `BEFORE UPDATE` (varias tablas) | Setea `updated_at = now()` | ❌ No lo necesita (no lee tablas protegidas) |

**Por qué `SECURITY DEFINER` en los triggers de stock:** corren bajo el contexto
de un `seller`, que por RLS **no puede** insertar en `stock_movements` (solo
admins pueden, política `stock_movements_insert_admin`). El DEFINER ejecuta la
función con los privilegios del dueño de la función (no del invocante), saltando
RLS para escribir la auditoría. Todas fijan `SET search_path = public` para
evitar secuestro de search_path (buena práctica de seguridad obligatoria en
funciones DEFINER).

> Para tu proyecto: si vas a usar RLS multi-tienda, replicá exactamente este
> patrón (trigger DEFINER + `SET search_path`). Si NO usás RLS, los triggers
> pueden ser `SECURITY INVOKER` y es más simple.

**Nota:** no hay función `expire`/cron relevante a inventario puro
(`expire_overdue_layaways()` existe pero es de separados, libera reservas).

---

## 4. UI / páginas y hooks

### 4.1 Página de inventario — [`InventoryPage.tsx`](src/pages/InventoryPage.tsx)

Una sola página con dos pestañas:

**Pestaña "Inventario" (niveles de stock):**
- 5 tarjetas resumen: Total variantes · Sin disponible · Stock bajo · Con
  reservas · Valor inventario (`fmtCOP`).
- Tabla con: Producto, Marca, Variante, SKU, Código de barras, **Total**
  (físico), **Reservado**, **Disponible**, Mín., Estado (badge).
- Filtros: búsqueda (nombre/SKU/barcode, con debounce), categoría, marca, estado
  (`all/out/low/ok/reserved`).
- Export a Excel con `exceljs` (carga dinámica `import('exceljs')`), filas
  tintadas por estado.
- Botón "Ajuste manual" → abre `AdjustModal`.

**`AdjustModal`** (en el mismo archivo): busca variante (nombre/SKU/barcode),
muestra stock actual, pide tipo de ajuste (4 etiquetas), cantidad con signo
(muestra "stock resultante" en vivo, rojo si quedaría negativo) y motivo
obligatorio.

**Pestaña "Movimientos" (auditoría):**
- Tabla paginada (50/pág) desde `stock_movements`: Fecha/hora, Tipo (badge por
  tipo), Producto, Variante, Cantidad (verde + / rojo −), Usuario, Referencia
  (muestra `reference_id` truncado o `notes`).
- Filtros: tipo de movimiento, rango de fechas (convertido a UTC desde zona
  Bogotá vía `bogotaDayStartToUtc`/`bogotaDayEndToUtc`).

Permisos: el ajuste manual es admin (RLS `stock_movements_insert_admin`); ver
movimientos lo puede cualquier usuario de la tienda.

### 4.2 Productos / variantes — `ProductsPage.tsx` + `VariantsPanel.tsx`

CRUD de catálogo. El alta de variante define `price`, `cost_price`, `min_stock`,
SKU, barcode. **El stock inicial NO se setea aquí** (arranca en 0); entra por
compra o ajuste. → En tu proyecto, acá iría también la edición de la receta
(`product_components`) para productos `composite`.

### 4.3 Compras — `SuppliersPage.tsx` + `NewInvoiceModal.tsx`

Crear factura de compra = forma normal de **ingresar stock**. Cada ítem dispara
`increase_stock_on_purchase`. Opción `update_cost` por ítem actualiza el costo.

### 4.4 Hooks principales

| Hook | Archivo | Responsabilidad |
|---|---|---|
| `useStockLevels()` | [`useInventory.ts`](src/hooks/useInventory.ts) | Lee variantes activas + producto/categoría; calcula `available` y `stock_state` en cliente. `staleTime` 30 s |
| `useStockMovements(filters, page)` | `useInventory.ts` | Auditoría paginada con filtros (tipo, fechas) |
| `useInventoryMutations()` | [`useInventoryMutations.ts`](src/hooks/useInventoryMutations.ts) | `adjustStock` (UPDATE + INSERT manual) |
| `useCreateOrder()` | [`useCreateOrder.ts`](src/hooks/useCreateOrder.ts) | Inserta orden + ítems (el stock baja por trigger); valida precios; rollback de la orden si fallan los ítems; invalida queries de inventario |
| `useInvoiceMutations()` | `useInvoiceMutations.ts` | Crear factura de compra (entrada de stock) |
| `useReturnMutations()` | `useReturnMutations.ts` | Devoluciones (reingreso de stock) |

Patrón de invalidación (importante para que la UI refleje el stock): tras crear
una orden, `useCreateOrder` invalida `['variants']`, `['products']`,
`['pos-products']`, `['stock-movements']`, etc. **Replicá esto:** cualquier
mutación que mueva stock debe invalidar las queries de inventario y de catálogo
del POS, o la UI mostrará stock viejo.

---

## 5. Qué replicar vs. qué cambiar

### ✅ Replicar (funcionó bien)

1. **Stock movido por trigger en la BD, no desde el cliente.** Atomicidad,
   imposible desincronizar `stock_qty` de la auditoría, y la lógica vive en un
   solo lugar sin importar qué cliente inserte la venta. Es el acierto central.
2. **`stock_movements` append-only con `qty` con signo y `reference_id` suelto.**
   Auditoría completa, reconstruible, y un solo esquema sirve para venta,
   compra, devolución y ajuste. Reusala tal cual; agregá tipos
   (`consumption`/`production`) si los necesitás.
3. **`stock_qty` como única fuente de verdad** (no recalcular desde movimientos
   en cada lectura). Rápido y simple. La auditoría es paralela, no autoritativa.
4. **`CHECK (stock_qty >= 0)` + validación en el trigger** como doble barrera
   anti-sobreventa. No confíes solo en el filtro de UI.
5. **Triggers `SECURITY DEFINER` con `SET search_path`** para escribir auditoría
   desde roles sin permiso directo. Patrón correcto con RLS.
6. **Separar "físico" de "disponible"** (`stock_qty` vs `stock - reserved`). Aun
   sin layaway, el concepto sirve si algún día reservás barra para eventos.

### ⚠️ Cambiar / evitar si empezás de nuevo

1. **Construí la composición desde el día 1** (§1.5). Es el corazón de un POS de
   coctelería y G-Mura no la tiene. No la atornilles después: el tipo de
   `qty`/`stock_qty` (numeric vs integer) depende de esta decisión.
2. **`stock_qty` debería ser `numeric`, no `integer`.** Coctelería consume
   fracciones (45 ml, 1.5 oz). G-Mura usa `integer` porque vende prendas
   enteras. Cambiar el tipo después es caro.
3. **El ajuste manual debería ser una RPC/trigger transaccional**, no UPDATE +
   INSERT en dos llamadas del cliente (§2.3). Hoy hay una ventana donde el stock
   cambia sin auditoría si la app muere entre ambas. Encapsulalo en una función
   `adjust_stock(variant_id, qty, reason)` `SECURITY DEFINER` que haga ambas
   cosas atómicamente.
4. **`reference_id` sin FK declarado** sacrifica integridad referencial por
   flexibilidad. Aceptable, pero si querés joins seguros considerá columnas
   tipadas opcionales (`order_id`, `return_id`, `invoice_id`) o una tabla
   polimórfica con CHECK. Como mínimo, indexala.
5. **Costeo "último conocido" (se pisa `cost_price`).** Para inventario valorado
   con seriedad, llevá **costo promedio ponderado**: al comprar,
   `nuevo_costo = (stock*costo_actual + qty*unit_cost) / (stock+qty)`. Es poco
   código extra en el trigger de compra y da un valor de inventario real.
6. **Alertas y valorización calculadas en cliente.** Bien para volúmenes
   chicos; con catálogo grande, movelas a vistas SQL (G-Mura ya usa vistas para
   reportes en `003_reports_views.sql` / `012_purchase_views.sql` — seguí ese
   patrón para "inventario bajo" y "valor de inventario").
7. **Sin punto de reorder / sugerencia de compra.** Solo hay `min_stock` para
   alertar. Si querés reposición asistida, agregá `reorder_qty` y una vista que
   liste qué pedir.
8. **El stock inicial entra en 0** y solo sube por compra/ajuste. Si querés
   sembrar inventario al crear el producto, agregá un movimiento de tipo
   `adjustment`/`opening` en el alta — no escribas `stock_qty` a mano sin
   movimiento.

---

## 6. Checklist mínimo para portar a coctelería

1. Tabla de stock (`products` con `stock_qty numeric`, `cost_price`, `min_stock`,
   `kind`, `barcode`, `store_id`). Colapsá variantes.
2. `stock_movements` tal cual (agregá tipos `consumption`/`production` si querés).
3. `product_components` (§1.5) + `products.kind`.
4. Trigger de venta que **explota la receta** si `kind = 'composite'`, descuenta
   1:1 si `simple` (§2.2). `SECURITY DEFINER` + `SET search_path`.
5. Trigger de compra (entrada de stock) — copialo de `increase_stock_on_purchase`,
   con costeo promedio si lo querés bien.
6. Función `adjust_stock(...)` transaccional para ajustes/merma.
7. RLS por `store_id` si es multi-tienda; si no, omitila y usá triggers INVOKER.
8. UI: página de inventario (niveles + movimientos), editor de recetas en el
   alta de producto, modal de ajuste. Invalidá las queries de stock tras cada
   mutación.
9. `CHECK (stock_qty >= 0)` solo en insumos `simple`; los `composite` no llevan
   stock.
