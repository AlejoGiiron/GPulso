import { useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { useReadyRepairsCount } from '@/hooks/useRepairs'

// Pill de la barra superior: equipos en estado 'listo' esperando retiro (Bloque
// B4). Solo se muestra cuando hay al menos uno.
export function RepairsReadyBell() {
  const navigate = useNavigate()
  const { data: count = 0 } = useReadyRepairsCount()
  if (count <= 0) return null
  return (
    <button
      onClick={() => navigate('/reparaciones')}
      title={`${count} equipo(s) listo(s) para entregar`}
      className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50/60 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-cyan-700 hover:bg-cyan-100"
    >
      <CheckCircle2 size={14} />
      <span>Listos para entregar</span>
      <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-cyan-600 px-1 text-[10px] font-bold text-white">
        {count > 99 ? '99+' : count}
      </span>
    </button>
  )
}
