import { Calendar } from 'lucide-react'
import { resolveDateRange, type DateRangePreset } from '@/lib/dateRange'

// Filtro de rango de fechas reutilizable (pills de preset + rango personalizado).
// Controlado: el estado (preset + dateFrom/dateTo) vive en la página que lo usa;
// este componente solo emite el próximo valor por onChange. Las fechas son
// YYYY-MM-DD civiles de Bogotá (ver src/lib/dateRange.ts).

export interface DateRangeValue {
  preset: DateRangePreset
  dateFrom: string
  dateTo: string
}

const PRESET_LABELS: Record<DateRangePreset, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  last7: 'Últimos 7 días',
  month: 'Este mes',
  'prev-month': 'Mes anterior',
  custom: 'Personalizado',
}

// Set base para las 3 vistas (sin 'prev-month'). Reportes pasa su propio set.
const DEFAULT_PRESETS: DateRangePreset[] = [
  'today',
  'yesterday',
  'last7',
  'month',
  'custom',
]

interface Props {
  preset: DateRangePreset
  dateFrom: string
  dateTo: string
  presets?: DateRangePreset[]
  onChange: (next: DateRangeValue) => void
}

export function DateRangeFilter({
  preset,
  dateFrom,
  dateTo,
  presets = DEFAULT_PRESETS,
  onChange,
}: Props) {
  const handlePreset = (p: DateRangePreset) => {
    if (p === 'custom') {
      // Cambiar a personalizado conserva el rango visible actual; el usuario
      // ajusta desde/hasta en los inputs.
      onChange({ preset: 'custom', dateFrom, dateTo })
      return
    }
    onChange({ preset: p, ...resolveDateRange(p) })
  }

  // Aviso sutil (no bloqueante): "hasta" no debería ser anterior a "desde".
  const invalidRange =
    preset === 'custom' && !!dateFrom && !!dateTo && dateTo < dateFrom

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white p-0.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handlePreset(p)}
            aria-pressed={preset === p}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              preset === p
                ? 'bg-slate-900 text-white'
                : 'text-[#525252] hover:text-[#1a1a1a]'
            }`}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Calendar size={14} className="text-[#737373]" />
          <input
            type="date"
            aria-label="Desde"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) =>
              onChange({ preset: 'custom', dateFrom: e.target.value, dateTo })
            }
            className="h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-cyan-400"
          />
          <span className="text-xs text-[#737373]">a</span>
          <input
            type="date"
            aria-label="Hasta"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) =>
              onChange({ preset: 'custom', dateFrom, dateTo: e.target.value })
            }
            className="h-9 rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-cyan-400"
          />
          {invalidRange && (
            <span className="text-xs text-red-500">
              La fecha «hasta» no puede ser anterior a «desde».
            </span>
          )}
        </div>
      )}
    </div>
  )
}
