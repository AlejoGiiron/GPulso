import { useState, useEffect, useRef } from 'react'
import { Printer, Plus, Trash2, AlertTriangle } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import toast from 'react-hot-toast'
import { fmtCOP } from '@/lib/formatters'
import { useStoreConfig, useResolvedConfig } from '@/hooks/useConfig'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import {
  deriveLabelStyle,
  newLabelSizeId,
  WARN_WIDTH,
  MIN_WIDTH,
} from '@/lib/labelSizes'
import type { LabelSize, LabelFields } from '@/types/config.types'

const SAMPLE_CODE = '7890123456789'
const SAMPLE_BRAND = 'Marca'
// Alto mínimo sensato (mm) por coherencia con el ancho escaneable.
const MIN_HEIGHT = 10

// ─── Label Preview ────────────────────────────────────────────────────────────
// Usa el MISMO helper de escalado que la impresión (deriveLabelStyle), de modo
// que la vista previa refleja exactamente cómo saldrá la etiqueta.

function LabelPreview({ size, fields }: { size: LabelSize; fields: LabelFields }) {
  const ref = useRef<SVGSVGElement>(null)
  const s = deriveLabelStyle(size)

  useEffect(() => {
    if (!ref.current) return
    try {
      JsBarcode(ref.current, SAMPLE_CODE, {
        format: 'CODE128',
        width: s.barcodeWidth,
        height: s.barcodeHeight,
        displayValue: false,
        margin: 0,
      })
    } catch {
      // código inválido
    }
  }, [s.barcodeWidth, s.barcodeHeight])

  return (
    <div
      style={{
        width: s.width,
        height: s.height,
        border: s.border,
        padding: s.padding,
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#fff',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div>
        <p
          style={{
            fontSize: s.brandFs,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: '#888',
            lineHeight: 1,
            margin: 0,
          }}
        >
          {SAMPLE_BRAND}
        </p>
        {fields.name && (
          <p style={{ fontSize: s.nameFs, fontWeight: 700, lineHeight: 1.1, margin: 0 }}>
            Producto ejemplo
          </p>
        )}
      </div>
      {fields.size_color && (
        <p style={{ fontSize: s.detailFs, color: '#555', lineHeight: 1, margin: 0 }}>
          T.M · Negro
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
        <svg ref={ref} style={{ width: '100%' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        {fields.sku && (
          <p style={{ fontSize: s.skuFs, fontFamily: 'monospace', color: '#666', margin: 0 }}>
            SKU-001
          </p>
        )}
        {fields.price && (
          <p style={{ fontSize: s.priceFs, fontWeight: 700, margin: 0 }}>
            {fmtCOP(45000)}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Size manager ───────────────────────────────────────────────────────────

// Devuelve el aviso de escaneabilidad por ancho, o null si el ancho es seguro.
function widthIssue(width: number): { level: 'block' | 'warn'; msg: string } | null {
  if (width < MIN_WIDTH)
    return {
      level: 'block',
      msg: `Ancho mínimo ${MIN_WIDTH}mm para que el código sea escaneable`,
    }
  if (width < WARN_WIDTH)
    return {
      level: 'warn',
      msg: `A menos de ${WARN_WIDTH}mm el código puede ser difícil de escanear`,
    }
  return null
}

function LabelSizesManager({
  sizes,
  defaultId,
  onChange,
  onDefaultChange,
}: {
  sizes: LabelSize[]
  defaultId: string
  onChange: (s: LabelSize[]) => void
  onDefaultChange: (id: string) => void
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  function update(idx: number, patch: Partial<LabelSize>) {
    onChange(sizes.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  function addSize() {
    onChange([
      ...sizes,
      { id: newLabelSizeId(), name: 'Nuevo tamaño', width_mm: 38, height_mm: 25 },
    ])
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
        Tamaños de etiqueta
      </p>
      <p className="mb-3 text-[11px] text-[#a8a29e]">
        Define los tamaños disponibles (ancho × alto en mm). Marca uno como
        predeterminado: será el que se use al imprimir. El contenido escala
        proporcionalmente al tamaño.
      </p>

      <div className="space-y-2">
        {sizes.map((s, idx) => {
          const issue = widthIssue(s.width_mm)
          const heightIssue = s.height_mm < MIN_HEIGHT
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
                  title="Marcar como predeterminado"
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
                    onChange={(e) =>
                      update(idx, { width_mm: parseInt(e.target.value, 10) || 0 })
                    }
                    className="h-9 w-16 rounded-lg border border-[#ebe9e6] px-2 text-right text-sm tabular-nums outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                  />
                  <span>×</span>
                  <input
                    type="number"
                    min={1}
                    value={s.height_mm}
                    onChange={(e) =>
                      update(idx, { height_mm: parseInt(e.target.value, 10) || 0 })
                    }
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
                    title={
                      sizes.length <= 1
                        ? 'Debe quedar al menos un tamaño'
                        : 'Eliminar tamaño'
                    }
                    className="grid h-8 w-8 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* Avisos de escaneabilidad */}
              {issue && (
                <div
                  className={`mt-2 flex items-center gap-1.5 pl-6 text-[11px] ${
                    issue.level === 'block' ? 'text-red-500' : 'text-amber-600'
                  }`}
                >
                  <AlertTriangle size={12} />
                  {issue.msg}
                </div>
              )}
              {heightIssue && (
                <div className="mt-1.5 flex items-center gap-1.5 pl-6 text-[11px] text-red-500">
                  <AlertTriangle size={12} />
                  Alto mínimo {MIN_HEIGHT}mm
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        onClick={addSize}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-[#d6d3d1] py-2.5 text-sm font-medium text-cyan-500 hover:border-cyan-300 hover:bg-cyan-50"
      >
        <Plus size={14} />
        Agregar tamaño
      </button>
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
  const [fields, setFields] = useState<LabelFields>({
    sku: true,
    name: true,
    size_color: true,
    price: true,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!store) return
    setSizes(config.label_sizes)
    setDefaultId(config.label_default_size_id)
    setFields(config.label_fields)
  }, [store, config])

  function toggleField(key: keyof LabelFields) {
    setFields((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const previewSize = sizes.find((s) => s.id === defaultId) ?? sizes[0]

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
    for (const s of cleaned) {
      if (s.width_mm < MIN_WIDTH) {
        toast.error(
          `"${s.name}": ancho mínimo ${MIN_WIDTH}mm para que el código sea escaneable`,
        )
        return
      }
      if (s.height_mm < MIN_HEIGHT) {
        toast.error(`"${s.name}": alto mínimo ${MIN_HEIGHT}mm`)
        return
      }
    }
    // Garantizar que el predeterminado exista entre los tamaños.
    const validDefault = cleaned.some((s) => s.id === defaultId)
      ? defaultId
      : cleaned[0].id

    setSaving(true)
    try {
      await updateStoreConfig.mutateAsync({
        label_sizes: cleaned,
        label_default_size_id: validDefault,
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
          <p className="text-xs text-[#737373]">Tamaños, campos y vista previa</p>
        </div>
      </div>

      <div className="divide-y divide-[#f5f4f1]">
        {/* Sizes */}
        <div className="px-5 py-5">
          <LabelSizesManager
            sizes={sizes}
            defaultId={defaultId}
            onChange={setSizes}
            onDefaultChange={setDefaultId}
          />
        </div>

        {/* Fields */}
        <div className="px-5 py-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Campos a mostrar
          </p>
          <div className="space-y-2">
            {/* Barcode: always active */}
            <label className="flex cursor-not-allowed items-center gap-3 rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3 opacity-70">
              <input type="checkbox" checked disabled className="accent-cyan-500" />
              <span className="text-sm font-medium text-[#1a1a1a]">Código de barras</span>
              <span className="ml-auto text-[11px] text-[#a8a29e]">siempre activo</span>
            </label>
            {(
              [
                { key: 'name', label: 'Nombre del producto' },
                { key: 'size_color', label: 'Variante y color' },
                { key: 'sku', label: 'SKU' },
                { key: 'price', label: 'Precio' },
              ] as { key: keyof LabelFields; label: string }[]
            ).map(({ key, label }) => (
              <label
                key={key}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                  fields[key]
                    ? 'border-cyan-300 bg-cyan-50'
                    : 'border-[#ebe9e6] bg-white hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={fields[key]}
                  onChange={() => toggleField(key)}
                  className="accent-cyan-500"
                />
                <span className="text-sm font-medium text-[#1a1a1a]">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="px-5 py-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
            Vista previa
          </p>
          <div className="flex flex-col items-center justify-center rounded-xl border border-[#ebe9e6] bg-[#fafaf9] py-8">
            {previewSize && <LabelPreview size={previewSize} fields={fields} />}
            {previewSize && (
              <p className="mt-3 text-[11px] text-[#a8a29e]">
                {previewSize.name} · {previewSize.width_mm} × {previewSize.height_mm} mm
                {' · escala real'}
              </p>
            )}
          </div>
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
