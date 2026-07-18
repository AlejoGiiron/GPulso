import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Clock, X } from 'lucide-react'
import { fmtCOP } from '@/lib/formatters'
import { useExpiringLayaways } from '@/hooks/useReports'

const URGENT_DAYS = 3

function fmtExpiresShort(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/**
 * Campana de notificaciones del header. Muestra separados activos que vencen
 * en los próximos 3 días con badge rojo + dropdown navegable.
 */
export function LayawayNotifications() {
  const navigate = useNavigate()
  const { data: expiring = [] } = useExpiringLayaways()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const urgent = useMemo(
    () => expiring.filter((l) => l.days_until_expiry <= URGENT_DAYS),
    [expiring],
  )
  const count = urgent.length

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notificaciones${count > 0 ? ` (${count} separados por vencer)` : ''}`}
        className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
          count > 0
            ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
            : 'border-stone-200 bg-white text-gray-500 hover:bg-stone-50'
        }`}
      >
        <Bell size={14} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[340px] overflow-hidden rounded-xl border border-[#ebe9e6] bg-white shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
          <div className="flex items-center justify-between border-b border-[#f5f4f1] px-4 py-3">
            <p className="text-sm font-semibold text-[#1a1a1a]">
              Separados por vencer
            </p>
            <button
              onClick={() => setOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[#737373] hover:bg-[#f5f4f1]"
              aria-label="Cerrar"
            >
              <X size={13} />
            </button>
          </div>

          {urgent.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
                <Clock size={16} className="text-emerald-500" />
              </div>
              <p className="text-xs text-[#737373]">
                Ningún separado vence en los próximos {URGENT_DAYS} días.
              </p>
            </div>
          ) : (
            <div className="max-h-[360px] overflow-y-auto">
              {urgent.map((l) => {
                const days = l.days_until_expiry
                const dayColor =
                  days < 1 ? 'text-red-600' : days < 3 ? 'text-amber-600' : 'text-orange-500'
                return (
                  <button
                    key={l.id}
                    onClick={() => {
                      setOpen(false)
                      navigate(`/separados?id=${l.id}`)
                    }}
                    className="flex w-full items-start gap-3 border-b border-[#f5f4f1] px-4 py-3 text-left transition-colors last:border-0 hover:bg-[#fafaf9]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-50 font-mono text-[10px] font-bold text-cyan-700">
                      #{l.layaway_number}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#1a1a1a]">
                        {l.customer_name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#737373]">
                        Vence: {fmtExpiresShort(l.expires_at)}
                      </p>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className={`text-[11px] font-semibold ${dayColor}`}>
                          {days <= 0 ? 'Vence hoy' : `${days} día${days !== 1 ? 's' : ''}`}
                        </span>
                        <span className="font-mono text-[11.5px] font-semibold text-[#1a1a1a]">
                          {fmtCOP(Number(l.pending_amount))}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          <button
            onClick={() => {
              setOpen(false)
              navigate('/separados')
            }}
            className="block w-full border-t border-[#f5f4f1] bg-[#fafaf9] px-4 py-2.5 text-center text-xs font-medium text-cyan-600 hover:bg-[#f5f4f1]"
          >
            Ver todos los separados
          </button>
        </div>
      )}
    </div>
  )
}
