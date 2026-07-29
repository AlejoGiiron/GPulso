# Backups de la BD de producción — G-Pulso

Sistema de backups de la base de datos de producción (Supabase / PostgreSQL)
de **CelFashion** (proyecto `gpulso-prod`). Pensado para correr un backup
confiable **antes de cada fase que toque la BD** y antes de cualquier reset.

> ⚠️ **NUNCA** commitees `.env.backup` (tu credencial) ni los archivos `.dump`
> (datos reales del cliente). Ambos están en `.gitignore`. Si alguno aparece en
> `git status` como trackeado, detente y quítalo del índice.

> 🔒 **Este repo es G-Pulso. La variable es `GPULSO_DB_URL`.**
> No pongas acá la cadena de **G-Mura / La Bodega del Jeans**: es otro cliente,
> otro proyecto Supabase, otro repo. El 2026-07-28 este archivo documentaba
> `GMURA_DB_URL` y `.env.backup` apuntaba a la producción de G-Mura; un reset
> estuvo a un comando de borrar datos reales de ese cliente.
> `backup-db.sh` ahora **aborta** si encuentra `GMURA_DB_URL` y **verifica** que
> la base tenga los objetos propios de G-Pulso antes de respaldar.
> Ver [`FORKED_FROM.md`](../FORKED_FROM.md) § incidente 2026-07-28.

---

## 1. Configurar la credencial (`.env.backup`)

1. Copia la plantilla:
   ```bash
   cp .env.backup.example .env.backup
   ```

2. Saca la cadena de conexión de Supabase:
   **Dashboard → proyecto `gpulso-prod` → Settings → Database → Connection
   string → URI → modo `Session`** (no uses el modo `Transaction` para backups).

   Verifica que el `PROJECT_REF` sea el de **gpulso-prod**. Si te queda duda,
   la comprobación de una línea es:
   ```bash
   psql "$GPULSO_DB_URL" -tAc "SELECT string_agg(name, ', ') FROM organizations;"
   # gpulso-prod → CelFashion
   # G-Mura      → La Bodega del Jeans, …   ← BASE EQUIVOCADA, detente
   ```

3. Pega la cadena en `.env.backup` como valor de `GPULSO_DB_URL`:
   ```
   GPULSO_DB_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
   ```
   - Si tu contraseña tiene caracteres especiales (`@ : / ? #`), URL-encodéalos.
   - `.env.backup` queda solo en tu máquina; nunca se sube al repo.
   - **Preferible**: no dejarla en disco y exportarla solo para la sesión:
     ```bash
     export GPULSO_DB_URL="postgresql://…"
     ```

---

## 2. Requisitos

- `pg_dump` y `pg_restore` instalados y en el `PATH`.
- (Opcional pero recomendado) `psql`, para que el script verifique que la
  versión de tu `pg_dump` sea **>= la del servidor Supabase (15 o 16)**.

Verifica tu versión:
```bash
pg_dump --version
```

> El script **aborta o advierte** si `pg_dump` es más viejo que el servidor: un
> dump con cliente desactualizado puede salir **incompleto**. Instala la versión
> 16 de las client tools de PostgreSQL si hace falta.

---

## 3. Correr un backup

Pásale una **etiqueta de fase** como argumento:

```bash
./scripts/backup-db.sh pre-fase1
./scripts/backup-db.sh pre-multitenancy
```

El script:
- Genera `backups/gpulso_YYYYMMDD_HHMM_<etiqueta>.dump` (formato custom `-F c`).
- Verifica que el archivo exista, pese > 0 bytes y que `pg_restore --list`
  muestre tablas y funciones (si no, **borra el dump y falla**).
- Agrega una fila a `backups/REGISTRO.md` con fecha, etiqueta, archivo, tamaño
  y checksum.
- Imprime un resumen.

En Windows usa **Git Bash** o **WSL** para ejecutar el `.sh`.
Si hace falta, dale permisos: `chmod +x scripts/backup-db.sh`.

---

## 4. Restaurar un backup

> ⚠️ `--clean --if-exists` **borra y recrea** los objetos en la BD destino.
> Asegúrate de apuntar a la base correcta (idealmente una de staging/pruebas
> primero, no producción a ciegas).

```bash
pg_restore --clean --if-exists --no-owner --no-acl \
  -d "postgresql://postgres.PROJECT_REF:PASSWORD@HOST:5432/postgres" \
  backups/gpulso_YYYYMMDD_HHMM_<etiqueta>.dump
```

- `--clean --if-exists`: elimina objetos previos sin error si no existen.
- `--no-owner --no-acl`: no intenta restaurar dueños/permisos de prod (portable).
- Puedes inspeccionar el contenido sin restaurar:
  ```bash
  pg_restore --list backups/gpulso_YYYYMMDD_HHMM_<etiqueta>.dump
  ```

---

## 5. Reglas de seguridad

- **NUNCA** subas `.dump` ni `.env.backup` al repositorio. Tienen credenciales
  y datos personales de clientes.
- Guarda los `.dump` también fuera de la máquina, en almacenamiento cifrado.
- `backups/REGISTRO.md` SÍ se commitea (no contiene datos sensibles, solo
  metadatos: fecha, etiqueta, nombre de archivo, tamaño, checksum).
