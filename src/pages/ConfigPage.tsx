import { useState } from 'react'
import {
  Store,
  Building2,
  Users,
  ShieldCheck,
  Tag,
  CreditCard,
  Bookmark,
  Printer,
  type LucideIcon,
} from 'lucide-react'
import StoreSection from '@/components/config/StoreSection'
import StoresSection from '@/components/config/StoresSection'
import UsersSection from '@/components/config/UsersSection'
import RolesSection from '@/components/config/RolesSection'
import ProductsSection from '@/components/config/ProductsSection'
import CajaSection from '@/components/config/CajaSection'
import SeparadosSection from '@/components/config/SeparadosSection'
import EtiquetasSection from '@/components/config/EtiquetasSection'
import CategoriesManager from '@/components/config/CategoriesManager'
import { usePermissions } from '@/hooks/usePermissions'

type SectionId =
  | 'tienda'
  | 'sucursales'
  | 'usuarios'
  | 'roles'
  | 'productos'
  | 'caja'
  | 'separados'
  | 'etiquetas'

const SECTIONS: {
  id: SectionId
  label: string
  Icon: LucideIcon
  /** Permiso extra para ver la sub-sección (la ruta ya exige config.gestionar). */
  permission?: string
}[] = [
  { id: 'tienda', label: 'Tienda', Icon: Store },
  { id: 'sucursales', label: 'Sucursales', Icon: Building2 },
  { id: 'usuarios', label: 'Usuarios', Icon: Users, permission: 'usuarios.gestionar' },
  { id: 'roles', label: 'Roles', Icon: ShieldCheck, permission: 'roles.gestionar' },
  { id: 'productos', label: 'Productos', Icon: Tag },
  { id: 'caja', label: 'Caja', Icon: CreditCard },
  { id: 'separados', label: 'Separados', Icon: Bookmark },
  { id: 'etiquetas', label: 'Etiquetas', Icon: Printer },
]

export default function ConfigPage() {
  const { can } = usePermissions()
  const [active, setActive] = useState<SectionId>('tienda')
  const visibleSections = SECTIONS.filter((s) => !s.permission || can(s.permission))

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left nav ───────────────────────────────────────────────────────── */}
      <nav className="w-56 shrink-0 overflow-y-auto border-r border-[#ebe9e6] bg-white p-3">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.06em] text-[#94a3b8]">
          Configuración
        </p>
        {visibleSections.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActive(id)}
            className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
              active === id
                ? 'bg-cyan-500 text-white'
                : 'text-[#525252] hover:bg-slate-50 hover:text-[#1a1a1a]'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}

        <p className="mb-2 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[.06em] text-[#94a3b8]">
          Catálogo
        </p>
        <div className="rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-3 py-2">
          <p className="text-xs text-[#737373]">Categorías gestionadas en Productos → Configuración</p>
        </div>
      </nav>

      {/* ── Right content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-[#f8f7f5]">
        {/* Page header */}
        <div className="border-b border-[#ebe9e6] bg-white px-6 py-4">
          <h1
            className="text-[20px] font-semibold tracking-[-0.025em] text-[#1a1a1a]"
            style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
          >
            {SECTIONS.find((s) => s.id === active)?.label ?? 'Configuración'}
          </h1>
          <p className="mt-0.5 text-sm text-[#737373]">
            {active === 'tienda' && 'Nombre, logo y datos de contacto de la tienda'}
            {active === 'sucursales' && 'Crea y administra las sucursales de tu negocio'}
            {active === 'usuarios' && 'Gestiona el equipo y sus permisos de acceso'}
            {active === 'roles' && 'Crea roles y define qué puede hacer cada uno'}
            {active === 'productos' && 'Tallas, colores, marcas y límite de devoluciones'}
            {active === 'caja' && 'Métodos de pago, motivos de ajuste y QR para pagos'}
            {active === 'separados' && 'Condiciones del separado que se imprimen en el recibo'}
            {active === 'etiquetas' && 'Formato y campos para etiquetas de precio'}
          </p>
        </div>

        <div className="p-6">
          {active === 'tienda' && <StoreSection />}
          {active === 'sucursales' && <StoresSection />}
          {active === 'usuarios' && can('usuarios.gestionar') && (
            <div className="space-y-6">
              <UsersSection />
            </div>
          )}
          {active === 'roles' && can('roles.gestionar') && <RolesSection />}
          {active === 'productos' && (
            <div className="space-y-6">
              <ProductsSection />
              <CategoriesManager />
            </div>
          )}
          {active === 'caja' && <CajaSection />}
          {active === 'separados' && <SeparadosSection />}
          {active === 'etiquetas' && <EtiquetasSection />}
        </div>
      </div>
    </div>
  )
}
