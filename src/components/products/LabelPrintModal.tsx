import { useState, useEffect, useRef } from 'react'
import { X, Printer, Minus, Plus, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { fmtCOP } from '@/lib/formatters'
import { generateBarcode } from '@/lib/products'
import { useResolvedConfig } from '@/hooks/useConfig'
import { useVariantMutations } from '@/hooks/useVariantMutations'
import { findLabelSize } from '@/lib/labelSizes'
import { barcodeFit, encodeCode128 } from '@/lib/labelLayout'
import {
  LabelCard,
  LabelPagePreview,
  LabelPrintSheet,
  type LabelContent,
} from '@/components/labels/LabelParts'
import type { LabelSize } from '@/types/config.types'
import type { Variant } from '@/types/database.types'

const PRINT_STYLE_ID = 'gpulso-label-print-style'
const PRINT_CONTAINER_ID = 'gpulso-label-print'

// CODE128 acepta ASCII imprimible. Un código vacío o con caracteres fuera de
// rango no se puede codificar.
function isValidCode(code: string | null | undefined): code is string {
  return encodeCode128(code) !== null
}

function labelCode(variant: Variant): string {
  return variant.barcode ?? variant.sku ?? variant.id.slice(-10)
}

function labelContent(variant: Variant, productName: string, brand: string | null | undefined): LabelContent {
  return {
    name: productName,
    brand: brand?.trim() || null,
    variantText: [variant.size, variant.color].filter(Boolean).join(' · ') || null,
    sku: variant.sku,
    price: variant.price,
    code: labelCode(variant),
  }
}

interface LabelPrintModalProps {
  productName: string
  brand?: string | null
  variants: Variant[]
  onClose: () => void
}

interface LabelItem {
  variant: Variant
  qty: number
}

export default function LabelPrintModal({
  productName,
  brand,
  variants,
  onClose,
}: LabelPrintModalProps) {
  const config = useResolvedConfig()
  // Tamaño activo: el predeterminado de la tienda. label_sizes nunca está vacío
  // (seeding en resolveConfig), por lo que el fallback al primero es seguro.
  const activeSize: LabelSize =
    findLabelSize(config.label_sizes, config.label_default_size_id) ??
    config.label_sizes[0]
  const media = config.label_media
  const mediaLabel = media === 'die_cut' ? 'troquelado' : `continuo · corte ${config.label_gap_mm}mm`
  const formatLabel = `${activeSize.name} · ${activeSize.width_mm} × ${activeSize.height_mm} mm · ${mediaLabel}`

  const productId = variants[0]?.product_id ?? ''
  const { update } = useVariantMutations(productId)

  const persistedRef = useRef(false)

  // Si una variante no tiene barcode válido, generamos uno (formato propio de
  // 12 dígitos) para poder imprimir; se persiste en BD en el efecto siguiente.
  const [items, setItems] = useState<LabelItem[]>(() =>
    variants.map((v) => ({
      variant: isValidCode(v.barcode) ? v : { ...v, barcode: generateBarcode() },
      qty: 1,
    })),
  )

  // Persistir barcodes autogenerados (una sola vez por sesión del modal)
  useEffect(() => {
    if (persistedRef.current) return
    persistedRef.current = true
    items.forEach((item, i) => {
      const original = variants[i]
      if (!isValidCode(original?.barcode) && item.variant.barcode) {
        update
          .mutateAsync({ id: item.variant.id, barcode: item.variant.barcode })
          .catch(() => {
            /* la mutation ya muestra toast.error */
          })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  function setQty(variantId: string, delta: number) {
    setItems((prev) =>
      prev.map((item) =>
        item.variant.id === variantId
          ? { ...item, qty: Math.max(0, item.qty + delta) }
          : item,
      ),
    )
  }

  // Una página por etiqueta: N copias = N páginas.
  const labelsToRender = items.flatMap(({ variant, qty }) =>
    Array.from({ length: qty }, () => variant),
  )
  const totalLabels = labelsToRender.length

  function codeFits(variant: Variant): boolean {
    const bits = encodeCode128(labelCode(variant))
    return !!bits && barcodeFit(bits, activeSize.width_mm).fits
  }
  const notFitting = items.filter((it) => it.qty > 0 && !codeFits(it.variant))

  function handlePrint() {
    if (totalLabels === 0) {
      toast.error('No hay etiquetas para imprimir')
      return
    }
    if (notFitting.length > 0) {
      toast.error('Hay códigos que no caben en la etiqueta: el lector no los leería')
      return
    }
    try {
      window.print()
    } catch {
      toast.error('No se pudo abrir el diálogo de impresión')
    }
  }

  const previewVariant = items.find((it) => it.qty > 0)?.variant ?? items[0]?.variant

  return (
    <>
      <LabelPrintSheet
        containerId={PRINT_CONTAINER_ID}
        styleId={PRINT_STYLE_ID}
        size={activeSize}
        media={media}
        gapMm={config.label_gap_mm}
      >
        {labelsToRender.map((variant, i) => (
          <LabelCard
            key={`${variant.id}-${i}`}
            size={activeSize}
            fields={config.label_fields}
            content={labelContent(variant, productName, brand)}
          />
        ))}
      </LabelPrintSheet>

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 grid place-items-center"
        style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <div
          className="w-[560px] max-h-[90vh] overflow-auto rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between border-b border-[#f5f4f1] px-7 py-6">
            <div>
              <h2
                style={{
                  fontFamily: 'Bricolage Grotesque, sans-serif',
                  fontSize: 22,
                  fontWeight: 600,
                  letterSpacing: '-0.025em',
                  color: '#1a1a1a',
                }}
              >
                Imprimir etiquetas
              </h2>
              <p className="mt-0.5 text-[13px] text-[#737373]">
                {productName} ·{' '}
                {totalLabels} etiqueta{totalLabels !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
            >
              <X size={14} className="text-[#525252]" />
            </button>
          </div>

          {/* Cantidad por variante */}
          <div className="space-y-3 px-7 py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Cantidad por variante
            </p>
            {items.map(({ variant, qty }) => {
              const fits = codeFits(variant)
              return (
                <div
                  key={variant.id}
                  className={`rounded-xl border px-4 py-3 ${
                    fits ? 'border-[#ebe9e6] bg-[#f8f7f5]' : 'border-amber-300 bg-amber-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[#1a1a1a]">
                        {[variant.size, variant.color].filter(Boolean).join(' · ') || productName}
                      </p>
                      <p className="font-mono text-xs text-[#737373]">
                        {labelCode(variant)} · {fmtCOP(variant.price)}
                      </p>
                    </div>
                    <div className="flex h-8 items-center overflow-hidden rounded-lg border border-[#ebe9e6] bg-white">
                      <button
                        onClick={() => setQty(variant.id, -1)}
                        disabled={qty <= 0}
                        aria-label="Menos"
                        className="flex h-full w-8 items-center justify-center text-[#737373] hover:bg-[#f8f7f5] disabled:opacity-40"
                      >
                        <Minus size={11} />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold tabular-nums">
                        {qty}
                      </span>
                      <button
                        onClick={() => setQty(variant.id, 1)}
                        aria-label="Más"
                        className="flex h-full w-8 items-center justify-center text-[#737373] hover:bg-[#f8f7f5]"
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  </div>
                  {!fits && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700">
                      <AlertTriangle size={12} />
                      Este código no cabe con barras legibles en {activeSize.width_mm}mm. Usa un
                      código más corto para esta variante.
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {/* Vista previa a tamaño real */}
          <div className="border-t border-[#f5f4f1] px-7 py-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Vista previa · tamaño real
            </p>
            <div className="flex items-center justify-center rounded-xl border border-[#ebe9e6] bg-[#f1f0ee] p-6">
              {previewVariant && (
                <LabelPagePreview size={activeSize} media={media} gapMm={config.label_gap_mm}>
                  <LabelCard
                    size={activeSize}
                    fields={config.label_fields}
                    content={labelContent(previewVariant, productName, brand)}
                  />
                </LabelPagePreview>
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-[#a8a29e]">
              {formatLabel} · la línea punteada marca el área útil y no se imprime
            </p>
          </div>

          {/* Footer */}
          <div className="flex gap-3 border-t border-[#f5f4f1] px-7 py-5">
            <button
              onClick={onClose}
              className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
            >
              Cancelar
            </button>
            <button
              onClick={handlePrint}
              disabled={totalLabels === 0}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#06b6d4] text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95 disabled:opacity-50"
            >
              <Printer size={14} />
              Imprimir {totalLabels} etiqueta{totalLabels !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
