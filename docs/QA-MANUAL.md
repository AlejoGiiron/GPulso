# G-Pulso — Manual de pruebas

**Para quien va a probar el sistema. No necesitas saber programar.**

Versión 1.0 · Julio 2026 · Cubre POS, inventario con IMEI, taller de reparaciones y comisiones.

---

## Antes de empezar

### ¿Qué es G-Pulso?

Es el sistema de una tienda de tecnología. Sirve para cuatro cosas:

1. **Vender** accesorios (cables, forros, cargadores) y equipos (celulares, computadores).
2. **Controlar el inventario**, incluyendo equipos que se rastrean uno por uno con su IMEI.
3. **Manejar el taller** de reparaciones: recibir un equipo dañado, repararlo, avisarle al cliente y cobrarle cuando lo recoge.
4. **Registrar comisiones** por créditos que gestiona el local.

Tu trabajo es usarlo como lo usaría una persona real de la tienda, y anotar todo lo que falle, se vea raro o te confunda.

### Datos de acceso

> Alejandro llena esto antes de entregarte el manual:

| | |
|---|---|
| **Dirección del sistema** | https://g-pulso.vercel.app/ |
| **Usuario Administrador** | qa.admin@celfashion.co Clave: lab123 |
| **Usuario Vendedor** | qa.vendedor@celfashion.co Clave: lab123 |
| **Usuario Técnico** | qa.tecnico@celfashion.co Clave: lab123 |

Vas a necesitar los tres. Muchas pruebas consisten justamente en verificar que cada uno vea y pueda hacer solo lo suyo.

### Reglas de oro

1. **Todo lo que crees empieza con `PRUEBA-`.** Productos, clientes, todo: `PRUEBA-Cargador`, `PRUEBA-Ana Gómez`. Así después se limpia fácil y nadie confunde tus datos con los de la tienda.
2. **No borres nada que no hayas creado tú.**
3. **Si algo falla, anótalo y sigue con el caso siguiente.** No te quedes trabado tratando de entender por qué.
4. **Anota hasta lo que dudes.** Si algo te pareció raro pero no sabes si es un error, anótalo igual. Esa duda vale oro.
5. **Captura de pantalla de todo lo que falle.** Una foto vale más que una descripción.
6. **No uses datos reales de personas** (cédulas, teléfonos de verdad). Invéntalos.

### Cómo anotar un problema

Al final de este manual hay una plantilla. Para cada problema anota:

- **Dónde**: en qué caso de prueba y en qué pantalla.
- **Qué hiciste**: los pasos exactos, para que se pueda repetir.
- **Qué esperabas** que pasara.
- **Qué pasó** en realidad.
- **Qué tan grave** te parece:
  - 🔴 **Grave** — se pierde plata, se pierden datos, o no se puede seguir trabajando.
  - 🟡 **Molesto** — funciona, pero mal, confuso o incompleto.
  - 🔵 **Detalle** — cosmético: un texto mal escrito, algo descuadrado, un color raro.

### Cosas que YA sabemos (no las reportes)

- Los comprobantes impresos tienen un **texto legal de relleno** (algo genérico sobre garantía y equipos no reclamados). El texto real lo va a dar la dueña de la tienda.
- El catálogo de productos que veas es **de prueba**, no el real de la tienda.
- Cuando se cobra una reparación, en el historial de ventas aparece un producto llamado **"Servicio de reparación"**. Eso es correcto, así se contabiliza el taller.

### Glosario rápido

| Palabra | Qué significa |
|---|---|
| **Turno** | La jornada de caja. Se abre al empezar el día declarando la plata inicial, y se cierra contando lo que quedó. |
| **Cuadre** | Al cerrar el turno, contar la plata real y compararla con lo que el sistema esperaba. |
| **IMEI / Serial** | El número único de cada equipo. Como la cédula del celular. |
| **Variante** | Las versiones de un mismo producto: "128GB Azul", "256GB Negro". |
| **Unidad** | Un equipo físico concreto, identificado por su IMEI. Dos celulares iguales son dos unidades distintas. |
| **Separado** | Apartar un producto pagando de a poquitos hasta completarlo. |
| **Orden de trabajo** | La ficha de un equipo que entró al taller a reparación. |

---

## Bloque 0 — Prueba rápida (10 minutos)

Haz esto primero, siempre. Si algo de aquí falla, avísale a Alejandro **antes** de seguir con el resto: significa que algo grande está roto.

**0.1** Entra con el usuario Administrador.
→ Debe abrir el sistema con el logo de G-Pulso (un cuadrito azul-verdoso con una línea de electrocardiograma).

**0.2** Mira el menú de la izquierda.
→ Deben aparecer al menos: Ventas, Productos, Inventario, Reparaciones, Clientes, Caja/Turnos, Reportes.

**0.3** Abre un turno de caja con $100.000 de base.
→ Arriba debe aparecer que hay un turno abierto.

**0.4** Entra a Ventas y busca cualquier producto.
→ Debe cargar la lista de productos.

**0.5** Entra a Reparaciones.
→ Debe aparecer el tablero con las columnas: Recibido, En reparación, Listo, Entregado.

**0.6** Cierra el turno declarando los mismos $100.000.
→ Debe dejarte cerrar y mostrar el resumen sin diferencias.

**Resultado del bloque 0:** ☐ Todo bien ☐ Algo falló → **para y avisa**

---

## Bloque 1 — Lo básico: vender y cuadrar la caja

> Usuario: **Administrador**

### 1.1 — Abrir turno

1. Ve a Caja / Turnos y abre un turno con una base de $100.000.

→ **Debe pasar:** el turno queda abierto y se ve reflejado en la barra de arriba.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 1.2 — Crear una categoría y un accesorio

1. Crea la categoría `PRUEBA-Accesorios`.
2. Crea un producto llamado `PRUEBA-Cable USB-C`, tipo de variante **Única**, precio $25.000, con 10 de stock.

→ **Debe pasar:** el formulario te deja crearlo **en un solo paso** (te pide el precio y el stock ahí mismo, sin mandarte a otra pantalla a crear variantes). El botón debe decir "Crear producto".

→ **Fíjate:** en ninguna parte debe aparecer la palabra "Talla" ni ejemplos de ropa (camisetas, jeans). Si ves algo así, anótalo.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 1.3 — Vender el accesorio

1. Ve a Ventas, busca `PRUEBA-Cable` y agrégalo al carrito.
2. Agrega 3 unidades usando los botones + y −.
3. Cobra en efectivo, indicando que el cliente te dio $100.000.

→ **Debe pasar:** el sistema calcula bien las vueltas ($100.000 − $75.000 = $25.000).

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 1.4 — Revisar el comprobante

1. Mira el comprobante de esa venta.

→ **Debe pasar:** se ve el producto, la cantidad, el total y las vueltas. Los precios en formato colombiano ($25.000, sin decimales).

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 1.5 — Devolver un producto

1. Busca la venta que acabas de hacer y haz una devolución de 1 unidad.
2. Ve al inventario y revisa el stock de `PRUEBA-Cable USB-C`.

→ **Debe pasar:** el stock subió en 1 (de 7 pasa a 8).

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 1.6 — Cerrar turno y cuadrar

1. Cierra el turno. Cuando te pida cuánto efectivo hay, declara **$150.000** (o sea, $25.000 menos de lo que debería haber).

→ **Debe pasar:** el sistema detecta la diferencia y la muestra claramente (un faltante de $25.000). No debe dejarte cerrar como si nada.

2. Anota qué tan claro te pareció el resumen del cierre. ¿Se entiende de dónde salió cada peso?

☐ Pasó ☐ Falló · Notas: ______________________________________________

---

## Bloque 2 — Equipos con IMEI

> Usuario: **Administrador** · Abre un turno nuevo antes de empezar.

Esta es la parte más nueva del sistema. La idea: los accesorios se cuentan por cantidad ("tengo 10 cables"), pero los celulares se rastrean uno por uno ("tengo ESTE celular, con ESTE IMEI").

**Inventa IMEIs de 15 dígitos** para las pruebas. Por ejemplo:
`358921094412873`, `358921094418420`, `351987220945116`, `869123045512034`, `869123045518871`.

### 2.1 — Crear un producto serializado

1. Crea un producto `PRUEBA-iPhone 13`, y marca la opción de **equipo serializado (IMEI/serial)**.
2. Ponle precio $1.850.000.

→ **Debe pasar:** al marcarlo como serializado, el sistema te avisa que las unidades se cargan después (por compra o por inventario), no aquí.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.2 — Recibir equipos con el lector (captura en ráfaga)

Esto simula el día que llega el pedido del proveedor.

1. Crea una factura de compra con el proveedor que quieras, con `PRUEBA-iPhone 13`, cantidad **3**, costo $1.500.000 cada uno.
2. Confírmala. Debe abrirse un panel para capturar los seriales.
3. Escribe el primer IMEI y presiona **Enter**. Luego el segundo, Enter.

→ **Debe pasar:**
- El cursor se queda solo en el campo, listo para el siguiente (no tienes que hacer clic entre uno y otro).
- Aparece un contador tipo "2 de 3 — falta 1".
- Cada IMEI capturado se ve en una lista.

4. Ahora escribe **otra vez el segundo IMEI** (uno repetido) y presiona Enter.

→ **Debe pasar:** te avisa que ya lo capturaste, se marca en rojo y **no** lo agrega. El contador no sube.

5. Confirma la recepción con solo esos 2.

→ **Debe pasar:** te pregunta si estás seguro de recibir parcialmente, avisando que queda 1 pendiente.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.3 — Completar la recepción pendiente

1. Vuelve a la factura. La línea debe estar marcada con algo tipo "1 por recibir".
2. Ábrela.

→ **Debe pasar:** ves los 2 seriales ya capturados (sin poder editarlos) y puedes capturar el que falta.

3. Captura el tercero y confirma.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.4 — Intentar recibir de más

1. Intenta capturar un cuarto IMEI en esa misma línea (que era de 3).

→ **Debe pasar:** no te deja, o te rechaza con un mensaje claro. **Nunca** debe aceptar más unidades de las que decía la factura.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.5 — Ver las unidades en el inventario

1. Ve a Inventario y busca `PRUEBA-iPhone 13`.

→ **Debe pasar:** muestra "3 unidades" y al desplegarlo se ven los tres IMEI, cada uno con su estado (Disponible) y su costo.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.6 — Agregar una unidad a mano

1. Desde el inventario, agrega una unidad suelta a ese producto: un IMEI nuevo y un costo.

→ **Debe pasar:** queda como disponible y ahora son 4 unidades.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.7 — Buscar un equipo por su IMEI

1. Usa la búsqueda por serial y pega uno de los IMEI.

→ **Debe pasar:** lo encuentra y muestra su ficha: producto, estado, costo, de dónde entró.

2. Prueba con un IMEI inventado que no exista.

→ **Debe pasar:** te dice claramente que no lo encontró (no una pantalla en blanco ni un error feo).

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.8 — Vender escaneando el IMEI

1. Ve a Ventas. En la barra de escaneo, escribe uno de los IMEI y presiona Enter.

→ **Debe pasar:** ese equipo exacto cae al carrito, mostrando su IMEI en la línea.

2. Escribe **el mismo IMEI otra vez**.

→ **Debe pasar:** te avisa que ya está en el carrito y no lo duplica.

3. Fíjate en la línea del equipo en el carrito.

→ **Debe pasar:** **no** tiene los botones de + y − de cantidad (es un equipo único, no se venden "dos de ese IMEI").

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.9 — Vender eligiendo la unidad de una lista

1. Vacía el carrito. Ahora toca la tarjeta del producto `PRUEBA-iPhone 13` (sin escanear).

→ **Debe pasar:** se abre una lista con las unidades disponibles, con sus IMEI. Puedes buscar por parte del número. Eliges una y confirma cuál quedó.

2. Fíjate si la unidad que ya vendiste (o la que está en el carrito) aparece bloqueada o no seleccionable.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.10 — Venta mixta (equipo + accesorio)

1. Arma un carrito con: un equipo (por IMEI) y 2 cables `PRUEBA-Cable USB-C`.
2. Cóbralo.
3. Revisa el comprobante y el inventario.

→ **Debe pasar:** el comprobante muestra el IMEI del equipo. El cable bajó 2 de stock, y la unidad del equipo quedó como vendida.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.11 — Ingreso rápido: comprar y vender el mismo día

Esto simula lo que realmente hace la dueña: no tiene celulares en vitrina, los consigue cuando un cliente los pide.

1. En Ventas, escribe un IMEI **que no exista** en el sistema y presiona Enter.

→ **Debe pasar:** te ofrece algo tipo "Registrar y vender".

2. Úsalo: elige el producto (o crea uno nuevo ahí mismo), ponle el costo que "pagaste" hoy y el precio de venta.

→ **Debe pasar:** la unidad se crea y cae directo al carrito.

3. Cóbralo.
4. Busca ese IMEI en el inventario.

→ **Debe pasar:** aparece como vendido, con su costo registrado y una nota que dice que entró por ingreso rápido.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.12 — Devolver un equipo

1. Haz la devolución de uno de los equipos vendidos.
2. Búscalo por IMEI.

→ **Debe pasar:** vuelve a estar **Disponible** y se puede volver a vender.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.13 — La historia de un equipo

1. Abre la ficha del equipo que acabas de devolver.

→ **Debe pasar:** muestra una línea de tiempo completa: cuándo entró, cuándo se vendió (con la orden y el cliente), cuándo se devolvió.

2. Véndelo otra vez y vuelve a mirar la ficha.

→ **Debe pasar:** ahora aparece también la segunda venta. **Nada de la historia anterior se borró.**

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 2.14 — Los equipos de un cliente

1. Ve a la ficha del cliente al que le vendiste un equipo.
2. Busca la pestaña de **Equipos**.

→ **Debe pasar:** aparece el equipo con su IMEI, y puedes abrir su ficha desde ahí.

☐ Pasó ☐ Falló · Notas: ______________________________________________

---

## Bloque 3 — El taller de reparaciones

> Usuario: **Administrador** (después repetirás partes con Vendedor y Técnico) · Turno abierto.

Cómo funciona en la vida real: el cliente trae un celular dañado → se le hace un recibo → el técnico lo repara → se le avisa al cliente → **el cliente paga cuando lo recoge**.

### 3.1 — Recibir un equipo

1. En Reparaciones, usa "Recibir equipo".
2. Llena todo:
   - Cliente: créalo ahí mismo (`PRUEBA-Carlos Ruiz`, con un teléfono inventado).
   - Equipo: marca, modelo, IMEI.
   - Falla: "No carga aunque se conecte".
   - **Checklist**: marca al menos un **daño** (rayones, pantalla rota...) y una **verificación** (enciende, cámara ok...).
   - Accesorios: "Cargador y funda".
   - Contraseña del equipo: `1234`.

→ **Debe pasar:** los daños y las verificaciones se ven **distintos** (colores diferentes: los daños en ámbar/naranja, las verificaciones en verde). Debe quedar claro qué significa cada marca.

→ **Fíjate:** la contraseña debe estar marcada como dato confidencial.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.2 — El recibo que se le da al cliente ⭐

1. Imprime (o previsualiza) el comprobante de recepción.

→ **Debe pasar:**
- Aparecen: el equipo con su IMEI, la falla, los accesorios que dejó, y las dos listas del checklist **separadas y entendibles**.
- **LA CONTRASEÑA NO APARECE POR NINGUNA PARTE.** Esto es importante: ese papel se lo lleva el cliente.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.3 — Mover la orden entre estados

1. Pasa la orden de Recibido → En reparación.

→ **Debe pasar:** la tarjeta se mueve de columna.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.4 — Usar un repuesto del inventario

1. Crea un producto `PRUEBA-Pantalla iPhone` (categoría repuestos, por cantidad) con 5 de stock y costo $180.000.
2. En la orden de reparación, agrega ese repuesto desde el inventario, cantidad 1.
3. Ve al inventario y mira el stock.

→ **Debe pasar:** el stock bajó a 4, y en la orden aparece el costo del repuesto.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.5 — Quitar un repuesto (equivocación del técnico)

1. Quita ese repuesto de la orden.
2. Vuelve a mirar el stock.

→ **Debe pasar:** el stock **vuelve a 5**. El costo de la orden baja.

3. Vuelve a agregarlo (lo necesitamos para lo que sigue).

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.6 — Repuesto comprado aparte

1. Agrega un repuesto de compra externa: descripción "Flex de carga", costo $28.000.

→ **Debe pasar:** suma al costo de la orden pero **no toca ningún inventario** (porque se compró suelto en la calle).

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.7 — Dejarlo listo para entregar

1. Ponle precio a la reparación: $290.000.
2. Pasa la orden a **Listo**.
3. Mira la barra de arriba.

→ **Debe pasar:** aparece un contador/aviso de equipos listos para entregar, y sube en 1.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.8 — Cobrar y entregar

1. Usa "Cobrar y entregar".
2. Método: efectivo. El cliente te da $300.000.

→ **Debe pasar:** calcula las vueltas ($10.000). Se ve a qué turno se está imputando.

3. Confirma.

→ **Debe pasar:** la orden pasa a Entregado.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.9 — La reparación quedó como venta

1. Ve al historial de ventas.

→ **Debe pasar:** hay una venta nueva por $290.000, con una línea de "Servicio de reparación".

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.10 — ⭐⭐ LA PRUEBA MÁS IMPORTANTE DE TODO EL MANUAL ⭐⭐

**Que la plata de la reparación esté en el cuadre de caja.**

1. Cierra el turno.
2. Mira cuánto efectivo dice el sistema que debería haber.

→ **Debe pasar:** ese monto **incluye los $290.000** de la reparación que acabas de cobrar.

Haz la cuenta a mano: base inicial + ventas en efectivo + reparaciones cobradas en efectivo. Si el número del sistema no coincide, **es un error grave (🔴) y hay que avisar de inmediato**. Significaría que a la tienda le va a faltar plata en la caja todos los días sin que nadie sepa por qué.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.11 — El comprobante de entrega

1. Revisa el comprobante que se imprime al entregar.

→ **Debe pasar:** número de orden, equipo, precio cobrado, método de pago, vueltas.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.12 — Una reparación de garantía (gratis)

1. Recibe otro equipo, avánzalo hasta Listo, y ponle precio **$0**.
2. Entrégalo.

→ **Debe pasar:** te deja entregarlo sin pedir ningún pago.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 3.13 — El "Servicio de reparación" no debe estorbar

1. Ve a Ventas y busca "servicio" o "reparación" en el buscador de productos.
2. Ve a Inventario y busca lo mismo.
3. Mira las alertas de stock bajo / productos agotados.

→ **Debe pasar:** el producto "Servicio de reparación" **no aparece en ninguno de los tres lados**. Solo debe verse en el historial de ventas.

☐ Pasó ☐ Falló · Notas: ______________________________________________

---

## Bloque 4 — Comisiones por crédito

> Usuario: **Administrador** · Turno abierto.

Cómo funciona: la tienda gestiona créditos de una financiera. Por cada crédito entran $100.000 de comisión, que se reparten mitad para el local y mitad para el trabajador que lo hizo. A fin de quincena se suma y se le paga.

### 4.1 — Registrar una comisión en efectivo

1. Registra una comisión: trabajador (elige al Vendedor), monto $100.000, método **efectivo**.

→ **Debe pasar:** queda registrada, con el reparto de $50.000 y $50.000 visible.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 4.2 — ⭐ Que esa plata entre a la caja

1. Ve a cerrar el turno (sin cerrarlo todavía) y mira el efectivo esperado.

→ **Debe pasar:** los $100.000 de la comisión están sumados, y se ven en una **sección aparte** (algo como "Comisiones de crédito"), separada de las ventas.

Esto también es plata real en el cajón. Si no aparece, es 🔴.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 4.3 — Una comisión que llega por consignación

1. Registra otra comisión, esta vez método **consignación**.
2. Mira otra vez el efectivo esperado del turno.

→ **Debe pasar:** el efectivo esperado **NO cambió**. Esa plata fue a la cuenta bancaria, no al cajón.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 4.4 — Anular una comisión (turno abierto)

1. Anula la comisión en efectivo del punto 4.1.

→ **Debe pasar:**
- El efectivo esperado del turno baja $100.000.
- La comisión **no desaparece de la lista**: queda marcada como anulada, con su fecha.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 4.5 — El reporte de la quincena

1. Registra 3 comisiones más para el mismo trabajador.
2. Abre el reporte quincenal.

→ **Debe pasar:** muestra cuántos créditos hizo y cuánto se le debe pagar. **Las anuladas no deben estar sumadas.**

Haz la cuenta a mano y compárala.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 4.6 — Intentar anular algo de un turno ya cerrado

1. Cierra el turno actual.
2. Intenta anular una comisión en efectivo de ese turno ya cerrado.

→ **Debe pasar:** **no te deja**, y te explica qué hacer en cambio (algo como: registra la correcta y haz el ajuste por Gastos en el turno de hoy).

→ **Fíjate:** ¿el mensaje se entiende? ¿Sabrías qué hacer si fueras la dueña de la tienda? Si no, anótalo.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 4.7 — Corregir el trabajador después del cierre

1. En esa misma comisión del turno cerrado, cambia el trabajador (reasignar).

→ **Debe pasar:** sí te deja (es un error común y no mueve plata de la caja). Queda un rastro de que se reasignó.

2. Vuelve a mirar el turno cerrado.

→ **Debe pasar:** el cuadre de ese turno **no cambió**.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 4.8 — Lo que ve el trabajador

1. Sal y entra con el usuario **Vendedor**.
2. Busca las comisiones.

→ **Debe pasar:** ve **solo las suyas** (las que tiene asignadas), en modo lectura: no puede registrar, anular ni editar. **Nunca** debe ver las comisiones de otro trabajador.

☐ Pasó ☐ Falló · Notas: ______________________________________________

---

## Bloque 5 — Permisos: cada quien lo suyo

Entra con cada usuario y marca lo que **puede** hacer. Lo importante es que las casillas marcadas coincidan exactamente con esta tabla.

| Acción | Administrador | Vendedor | Técnico |
|---|---|---|---|
| Vender en el POS | ✅ | ✅ | ❌ |
| Ver el tablero del taller | ✅ | ✅ | ✅ |
| Recibir un equipo en el taller | ✅ | ✅ | ✅ |
| **Ver el costo de los repuestos** | ✅ | ❌ | ✅ |
| Ver el precio a cobrar de una reparación lista | ✅ | ✅ | ✅ |
| **Cobrar la entrega de una reparación** | ✅ | ✅ | ❌ |
| Ver el costo de las unidades (IMEI) en inventario | ✅ | ❌ | — |
| Registrar unidades / ingreso rápido | ✅ | ❌ | — |
| Registrar comisiones | ✅ | ❌ | ❌ |
| Ver comisiones de otros | ✅ | ❌ | ❌ |

**Prueba clave 5.1 — El técnico no cobra:** con el usuario Técnico, intenta cobrar la entrega de una reparación lista.
→ **Debe pasar:** o no le aparece el botón, o lo rechaza con un mensaje claro.

☐ Pasó ☐ Falló · Notas: ______________________________________________

**Prueba clave 5.2 — El vendedor no ve costos:** con el usuario Vendedor, abre una orden de reparación con repuestos.
→ **Debe pasar:** no ve cuánto costaron los repuestos. Sí puede ver el precio a cobrar cuando la orden está en Listo.

☐ Pasó ☐ Falló · Notas: ______________________________________________

**Prueba clave 5.3 — Los costos de inventario:** con el usuario Vendedor, mira la lista de unidades de un producto.
→ **Debe pasar:** ve los IMEI y su estado, pero **no** los costos.

☐ Pasó ☐ Falló · Notas: ______________________________________________

---

## Bloque 6 — Pruebas rudas (romper el sistema a propósito)

Aquí la idea es hacer lo que una persona apurada haría un viernes a las 7 de la noche.

### 6.1 — Vender sin turno abierto

1. Asegúrate de que **no hay ningún turno abierto**.
2. Intenta hacer una venta.

→ **Debe pasar:** no te deja, y te dice que abras turno.

3. Intenta cobrar la entrega de una reparación.

→ **Debe pasar:** tampoco te deja, con el mismo tipo de mensaje.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 6.2 — ⭐ Dos cajas vendiendo el mismo equipo

Esta prueba necesita **dos ventanas del navegador** (una normal y una de incógnito, o dos navegadores distintos).

1. En ambas ventanas, entra al sistema (puede ser el mismo usuario).
2. En **las dos** agrega al carrito **el mismo equipo, el mismo IMEI**.
3. Cobra en la ventana A. → Debe funcionar.
4. Ahora cobra en la ventana B.

→ **Debe pasar:**
- La venta B **falla**, y te dice **cuál equipo** se perdió (nombre e IMEI), no un error genérico.
- El carrito **sigue ahí y editable**, con esa línea marcada.
- Puedes quitar esa línea y cobrar el resto.

5. Revisa el historial de ventas y el inventario.

→ **Debe pasar:** hay **una sola** venta de ese equipo. No dos.

Si el mismo IMEI se vendió dos veces, es 🔴 y hay que avisar de inmediato.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 6.3 — Un turno, varias personas

1. Con el **Administrador**, abre el turno.
2. Sal y entra con el **Vendedor** (sin cerrar el turno).
3. Haz una venta con el Vendedor.

→ **Debe pasar:** vende sin problema, bajo el turno que abrió el Administrador. **No** debe pedirle abrir su propio turno.

(El turno es de la tienda, no de la persona.)

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 6.4 — Doble clic y botón atrás

1. En cualquier formulario de guardar (una venta, una orden de reparación), haz **doble clic rápido** en el botón de confirmar.

→ **Debe pasar:** se crea **una sola** cosa, no dos.

2. Después de guardar algo, dale al **botón atrás** del navegador y mira si se puede volver a enviar.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 6.5 — Recargar a mitad de camino

1. Arma un carrito con varias cosas y **recarga la página** (F5) antes de cobrar.

→ **Debe pasar:** o el carrito se mantiene, o se pierde limpiamente. Lo que **no** debe pasar es que quede algo a medias (una venta creada sin cobrar, un equipo marcado como vendido sin venta).

2. Si algo quedó raro, revisa el inventario y el historial de ventas y anota exactamente qué encontraste.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 6.6 — Datos absurdos

Prueba en los formularios que se te ocurran:

- Dejar campos obligatorios vacíos → debe avisarte, no romperse.
- Un nombre de producto larguísimo (300 letras) → no debe descuadrar la pantalla.
- Precio en 0, o negativo, o con muchos decimales.
- Un IMEI con letras y espacios.
- Textos con tildes, ñ y emojis 🙂 → deben guardarse bien y verse bien después.
- Una fecha del año 1900 o del 2099.

☐ Pasó ☐ Falló · Notas: ______________________________________________

### 6.7 — En el celular

1. Abre el sistema desde un teléfono.

→ **Fíjate:** ¿se puede usar? ¿los botones se alcanzan? ¿se lee bien? ¿el tablero del taller se puede navegar?

No hace falta que sea perfecto, pero anota qué tan usable es. La dueña probablemente lo va a abrir desde el celular alguna vez.

☐ Pasó ☐ Falló · Notas: ______________________________________________

---

## Al terminar todo

Antes de entregar tu reporte, responde estas preguntas. Valen tanto como los errores:

1. **¿Qué parte te pareció más confusa?** (aunque funcionara bien)
2. **¿Hubo algún momento en que no supiste qué hacer o dónde hacer clic?**
3. **¿Algún mensaje de error que no se entienda?** Cópialo tal cual.
4. **Si tuvieras que enseñarle esto a alguien en 10 minutos, ¿qué le costaría más entender?**
5. **¿Algo que se vea feo, descuadrado o inconsistente?**

---

## Resumen de bloques

| Bloque | Tema | ¿Terminado? | Errores encontrados |
|---|---|---|---|
| 0 | Prueba rápida | ☐ | ___ |
| 1 | Vender y cuadrar | ☐ | ___ |
| 2 | Equipos con IMEI | ☐ | ___ |
| 3 | Taller | ☐ | ___ |
| 4 | Comisiones | ☐ | ___ |
| 5 | Permisos | ☐ | ___ |
| 6 | Pruebas rudas | ☐ | ___ |

**Los tres casos que no pueden fallar** (si alguno falla, avisa de inmediato sin esperar a terminar):

- **3.10** — La plata de una reparación entra al cuadre de caja.
- **4.2** — La comisión en efectivo entra al cuadre de caja.
- **6.2** — El mismo IMEI no se puede vender dos veces.

---

*Usa la plantilla `QA-REPORTE.md` para anotar cada problema que encuentres.*
