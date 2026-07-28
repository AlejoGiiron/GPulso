---
description: Genera el scaffold completo de un módulo: página, hooks de datos y registro en el router.
argument-hint: <nombre-modulo>
---

Crea un módulo nuevo llamado **$ARGUMENTS** en el proyecto G-Pulso:

## 1. Página — `src/pages/{Nombre}Page.tsx`

Componente funcional en PascalCase con:
- Encabezado con nombre del módulo en español
- **Estado de carga:** skeleton con la forma aproximada del contenido,
  no un spinner genérico centrado
- **Estado vacío:** mensaje útil en español que oriente al usuario
- Sin comentarios genéricos

## 2. Hook de lectura — `src/hooks/use{Nombre}.ts`

Con React Query (`useQuery`) que:
- Llama al helper correspondiente de `src/lib/supabase-helpers.ts`
  (créalo si no existe)
- Devuelve `{ data, isLoading, error }`
- Tipado estrictamente con los tipos de `src/types/database.types.ts`
- Sin `any`

## 3. Hook de mutaciones — `src/hooks/use{Nombre}Mutations.ts`

> Sufijo `Mutations` en inglés — es la convención real del proyecto
> (`useRepairMutations`, `useConfigMutations`, `useCashShiftMutations`…).

Archivo separado con `useMutation` que exponga:
- `crear(data: TablesInsert<'nombre_tabla'>)` — inserta e invalida la query
- `actualizar(data: TablesUpdate<'nombre_tabla'> & { id: string })` — ídem
- `eliminar(id: string)` — elimina e invalida la query
- Cada mutación muestra `toast.error()` en `onError`
  y `toast.success()` en `onSuccess`

## 4. Router — `src/App.tsx`

Añade la ruta `/nombre-en-kebab-case` dentro del bloque
`<ProtectedRoute>` → `<AppLayout>` existente.

El acceso se controla por **permiso RBAC**, no por el enum de rol:
`<ProtectedRoute permission="modulo.gestionar">`. No existe `allowedRoles`.

## 5. Sidebar — `src/components/layout/Sidebar.tsx`

Agrega la entrada al grupo correspondiente de `NAV_GROUPS` (el sidebar está
agrupado en secciones colapsables: Operación / Inventario / Compras / Clientes /
Análisis y admin), con el ícono de lucide-react más apropiado y el label en
español.

La visibilidad la decide el campo `permission: 'modulo.gestionar'` vía `can()`.
Un ítem sin `permission` es visible para cualquier usuario autenticado. No uses
`adminOnly`.

## 6. Permiso nuevo (si el módulo lo necesita)

Si introduces un permiso que no existe, hay que darlo de alta en los tres
lugares — ver el procedimiento en `CLAUDE.md` § RBAC:
1. El array del rol en `canonical_role_permissions()` (migración 035).
2. Una migración de reconciliación **aditiva, SIN filtro de organización**
   (patrón 034/035). Nunca filtrar por `organizations.name = '...'`.
3. `src/lib/permissionsCatalog.ts` (catálogo de la UI).

## Convenciones obligatorias
- TypeScript strict — sin `any`
- Strings de UI en español (Colombia)
- Precios en COP con `Intl.NumberFormat('es-CO')`
- Errores de Supabase con `toast.error()` de react-hot-toast
- Queries de Supabase solo en hooks, nunca en componentes directamente
- Si el módulo toca variantes: siempre usar `variant_id`, nunca solo `product_id`