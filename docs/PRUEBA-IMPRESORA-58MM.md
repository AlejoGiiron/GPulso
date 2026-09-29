# Prueba de la impresora térmica 58mm (Goojprt PT-260)

Guion corto para validar los comprobantes a 58mm **antes de mergear**
`feature/receipts-58mm`. Se prueba contra el **lab**, no contra producción.

## 0. Preparación (una vez)

**Lab.** Corre en los puertos **5434x**: el stack local de G-Mura ocupa los
5432x que usa `supabase/config.toml`. Si se usaran esos, la app de G-Pulso se
conectaría a la base de G-Mura. La configuración con los puertos alternos vive
**fuera del repo**, en `C:\Users\Alejandro\.gpulso-lab\supabase\config.toml`.

| Qué | Dónde |
|---|---|
| App contra el lab | `pnpm dev --mode lab` → http://localhost:5173 (lee `.env.lab.local`, ignorado por git) |
| Usuario | `qa.admin@celfashion.co` · contraseña de **lab**: `lab58mm` |
| Studio del lab | http://127.0.0.1:54343 (`lab-restore.sh` imprime 54323: ignóralo) |
| Levantar el lab si está apagado | `supabase start --workdir C:/Users/Alejandro/.gpulso-lab` |
| Apagarlo | `supabase stop --project-id gpulso` |

**Datos de ejemplo** (`scripts/lab-seed-recibos.sql`, ya aplicado):
- Ancho de recibo **58mm**.
- Turno abierto hoy.
- Cliente de nombre largo: *María Fernanda Castaño Villalobos*.
- **Venta #66**: mixta (efectivo + transferencia) con un equipo con IMEI.
- **Separado #1**: un abono mixto y un abono histórico.
- Un egreso con motivo largo.
- **Reparación #33**: lista, con IMEI y checklist.

**Volver al estado inicial** (después de probar devoluciones o entregas):

```bash
./scripts/lab-restore.sh backups/gpulso_20260928_1907_pre-reset-reactivacion.dump
MSYS_NO_PATHCONV=1 docker exec -i supabase_db_gpulso \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/lab-seed-recibos.sql
```

**Impresora (Windows, USB).**
1. Instala el driver de la PT-260 (suele venir como "POS-58").
2. En el diálogo de impresión de Chrome, en **Más opciones**, configura:
   - **Tamaño del papel:** el rollo de 58mm del driver.
   - **Márgenes:** Ninguno.
   - **Escala:** Predeterminada (100%).
   - **Encabezados y pies de página:** desmarcado.

> El navegador ignora el tamaño de hoja que pide la app (`size: 58mm auto`
> no es válido para Chrome; ya pasaba igual con 80mm). **El ancho real lo pone
> el papel que elijas en el diálogo.** Si ahí queda "Carta", sale todo corrido
> a la izquierda.

## 1. Página de prueba (calibración)

Ve a **Configuración → Recibos**, elige **58 mm**, guarda y pulsa **Imprimir página de prueba**.

| Verificar | Esperado | Si falla |
|---|---|---|
| Recuadro "◀ 48 mm ▶" | Se ven las dos flechas y los cuatro bordes | Anota qué lado se corta y cuántos mm |
| Regla de números | Anota el último número completo | Sirve para saber cuántos caracteres caben (en pantalla: unos 30) |
| Renglón largo | "$1.207.000" baja al renglón siguiente, a la derecha | — |
| IMEI | Grande y en una sola línea | — |
| Texto legal | Legible y negro (no gris) | — |

Si se corta un lado, el ajuste se hace en un solo lugar: `src/lib/receiptLayout.ts`
(`LAYOUTS[58].paddingXMm` / `printableMm`). Un corte de unos 5mm a la derecha
significa que el driver trata la hoja como de 48mm: bajar `paddingXMm` a 0 lo
corrige.

## 2. Comprobantes

| # | Comprobante | Cómo imprimirlo en el lab |
|---|---|---|
| 1 | Venta | **Historial** → hoy → fila **#66** → *Reimprimir ticket*. Opcional: una venta nueva en **Ventas** |
| 2 | Separado | **Separados** → **#1** → *Imprimir* |
| 3 | Cuadre | Arriba, **Cerrar turno** → contado → *Imprimir y cerrar*. Cierra el turno del lab; para seguir, abre otro. También: **Historial de caja** → reimprimir |
| 4 | Taller: recepción | **Taller → Recibir equipo** → cliente *María Fernanda* → marca, modelo e **IMEI de 15 dígitos** → marca daños y verificaciones → *Recibir* → *Imprimir* |
| 5 | Taller: entrega | **Taller** → **#33** → *Entregar y cobrar* → *Cobrar y entregar* → *Imprimir entrega* |
| 6 | Devolución | **Devoluciones** → buscar `66` → ítems con **+** → *Devolución* → *Efectivo* → *Ver resumen* → *Confirmar* → *Imprimir* |

Revisa en cada uno:
- El encabezado dice **CelFashion**, no "G-MURA".
- No se corta ningún borde.
- No hay texto gris ni débil.
- Las líneas largas bajan al renglón siguiente en vez de pisarse.
- En el cuadre, cada abono o egreso ocupa dos renglones (hora arriba, método y monto abajo).
- En el taller, el IMEI sale grande y en su propio renglón.
- La devolución imprime **solo** el comprobante, no la pantalla.

## 3. Anotar

| Comprobante | ¿Legible? | ¿Algo cortado? | Observaciones |
|---|---|---|---|
| Página de prueba | | | |
| Venta | | | |
| Separado | | | |
| Cuadre | | | |
| Taller: recepción | | | |
| Taller: entrega | | | |
| Devolución | | | |

## Fuera de esta prueba

- **Etiquetas de código de barras:** dependen del papel (rollo de recibo o
  etiqueta adhesiva con separación).
- **Bluetooth / celular:** esta guía asume Windows por USB con driver. Imprimir
  desde un celular es otro camino (servicio de impresión o ESC/POS directo).
