import { useState, useEffect } from 'react'
import { Printer, Plus, Trash2, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStoreConfig, useResolvedConfig } from '@/hooks/useConfig'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import { newLabelSizeId } from '@/lib/labelSizes'
import {
  DEFAULT_CONTINUOUS_GAP_MM,
  LABEL_PRESETS,
  MAX_LABEL_GAP_MM,
  SAMPLE_CODE_OWN,
  labelSizeIssues,
  type LabelMedia,
} from '@/lib/labelLayout'
import {
  LabelCard,
  LabelPagePreview,
  LabelPrintSheet,
  type LabelContent,
} from '@/components/labels/LabelParts'
import type { LabelSize, LabelFields } from '@/types/config.types'

const TEST_PRINT_CONTAINER_ID = 'gpulso-label-test-print'
const TEST_PRINT_STYLE_ID = 'gpulso-label-test-print-style'
/** Prueba de centrado (1) y de alineación (10 seguidas: el desfase se acumula). */
const TEST_COUNTS = [1, 10] as const

// Peor caso para la vista previa: nombre largo y precio alto.
const SAMPLE: LabelContent = {
  name: 'Cargador inalámbrico MagSafe 15W carga rápida original',
  brand: 'Apple',
  variantText: '128GB · Negro',
  sku: 'SKU-001',
  price: 1_250_000,
  code: SAMPLE_CODE_OWN,
}

const FIELD_OPTIONS: { key: keyof LabelFields; label: string; hint?: string }[] = [
  { key: 'name', label: 'Nombre del producto' },
  { key: 'price', label: 'Precio', hint: 'en grande' },
  { key: 'size_color', label: 'Variante' },
  { key: 'brand', label: 'Marca' },
  { key: 'sku', label: 'SKU' },
]

// ─── Size manager ───────────────────────────────────────────────────────────

function LabelSizesManager({
  sizes,
  defaultId,
  maxWidthMm,
  onChange,
  onDefaultChange,
}: {
  sizes: LabelSize[]
  defaultId: string
  maxWidthMm: number
  onChange: (s: LabelSize[]) => void
  onDefaultChange: (id: string) => void
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  function update(idx: number, patch: Partial<LabelSize>) {
    onChange(sizes.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  function addSize(width_mm: number, height_mm: number, name: string) {
    const existing = sizes.find((s) => s.width_mm === width_mm && s.height_mm === height_mm)
    if (existing) {
      onDefaultChange(existing.id)
      return
    }
    const id = newLabelSizeId()
    onChange([...sizes, { id, name, width_mm, height_mm }])
    onDefaultChange(id)
  }

  function removeSize(idx: number) {
    const removed = sizes[idx]
    const next = sizes.filter((_, i) => i !== idx)
    onChange(next)
    // Reasignar el predeterminado si se eliminó el actual.
    if (removed.id === defaultId && next.length > 0) {
      onDefaultChange(next[0].id)
    }
    setConfirmDeleteId(null)
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
        Tamaño de etiqueta
      </p>
      <p className="mb-3 text-[11px] text-[#a8a29e]">
        Ancho × alto en mm. Si el paquete no lo dice, mide el tramo que avanza la
        impresora con el botón de avance (ver guion de prueba). El marcado es el que
        se usa al imprimir.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {LABEL_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => addSize(p.width_mm, p.height_mm, p.name)}
            className="h-8 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-semibold text-[#525252] hover:border-cyan-300 hover:bg-cyan-50"
          >
            {p.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => addSize(40, 30, 'Personalizado')}
          className="flex h-8 items-center gap-1 rounded-lg border-[1.5px] border-dashed border-[#d6d3d1] px-3 text-xs font-medium text-cyan-600 hover:border-cyan-300 hover:bg-cyan-50"
        >
          <Plus size={12} /> Personalizado
        </button>
      </div>

      <div className="space-y-2">
        {sizes.map((s, idx) => {
          const issues = labelSizeIssues(s, maxWidthMm)
          const isDefault = s.id === defaultId
          return (
            <div
              key={s.id}
              className={`rounded-xl border p-3 transition-colors ${
                isDefault ? 'border-cyan-300 bg-cyan-50' : 'border-[#ebe9e6] bg-white'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="label-default-size"
                  checked={isDefault}
                  onChange={() => onDefaultChange(s.id)}
                  title="Usar este tamaño al imprimir"
                  className="accent-cyan-500"
                />
                <input
                  value={s.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  placeholder="Nombre del tamaño"
                  className="h-9 flex-1 rounded-lg border border-[#ebe9e6] px-3 text-sm font-medium outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
                <div className="flex items-center gap-1 text-sm text-[#737373]">
                  <input
                    type="number"
                    min={1}
                    value={s.width_mm}
                    aria-label="Ancho (mm)"
                    onChange={(e) => update(idx, { width_mm: parseInt(e.target.value, 10) || 0 })}
                    className="h-9 w-16 rounded-lg border border-[#ebe9e6] px-2 text-right text-sm tabular-nums outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                  />
                  <span>×</span>
                  <input
                    type="number"
                    min={1}
                    value={s.height_mm}
                    aria-label="Alto (mm)"
                    onChange={(e) => update(idx, { height_mm: parseInt(e.target.value, 10) || 0 })}
                    className="h-9 w-16 rounded-lg border border-[#ebe9e6] px-2 text-right text-sm tabular-nums outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                  />
                  <span className="text-xs text-[#a8a29e]">mm</span>
                </div>

                {confirmDeleteId === s.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => removeSize(idx)}
                      className="h-8 rounded-md bg-red-500 px-2.5 text-xs font-semibold text-white hover:bg-red-600"
                    >
                      Eliminar
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="h-8 rounded-md border border-[#ebe9e6] px-2.5 text-xs font-medium text-[#525252] hover:bg-slate-50"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(s.id)}
                    disabled={sizes.length <= 1}
                    title={sizes.length <= 1 ? 'Debe quedar al menos un tamaño' : 'Eliminar tamaño'}
                    className="grid h-8 w-8 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {issues.map((issue) => (
                <div
                  key={issue.msg}
                  className={`mt-1.5 flex items-center gap-1.5 pl-6 text-[11px] ${
                    issue.level === 'block' ? 'text-red-500' : 'text-amber-600'
                  }`}
                >
                  <AlertTriangle size={12} />
                  {issue.msg}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function EtiquetasSection() {
  const { data: store, isLoading } = useStoreConfig()
  const config = useResolvedConfig()
  const { updateStoreConfig } = useConfigMutations()

  const [sizes, setSizes] = useState<LabelSize[]>([])
  const [defaultId, setDefaultId] = useState('')
  const [fields, setFields] = useState<LabelFields>(config.label_fields)
  const [media, setMedia] = useState<LabelMedia>(config.label_media)
  const [gapMm, setGapMm] = useState(config.label_gap_mm)
  const [maxWidthMm, setMaxWidthMm] = useState(config.label_max_width_mm)
  const [saving, setSaving] = useState(false)
  const [testCount, setTestCount] = useState<number>(1)

  useEffect(() => {
    if (!store) return
    setSizes(config.label_sizes)
    setDefaultId(config.label_default_size_id)
    setFields(config.label_fields)
    setMedia(config.label_media)
    setGapMm(config.label_gap_mm)
    setMaxWidthMm(config.label_max_width_mm)
  }, [store, config])

  function toggleField(key: keyof LabelFields) {
    setFields((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const previewSize = sizes.find((s) => s.id === defaultId) ?? sizes[0]
  const previewBlocked = previewSize
    ? labelSizeIssues(previewSize, maxWidthMm).some((i) => i.level === 'block')
    : true

  function handlePrintTest(count: number) {
    if (previewBlocked) {
      toast.error('Corrige el tamaño antes de imprimir la prueba')
      return
    }
    setTestCount(count)
    // Esperar al render de la hoja con N etiquetas antes de abrir el diálogo.
    requestAnimationFrame(() => {
      try {
        window.print()
      } catch {
        toast.error('No se pudo abrir el diálogo de impresión')
      }
    })
  }

  async function handleSave() {
    const cleaned = sizes.map((s) => ({ ...s, name: s.name.trim() }))

    if (cleaned.length === 0) {
      toast.error('Debe existir al menos un tamaño de etiqueta')
      return
    }
    if (cleaned.some((s) => !s.name)) {
      toast.error('Cada tamaño necesita un nombre')
      return
    }
    const lowerNames = cleaned.map((s) => s.name.toLowerCase())
    if (new Set(lowerNames).size !== lowerNames.length) {
      toast.error('Hay nombres de tamaño duplicados')
      return
    }
    if (!Number.isFinite(maxWidthMm) || maxWidthMm < 20 || maxWidthMm > 120) {
      toast.error('Ancho máximo imprimible entre 20 y 120 mm')
      return
    }
    for (const s of cleaned) {
      const block = labelSizeIssues(s, maxWidthMm).find((i) => i.level === 'block')
      if (block) {
        toast.error(`"${s.name}": ${block.msg}`)
        return
      }
    }
    if (!fields.name && !fields.price) {
      toast.error('La etiqueta necesita al menos el nombre o el precio')
      return
    }
    // Garantizar que el predeterminado exista entre los tamaños.
    const validDefault = cleaned.some((s) => s.id === defaultId) ? defaultId : cleaned[0].id

    setSaving(true)
    try {
      await updateStoreConfig.mutateAsync({
        label_sizes: cleaned,
        label_default_size_id: validDefault,
        label_fields: fields,
        label_media: media,
        label_gap_mm: Math.min(MAX_LABEL_GAP_MM, Math.max(0, gapMm)),
        label_max_width_mm: maxWidthMm,
      })
      toast.success('Configuración de etiquetas guardada')
    } catch {
      // toast shown by mutation
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-[14px] border border-[#ebe9e6] bg-white p-5">
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
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
          <Printer size={15} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Etiquetas de precio</h2>
          <p className="text-xs text-[#737373]">
            Impresora de etiquetas, tamaño, campos y vista previa a tamaño real
          </p>
        </div>
      </div>

      <div className="divide-y divide-[#f5f4f1]">
        {/* Impresora */}
        <div className="px-5 py-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Impresora de etiquetas
          </p>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de rollo">
            {(
              [
                { key: 'die_cut', title: 'Rollo troquelado', detail: 'Etiquetas separadas; la impresora detecta el espacio entre ellas. Una etiqueta por hoja, tamaño exacto.' },
                { key: 'continuous', title: 'Rollo continuo', detail: 'Papel adhesivo sin separaciones: se deja un margen de corte entre etiquetas.' },
              ] as { key: LabelMedia; title: string; detail: string }[]
            ).map((opt) => {
              const active = media === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setMedia(opt.key)
                    if (opt.key === 'continuous' && gapMm === 0) setGapMm(DEFAULT_CONTINUOUS_GAP_MM)
                  }}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    active ? 'border-cyan-400 bg-[#ecfeff] ring-2 ring-cyan-100' : 'border-[#ebe9e6] hover:bg-[#fafaf9]'
                  }`}
                >
                  <span className="block text-sm font-semibold text-[#1a1a1a]">{opt.title}</span>
                  <span className="block text-xs text-[#737373]">{opt.detail}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[#525252]">
            {media === 'continuous' && (
              <label className="flex items-center gap-2">
                Margen de corte
                <input
                  type="number"
                  min={0}
                  max={MAX_LABEL_GAP_MM}
                  step={0.5}
                  value={gapMm}
                  onChange={(e) => setGapMm(parseFloat(e.target.value) || 0)}
                  className="h-9 w-16 rounded-lg border border-[#ebe9e6] px-2 text-right tabular-nums outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
                <span className="text-xs text-[#a8a29e]">mm</span>
              </label>
            )}
            <label className="flex items-center gap-2">
              Ancho máximo imprimible
              <input
                type="number"
                min={20}
                max={120}
                value={maxWidthMm}
                onChange={(e) => setMaxWidthMm(parseInt(e.target.value, 10) || 0)}
                className="h-9 w-16 rounded-lg border border-[#ebe9e6] px-2 text-right tabular-nums outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
              />
              <span className="text-xs text-[#a8a29e]">mm (PT-260 Label Maker: 48)</span>
            </label>
          </div>
        </div>

        {/* Sizes */}
        <div className="px-5 py-5">
          <LabelSizesManager
            sizes={sizes}
            defaultId={defaultId}
            maxWidthMm={maxWidthMm}
            onChange={setSizes}
            onDefaultChange={setDefaultId}
          />
        </div>

        {/* Fields */}
        <div className="px-5 py-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Campos a imprimir
          </p>
          <div className="space-y-2">
            <label className="flex cursor-not-allowed items-center gap-3 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3 opacity-70">
              <input type="checkbox" checked disabled className="accent-cyan-500" />
              <span className="text-sm font-medium text-[#1a1a1a]">Código de barras</span>
              <span className="ml-auto text-[11px] text-[#a8a29e]">siempre: lo lee el lector</span>
            </label>
            {FIELD_OPTIONS.map(({ key, label, hint }) => (
              <label
                key={key}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  fields[key] ? 'border-cyan-300 bg-cyan-50' : 'border-[#ebe9e6] bg-white hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={fields[key]}
                  onChange={() => toggleField(key)}
                  className="accent-cyan-500"
                />
                <span className="text-sm font-medium text-[#1a1a1a]">{label}</span>
                {hint && <span className="ml-auto text-[11px] text-[#a8a29e]">{hint}</span>}
              </label>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="px-5 py-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Vista previa · tamaño real
          </p>
          <div className="flex flex-col items-center justify-center rounded-xl border border-[#ebe9e6] bg-[#f1f0ee] py-8">
            {previewSize && (
              <LabelPagePreview size={previewSize} media={media} gapMm={gapMm}>
                <LabelCard size={previewSize} fields={fields} content={SAMPLE} calibration />
              </LabelPagePreview>
            )}
            {previewSize && (
              <p className="mt-3 text-[11px] text-[#a8a29e]">
                {previewSize.width_mm} × {previewSize.height_mm} mm ·{' '}
                {media === 'die_cut' ? 'troquelado' : `continuo, corte ${gapMm}mm`} · peor caso:
                nombre largo y precio alto · las marcas de borde solo salen en la prueba
              </p>
            )}
            <div className="mt-4 flex gap-2">
              {TEST_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => handlePrintTest(n)}
                  className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-[#f5f4f1]"
                >
                  <Printer size={13} />
                  {n === 1 ? 'Imprimir 1 de prueba (centrado)' : `Imprimir ${n} seguidas (alineación)`}
                </button>
              ))}
            </div>
          </div>
          {previewSize && (
            <LabelPrintSheet
              containerId={TEST_PRINT_CONTAINER_ID}
              styleId={TEST_PRINT_STYLE_ID}
              size={previewSize}
              media={media}
              gapMm={gapMm}
            >
              {Array.from({ length: testCount }, (_, i) => (
                <LabelCard
                  key={i}
                  size={previewSize}
                  fields={fields}
                  calibration
                  content={{ ...SAMPLE, name: `Prueba ${i + 1}/${testCount} · ${SAMPLE.name}` }}
                />
              ))}
            </LabelPrintSheet>
          )}
        </div>
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
