import { useState, useEffect, useRef } from 'react'
import { X, Printer, Minus, Plus } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import toast from 'react-hot-toast'
import { fmtCOP } from '@/lib/formatters'
import { generateBarcode } from '@/lib/products'
import { useResolvedConfig } from '@/hooks/useConfig'
import { useVariantMutations } from '@/hooks/useVariantMutations'
import { deriveLabelStyle, findLabelSize } from '@/lib/labelSizes'
import type { LabelSize } from '@/types/config.types'
import type { Variant } from '@/types/database.types'

const PRINT_STYLE_ID = 'gpulso-label-print-style'
const PRINT_CONTAINER_ID = 'gpulso-label-print'

// JsBarcode (CODE128) acepta ASCII imprimible. Un código vacío o con
// caracteres fuera de rango lanza excepción al renderizar.
function isValidCode(code: string | null | undefined): code is string {
  if (!code) return false
  const trimmed = code.trim()
  if (trimmed.length === 0) return false
  return /^[\x20-\x7e]+$/.test(trimmed)
}

// ─── Barcode SVG helpers ──────────────────────────────────────────────────────

interface BarcodeSvgProps {
  code: string
  height?: number
  width?: number
  onError?: () => void
}

function BarcodeSvg({ code, height = 28, width = 1.2, onError }: BarcodeSvgProps) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!ref.current) return
    if (!isValidCode(code)) {
      onError?.()
      return
    }
    try {
      JsBarcode(ref.current, code, {
        format: 'CODE128',
        width,
        height,
        displayValue: false,
        margin: 1,
      })
    } catch {
      onError?.()
    }
  }, [code, height, width, onError])

  return <svg ref={ref} style={{ width: '100%' }} />
}

// ─── Etiqueta física ──────────────────────────────────────────────────────────

interface LabelCardProps {
  variant: Variant
  productName: string
  brand?: string | null
  size: LabelSize
  onBarcodeError?: () => void
}

function LabelCard({ variant, productName, brand, size, onBarcodeError }: LabelCardProps) {
  // Mismo helper de escalado que la vista previa de Config (EtiquetasSection):
  // lo que el admin ve en la preview = lo que sale impreso.
  const s = deriveLabelStyle(size)
  const code = variant.barcode ?? variant.sku ?? variant.id.slice(-10)
  const brandLabel = brand?.trim()
  const truncName =
    productName.length > 22 ? `${productName.slice(0, 21)}…` : productName
  const detail = [variant.size, variant.color]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className="label-card"
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
        pageBreakInside: 'avoid',
        breakInside: 'avoid',
        background: '#fff',
      }}
    >
      <div>
        {brandLabel && (
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
            {brandLabel}
          </p>
        )}
        <p style={{ fontSize: s.nameFs, fontWeight: 700, lineHeight: 1.1, margin: 0 }}>
          {truncName}
        </p>
      </div>
      {detail && (
        <p style={{ fontSize: s.detailFs, color: '#555', lineHeight: 1, margin: 0 }}>
          {detail}
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center' }}>
        <BarcodeSvg
          code={code}
          height={s.barcodeHeight}
          width={s.barcodeWidth}
          onError={onBarcodeError}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <p style={{ fontSize: s.skuFs, color: '#666', fontFamily: 'monospace', margin: 0 }}>
          {(variant.sku ?? code).slice(0, 14)}
        </p>
        <p style={{ fontSize: s.priceFs, fontWeight: 700, margin: 0 }}>
          {fmtCOP(variant.price)}
        </p>
      </div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

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
  const formatLabel = `${activeSize.name} · ${activeSize.width_mm} × ${activeSize.height_mm} mm`

  const productId = variants[0]?.product_id ?? ''
  const { update } = useVariantMutations(productId)

  const printRef = useRef<HTMLDivElement>(null)
  const persistedRef = useRef(false)
  const errorReportedRef = useRef(false)

  // Si una variante no tiene barcode válido, generamos uno temporal
  // para poder imprimir; la persistencia en BD ocurre en el useEffect siguiente.
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

  // Inyectar estilos de impresión — con guard para evitar duplicados
  useEffect(() => {
    if (document.getElementById(PRINT_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = PRINT_STYLE_ID
    style.textContent = `
      @media print {
        body > * { visibility: hidden !important; }
        #${PRINT_CONTAINER_ID},
        #${PRINT_CONTAINER_ID} * { visibility: visible !important; }
        #${PRINT_CONTAINER_ID} {
          display: block !important;
          position: fixed !important;
          top: 0 !important; left: 0 !important;
          width: 100% !important;
          padding: 4mm !important;
          box-sizing: border-box !important;
        }
        @page { margin: 0; size: auto; }
      }
    `
    document.head.appendChild(style)
    return () => {
      document.getElementById(PRINT_STYLE_ID)?.remove()
    }
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
          ? { ...item, qty: Math.max(1, item.qty + delta) }
          : item,
      ),
    )
  }

  function reportBarcodeError() {
    if (errorReportedRef.current) return
    errorReportedRef.current = true
    toast.error('Una o más etiquetas tienen códigos inválidos')
  }

  function handlePrint() {
    if (!printRef.current) {
      toast.error('La vista de impresión aún no está lista. Intenta de nuevo.')
      return
    }
    if (totalLabels === 0) {
      toast.error('No hay etiquetas para imprimir')
      return
    }
    try {
      window.print()
    } catch {
      toast.error('No se pudo abrir el diálogo de impresión')
    }
  }

  const labelsToRender = items.flatMap(({ variant, qty }) =>
    Array.from({ length: qty }, (_, i) => ({ variant, key: `${variant.id}-${i}` })),
  )

  const totalLabels = labelsToRender.length

  return (
    <>
      {/* Contenedor de impresión (invisible en pantalla) */}
      <div
        ref={printRef}
        id={PRINT_CONTAINER_ID}
        style={{
          display: 'none',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2mm' }}>
          {labelsToRender.map(({ variant, key }) => (
            <LabelCard
              key={key}
              variant={variant}
              productName={productName}
              brand={brand}
              size={activeSize}
              onBarcodeError={reportBarcodeError}
            />
          ))}
        </div>
      </div>

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
            {items.map(({ variant, qty }) => (
              <div
                key={variant.id}
                className="flex items-center justify-between rounded-xl border border-[#ebe9e6] bg-[#f8f7f5] px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-14 shrink-0">
                    <BarcodeSvg
                      code={variant.barcode ?? variant.sku ?? variant.id.slice(-8)}
                      height={14}
                      width={1}
                      onError={reportBarcodeError}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#1a1a1a]">
                      {[variant.size, variant.color]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </p>
                    <p className="text-xs text-[#737373]">
                      {variant.sku ?? variant.barcode ?? '—'} · {fmtCOP(variant.price)}
                    </p>
                  </div>
                </div>
                <div className="flex h-8 items-center overflow-hidden rounded-lg border border-[#ebe9e6] bg-white">
                  <button
                    onClick={() => setQty(variant.id, -1)}
                    disabled={qty <= 1}
                    className="flex h-full w-8 items-center justify-center text-[#737373] hover:bg-[#f8f7f5] disabled:opacity-40"
                  >
                    <Minus size={11} />
                  </button>
                  <span className="w-8 text-center text-sm font-semibold tabular-nums">
                    {qty}
                  </span>
                  <button
                    onClick={() => setQty(variant.id, 1)}
                    className="flex h-full w-8 items-center justify-center text-[#737373] hover:bg-[#f8f7f5]"
                  >
                    <Plus size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Vista previa */}
          <div className="border-t border-[#f5f4f1] px-7 py-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Vista previa
            </p>
            <div className="flex items-center justify-center rounded-xl border border-[#ebe9e6] bg-[#fafaf9] p-6">
              {items[0] && (
                <LabelCard
                  variant={items[0].variant}
                  productName={productName}
                  brand={brand}
                  size={activeSize}
                  onBarcodeError={reportBarcodeError}
                />
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-[#a8a29e]">
              Escala real: {formatLabel}
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
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#06b6d4] text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95"
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
