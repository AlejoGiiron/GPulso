# G-Pulso Design System

Extraído de los archivos `_design/` (pos-v2, products-v2, login, gm-sidebar, pos-shared, prod-shared, tweaks-panel).
Fuente de verdad visual para todos los módulos del proyecto.

---

## Índice

1. [Paleta de colores](#1-paleta-de-colores)
2. [Tipografía](#2-tipografía)
3. [Layout y estructura](#3-layout-y-estructura)
4. [Componentes documentados](#4-componentes-documentados)
5. [Patrones de UX](#5-patrones-de-ux)
6. [Iconografía](#6-iconografía)
7. [Patrones específicos de G-Pulso](#7-patrones-específicos-de-g-pulso)

---

## 1. Paleta de colores

### 1.1 Fondos y superficies

| Token             | HEX       | Uso                                                           |
|-------------------|-----------|---------------------------------------------------------------|
| `bg-app`          | `#f8f7f5` | Fondo principal de la aplicación (cuerpo de página)           |
| `bg-surface`      | `#fdfcfb` | Headers, sidebars de contenido, panel de login derecho        |
| `bg-card`         | `#ffffff` | Cards, modales, paneles interiores                            |
| `bg-table-header` | `#fafaf9` | Fila de encabezado en tablas, fondo de totales del carrito    |
| `bg-muted`        | `#f5f4f1` | Badges de categoría, chips de talla, hover de celdas editables|
| `bg-input`        | `#ffffff` | Inputs estándar                                               |
| `bg-search`       | `#f8f7f5` | Barra de búsqueda del POS                                     |
| `bg-upload`       | `#fafaf9` | Área de upload de imagen (dropzone)                           |

### 1.2 Texto

| Token           | HEX       | Uso                                                            |
|-----------------|-----------|----------------------------------------------------------------|
| `text-primary`  | `#1a1a1a` | Texto principal, títulos, valores                              |
| `text-secondary`| `#525252` | Texto secundario, labels de campo, meta info                   |
| `text-muted`    | `#737373` | Subtítulos de header, texto de ayuda, fechas                   |
| `text-faint`    | `#a8a29e` | Marca (brand), placeholders visuales, dividers de bullet       |
| `text-white`    | `#ffffff` | Texto sobre fondos oscuros o de acento                         |
| `text-sidebar`  | `#cbd5e1` | Nav items inactivos en sidebar                                 |
| `text-sidebar-sub`| `#94a3b8`| Rol del usuario en sidebar, texto secundario del panel oscuro |
| `text-sidebar-section`| `#64748b`| Labels de sección uppercase en sidebar                   |

### 1.3 Bordes

| Token             | HEX       | Uso                                                         |
|-------------------|-----------|-------------------------------------------------------------|
| `border-default`  | `#ebe9e6` | Borde principal de cards, headers, inputs, separadores      |
| `border-subtle`   | `#f5f4f1` | Separadores entre filas de tabla                            |
| `border-dashed`   | `#d6d3d1` | Bordes de estados vacíos, "nueva variante", dropzone        |
| `border-focus`    | accent    | Borde de input en foco, celda seleccionada                  |

### 1.4 Acento / Brand

| Token              | HEX       | Uso                                                              |
|--------------------|-----------|------------------------------------------------------------------|
| `accent`           | `#06b6d4` | Color principal — botones CTA, nav activo, logos, focos          |
| `accent-dark`      | `#0891b2` | Hover de accent, gradiente del avatar                            |
| `accent-light`     | `#22d3ee` | Gradiente del avatar (inicio), tint de iconos en login           |
| `accent-shadow`    | `#06b6d440`| Box shadow de botones primarios (`0 4px 12px`)                  |
| `accent-shadow-lg` | `#06b6d445`| Box shadow extendido en botón Cobrar (`0 6px 18px`)             |
| `accent-focus-ring`| `#06b6d41a`| Ring de foco en inputs (`0 0 0 4px`)                           |
| `accent-selected`  | `#06b6d41a`| Ring de selección en lista productos (`0 0 0 3px`)              |

### 1.5 Semánticos

#### Éxito / Stock OK
| Propiedad    | Valor     |
|--------------|-----------|
| Background   | `#dcfce7` |
| Texto        | `#166534` |
| Dot/border   | `#16a34a` |
| Border tint  | `#16a34a33` |

#### Alerta / Stock bajo
| Propiedad    | Valor     |
|--------------|-----------|
| Background   | `#fef3c7` |
| Texto        | `#92400e` |
| Dot/border   | `#d97706` |
| Border tint  | `#d9770633` |

#### Error / Sin stock
| Propiedad    | Valor     |
|--------------|-----------|
| Background   | `#fee2e2` |
| Texto        | `#b91c1c` |
| Dot/border   | `#dc2626` |
| Border tint  | `#dc262633` |

#### Online / Turno activo
| Propiedad    | Valor       |
|--------------|-------------|
| Dot          | `#16a34a`   |
| Glow ring    | `#16a34a25` |

### 1.6 Sidebar / Panel oscuro

| Token             | HEX       | Uso                           |
|-------------------|-----------|-------------------------------|
| `sidebar-bg`      | `#0f172a` | Fondo de sidebar y panel login|
| `sidebar-divider` | `rgba(148,163,184,0.18)` | Línea divisoria  |
| `avatar-gradient` | `linear-gradient(135deg,#22d3ee,#0891b2)` | Avatar usuario |
| `login-glow`      | `${accent}45` radial | Glow decorativo en login |

---

## 2. Tipografía

### 2.1 Familias de fuentes

| Familia                      | Uso                                                                  |
|------------------------------|----------------------------------------------------------------------|
| `IBM Plex Sans, system-ui, sans-serif` | Todo el texto de interfaz: labels, inputs, tablas, descripción     |
| `Bricolage Grotesque, serif`  | Títulos de página, wordmark, precios grandes, totales, stats        |
| `ui-monospace, monospace`     | SKUs en tabla de variantes, precios en contexto de código           |

> En Tailwind: usar `font-sans` para UI, `font-serif` no es Bricolage — deberá cargarse vía `@import` o ser añadida en `tailwind.config.js`. Para monospaced: `font-mono`.

### 2.2 Escala de tamaños

| px    | Tailwind aprox.  | Uso                                                          |
|-------|------------------|--------------------------------------------------------------|
| 9.5px | ~`text-[9.5px]`  | Precio secundario en celda matriz                            |
| 10px  | `text-[10px]`    | Labels de sección en sidebar (UPPERCASE)                     |
| 10.5px| `text-[10.5px]`  | Labels de MiniStat                                           |
| 11px  | `text-[11px]`    | Badges, OOS count, header tablas, tiempo de carrito          |
| 11.5px| `text-xs`        | Chips de talla en product cards, pills de categoría          |
| 12px  | `text-xs`        | Labels de campo, footer, sidebar subtitle, SKUs              |
| 12.5px| `text-[12.5px]`  | Status bar text, tiempo POS                                  |
| 13px  | `text-sm`        | Body general, nav sidebar, descripción de producto           |
| 13.5px| `text-sm`        | Nav items activos, nombre en product list                    |
| 14px  | `text-sm`        | Inputs, texto regular en modales                             |
| 14.5px| `text-[14.5px]`  | Inputs de login                                              |
| 15px  | `text-sm`        | Botón submit de login                                        |
| 16px  | `text-base`      | Input de búsqueda POS, botón Cobrar                          |
| 18px  | `text-lg`        | Número de stock en celda matriz (Bricolage)                  |
| 19px  | `text-[19px]`    | Wordmark en sidebar (Bricolage)                              |
| 20px  | `text-xl`        | Título de página "Catálogo" (Bricolage)                      |
| 22px  | `text-2xl`       | Título modal "Nuevo producto", cart order # (Bricolage)      |
| 28px  | `text-3xl`       | Nombre de producto en hero (Bricolage)                       |
| 32–34px| `text-[34px]`  | Total del carrito (Bricolage)                                |
| 40px  | `text-4xl`       | Tagline login V1 (Bricolage)                                 |
| 76px  | `text-[76px]`    | Hero "Vendé. Cobrá. Repetí." en login V2 (Bricolage)         |

### 2.3 Pesos por contexto

| Peso  | Uso                                                                    |
|-------|------------------------------------------------------------------------|
| `500` | La mayoría del texto de UI: nav items, labels de tabla, body           |
| `600` | Encabezados de página, títulos de sección, wordmark, botones CTA       |
| `700` | Logo "G", totales del carrito, stock en matriz, hero de login          |

### 2.4 Variantes especiales

- **Letra espaciada**: `letter-spacing: -0.02em` a `-0.04em` en Bricolage (títulos)
- **UPPERCASE tracking**: `font-size: 10-11px, font-weight: 600, text-transform: uppercase, letter-spacing: .05em-.08em` — sección labels, table headers
- **Tabular nums**: `font-variant-numeric: tabular-nums` — cantidades, precios, stock

---

## 3. Layout y estructura

### 3.1 Estructura general

```
┌─────────────────────────────────────────────────────┐
│  Sidebar 220px (slate-900)                          │
│  ├── Wordmark                                       │
│  ├── Nav items (scroll)                             │
│  └── Footer (config + avatar)                       │
├────────────────────────────────────────────────────┤
│  Main (flex-1)                                      │
│  ├── Header 64px (bg-surface, border-bottom)        │
│  └── Body (flex, overflow: hidden)                  │
│       ├── Panel izquierdo                           │
│       └── Panel derecho                             │
└─────────────────────────────────────────────────────┘
```

### 3.2 Proporciones por pantalla

| Pantalla     | Izquierdo        | Derecho         | Gap   | Padding |
|--------------|------------------|-----------------|-------|---------|
| **POS**      | `flex: 0 0 60%`  | `flex: 0 0 40%` | `16px`| `16px`  |
| **Productos**| `flex: 0 0 320px`| `flex: 1`       | `0`   | `24px`  |
| **Login**    | `flex: 0 0 40%`  | `flex: 1`       | —     | `40-48px`|

### 3.3 Sidebar

```css
width: 220px;
background: #0f172a;
padding: 22px 14px;
flex-shrink: 0;
```

### 3.4 Header

```css
height: 64px;
padding: 0 24px;
background: #fdfcfb;
border-bottom: 1px solid #ebe9e6;
display: flex;
align-items: center;
justify-content: space-between;
```

### 3.5 Cards interiores

```css
background: #fff;
border: 1px solid #ebe9e6;
border-radius: 14px;
overflow: hidden;
```

Card header interno:
```css
padding: 16px 20px;
border-bottom: 1px solid #f5f4f1;
display: flex;
justify-content: space-between;
align-items: center;
```

### 3.6 Padding estándar

| Contexto                    | Valor               |
|-----------------------------|---------------------|
| Contenido de página         | `24px`              |
| POS body (entre cards)      | `16px` gap, `16px` padding |
| Interior de card            | `20–24px`           |
| Filas de tabla              | `10px 16px`         |
| Nav items sidebar           | `10px`              |
| Badges/pills                | `3px 9px`           |
| Input estándar              | `0 12px`            |

---

## 4. Componentes documentados

### 4.1 Botones

#### Primario (CTA)
```css
height: 38px;           /* 42px modal, 50px login */
padding: 0 16px;
border: 0;
border-radius: 8px;     /* 10px en login */
background: #06b6d4;
color: #fff;
font-size: 13.5px;      /* 15px login */
font-weight: 600;
cursor: pointer;
box-shadow: 0 4px 12px #06b6d440;
display: flex; align-items: center; gap: 7px;
```

Hover/active: bajar opacidad o `filter: brightness(0.92)`

Disabled/loading:
```css
opacity: 0.85;
cursor: wait;
```

#### Secundario (outline)
```css
height: 38px;           /* 34px acciones en hero */
padding: 0 14px;
border: 1px solid #ebe9e6;
background: #fff;
color: #404040;
border-radius: 8px;     /* 7px botones pequeños */
font-size: 13px;
font-weight: 500;       /* normal para algunos */
cursor: pointer;
```

#### Acción pequeña (ghost row)
```css
height: 28px;
padding: 0 10px;
border: 1px solid #ebe9e6;
background: #fff;
border-radius: 6px;
color: #525252;
font-size: 12px;
```

#### Botón destructivo / vaciar
```css
height: auto; padding: 6px 12px;
border: 1px solid #ebe9e6;
background: #fff;
border-radius: 7px;
color: #525252;
font-size: 12px;
```

#### Botón ícono (icono solo)
```css
width: 34px; height: 34px;
border: 1px solid #ebe9e6;
background: #fff;
border-radius: 7px;
cursor: pointer;
color: #525252;
```

#### Botón de cierre modal (X)
```css
width: 28px; height: 28px;
border: 0;
background: #f5f4f1;
border-radius: 7px;
cursor: pointer;
display: grid; place-items: center;
```

### 4.2 Inputs

#### Estándar
```css
width: 100%;
height: 40px;
padding: 0 12px;
border: 1px solid #ebe9e6;
background: #fff;
border-radius: 8px;
font-size: 14px;
font-family: inherit;
outline: 0;
```

#### Focus
```css
border: 1.5px solid accent;
box-shadow: 0 0 0 4px #06b6d41a;
transition: border-color .12s, box-shadow .12s;
```

#### Textarea
```css
/* mismas bases, height: auto, padding: 10px 12px */
resize: vertical;
```

#### Select
```css
/* mismo que input estándar */
padding-right: 28px; /* espacio para flecha */
```

#### Barra de búsqueda POS
```css
height: 56px;
border-radius: 12px;
background: #f8f7f5;
border: 1px solid #ebe9e6;
display: flex; align-items: center;
padding: 0 16px;
gap: 12px;
```

#### Celda editable inline (tabla/matriz)
```css
/* estado normal (hover) */
background: #f5f4f1; border-radius: 6px; cursor: text;

/* estado editando */
border: 1.5px solid #06b6d4;
border-radius: 6px;
outline: 0;
box-shadow: 0 0 0 3px #06b6d420;
```

### 4.3 Cards de producto (lista lateral)

```css
/* Normal */
border: 1.5px solid transparent;
background: transparent;
border-radius: 10px;
padding: 10px;
cursor: pointer;

/* Seleccionado / active */
border: 1.5px solid #06b6d4;
background: #fff;
box-shadow: 0 0 0 3px #06b6d41a;
```

Thumbnail: `width: 44px; height: 44px; border-radius: 7px`

### 4.4 Tabla

#### Encabezado (`Th`)
```css
text-align: left; /* o right */
font-size: 11px;
font-weight: 600;
color: #737373;
text-transform: uppercase;
letter-spacing: .05em;
padding: 10px 16px;
border-bottom: 1px solid #ebe9e6;
```

#### Celda (`Td`)
```css
padding: 10px 16px;
vertical-align: middle;
```

#### Fila
```css
border-bottom: 1px solid #f5f4f1;
```

### 4.5 Badges de stock

```jsx
// Sin stock
<span style={{
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '3px 9px', borderRadius: 999,
  background: '#fee2e2', color: '#b91c1c',
  fontSize: 11, fontWeight: 600
}}>
  <span style={{ width: 5, height: 5, borderRadius: 999, background: '#dc2626' }} />
  Sin stock
</span>

// Stock bajo
<span style={{
  background: '#fef3c7', color: '#92400e'
  /* dot: #d97706 */
}}>Stock bajo</span>

// Disponible
<span style={{
  background: '#dcfce7', color: '#166534'
  /* dot: #16a34a */
}}>Disponible</span>
```

Equivalentes Tailwind:
```tsx
// Sin stock
"inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-800"

// Stock bajo
"inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900"

// Disponible
"inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-semibold text-green-900"
```

### 4.6 Pills de categoría

```css
/* Inactiva */
display: inline-flex;
padding: 4px 10px;
border-radius: 999px;
border: 1px solid #ebe9e6;
background: #fff;
color: #525252;
font-size: 11.5px;
font-weight: 500;

/* Activa */
border: 1px solid #1a1a1a;
background: #1a1a1a;
color: #fff;
```

Tailwind equivalente:
```tsx
// Inactiva
"rounded-full border border-[#ebe9e6] bg-white px-4 py-2 text-sm font-medium text-slate-600"

// Activa
"rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white"
```

### 4.7 Nav items del sidebar

```css
/* Inactivo */
display: flex; align-items: center; gap: 11px;
padding: 10px;
border-radius: 8px;
border: 0;
background: transparent;
color: #cbd5e1;
font-size: 13.5px; font-weight: 500;

/* Activo */
background: #06b6d4;
color: #fff;
```

Badge de conteo (e.g. carrito):
```css
/* sobre activo */
background: rgba(255,255,255,0.25);

/* sobre inactivo */
background: #06b6d4;

/* común */
min-width: 18px; height: 18px;
padding: 0 5px;
border-radius: 9px;
color: #fff;
font-size: 10.5px; font-weight: 600;
```

### 4.8 Modales

**Overlay**:
```css
position: fixed; inset: 0;
background: rgba(15,23,42,0.5);
backdrop-filter: blur(4px);
display: grid; place-items: center;
z-index: 50;
```

**Panel**:
```css
width: 540px;         /* varía: 540px productos, ~400px pagos */
max-height: 90%;
overflow: auto;
background: #fff;
border-radius: 14px;
padding: 28px;
box-shadow: 0 20px 60px rgba(0,0,0,0.3);
```

Título modal:
```css
font-family: 'Bricolage Grotesque', serif;
font-size: 22px; font-weight: 600;
letter-spacing: -0.025em;
```

Subtítulo:
```css
font-size: 13px; color: #737373;
margin-bottom: 20px;
```

### 4.9 Matriz de inventario (talla × color)

Celda con stock:
```css
height: 56px;
min-width: 64px;
border-radius: 8px;
/* colores según stockState */
display: flex; flex-direction: column;
align-items: center; justify-content: center;
cursor: pointer;
```

Celda vacía (sin esa combinación):
```css
height: 56px;
border: 1.5px dashed #d6d3d1;
background: transparent;
border-radius: 8px;
color: #a8a29e;
```

Número de stock en celda:
```css
font-family: 'Bricolage Grotesque', serif;
font-size: 18px; font-weight: 700;
color: /* fg del estado */;
font-variant-numeric: tabular-nums;
line-height: 1;
```

Leyenda de matriz:
```jsx
// OK: cuadrado 9×9, bg=#dcfce7, border=1px solid #16a34a, border-radius: 2px
// Bajo: bg=#fef3c7, border=1px solid #d97706
// Cero: bg=#fee2e2, border=1px solid #dc2626
```

### 4.10 Dropzone de imagen

```css
width: 100%; height: 110px;
border: 1.5px dashed #d6d3d1;
border-radius: 10px;
background: #fafaf9;
cursor: pointer;
display: flex; flex-direction: column;
align-items: center; justify-content: center;
gap: 6px; color: #737373;
```

Texto secundario: `font-size: 11px; color: #a8a29e`

---

## 5. Patrones de UX

### 5.1 Estados de carga (skeletons)

- Clases Tailwind: `animate-pulse rounded-xl bg-slate-100`
- Forma: replicar la forma del componente (card, fila, etc.) con `aspect-square` o altura fija
- Grid de skeletons: mismo grid que los cards reales

### 5.2 Estados vacíos

Estructura estándar:
```tsx
<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
    <IconName size={24} className="text-slate-300" />
  </div>
  <div>
    <p className="text-sm font-medium text-slate-500">Título vacío</p>
    <p className="mt-1 text-xs text-slate-400">Descripción de qué hacer.</p>
  </div>
</div>
```

Carrito vacío específicamente usa `ShoppingCart` y fondo `bg-slate-100` para el círculo.

### 5.3 Toasts y errores

- Librería: `react-hot-toast`
- Posición: por defecto top-center (o configurar en `Toaster`)
- Uso: `toast.success('msg')` en onSuccess de mutaciones, `toast.error(err.message)` en onError

### 5.4 Modales — patrones de apertura y cierre

- Click en overlay cierra (`onClick={onClose}` en el overlay, `e.stopPropagation()` en el panel)
- Botón X top-right en el panel
- Tecla Escape: añadir `useEffect` con listener de `keydown`
- Sin animaciones explícitas en los diseños (pueden añadirse con `transition`)
- Scroll interno: `max-height: 90vh; overflow-y: auto`

### 5.5 Celdas editables inline

Patrón de edición in-place (tabla y matriz):
1. Muestra valor formateado en un `<button>` con hover `bg-[#f5f4f1]`
2. Al hacer click → cambia a `<input>` con `autoFocus` y `select()`
3. `onBlur` guarda; `Enter` hace blur; `Escape` cancela sin guardar
4. Input usa `border: 1.5px solid accent, box-shadow: 0 0 0 3px ${accent}20`

### 5.6 Items de carrito

Cada ítem:
```tsx
<div className="flex items-center gap-3 px-5 py-3">
  {/* color dot */}
  <div className="h-4 w-4 shrink-0 rounded-full shadow-[0_0_0_1.5px_rgba(0,0,0,0.12)]"
       style={{ background: colorHex }} />
  {/* info */}
  <div className="flex-1 min-w-0">
    <p className="truncate text-sm font-medium">{name}</p>
    <p className="text-xs text-slate-400">Talla {size} · {fmtCOP(price)} c/u</p>
  </div>
  {/* qty control */}
  <div className="flex h-7 items-center rounded-lg border border-slate-200">
    <button /* minus */>−</button>
    <span className="w-5 text-center text-xs font-semibold">{qty}</span>
    <button /* plus */>+</button>
  </div>
  {/* subtotal */}
  <span className="w-20 text-right font-mono text-sm font-semibold">{fmtCOP(total)}</span>
  {/* remove */}
  <button /* X *//>
</div>
```

### 5.7 Status indicator (online)

```tsx
<div className="flex items-center gap-2">
  <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_0_3px_#16a34a25]" />
  <span>Caja 02 · en línea</span>
</div>
```

---

## 6. Iconografía

Todos los íconos de `lucide-react` con `strokeWidth` implícito de Lucide (`1.5–2`).

### 6.1 Navegación del sidebar

| Ícono Lucide        | Pantalla / sección   |
|---------------------|----------------------|
| `ShoppingCart`      | Ventas (POS)         |
| `Tag`               | Productos            |
| `Package`           | Inventario           |
| `RotateCcw`         | Devoluciones         |
| `Users`             | Clientes             |
| `BarChart2`         | Reportes             |
| `Settings`          | Configuración        |

Tamaño: `17×17`

### 6.2 POS

| Ícono Lucide        | Uso                                      |
|---------------------|------------------------------------------|
| `ScanLine` / `Scan` | Input de búsqueda/escáner de barcode     |
| `Search`            | Buscador en lista de productos           |
| `X`                 | Cerrar popover, eliminar ítem del carrito|
| `Plus`              | Agregar al carrito, nueva variante       |
| `Minus`             | Reducir cantidad                         |
| `User`              | Campo de cliente                         |
| `Tag`               | Descuento                                |
| `Clock`             | Hora en header                           |
| `Bell`              | Notificaciones                           |
| `ChevronDown`       | Selector de tipo de descuento            |
| `CheckCircle`       | Confirmar pago                           |
| `Banknote`          | Efectivo                                 |
| `CreditCard`        | Tarjeta                                  |
| `ArrowLeftRight`    | Transferencia                            |
| `Smartphone`        | Addi (pago en cuotas)                    |
| `Printer`           | Imprimir ticket                          |
| `ShoppingCart`      | Empty state del carrito                  |

### 6.3 Productos

| Ícono Lucide        | Uso                                          |
|---------------------|----------------------------------------------|
| `Package`           | Placeholder de imagen de producto            |
| `Printer`           | Generar/imprimir etiqueta de barcode         |
| `MoreHorizontal`    | Menú contextual `···` de variante            |
| `ToggleRight`       | Desactivar variante activa                   |
| `Search`            | Buscador de producto                         |
| `Plus`              | Nuevo producto, nueva variante               |

### 6.4 Auth / Login

| Ícono Lucide    | Uso                           |
|-----------------|-------------------------------|
| `ArrowRight`    | Flecha en botón "Ingresar"    |
| `Eye` / `EyeOff`| Mostrar/ocultar contraseña   |
| `Check`         | Checkbox "Mantener sesión"    |
| `Box`           | Feature card Inventario       |
| `ScanLine`      | Feature card Escáner          |
| `RefreshCw`     | Feature card Devoluciones     |

### 6.5 Tamaños estándar

| Contexto              | Tamaño     |
|-----------------------|------------|
| Nav sidebar           | `17×17`    |
| Ícono en buscador POS | `22×22`    |
| Ícono en buscador lista | `15×15`  |
| Botones con ícono     | `14×14`    |
| Botón X de modal      | `14×14`    |
| Acciones inline       | `12–13`    |
| Empty state           | `22–28`    |
| Inline en texto       | `13–16`    |

---

## 7. Patrones específicos de G-Pulso

### 7.1 Formato de precios COP

```ts
const fmt = new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})
export const fmtCOP = (n: number) => fmt.format(n)
// Resultado: "$45.000"
```

Contextos de tipografía:
- **Grande (total/precio principal)**: `Bricolage Grotesque, font-weight: 700, tracking: -0.03em`
- **Mediano (producto hero)**: `Bricolage Grotesque, fontSize: 19, font-weight: 700`
- **Tabla/contexto técnico**: `ui-monospace, font-size: 12–13px`
- **En celda matriz (subtítulo)**: `font-size: 9.5px, opacity: 0.75`

### 7.2 Display de talla

```tsx
<span className="inline-flex items-center justify-center min-w-[32px] h-6 px-2 rounded-[5px] bg-[#f5f4f1] font-semibold text-xs tabular-nums">
  {size}
</span>
```

En selector de variante (POS popover):
```css
min-width: 38px; height: 36px; padding: 0 10px;
font-size: 13px; font-weight: 600;
border-radius: 7px;
/* Normal */ border: 1px solid #ebe9e6; background: #fff; color: #1a1a1a;
/* Seleccionado */ border: 1px solid #1a1a1a; background: #1a1a1a; color: #fff;
/* Sin stock */ text-decoration: line-through; color: #a8a29e; cursor: not-allowed;
```

### 7.3 Display de color (swatch)

Swatch inline en tabla:
```tsx
<span
  className="inline-block h-3.5 w-3.5 rounded-full"
  style={{ background: colorHex, boxShadow: '0 0 0 1px #d6d3d1' }}
/>
```

Swatch en selector de variante (POS popover):
```css
width: 30px; height: 30px; border-radius: 999px;
/* Normal */ border: 2px solid #fff; box-shadow: 0 0 0 1px #d6d3d1;
/* Seleccionado */ border: 2px solid accent; box-shadow: 0 0 0 2px accent;
```

Swatch en carrito (ítem):
```css
width: 16px; height: 16px; border-radius: 999px;
box-shadow: 0 0 0 1.5px rgba(0,0,0,0.12);
```

### 7.4 Lógica de estado de stock

```ts
function stockState(qty: number, minStock = 2): 'out' | 'low' | 'ok' {
  if (qty === 0) return 'out'
  if (qty <= minStock) return 'low'
  return 'ok'
}
```

Colores de estado en texto inline (POS popover, disponibilidad):
```tsx
// qty > 2
"text-green-600"  // #16a34a: "{n} disponibles"

// qty > 0 && qty <= 2
"text-orange-500"  // #ea580c: "{n} disponibles"

// qty === 0
"text-red-500"   // #ef4444: "Sin stock"
```

### 7.5 Variante — representación combinada

En tabla de variantes completa:
```tsx
<div className="flex items-center gap-1.5">
  <span className="h-3.5 w-3.5 rounded-full shadow-[0_0_0_1px_#d6d3d1]"
        style={{ background: colorHex }} />
  <span className="text-sm">{colorName}</span>
</div>
```

En carrito (línea de descripción):
```tsx
<p className="text-xs text-slate-400">
  {size ? `T.${size}` : ''}{color ? ` · ${color}` : ''} · {fmtCOP(unitPrice)} c/u
</p>
```

### 7.6 Logo / Wordmark

```tsx
{/* Logo block */}
<div className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] bg-cyan-500
                font-bold text-[15px] text-white" style={{ fontFamily: 'Bricolage Grotesque' }}>
  G
</div>

{/* Wordmark text */}
<span style={{ fontFamily: 'Bricolage Grotesque', fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', color: '#fff' }}>
  G-Pulso<span style={{ color: accent }}>.</span>
</span>
```

El punto final en accent es obligatorio — es parte de la identidad.

### 7.7 Avatar de usuario

```tsx
<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
     style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)' }}>
  {initials}
</div>
```

### 7.8 Hero de producto (ProductHero)

Estructura de stats mini (`MiniStat`):
```tsx
<div>
  <p className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#a8a29e] mb-0.5">
    {label}
  </p>
  <p className="font-['Bricolage_Grotesque'] text-[22px] font-semibold tracking-[-0.025em] tabular-nums"
     style={{ color: tone ?? '#1a1a1a' }}>
    {value}
  </p>
</div>
```

Badges de estado del producto:
```tsx
{/* Categoría */}
<span className="rounded-full bg-[#f5f4f1] px-[9px] py-[3px] text-[11px] font-medium text-[#525252]">
  {category}
</span>

{/* Activo */}
<span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-[9px] py-[3px] text-[11px] font-medium text-[#166534]">
  <span className="h-[5px] w-[5px] rounded-full bg-[#16a34a]" />
  Activo
</span>
```

### 7.9 Botón "Nueva variante" (add row)

```tsx
<button className="flex w-full items-center justify-center gap-1.5 rounded-lg border-[1.5px]
                   border-dashed border-[#d6d3d1] bg-transparent py-2.5 text-sm font-medium"
        style={{ color: accent }}>
  <Plus size={14} /> Nueva variante
</button>
```
