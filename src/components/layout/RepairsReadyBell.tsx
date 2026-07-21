import { useNavigate } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { useReadyRepairsCount } from '@/hooks/useRepairs'

// Badge de la barra superior: equipos en estado 'listo' esperando retiro.
// Solo se muestra cuando hay al menos uno (Bloque B4).
export function RepairsReadyBell() {
  const navigate = useNavigate()
  const { data: count = 0 } = useReadyRepairsCount()
  if (count <= 0) return null
  return (
    <button
      onClick={() => navigate('/reparaciones')}
      title={`${count} equipo(s) listo(s) para entregar`}
      className="relative flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
    >
      <Wrench size={13} />
      <span>{count > 99 ? '99+' : count} listo{count === 1 ? '' : 's'}</span>
    </button>
  )
}
