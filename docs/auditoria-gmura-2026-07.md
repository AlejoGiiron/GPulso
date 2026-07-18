# Auditoría amplia de G-Mura — julio 2026

**Fecha:** 2026-07-16 · **Rama auditada:** `develop` (HEAD `c77213e`) · **Tipo:** solo lectura, mapa priorizado — no se modificó código.

**Método:** recorrido completo del repo — las 36 migraciones (RLS, triggers, constraints, vistas), los 45 hooks, la lib financiera pura y sus tests, los componentes grandes (POSPage, ReturnsPage, NewLayawayModal, ReportsPage), las 2 Edge Functions, los scripts de operación y la configuración del proyecto. Se corrió el gate completo: **262/262 tests en verde** y `tsc --noEmit` limpio.

**Dimensiones:** (1) calidad y mantenibilidad · (2) seguridad y datos · (3) oportunidades de producto.

---

## Top 5 — lo que yo atacaría primero

Cruce de severidad × esfuerzo. El orden es mi recomendación de ataque, no solo la severidad.

| # | Hallazgo | Dimensión | Severidad | Esfuerzo |
|---|----------|-----------|-----------|----------|
| 1 | [`is_active` de usuarios no se aplica en el servidor](#s1) — desactivar un usuario es cosmético | Seguridad | 🔴 | Chico |
| 2 | [Escrituras financieras no atómicas](#s2) — ventas/devoluciones/separados son multi-paso desde el navegador con rollback best-effort | Seguridad/datos | 🔴 | Grande (incremental) |
| 3 | [El tipado de Supabase es decorativo](#c1) — ~300 `as never` + ~120 `as unknown as` anulan al compilador en toda la capa de datos | Calidad | 🔴 | Medio |
| 4 | [Imputación de turnos duplicada](#c2) en `useShiftClosing` y `useShiftHistory` — cada regla financiera nueva se escribe dos veces | Calidad | 🟠 | Medio |
| 5 | [Reporte de margen/utilidad bruta](#p1) — `cost_price` ya se captura y se actualiza con cada compra, pero no se explota en ningún reporte | Producto | 🔴 (valor) | Chico–medio |

El #1 es el quick win de seguridad más claro del proyecto: impacto alto, arreglo de una migración corta. El #2 es el riesgo estructural más grande, pero se ataca por etapas (empezar por `useCreateOrder`). El #3 es el multiplicador: sin él, todo refactor futuro (incluidos #2 y #4) se hace sin red.

---

## Dimensión 1 — Calidad y mantenibilidad

### <a id="c1"></a>1.1 · El tipado de Supabase está anulado en la práctica 🔴

**Qué es.** El cliente se crea tipado (`createClient<Database>`), pero `database.types.ts` (738 líneas) está escrito **a mano** y su forma no encaja con lo que infiere supabase-js v2. Resultado: cada llamada lo esquiva — hay ~300 `as never` en argumentos de `.eq()/.in()/.update()` y ~120 `as unknown as X` en resultados. Los archivos financieros son los peores: `useShiftHistory` (49), `useShiftClosing` (41), `useSalesHistory` (36).

**Impacto.** TypeScript strict no protege nada en la capa de datos: un typo en un nombre de columna, una columna renombrada en una migración o un shape que cambió compilan sin error y explotan en runtime (o peor: devuelven `undefined` silencioso en un cálculo de plata). El esfuerzo de disciplina que el proyecto pone en "no usar `any`" se pierde justo donde más importa.

**Esfuerzo.** Medio. `supabase gen types typescript` genera el tipo real; después se eliminan casts por archivo, de forma incremental (los hooks financieros primero). No requiere tocar lógica.

### <a id="c2"></a>1.2 · La imputación híbrida de turnos vive duplicada 🟠

**Qué es.** `useShiftClosing` (373 líneas) y `useShiftHistory` (376 líneas) implementan **dos veces** la misma lógica no trivial: imputar ventas/abonos/gastos a un turno por `shift_id` (post-026) con fallback legacy por `opened_by` + ventana de tiempo, excluir órdenes de conversión de separados, sumar la porción efectivo desde `order_payments`, abonos de fiados, etc. La calc pura (`shiftCalc.ts`) está bien extraída y testeada, pero el **ensamblaje de datos** — qué filas entran y a qué turno se imputan — está copiado.

**Impacto.** Es lógica financiera: si una regla cambia en un hook y no en el otro, el "Esperado" del historial deja de coincidir con el recibo del cierre, y ese tipo de divergencia es exactamente lo que originó la fuga de caja que ya costó semanas rastrear. El propio historial del proyecto lo confirma: cada feature de caja (026, 029, 032) tuvo que tocar ambos archivos en espejo.

**Esfuerzo.** Medio. Extraer el fetch + imputación a un módulo compartido (mismo patrón que ya se usó con `shiftCalc`), o subir la agregación a una vista SQL. Los 22 tests de `shiftCalc` protegen el refactor.

### 1.3 · Componentes gigantes con lógica adentro 🟠

**Qué es.** `POSPage.tsx` tiene **2.237 líneas con 13 componentes internos** (PaymentModal, CreditCheckoutModal, TicketModal, QuickCreateModal, CustomerSearchInput, CartPanel…). `ReturnsPage.tsx`: 1.809 líneas y 16 componentes. Les siguen `NewLayawayModal` (1.525), `ReportsPage` (1.483), `InventoryPage` (1.137), `CustomersPage` (1.004). Además hay triplicación real: existe un `VariantPickerModal` en POSPage, **otro** en ReturnsPage y un `VariantPicker` en NewLayawayModal (la lógica pura compartida sí existe en `lib/variantPicker.ts`, pero la UI está copiada tres veces).

**Impacto.** Todo cambio al flujo de pago o de devoluciones implica navegar un archivo de 2.000 líneas; los modales internos no son testeables ni reusables, y un fix al picker de variantes hay que repetirlo en tres lugares (con riesgo de que diverjan, como ya pasó con los turnos).

**Esfuerzo.** Medio (mecánico, por etapas): extraer los modales de POSPage a `components/pos/`, los steps de ReturnsPage a `components/returns/`, y unificar el picker de variantes en un componente.

### 1.4 · Lógica de negocio en componentes, fuera del alcance de los tests 🟠

**Qué es.** La disciplina de "lógica pura en `src/lib` con tests" es de lo mejor del proyecto (17 archivos, 262 tests), pero quedaron funciones con reglas de negocio dentro de páginas: `suggestCashAmounts` (POSPage:259 — sugerencias de billetes/redondeos, toca dinero), `pivotDailySales` (ReportsPage:142 — pivoteo del reporte diario), `exchangeSummary` (ReturnsPage:82). Y ninguno de los hooks de agregación financiera (`useShiftClosing`, `useShiftHistory`, `useSalesHistory`) tiene tests del ensamblaje de queries — solo la calc pura downstream.

**Impacto.** Las funciones en componentes no se pueden testear sin montar la página; el ensamblaje de los hooks es justo donde viven los bugs de imputación (el flake de caja histórico no estaba en la calc, estaba en qué filas entraban).

**Esfuerzo.** Chico para mover las funciones a `lib/` con tests; medio si se quiere cubrir el ensamblaje de hooks (requiere mocks de Supabase o refactor previo del punto 1.2).

### 1.5 · Convenciones documentadas que el código ya no cumple 🟢

**Qué es.** Tres desalineaciones entre CLAUDE.md y la realidad:
- **Zod** se declara como el stack de validación, pero se usa en 2 archivos (LoginPage, CustomersPage); todo lo demás valida a mano (consistentemente, eso sí).
- **Realtime**: hay una convención de naming de canales documentada, pero no existe **ni un solo** `supabase.channel()` en el código.
- **Queries solo en hooks**: `NewInvoiceModal` (3 queries inline de búsqueda) y `ProductsSection` violan la regla propia.

**Impacto.** Bajo en runtime, pero las convenciones que mienten erosionan la confianza en el resto del documento y confunden a cualquier sesión/persona nueva. Decidir: o Zod y Realtime se adoptan de verdad, o se quitan de las convenciones.

**Esfuerzo.** Chico (es una decisión + edición de docs; mover las queries de NewInvoiceModal a un hook es una hora).

### 1.6 · CLAUDE.md desactualizado y con secciones duplicadas 🟢

**Qué es.** El CLAUDE.md raíz tiene **dos** secciones "Estado actual del proyecto" que se contradicen (una dice "Última fase: 07 — Configuración", la otra describe el presente), una línea de título duplicada ("Hotfix feedback v2 — anti-duplicados…" aparece dos veces seguidas), y lista como "Siguiente: Addi recargo… descuento por ítem" cosas que ya existen (migraciones 018/019, `ExpenseHistoryPage`). `src/CLAUDE.md` está aún más viejo: su árbol de carpetas no menciona layaways, suppliers, credit ni cash. Es el costo del formato append-only: ~500 líneas de changelog que ya duplican al historial de git.

**Impacto.** El contexto que se le da a cada sesión de trabajo contiene información falsa; el changelog gigante diluye las convenciones (que son lo valioso).

**Esfuerzo.** Chico. Compactar el historial a un resumen de módulos + estado real, y dejar el detalle en git log (que ya lo tiene).

### 1.7 · Deudas menores conocidas y orden del repo 🟢

- **Flake de `daysUntilExpiry`** (conocido): usa `Date.now()` directo (layawayCalc.ts:65) — no inyectable y calcula instantes, no días civiles de Bogotá, a diferencia del modelo de `dateRange.ts`. Arreglo chico.
- **Raíz del repo con archivos sin decidir**: `FEATURES-CATALOG.md`, `INVENTORY-SPEC.md`, `gmura-mejoras.html`, `gmura-plan-consolidacion.md`, `plan/`, `_design/` nuevos, `scripts/reset-store-data.sql` — todos untracked. Decidir qué se commitea, qué se ignora y qué se borra.
- ~11 `console.log/error` — casi todos en paths de rollback, uso apropiado. Sin hallazgo.

### ✅ Lo que está bien (y hay que decirlo)

- **Cero `any`, cero `@ts-ignore`, cero TODOs/hacks** en 39k líneas. Lint con `--max-warnings 0`. Es rarísimo ver eso.
- La **separación lib pura / hooks / componentes** para lo financiero es un patrón maduro y sostenido (shiftCalc, returnCalc, layawayCalc, creditCalc, orderPayments, salesHistoryCash — todos testeados, con casos de borde de zona horaria incluidos).
- Los **patrones de mutations** (validación de inputs → auth → INSERT → rollback compensatorio → invalidación amplia → toast) son consistentes en todos los hooks.
- El patrón de **recibos de impresión** está unificado (`receiptPrint.ts`) tras el refactor de calidad.
- El manejo de errores con toast es uniforme; no hay rutas de error silenciosas visibles.

---

## Dimensión 2 — Seguridad y datos

### <a id="s1"></a>2.1 · `is_active` de usuarios no se aplica en el servidor 🔴

**Qué es.** "Desactivar" un usuario (`UsersSection` → `toggleUserActive`) solo escribe `profiles.is_active = false`. Nada del lado del servidor lo consulta: ni `has_permission()` (021), ni `get_my_store_id()` (013), ni el login (`AuthContext` no lo chequea), ni la Edge Function `create-user` sobre el **llamante**. Tampoco se banea el usuario en `auth.users`.

**Impacto.** Un empleado desvinculado con la app abierta (o que vuelve a loguearse con su misma clave — el login sigue funcionando) conserva acceso **completo**: pasa el RLS, pasa los permisos, puede vender, ver clientes y, si era admin, tocar configuración. En un POS con rotación de personal esto es el hueco más explotable del sistema. Es la misma clase de problema que el blindaje de turnos ya cerró: la UI promete algo que el servidor no garantiza.

**Esfuerzo.** Chico. Una migración que agregue `AND p.is_active` a `has_permission()` y `get_my_store_id()` (con eso el RLS entero queda cerrado), + chequeo de `is_active` en el login para el mensaje amable, + idealmente `auth.admin.updateUserById(..., { ban_duration })` al desactivar (requiere pasar el toggle por una Edge Function).

### <a id="s2"></a>2.2 · Las escrituras financieras no son atómicas 🔴

**Qué es.** Ninguna operación de dinero es una transacción: crear una venta son 3 INSERTs secuenciales desde el navegador (orders → order_payments → order_items), con función de rollback compensatorio si un paso falla. Lo mismo devoluciones (returns → return_items → orden de cambio → cash_expense), separados, fiados y facturas de compra. Solo existen 4 RPCs y ninguno es transaccional de escritura de negocio. Los rollbacks están bien hechos **cuando el error llega como respuesta** — pero si el navegador se cierra, la pestaña se recarga o se cae la red *entre* pasos, queda una orden sin ítems o una devolución sin detalle, y nadie lo detecta.

**Impacto.** Órdenes huérfanas entran al cuadre y a los reportes con total > 0 pero sin ítems (o al revés, según el paso que faltó). Es una fuente estructural de "la caja no cuadra y nadie sabe por qué" — la clase de bug que más ha dolido en este proyecto. El riesgo crece con más tiendas y más cajeros en redes móviles.

**Esfuerzo.** Grande, pero perfectamente incremental: una función Postgres `create_order(...)` transaccional (RPC) primero — es el flujo más frecuente —, después devoluciones, después separados. Cada paso elimina una familia entera de estados imposibles. Alternativa intermedia de bajo costo: un chequeo/reporte de huérfanas (orden sin items) para al menos detectarlas.

### 2.3 · Dos sistemas de permisos conviven y se sincronizan a mano 🟠

**Qué es.** El RBAC (roles + `has_permission`, migraciones 020-025) es el sistema "bueno", pero el enum legacy `profiles.role` ('admin'/'seller') sigue **gateando cosas reales**: `switch_active_store()` decide multi-tienda con `IF v_role = 'admin'` (013), las rutas protegidas usan `allowedRoles=['admin']`, y la Edge Function `create-user` mantiene los dos sincronizados derivando `legacyRole` a mano ("para no dejar profiles.role stale").

**Impacto.** Fragilidad clásica de doble fuente de verdad: un rol personalizado RBAC con `usuarios.gestionar` pero cuyo `profiles.role` quedó 'seller' **no puede cambiar de tienda** aunque tenga accesos en `user_stores`; y cualquier flujo nuevo tiene que acordarse de actualizar ambos. El día que se olvide, el bug será confuso de diagnosticar (permisos dicen sí, enum dice no).

**Esfuerzo.** Medio. Migrar los 3-4 puntos que aún leen el enum a `has_permission()`/`user_stores`, y dejar `profiles.role` como columna informativa deprecada (o eliminarla con calma).

### 2.4 · Falta el CHECK de coherencia aritmética en `orders` 🟠

**Qué es.** `layaways` tiene constraint de coherencia (`total = subtotal - discount`, migración 010), pero `orders` no relaciona `subtotal/discount/surcharge/total` — solo no-negatividad por columna; la propia migración 018 lo reconoce en un comentario. Tampoco hay garantía en BD de que `sum(order_payments.amount) = orders.total` (se valida solo client-side en `orderPayments.ts`, que está testeado, pero es el navegador confiando en sí mismo).

**Impacto.** El esquema permite estados imposibles en la tabla más importante del sistema: una orden que declara total $100.000 con pagos por $60.000 se inserta sin protestar. Combinado con 2.2 (multi-paso no atómico), es la segunda mitad del mismo riesgo. La experiencia del proyecto (el CHECK de turnos de la 036 con `NOT VALID`) ya mostró el molde correcto para agregar constraints sin romper datos históricos.

**Esfuerzo.** Chico para el CHECK de coherencia de `orders` (mismo patrón 010/036, `NOT VALID`). Medio para la igualdad pagos=total (necesita trigger diferido, y decidir el tratamiento de fiados/abonos parciales).

### 2.5 · Políticas de Storage no versionadas 🟠

**Qué es.** Los buckets (`product-images`, logos, QR de pagos) solo existen como comentario en la migración 002; ninguna migración crea buckets ni define sus políticas de acceso. Todo se configuró a mano en el dashboard.

**Impacto.** Dos riesgos: (a) no hay forma de saber *desde el repo* si los buckets son públicos o con qué políticas — no se puede auditar ni reproducir; (b) una org/entorno nuevo (el hueco 6B, el lab) nace sin storage o con configuración divergente. Si `product-images` es público (lo usual para imágenes de producto) el riesgo real es bajo, pero el QR de pagos y los logos merecen revisión consciente.

**Esfuerzo.** Chico. Una migración con `insert into storage.buckets` + políticas de `storage.objects` (por prefijo `storeId/`), documentando lo que hoy existe.

### 2.6 · Deudas ya conocidas (se documentan, sin gastar pólvora) 🟢

- **Migraciones 023/027/029 con hardcode de org** ('La Bodega del Jeans'): patrón prohibido ya identificado; el molde correcto (034/035 + `seed_org_roles`) existe. Pendiente solo para orgs futuras — el flujo 6B lo resolverá.
- **Hueco 6B** (crear org desde la app): hoy una org nueva se crea con `create-lab-org.sql` a mano.
- Migraciones 011/012: CLAUDE.md aún dice "pendientes de aplicar" — verificar si esa nota está vieja (los módulos que dependen de ellas están en producción).

### ✅ Lo que está bien en seguridad (es bastante)

- **RLS habilitado en las 25 tablas**, sin excepciones. El aislamiento multi-tenant (`store_id = get_my_store_id()` encadenado a org) se mantiene intacto en todas las políticas.
- La **matriz de permisos de la 024** es de calidad profesional: permisos por operación, razonamiento documentado de cada decisión (triggers SECURITY DEFINER, tablas hijas sin UPDATE/DELETE), y checklist de verificación manual por rol.
- **Todas las vistas** (003, 009, 012, 029, 033) tienen `security_invoker = true` — el bypass clásico de RLS por vistas está cerrado en el 100%.
- La **Edge Function `create-user` está bien blindada**: verifica token del llamante, permiso `usuarios.gestionar`, coherencia de organización (rol↔tienda↔llamante), y solo un Dueño puede asignar rol Dueño. Rollback completo en fallos.
- **Higiene de secretos limpia**: `.env*` fuera de git, ejemplos sin valores, backups con credenciales excluidos explícitamente y con registro (`backups/REGISTRO.md`).
- Los hooks **no confían en el RLS a solas**: filtran por `store_id` además (defensa en profundidad declarada y aplicada).
- El **CHECK de turnos (036)** con `NOT VALID` y las 3 capas de blindaje de pagos son el patrón correcto y reciente.

---

## Dimensión 3 — Oportunidades de producto

### <a id="p1"></a>3.1 · Reporte de margen / utilidad bruta 🔴 (valor alto, ya casi gratis)

**Qué es.** El sistema ya captura todo lo necesario: `variants.cost_price` con CHECK, actualización automática del costo en cada compra (`update_cost`), y el precio real de venta por ítem (`order_items.unit_price` + `list_price` del descuento por ítem). Hoy el costo solo aparece como una columna en el Excel de inventario — **no existe ningún reporte de utilidad**.

**Impacto.** Para el dueño de una tienda de ropa, "¿cuánto gané?" es LA pregunta — más que cuánto vendió. Margen por período, por producto, por categoría y por marca saldría de un JOIN que ya es posible. Es la mejora de mayor valor/costo de toda la auditoría.

**Esfuerzo.** Chico–medio. Una vista SQL (con `security_invoker`, molde de la 003) + una sección en ReportsPage. Matiz a resolver: el costo histórico al momento de la venta no se snapshotea en `order_items` (solo el actual en variants) — vale la pena agregar `cost_price` al INSERT de order_items de ahora en adelante, como ya se hace con `list_price`.

### 3.2 · Facturación electrónica DIAN 🟠 (estratégica)

**Qué es.** No hay ninguna mención a DIAN en el código. En Colombia la facturación electrónica es obligatoria para la mayoría de comercios formales; hoy G-Mura emite tickets térmicos no fiscales.

**Impacto.** Es probablemente la línea que separa "sistema interno de la tienda" de "POS vendible a terceros". Sin ella, todo cliente formal necesita un sistema paralelo para facturar. Con el modelo de datos actual (orders + items + customer con `document_id` ya capturado) la base está.

**Esfuerzo.** Grande, pero no se construye desde cero: se integra un proveedor tecnológico autorizado (Factus, Siigo, Alegra, etc.) vía API. Decisión de roadmap más que técnica: depende de si G-Mura aspira a multi-cliente (la infraestructura multi-org sugiere que sí).

### 3.3 · Resiliencia offline 🟠

**Qué es.** No hay PWA, ni service worker, ni cola de operaciones: sin internet, la tienda no puede vender. Para un POS es el gap operativo clásico (los competidores del rubro lo resuelven con modo offline + sincronización).

**Impacto.** Cada caída de red = tienda parada y ventas anotadas en papel (que después alguien "cuadra" a mano — exactamente lo que el sistema vino a eliminar). La arquitectura actual (escrituras multi-paso directas a Supabase, ver 2.2) hace esto más difícil; si algún día se ataca, conviene **después** de mover las ventas a RPC (una operación atómica es encolable; tres pasos no).

**Esfuerzo.** Grande. Registrarlo como decisión de roadmap, no como tarea.

### 3.4 · Alertas proactivas de stock bajo y flujo de reposición 🟠

**Qué es.** `min_stock` existe por variante, `inventory_status` calcula estados (out/low/ok) y la UI los pinta — pero solo si alguien entra a Inventario a mirar. Ya existen **dos campanas** de notificación en el Header (separados por vencer, facturas por vencer); no hay una de stock.

**Impacto.** En ropa, quedarse sin la talla que rota es venta perdida silenciosa. Una campana de "X variantes bajo mínimo" + un listado "sugerencia de reposición" (cruzando ventas de los últimos 30 días con stock disponible — datos que ya existen) cierra el ciclo compra→venta→reposición que el módulo de proveedores dejó a un paso.

**Esfuerzo.** Chico para la campana (patrón ya triplicado); medio para la sugerencia de reposición.

### 3.5 · CRM subusado: los datos de clientes no trabajan 🟠

**Qué es.** Los clientes se registran y tienen historial completo (compras, devoluciones, separados, fiados), pero el CRM no hace nada con eso: no hay cumpleaños (el campo ni existe), ni segmentación (frecuentes/inactivos/VIP), ni exportación para campañas de WhatsApp — el canal de marketing de facto del retail colombiano.

**Impacto.** La retención es el multiplicador barato del retail de ropa. Con lo capturado ya se puede: "clientes que no compran hace 60 días", "top 20 por gasto", "compradores de X marca". Un campo `birthday` + 3 segmentos calculados + botón "exportar teléfonos" es un módulo de fidelización mínimo viable.

**Esfuerzo.** Chico–medio (los datos ya están; es una vista + una pestaña).

### 3.6 · Operación multi-tienda incompleta: traslados de stock 🟠

**Qué es.** La infraestructura multi-tienda existe (user_stores, switcher, RLS por tienda activa), pero **no hay traslados de inventario entre tiendas**: no existe flujo, ni tipo de movimiento (el enum es `sale/return/adjustment/purchase`). Hoy un traslado serían dos ajustes manuales descoordinados, sin trazabilidad ni estado "en tránsito".

**Impacto.** "Pásame esa talla de la otra tienda" es operación diaria en cadenas de ropa. Con dos ajustes manuales, el stock queda bien solo si nadie se equivoca, y no queda registro de qué se movió ni quién lo pidió.

**Esfuerzo.** Medio. Tipo de movimiento `transfer` + tabla de traslados con estados + UI simple. Encaja con los patrones existentes.

### 3.7 · Reportes por vendedor 🟢

**Qué es.** `orders.created_by` existe en cada venta, pero ningún reporte agrega por vendedor: no hay ranking, ni ventas por cajero por período, ni base para comisiones (práctica común en ropa).

**Esfuerzo.** Chico (los datos están; es una vista + una tabla en ReportsPage). **Impacto** medio: gestión de equipo y, si el negocio paga comisiones, hoy las calcula a mano.

### 3.8 · Conteo físico de inventario (stocktake) 🟢

**Qué es.** Existen ajustes manuales uno a uno (con motivo "Ajuste por conteo"), pero no un flujo de conteo físico: escanear/contar todo, comparar contra el sistema y aplicar diferencias en lote con un reporte de merma.

**Impacto.** En ropa la merma es real (robo, cambios mal registrados) y el conteo periódico es la única forma de verla. Hoy hacer inventario físico con G-Mura es variante por variante. **Esfuerzo** medio.

### 3.9 · Menores 🟢

- **Ticket por WhatsApp**: hoy solo impresión térmica; un botón "enviar por WhatsApp" (link `wa.me` con el texto del ticket) es barato y muy del contexto colombiano.
- **Stock stale entre cajas**: sin Realtime, dos terminales de la misma tienda ven stock desactualizado hasta la siguiente invalidación de React Query. Con una caja por tienda no duele; si crece, Realtime en variantes del POS es el primer candidato (y la convención de canales ya está escrita, ver 1.5).
- **Hueco 6B** (crear org desde la app): ya identificado; es lo que convierte la infraestructura multi-org en un producto onboardeable.

---

## Salud general del proyecto

**El proyecto está sano, y en varias cosas sorprendentemente bien.** Para un POS de ~39k líneas construido a ritmo de features semanales, el estado es muy superior al típico: cero `any`, cero TODOs abandonados, gate completo (typecheck + lint estricto + 262 tests) en verde, y una disciplina — poco común incluso en equipos grandes — de extraer la lógica financiera a funciones puras testeadas, con casos de borde de zona horaria incluidos. La capa de seguridad de base de datos es el punto más alto: RLS en el 100% de las tablas, todas las vistas con `security_invoker`, una matriz de permisos (024) con el razonamiento documentado decisión por decisión, y migraciones que se leen como documentos de diseño. La trayectoria también es buena: los problemas encontrados en producción (fuga de caja, turnos) se cerraron con capas servidor + CHECK, no con parches de UI.

**Lo que está por debajo del resto son dos cosas, y las dos son estructurales, no cosméticas.** Primero, la brecha entre lo que la UI promete y lo que el servidor garantiza en dos puntos concretos: `is_active` (un desactivado conserva acceso) y la aritmética de órdenes (el esquema acepta totales incoherentes). Segundo — y es el riesgo estructural más grande —, **todas las operaciones de dinero son secuencias de escrituras no atómicas ejecutadas desde el navegador**. Los rollbacks compensatorios están bien escritos, pero cubren solo los fallos que llegan como respuesta; un cierre de pestaña entre pasos deja datos huérfanos que entran al cuadre. El proyecto ya pagó caro una vez el costo de "el cuadre no explica la realidad"; esta es la misma categoría de riesgo, latente. La buena noticia es que la solución (RPCs transaccionales) es incremental y el terreno está preparado: la validación ya está centralizada en hooks y la lógica pura ya está aislada.

**El tercer eje, menos urgente pero acumulativo, es la fricción de mantenimiento**: el tipado de Supabase anulado por ~400 casts, la imputación de turnos duplicada en dos hooks de 370 líneas, y páginas de 2.000 líneas con modales adentro. Nada de eso rompe hoy; todo eso encarece cada semana de desarrollo futuro y multiplica la probabilidad del próximo bug financiero. En producto, la paradoja es favorable: G-Mura captura más datos de los que muestra — el costo de cada prenda, el historial completo de cada cliente, el vendedor de cada venta — y las oportunidades de mayor retorno (margen, reposición, fidelización) son en su mayoría *vistas nuevas sobre datos que ya existen*, no módulos nuevos. La única decisión de producto realmente grande en el horizonte es DIAN, y es la que define si G-Mura es el sistema de una tienda o un producto.

---

*Auditoría generada el 2026-07-16 sobre `develop` @ `c77213e`. Solo lectura: ningún archivo de código fue modificado.*
