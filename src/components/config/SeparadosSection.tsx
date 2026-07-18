import { useEffect, useState } from 'react'
import { Bookmark } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  useOrgConfig,
  useResolvedOrgConfig,
  useOrgConfigMutations,
} from '@/hooks/useOrg'

/**
 * Configuración → Separados (nivel ORGANIZACIÓN, uno para todo el negocio).
 * Hoy contiene el texto de condiciones que se imprime en el recibo del
 * separado, editable como lista de líneas (una condición por renglón).
 * Protegido por config.gestionar vía la ruta (ProtectedRoute) + la RLS 031.
 */
export default function SeparadosSection() {
  const { data: org, isLoading } = useOrgConfig()
  const orgConfig = useResolvedOrgConfig()
  const { updateOrgConfig } = useOrgConfigMutations()

  // El textarea trabaja con un string multilínea; convertimos a/desde string[]
  // (join por \n para mostrar, split por \n al guardar).
  const [termsText, setTermsText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!org) return
    setTermsText(orgConfig.layaway_terms.join('\n'))
  }, [org, orgConfig])

  async function handleSave() {
    const terms = termsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (terms.length === 0) {
      toast.error('Agrega al menos una condición')
      return
    }

    setSaving(true)
    try {
      await updateOrgConfig.mutateAsync({ layaway_terms: terms })
      toast.success('Condiciones del separado guardadas')
    } catch {
      // toast lo muestra la mutación
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-[14px] border border-[#ebe9e6] bg-white p-5">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-10 w-full animate-pulse rounded-lg bg-slate-100"
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[14px] border border-[#ebe9e6] bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-100 text-cyan-600">
          <Bookmark size={15} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#1a1a1a]">
            Condiciones del separado
          </h2>
          <p className="text-xs text-[#737373]">
            Texto que se imprime en el recibo del separado. Aplica a todo el
            negocio.
          </p>
        </div>
      </div>

      <div className="px-5 py-5">
        <label className="mb-1.5 block text-xs font-medium text-[#525252]">
          Condiciones (una por línea)
        </label>
        <textarea
          value={termsText}
          onChange={(e) => setTermsText(e.target.value)}
          rows={5}
          placeholder={
            'Los abonos no se reembolsan al cancelar.\nSi pasa la fecha de vencimiento sin completar, el separado expira.'
          }
          className="w-full resize-y rounded-lg border border-[#ebe9e6] px-3 py-2 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
        />
        <p className="mt-1.5 text-[11px] text-[#a8a29e]">
          Cada renglón aparece como un ítem con guion en el recibo, debajo de
          “IMPORTANTE”.
        </p>
      </div>

      {/* Footer */}
      <div className="flex justify-end border-t border-[#f5f4f1] px-5 py-4">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex h-9 items-center gap-2 rounded-lg bg-[#06b6d4] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95 disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
