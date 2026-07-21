/**
 * Catálogo de permisos RBAC para la UI (fuente única de verdad).
 *
 * Agrupa los permisos por módulo con etiquetas legibles para un dueño no
 * técnico. Lo consume el editor de roles (checkboxes) y cualquier vista que
 * necesite mostrar permisos de forma amigable.
 *
 * El comodín '*' del rol Dueño NO está en el catálogo: es especial (acceso
 * total) y el rol Dueño es inmutable, no se edita con checkboxes.
 */

export interface PermissionDef {
  key: string
  label: string
}

export interface PermissionGroup {
  label: string
  permissions: PermissionDef[]
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: 'Ventas',
    permissions: [
      { key: 'pos.usar', label: 'Vender (usar el POS)' },
      { key: 'ventas.anular', label: 'Anular ventas' },
      { key: 'ventas.regalo', label: 'Marcar ítems sin cargo' },
      { key: 'ventas.fiar', label: 'Vender a crédito (fiar)' },
      { key: 'historial.ver', label: 'Ver historial de ventas' },
    ],
  },
  {
    label: 'Separados',
    permissions: [
      { key: 'separados.gestionar', label: 'Crear y gestionar separados' },
      { key: 'separados.eliminar', label: 'Eliminar separados' },
    ],
  },
  {
    label: 'Devoluciones',
    permissions: [
      { key: 'devoluciones.gestionar', label: 'Gestionar devoluciones y cambios' },
    ],
  },
  {
    label: 'Clientes',
    permissions: [
      { key: 'clientes.gestionar', label: 'Crear y editar clientes' },
      { key: 'clientes.eliminar', label: 'Eliminar clientes' },
    ],
  },
  {
    label: 'Inventario',
    permissions: [
      { key: 'inventario.ver', label: 'Ver inventario' },
      { key: 'inventario.gestionar', label: 'Ajustar stock manualmente' },
    ],
  },
  {
    label: 'Productos',
    permissions: [
      { key: 'productos.gestionar', label: 'Gestionar productos y categorías' },
    ],
  },
  {
    label: 'Compras',
    permissions: [{ key: 'compras.gestionar', label: 'Proveedores y compras' }],
  },
  {
    label: 'Reportes',
    permissions: [
      { key: 'reportes.ver', label: 'Ver reportes e historial de caja' },
      { key: 'gastos.ver', label: 'Ver historial de gastos' },
    ],
  },
  {
    label: 'Caja',
    permissions: [{ key: 'gastos.gestionar', label: 'Registrar gastos de caja' }],
  },
  {
    label: 'Reparaciones',
    permissions: [
      { key: 'reparaciones.gestionar', label: 'Gestionar reparaciones (taller)' },
      { key: 'reparaciones.ver_costos', label: 'Ver costos de repuestos' },
    ],
  },
  {
    label: 'Administración',
    permissions: [
      { key: 'config.gestionar', label: 'Configuración de la tienda' },
      { key: 'usuarios.gestionar', label: 'Gestionar usuarios' },
      { key: 'roles.gestionar', label: 'Gestionar roles y permisos' },
    ],
  },
]

/**
 * Lista canónica de los permisos conocidos (los que usan las migraciones
 * 021/023/024 en el RLS). El catálogo de arriba debe cubrirla EXACTAMENTE.
 * NO incluye el comodín '*'.
 */
export const ALL_PERMISSIONS = [
  'pos.usar',
  'ventas.anular',
  'ventas.regalo',
  'ventas.fiar',
  'historial.ver',
  'separados.gestionar',
  'separados.eliminar',
  'devoluciones.gestionar',
  'clientes.gestionar',
  'clientes.eliminar',
  'inventario.ver',
  'inventario.gestionar',
  'productos.gestionar',
  'compras.gestionar',
  'reportes.ver',
  'gastos.ver',
  'gastos.gestionar',
  'config.gestionar',
  'usuarios.gestionar',
  'roles.gestionar',
  'reparaciones.gestionar',
  'reparaciones.ver_costos',
] as const

/** Keys del catálogo, aplanadas en orden de grupo. */
export const CATALOG_KEYS: string[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key),
)
