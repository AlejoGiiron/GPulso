# Prueba física — PT-260 Label Maker (etiquetas)

La impresora del cliente es la **PT-260 Label Maker** (rollo de 40mm). **Esta
semana se prueba SOLO con etiquetas.** Los comprobantes de 58mm quedan para una
futura impresora de recibos; están en el anexo.

Se prueba contra el **lab**, nunca contra producción. La rama es
`feature/receipts-58mm` y no se mergea hasta pasar esta prueba.

## 0. Preparación

| Qué | Cómo |
|---|---|
| App contra el lab | `pnpm dev --mode lab` → http://localhost:5173 |
| Usuario | `qa.admin@celfashion.co` · contraseña de **lab**: `lab58mm` |
| Levantar el lab si está apagado | `supabase start --workdir C:/Users/Alejandro/.gpulso-lab` |
| Volver al estado inicial | ver al final |

El lab corre en los puertos **5434x**. Los 5432x los ocupa el stack local de
G-Mura; con esos, la app de G-Pulso se conectaría a la base de G-Mura. La
configuración de puertos vive fuera del repo, en `C:\Users\Alejandro\.gpulso-lab`.

**Productos de ejemplo** (Productos → buscar → botón **Etiquetas**):

| Producto | Qué prueba |
|---|---|
| iPhone 15 Pro Max 256GB Titanio Natural reacondicionado | Nombre largo, precio de 8 dígitos, código de fábrica EAN-13 (13 dígitos) |
| Cargador inalámbrico MagSafe 15W carga rápida original | Nombre largo, código propio de 12 dígitos |
| Audífonos Bluetooth deportivos con cancelación de ruido | Sin código: se genera al imprimir |
| Forro antichoque transparente | Código alfanumérico que **no cabe**: la app avisa y no imprime |
| AIRPODS PRO 2 | Producto real del catálogo, de variante única |

## 1. Driver de Windows

Según los vendedores y el tutorial de instalación de este modelo, la PT-260 Label
Maker usa un **driver de etiquetas TSC** (Seagull), no el POS58 de recibos. Al
instalarlo, la impresora aparece como **"TSC DA200"**.

**De dónde sacar el driver, en este orden.** No hay ficha ni driver oficial del
fabricante en la web, así que:

1. **El CD o el código QR que venga en la caja de la impresora.**
2. **El enlace del vendedor** que la vendió (página del producto, chat o correo
   de la compra).
3. **Solo como último recurso**, el zip que enlaza un tutorial de YouTube
   (`Label_Print_PT-260_Driver.zip`, https://www.youtube.com/watch?v=DvD76sC6vwI).
   Antes de ejecutar nada, **súbelo a https://www.virustotal.com** (el zip y,
   si pasa, el `DriverWizard.exe`). No basta con el antivirus local. Si algún
   motor lo marca como malicioso, no lo ejecutes y avísame.

Si el driver de la caja o del vendedor no es el TSC, los menús tendrán otros
nombres. Lo que importa es lo mismo: un **tamaño de papel igual a la etiqueta**
y el **tipo de rollo** (con separación o continuo).

**Instalación (driver TSC):**

1. Conecta la impresora por USB y enciéndela. Si Windows abre un asistente para
   instalar el dispositivo, **cancélalo**.
2. Ejecuta **`DriverWizard.exe`** (carpeta "Driver PT-260") → Instalar driver →
   modelo **TSC DA200** → puerto USB.
3. Crea el tamaño de etiqueta. El driver trae 40×50 pero **no 40×30**:
   **Panel de control → Dispositivos e impresoras → TSC DA200 → Preferencias de
   impresión → Configurar página → Stock → Nuevo**.
   - Nombre: `40x30`
   - Ancho: **40 mm**
   - Alto: **el alto que midas en el paso 2** (30 si es 40×30)
4. En la pestaña **Stock → Tipo**:
   - **Labels with Gaps** si el rollo es troquelado. En **Gap Height** pon la
     separación entre etiquetas que midas, normalmente 2–3 mm (no verificado).
   - **Continuous** si el rollo es continuo.
5. Deja el tamaño `40x30` como predeterminado.

Si la impresora no responde con el driver TSC, hay otro driver en el tutorial del
canal HelpDesk (https://www.youtube.com/watch?v=Evq_ItraNe0) y el programa
DLabel. Ninguno está verificado.

## 2. Calibración (antes de imprimir productos)

**a) ¿Troquelado o continuo, y qué alto tiene?**
1. Con el rollo puesto, presiona **una vez** el botón de avance.
2. Si avanza un tramo y **se detiene**, el rollo es **troquelado** y la impresora
   detecta los espacios. Mide:
   - el **alto de la etiqueta** (sin la separación);
   - la **separación** entre etiquetas.
3. Si **no se detiene**, el rollo es **continuo**.
4. En la app: **Configuración → Etiquetas**.
   - Elige **Rollo troquelado** o **Rollo continuo** (con su margen de corte).
   - En tamaño, usa 40×30, 40×40 o 40×50, o **Personalizado** con el alto que
     mediste.
   - **Guarda.**
5. Ajusta el alto del driver (paso 1.3) a lo mismo.

> Algunas PT-260 cambian entre modo rollo y modo etiqueta con **FEED + encender**
> y luego **POWER dos veces**. Lo encontré en otra variante del modelo, sin
> confirmar. Pruébalo solo si con el rollo troquelado el avance no se detiene.

**b) Una etiqueta de prueba (centrado).**
Ve a **Configuración → Etiquetas → Imprimir 1 de prueba (centrado)**.

La etiqueta de prueba lleva **marcas de borde**: esquinas en L y marcas a mitad
de cada lado, justo en el borde de la etiqueta.
- **Bien:** las ocho marcas se ven completas y pegadas a los bordes físicos, y
  nada se sale a la etiqueta siguiente.
- **Si falta un lado o está corrida:** anota hacia dónde y cuántos mm. Se
  corrige con los *offsets* del driver (Stock → Vertical/Gap Offset) o, si es
  horizontal, en `src/lib/labelLayout.ts` (`LABEL_SAFE_MARGIN_MM`).

**c) Diez seguidas (alineación).**
Pulsa **Imprimir 10 seguidas (alineación)**.
- **Bien:** la **décima** está tan centrada como la primera.
- **Si se va corriendo:** el driver no está detectando el espacio. Revisa el
  Tipo (Labels with Gaps) y el Gap Height, o recalibra la impresora.

**Diálogo de impresión de Chrome (en todas las pruebas):**
- **Destino:** TSC DA200.
- **Tamaño del papel:** `40x30`. La app pide la hoja exacta, así que Chrome suele
  tomarla solo.
- **Márgenes:** Ninguno.
- **Escala:** 100%.
- **Encabezados y pies de página:** desmarcado.

## 3. Etiquetas de productos

Ve a **Productos**, busca el producto y pulsa **Etiquetas**. Elige la cantidad
(N copias = N etiquetas) y pulsa **Imprimir**. La vista previa está a tamaño
real; la línea punteada marca el área útil y no se imprime.

## 4. Prueba de lectura (lo crítico)

Con el **lector de códigos del mostrador**:
1. Escanea cada etiqueta impresa **sobre un campo de texto** (por ejemplo, el
   bloc de notas) y comprueba que salen los mismos dígitos que están impresos.
2. En **Ventas (POS)**, escanea la etiqueta: el producto debe entrar al carrito.
3. Anota si leyó **al primer intento**.

El código usa barras de **2 puntos enteros (0,25 mm)** con zona blanca a los
lados:
- el propio de 12 dígitos mide 25,3 mm de barras;
- el de fábrica de 13 dígitos, 30,8 mm.

Si el lector falla, no cambies el formato por tu cuenta. Anota qué pasó (no lee,
lee mal, necesita varios intentos) y lo decidimos. Las alternativas son un
código más corto para permitir barras más anchas u otro formato.

## 5. Resultados

| Prueba | Resultado | Observaciones |
|---|---|---|
| Rollo (troquelado / continuo), alto y separación medidos | | |
| 1 de prueba: 8 marcas completas, sin invadir la siguiente | | |
| 10 seguidas: la décima alineada | | |
| iPhone (EAN-13, precio de 8 dígitos): legible | | |
| Cargador (12 dígitos): legible | | |
| Audífonos (código generado): legible | | |
| Forro: la app avisa y no imprime | | |
| AIRPODS PRO 2 (variante única): se imprime | | |
| Lectura al primer intento (anota cuáles fallaron) | | |
| El lector agrega el producto en el POS | | |

## Volver al estado inicial del lab

```bash
./scripts/lab-restore.sh backups/gpulso_20260928_1907_pre-reset-reactivacion.dump
MSYS_NO_PATHCONV=1 docker exec -i supabase_db_gpulso \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/lab-seed-recibos.sql
```

---

## Anexo: comprobantes de 58mm (no aplica a esta impresora)

El soporte de recibos de 58mm está implementado en la misma rama. Sirve si el
cliente compra una impresora de recibos de 58mm, por ejemplo una PT-260 de
**recibos**, que es otro producto.
- Se configura en **Configuración → Recibos**, que tiene su página de prueba.
- En el diálogo de Chrome hay que elegir el papel de 58mm del driver, márgenes
  Ninguno y escala 100%. Chrome ignora el `size: 58mm auto` de la app, igual
  que pasaba con 80mm.
- Comprobantes a revisar:
  - venta: **Historial → #66**;
  - separado: **Separados → #1**;
  - cuadre: **Cerrar turno**;
  - taller: **Recibir equipo** y la **#33 → Entregar y cobrar**;
  - devolución: buscar **66**.
