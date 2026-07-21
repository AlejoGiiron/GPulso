import { useEffect, useState } from 'react'
import { Clock, Wallet, Receipt } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { useCurrentShift } from '@/hooks/useCashShift'
import {
  OpenShiftModal,
  CloseShiftModal,
  ExpenseModal,
} from './CashShiftModals'
import { LayawayNotifications } from './LayawayNotifications'
import { SupplierNotifications } from './SupplierNotifications'
import { RepairsReadyBell } from './RepairsReadyBell'
import { StoreSwitcher } from './StoreSwitcher'

function getBogoTime(): string {
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(new Date())
}

function formatShiftTime(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Bogota',
  }).format(new Date(iso))
}

export default function Header() {
  const { profile } = useAuth()
  const { can } = usePermissions()
  const { data: shift, isLoading: loadingShift } = useCurrentShift()
  const [time, setTime] = useState(getBogoTime)
  const [showOpen, setShowOpen] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [showExpense, setShowExpense] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setTime(getBogoTime()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Etiqueta del rol RBAC del usuario (nombre del rol asignado).
  const roleLabel = profile?.rbac_role?.name ?? 'Usuario'
  const initial = profile?.full_name?.charAt(0).toUpperCase() ?? '?'
  // Campanas: separados (quien gestiona separados) y proveedores (compras).
  const showLayawayBell = can('separados.gestionar')

  return (
    <>
      <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-cyan-100 text-sm font-semibold text-cyan-700">
            {initial}
          </div>
          <div>
            <div className="text-sm font-medium text-gray-900">
              {profile?.full_name ?? '—'}
            </div>
            <div className="text-xs text-gray-500">{roleLabel}</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Clock size={13} />
            <span className="tabular-nums">{time}</span>
          </div>

          {showLayawayBell && (
            <>
              <span className="h-5 w-px bg-gray-200" />
              <LayawayNotifications />
            </>
          )}

          {can('compras.gestionar') && <SupplierNotifications />}

          {can('reparaciones.gestionar') && <RepairsReadyBell />}

          <span className="h-5 w-px bg-gray-200" />

          <StoreSwitcher />

          <span className="h-5 w-px bg-gray-200" />

          {loadingShift ? (
            <div className="h-7 w-28 animate-pulse rounded-lg bg-gray-100" />
          ) : shift ? (
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-700">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_0_3px_#16a34a25]" />
                Turno abierto · {formatShiftTime(shift.opened_at)}
              </div>
              <button
                onClick={() => setShowExpense(true)}
                className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-stone-50"
              >
                <Receipt size={12} />
                Gasto
              </button>
              <button
                onClick={() => setShowClose(true)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Cerrar turno
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:bg-cyan-700"
            >
              <Wallet size={12} />
              Abrir turno
            </button>
          )}
        </div>
      </header>

      {showOpen && <OpenShiftModal onClose={() => setShowOpen(false)} />}
      {showClose && shift && (
        <CloseShiftModal shift={shift} onClose={() => setShowClose(false)} />
      )}
      {showExpense && shift && (
        <ExpenseModal onClose={() => setShowExpense(false)} />
      )}
    </>
  )
}
