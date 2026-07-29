# Registro de backups — BD producción G-Pulso (`gpulso-prod`)

> Este archivo SÍ se versiona en el repo. Los archivos `.dump` NO (contienen
> datos reales del cliente). Cada fila se agrega automáticamente al correr
> `scripts/backup-db.sh`.

## Contexto

**CelFashion** está en producción desde el 2026-07-25. Se toma un backup antes
de cada fase que toque la base de datos y **obligatoriamente antes de cualquier
reset**.

- Cliente para dump: `pg_dump` (formato custom `-F c`, `--no-owner --no-acl`)
- Restauración: ver [scripts/BACKUP.md](../scripts/BACKUP.md)
- Los `.dump` viven en `backups/` (ignorado por git). Guárdalos también fuera
  de la máquina (almacenamiento cifrado) — son datos de cliente.

> 🔒 **Solo G-Pulso.** Este registro es del proyecto `gpulso-prod` (org
> `CelFashion`). Los dumps de G-Mura / La Bodega del Jeans **no van acá**: son
> de otro cliente y otro repo. El historial heredado del fork y el dump tomado
> por error se movieron a [`_ajenos-gmura/`](_ajenos-gmura/LEEME.md).
> Ver el incidente 2026-07-28 en [`FORKED_FROM.md`](../FORKED_FROM.md).

> ℹ️ Las filas anteriores al 2026-07-28 se reconstruyeron a partir de los
> archivos presentes en `backups/`: el registro heredado llevaba el historial de
> **G-Mura**, no el de G-Pulso, y estos backups nunca quedaron anotados. Sin
> checksum porque se calculó después del hecho; los nuevos sí lo traen.

## Historial

| Fecha | Etiqueta | Archivo | Tamaño | SHA-256 (12) |
|-------|----------|---------|--------|--------------|
<!-- El script agrega una fila aquí por cada backup. No editar manualmente las filas generadas. -->
| 2026-07-20 17:09 | `pre-fase2` | `gpulso_20260720_1709_pre-fase2.dump` | 435KB | `n/a` |
| 2026-07-21 09:21 | `pre-fase3` | `gpulso_20260721_0921_pre-fase3.dump` | 434KB | `n/a` |
| 2026-07-21 18:22 | `pre-fase4` | `gpulso_20260721_1822_pre-fase4.dump` | 474KB | `n/a` |
| 2026-07-22 18:35 | `pre-inventory-lock` | `gpulso_20260722_1835_pre-inventory-lock.dump` | 502KB | `n/a` |
| 2026-07-25 17:12 | `pre-reset-pruebas` | `gpulso_20260725_1712_pre-reset-pruebas.dump` | 510KB | `n/a` |
| 2026-07-28 16:13 | `gpulso-prod-verificado` | `gpulso_20260728_1612_gpulso-prod-verificado.dump` | 502KB | `c5521b0b39a5` |
| 2026-07-28 21:03 | `pre-repair-status-rpc` | `gpulso_20260728_2102_pre-repair-status-rpc.dump` | 505KB | `0021d3ea83ae` |
| 2026-07-28 21:11 | `pre-reset-arranque-cliente` | `gpulso_20260728_2111_pre-reset-arranque-cliente.dump` | 512KB | `74f1422a0996` |
