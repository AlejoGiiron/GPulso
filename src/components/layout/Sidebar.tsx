import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ShoppingCart,
  Store,
  History,
  Undo2,
  Package,
  Tag,
  Layers,
  Users,
  BarChart3,
  BarChart2,
  Wallet,
  Receipt,
  Settings,
  ChevronDown,
  LogOut,
  Bookmark,
  Truck,
  Building2,
  HandCoins,
  Wrench,
  CreditCard,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { useActiveLayawaysCount } from '@/hooks/useLayaways'
import { useReadyRepairsCount } from '@/hooks/useRepairs'
import { Logo } from './Logo'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  /** Permiso RBAC requerido para ver el ítem. Si se omite, es visible para
   *  cualquier usuario autenticado. */
  permission?: string
  end?: boolean
  Badge?: React.FC
}

function ActiveLayawaysBadge() {
  const { data: count = 0 } = useActiveLayawaysCount()
  if (count <= 0) return null
  return (
    <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-cyan-500 px-1.5 text-[10px] font-semibold text-white">
      {count > 99 ? '99+' : count}
    </span>
  )
}

// Equipos LISTOS esperando retiro (emerald = acción pendiente de cobro).
function ReadyRepairsBadge() {
  const { data: count = 0 } = useReadyRepairsCount()
  if (count <= 0) return null
  return (
    <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-white">
      {count > 99 ? '99+' : count}
    </span>
  )
}

interface NavGroup {
  id: string
  label: string
  icon: LucideIcon
  items: NavItem[]
}

// ── Configuración ─────────────────────────────────────────────────────────────
// La visibilidad de cada ítem la decide su `permission` vía can(). Un ítem sin
// permission es visible para cualquier usuario autenticado. Un grupo se muestra
// si tiene al menos un ítem visible (ver filterByPermission).

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'operacion',
    label: 'Operación',
    icon: ShoppingCart,
    items: [
      { label: 'Ventas', path: '/ventas', icon: Store, end: true, permission: 'pos.usar' },
      { label: 'Historial', path: '/ventas/historial', icon: History, permission: 'historial.ver' },
      {
        label: 'Separados',
        path: '/separados',
        icon: Bookmark,
        permission: 'separados.gestionar',
        Badge: ActiveLayawaysBadge,
      },
      { label: 'Devoluciones', path: '/devoluciones', icon: Undo2, permission: 'devoluciones.gestionar' },
    ],
  },
  {
    id: 'taller',
    label: 'Taller',
    icon: Wrench,
    items: [
      {
        label: 'Reparaciones',
        path: '/reparaciones',
        icon: Wrench,
        permission: 'reparaciones.gestionar',
        Badge: ReadyRepairsBadge,
      },
    ],
  },
  {
    id: 'inventario',
    label: 'Inventario',
    icon: Package,
    items: [
      { label: 'Productos', path: '/productos', icon: Tag, permission: 'productos.gestionar' },
      { label: 'Inventario', path: '/inventario', icon: Layers, permission: 'inventario.ver' },
    ],
  },
  {
    id: 'clientes',
    label: 'Clientes',
    icon: Users,
    items: [
      { label: 'Clientes', path: '/clientes', icon: Users, permission: 'clientes.gestionar' },
      { label: 'Cartera', path: '/cartera', icon: HandCoins, permission: 'pos.usar' },
    ],
  },
  {
    id: 'compras',
    label: 'Compras',
    icon: Truck,
    items: [
      { label: 'Proveedores', path: '/proveedores', icon: Building2, permission: 'compras.gestionar' },
    ],
  },
  {
    id: 'comisiones',
    label: 'Comisiones',
    icon: CreditCard,
    items: [
      // Sin `permission`: visible a cualquier usuario. Con comisiones.gestionar
      // ve todo y registra; un trabajador sin el permiso ve SOLO lo suyo (RLS +
      // la propia página acotan la vista).
      { label: 'Comisiones', path: '/comisiones', icon: CreditCard },
    ],
  },
  {
    id: 'admin',
    label: 'Análisis y admin',
    icon: BarChart3,
    items: [
      { label: 'Reportes', path: '/reportes', icon: BarChart2, permission: 'reportes.ver' },
      { label: 'Historial de caja', path: '/caja/historial', icon: Wallet, permission: 'reportes.ver' },
      { label: 'Historial de gastos', path: '/gastos/historial', icon: Receipt, permission: 'gastos.ver' },
      { label: 'Configuración', path: '/configuracion', icon: Settings, permission: 'config.gestionar' },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

type ExpandedState = Record<string, boolean>

function storageKey(userId: string): string {
  return `gpulso-sidebar-groups-${userId}`
}

function loadExpanded(userId: string): ExpandedState | null {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as ExpandedState
    return null
  } catch {
    return null
  }
}

function saveExpanded(userId: string, state: ExpandedState) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(state))
  } catch {
    // ignora errores de quota o privacidad
  }
}

function itemMatchesPath(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.path
  return pathname === item.path || pathname.startsWith(item.path + '/')
}

function groupContainsActive(group: NavGroup, pathname: string): boolean {
  return group.items.some((i) => itemMatchesPath(i, pathname))
}

function filterByPermission(
  groups: NavGroup[],
  can: (perm: string) => boolean,
): NavGroup[] {
  return groups
    .map((g) => ({
      // Un ítem se ve si no exige permiso, o si el usuario lo tiene.
      ...g,
      items: g.items.filter((i) => !i.permission || can(i.permission)),
    }))
    // Un grupo se ve solo si le quedó al menos un ítem visible.
    .filter((g) => g.items.length > 0)
}

// ── Subcomponente: CollapsibleGroup ──────────────────────────────────────────

interface CollapsibleGroupProps {
  group: NavGroup
  isExpanded: boolean
  onToggle: () => void
  pathname: string
}

function CollapsibleGroup({
  group,
  isExpanded,
  onToggle,
  pathname,
}: CollapsibleGroupProps) {
  const GroupIcon = group.icon
  const hasActiveHidden = !isExpanded && groupContainsActive(group, pathname)

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`sidebar-group-${group.id}`}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
      >
        <GroupIcon size={16} className="shrink-0" />
        <span className="flex-1 text-left">{group.label}</span>
        {hasActiveHidden && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-cyan-400"
            aria-label="Sección con ruta activa"
          />
        )}
        <ChevronDown
          size={14}
          className="shrink-0 transition-transform duration-200"
          style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        />
      </button>

      {/* Animación de colapso via grid-template-rows */}
      <div
        id={`sidebar-group-${group.id}`}
        style={{
          display: 'grid',
          gridTemplateRows: isExpanded ? '1fr' : '0fr',
          transition: 'grid-template-rows 200ms ease-out',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div className="ml-7 mt-0.5 flex flex-col gap-0.5">
            {group.items.map((item) => {
              const ItemIcon = item.icon
              const Badge = item.Badge
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-cyan-500/15 text-cyan-300'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                    }`
                  }
                >
                  <ItemIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {Badge && <Badge />}
                </NavLink>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sidebar principal ─────────────────────────────────────────────────────────

export default function Sidebar() {
  const { profile, signOut } = useAuth()
  const { can } = usePermissions()
  const location = useLocation()
  const userId = profile?.id ?? ''

  const visibleGroups = useMemo(
    () => filterByPermission(NAV_GROUPS, can),
    [can],
  )

  // Estado inicial: localStorage si existe; sino, expandir el grupo que
  // contiene la ruta actual al montar.
  const [expanded, setExpanded] = useState<ExpandedState>(() => {
    const stored = userId ? loadExpanded(userId) : null
    if (stored) return stored
    const initial: ExpandedState = {}
    for (const group of visibleGroups) {
      initial[group.id] = groupContainsActive(group, location.pathname)
    }
    return initial
  })

  // Persistir cambios
  useEffect(() => {
    if (!userId) return
    saveExpanded(userId, expanded)
  }, [userId, expanded])

  // Asegurar que grupos visibles nuevos (eg cambio de rol) tengan estado
  useEffect(() => {
    setExpanded((prev) => {
      let changed = false
      const next = { ...prev }
      for (const g of visibleGroups) {
        if (next[g.id] === undefined) {
          next[g.id] = groupContainsActive(g, location.pathname)
          changed = true
        }
      }
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleGroups])

  function toggleGroup(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <aside className="flex h-screen w-56 flex-shrink-0 flex-col bg-slate-900">
      {/* Wordmark */}
      <div className="flex items-center gap-3 px-5 py-6">
        <Logo size={32} className="flex-shrink-0" />
        <span className="text-[17px] font-semibold tracking-tight text-white">
          G-Pulso<span className="text-cyan-400">.</span>
        </span>
      </div>

      {/* Nav grupos */}
      <nav className="sidebar-scroll flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-2">
        {visibleGroups.map((group) => (
          <CollapsibleGroup
            key={group.id}
            group={group}
            isExpanded={!!expanded[group.id]}
            onToggle={() => toggleGroup(group.id)}
            pathname={location.pathname}
          />
        ))}
      </nav>

      {/* Sign out */}
      <div className="border-t border-slate-800 px-3 py-4">
        <button
          onClick={() => void signOut()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
        >
          <LogOut size={17} />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
