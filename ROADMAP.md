# ROADMAP — G-Pulso (CelFashion)

Plan de trabajo desde la **reactivación del 2026-09-28** (el proyecto estuvo
pausado desde el 2026-07-28). El estado de cada punto es el **verificado ese
día** contra el repo y contra producción (lectura directa de la BD y del bundle
servido), no el de memoria o de docs anteriores.

Deudas numeradas (#2, #3…) = las de [`FORKED_FROM.md`](FORKED_FROM.md).

**Leyenda:** ✅ hecho · 🟡 parcial / mitigado · ⬜ pendiente · 🚧 en construcción · 🔍 en análisis · ❓ sin verificar

## Punto de partida verificado (2026-09-28)

- `develop` = `f06f5e0` (merge del rediseño de serializados), igual a
  `origin/develop`; ninguna rama sin mergear.
- Frontend en `g-pulso.vercel.app` = build exacto de `f06f5e0`.
- BD de prod: todas las migraciones del repo aplicadas (001–056 +
  `20260728_1630`), verificado por existencia de objetos y, para 053–056 y
  `20260728_1630`, también por contenido. Único objeto sin migración:
  `rls_auto_enable()` / event trigger `ensure_rls`, creado por la plataforma
  Supabase (RLS automático en tablas nuevas) — inofensivo.
- Organización **CelFashion**, **una sola tienda** (`CelFashion — Principal`).

---

## FASE 0 — REACTIVACIÓN

| | Punto | Estado verificado |
|---|---|---|
| ✅ | **Reset de la organización** | Hecho el 2026-09-28. Backup previo `gpulso_20260928_1907_pre-reset-reactivacion.dump` (630KB, SHA-256 `c242974d0dc4…`, en `backups/REGISTRO.md`). 773 filas transaccionales + catálogo + 1 proveedor de prueba. Se conservaron org, tienda, config, roles, 4 perfiles, `user_stores` y `auth`. El producto "Servicio de reparación" se recrea solo en la primera entrega (`ensure_repair_service_variant`). |
| ⬜ | **Roles parametrizables** (porteo desde G-Mura/G-Vento) | Hoy 4 roles fijos: Dueño (`*`), Administrador (22 permisos), Vendedor (7), Técnico (2: `reparaciones.*`, **sin `pos.usar`** por diseño de la 046). El enum legacy `user_role` solo tiene `admin` / `seller`: el Técnico queda con `role = 'seller'` en `profiles`. Resolver ambas cosas en el porteo. |
| ⬜ | **Usuarios reales de CelFashion; desactivar los QA** | Hoy hay 4 perfiles activos: el Dueño (login `alejogiiron@gmail.com`) y 3 QA (`qa.admin`, `qa.vendedor`, `qa.tecnico`). **La tienda operó julio–agosto con `qa.admin`**: crear las cuentas reales ANTES de desactivar los QA, o la tienda se queda sin acceso. |
| ⬜ | **Contraseñas: cambio propio + reset por admin** | No existe en la app. ❓ **Verificar primero si la Edge Function `create-user` está desplegada** en prod (no se ve desde la BD; revisar en Supabase → Edge Functions). |
| ⬜ | **Textos legales de los comprobantes del taller** | Placeholders `LEGAL_RECEPCION` y `LEGAL_GARANTIA` en `src/components/repairs/RepairReceipts.tsx` ("[Texto legal pendiente de definir.]"). Los define el cliente. |
| 🚧 | **Impresora PT-260 Label Maker: etiquetas (y recibos 58mm)** | En construcción en `feature/receipts-58mm` (sin mergear). La impresora es la versión de **etiquetas** (rollo de 40mm, driver TSC "TSC DA200"), no de recibos. **Etiquetas:** una por página del tamaño exacto (troquelado por defecto; continuo con margen de corte), 40×30 por defecto (40×40, 40×50, personalizado), nombre + precio grande + código CODE128 con barras en puntos enteros a 203 dpi (12 dígitos: 25,3mm en 36 útiles), marcas de borde en la prueba, botón Etiquetas también para productos de variante única (antes no se podían etiquetar). **Recibos 58mm:** hecho, para una futura impresora de recibos. **Pendiente: prueba física** (`docs/PRUEBA-IMPRESORA-58MM.md`): alto del rollo, sensor de gap, driver y lectura con el lector del mostrador. |
| ⬜ | **Manual de operación actualizado (inventario y taller)** | Existe `docs/QA-MANUAL.md` (v1.0, julio 2026, manual de *pruebas*), anterior al rediseño de serializados (plantilla + unidad, precio en unidad/sugerido, "Crear equipo y primera unidad"). |

## FASE 1 — INTEGRIDAD

| | Punto | Estado verificado |
|---|---|---|
| ⬜ | **Cierre administrativo de reparaciones** | A `entregado` solo se llega por `deliver_repair`: cobrando, o como "garantía" poniendo precio 0 (sin motivo, y se pierde el precio real). No existe cancelar (el enum `repair_status` no tiene ese estado). Falta: cancelar / "entregado sin cobro" **con motivo** y traza. |
| 🟡 | **Separados de serializados** (deuda #5) | Mitigado: el trigger de la `054` bloquea en servidor separar equipos con IMEI (verificado en prod). Falta cablear `reserve_unit` / `release_reserved_unit` / `complete_reserved_unit` en la UI y quitar el bloqueo. |
| 🟡 | **Atomicidad** (deuda #2): devoluciones, separados, fiado, turno; `createSimple` a RPC | Ventas: atómicas vía `create_order` (041). Lo demás sigue con varios INSERT desde el navegador + rollback compensatorio. `createSimple` (`useProductMutations`) inserta producto y variante por separado — **en prod apareció un producto huérfano sin variante** ("OWS-E10", 2026-07-30), evidencia concreta del hueco. |
| ⬜ | **Reset que muestre muestras de contenido, no solo conteos** | `reset-test-data.sql` solo imprime conteos. Lección de julio y de esta reactivación: el diagnóstico con contenido (nombres, teléfonos, fechas, fichas de taller) hubo que armarlo a mano. |
| ⬜ | **Registro de migraciones aplicadas en prod** | Prod no tiene `supabase_migrations.schema_migrations`: hoy qué está aplicado solo se sabe consultando los objetos uno a uno. |

## FASE 2 — CALIDAD

| | Punto | Estado verificado |
|---|---|---|
| ⬜ | **Sentry** (con filtrado de datos sensibles) | No integrado. Filtrar teléfonos, documentos, IMEI y claves de equipo antes de enviar. |
| ⬜ | **Tipado de Supabase** (deuda #3) | 140 `as unknown as` en `src/`; `database.types.ts` sigue hecho a mano. |
| ⬜ | **Imputación de turnos** (deuda #4) | `useShiftHistory` todavía no usa `calculateShiftSummary`; solo comparte `reconcileCash` / `shiftDifference` con `useShiftClosing`. |
| ⬜ | **Tests de UI automatizados** | Hay tests de lógica pura (Vitest) y scripts SQL de prueba; no hay tests de UI/E2E. |
| ⬜ | **Logo definitivo** | `src/components/layout/Logo.tsx` sigue siendo el placeholder (se cambia solo ese SVG). |

## TRANSVERSAL

| | Punto | Estado verificado |
|---|---|---|
| ⬜ | **Porteos a G-Mura**: `create_order`, migración de `is_active` (037), guardas del toolchain (`83d11ff`), lección del replay de la 006 | Tabla "Fixes porteados" de `FORKED_FROM.md` vacía: nada porteado todavía. |
| ⬜ | **Higiene: rotar la credencial de G-Mura** | La línea `GMURA_DB_URL` ya salió de `.env.backup` de G-Pulso, pero la contraseña estuvo en disco en este repo desde junio: rotarla en el proyecto de G-Mura. |
| ⬜ | **Higiene: sacar `backups/_ajenos-gmura/`** | Sigue ahí: `gmura-prod_20260728_1554_NO-ES-GPULSO.dump` (dump de OTRO cliente) + `LEEME.md`. Moverlo fuera de esta máquina/repo según corresponda. |
| ⬜ | **Higiene: quitar la regla de `run-ro`** cuando no se use | Regla `allow` de solo lectura a prod en el `settings.json` de usuario (`~/.claude/gpulso-prod-ro/run-ro.sh`), activa desde el 2026-09-28. |
| ⬜ | **Higiene: puertos del lab local** | `supabase/config.toml` de G-Pulso usa 5432x, los mismos del stack local de **G-Mura**: con ambos levantados, `.env.local` (127.0.0.1:54321) conecta la app de G-Pulso a la base de G-Mura. Hoy el lab corre en 5434x con una config fuera del repo (`~/.gpulso-lab`). Fijar un rango propio en el repo y actualizar `LAB.md` y `.env.local`. |
| ✅ | Higiene: `.claude/settings.local.json` fuera del repo | Hecho el 2026-09-28 (`git rm --cached` + `.gitignore`); no contenía secretos. |
