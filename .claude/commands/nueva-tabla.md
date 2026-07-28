---
description: Genera el SQL, los tipos TypeScript y los helpers de Supabase para una nueva tabla.
argument-hint: <nombre_tabla> [descripcion-breve]
---

Añade la tabla **$ARGUMENTS** al proyecto G-Pulso generando los tres artefactos:

## 1. SQL — `supabase/migrations/`

Crea un nuevo archivo de migración con número secuencial (ej. `002_nombre.sql`):
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` (si es tabla mutable)
- Columnas específicas según el contexto del argumento
- Constraints CHECK donde corresponda (valores no negativos, etc.)
- `CREATE INDEX` sobre `store_id` y cualquier FK adicional
- RLS habilitado con políticas coherentes con el schema:
  · Aislamiento de datos: `store_id = get_my_store_id()` (devuelve la tienda
    ACTIVA del usuario — modelo multi-store, ver migración 013/015).
  · Autorización: por **permiso RBAC** con `has_permission('modulo.gestionar')`,
    NO por el enum `profiles.role`. El enum ('admin' | 'seller') es legacy y ni
    siquiera cubre al Técnico; la verdad la da `profiles.role_id` → `roles`.
  · Si la tabla es sensible (dinero, inventario), considera **RPC-only**: sin
    políticas INSERT/UPDATE y una función `SECURITY DEFINER` como única vía,
    para que las validaciones (turno abierto, tienda) no se puedan saltar.
    Patrón en la migración 048 (`register_credit_commission`).
- Trigger `updated_at` usando la función `set_updated_at()` ya existente

## 2. Tipos TypeScript — `src/types/database.types.ts`

Añade la entrada en `Database['public']['Tables']` con:
- `Row` — todos los campos con tipos exactos
- `Insert` — campos requeridos vs opcionales (`?`) correctamente marcados
- `Update` — todos los campos opcionales (`?`)
- `Relationships` — referencias FK con `foreignKeyName`, `columns`,
  `referencedRelation`, `referencedColumns`

## 3. Helpers — `src/lib/supabase-helpers.ts`

Añade las funciones CRUD básicas tipadas:
- `get{Tabla}s(storeId: string)` — lista todos los registros de la tienda
- `upsert{Tabla}(data)` — insert o update
- `delete{Tabla}(id: string)` — soft delete si hay `is_active`, hard delete si no

Todas las funciones devuelven `{ data, error }` de Supabase sin try/catch —
el manejo de errores es responsabilidad del hook que las llama.

## Al terminar

Resume las columnas añadidas, las políticas RLS y las funciones helper creadas.