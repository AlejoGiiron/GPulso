import { useEffect, useRef, useState } from 'react'
import { Printer, Receipt } from 'lucide-react'
import toast from 'react-hot-toast'
import { useResolvedConfig, useStoreConfig } from '@/hooks/useConfig'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import { RECEIPT_WIDTHS, receiptLayout, type ReceiptWidthMm } from '@/lib/receiptLayout'
import { ReceiptWidthOverrideContext } from '@/components/receipts/receiptContext'
import { ReceiptTestPage, ReceiptTestPagePrint } from '@/components/receipts/ReceiptTestPage'

const WIDTH_COPY: Record<ReceiptWidthMm, { title: string; detail: string }> = {
  80: {
    title: '80 mm (estándar)',
    detail: 'Impresora de recibos de 80 mm. 72 mm imprimibles.',
  },
  58: {
    title: '58 mm (portátil)',
    detail:
      'Ej. Goojprt PT-260. 48 mm imprimibles: diagramación compacta y todo el texto en negro.',
  },
}

/**
 * Configuración → Recibos: ancho del papel de la impresora térmica de la
 * TIENDA (stores.config.receipt_width_mm). Aplica a todos los comprobantes
 * (venta, separado, cuadre, taller y devolución). La vista previa y la página
 * de prueba usan la opción elegida aunque todavía no esté guardada.
 */
export default function RecibosSection() {
  const { data: store, isLoading } = useStoreConfig()
  const config = useResolvedConfig()
  const { updateStoreConfig } = useConfigMutations()
  const [width, setWidth] = useState<ReceiptWidthMm>(config.receipt_width_mm)
  const [saving, setSaving] = useState(false)
  const printedAtRef = useRef(new Date())

  useEffect(() => {
    setWidth(config.receipt_width_mm)
  }, [config.receipt_width_mm])

  const dirty = width !== config.receipt_width_mm
  const layout = receiptLayout(width)
  const storeName = store?.name ?? ''

  async function handleSave() {
    setSaving(true)
    try {
      await updateStoreConfig.mutateAsync({ receipt_width_mm: width })
      toast.success(`Recibos a ${width} mm`)
    } catch {
      // toast lo muestra la mutación
    } finally {
      setSaving(false)
    }
  }

  function handlePrintTest() {
    printedAtRef.current = new Date()
    try {
      window.print()
    } catch {
      toast.error('No se pudo abrir el diálogo de impresión')
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-[14px] border border-[#ebe9e6] bg-white p-5">
        <div className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
      </div>
    )
  }

  return (
    <div className="rounded-[14px] border border-[#ebe9e6] bg-white">
      <div className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-100 text-cyan-600">
          <Receipt size={15} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[#1a1a1a]">Impresora de recibos</h2>
          <p className="text-xs text-[#737373]">
            Ancho del papel de esta tienda. Aplica a ventas, separados, cuadre de caja,
            taller y devoluciones.
          </p>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="space-y-2" role="radiogroup" aria-label="Ancho del papel">
            {RECEIPT_WIDTHS.map((w) => {
              const active = w === width
              return (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setWidth(w)}
                  className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
                    active
                      ? 'border-cyan-400 bg-[#ecfeff] ring-2 ring-cyan-100'
                      : 'border-[#ebe9e6] hover:bg-[#fafaf9]'
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                      active ? 'border-cyan-600' : 'border-[#a8a29e]'
                    }`}
                  >
                    {active && <span className="h-2 w-2 rounded-full bg-cyan-600" />}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-[#1a1a1a]">
                      {WIDTH_COPY[w].title}
                    </span>
                    <span className="block text-xs text-[#737373]">{WIDTH_COPY[w].detail}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-4 rounded-xl border border-[#ebe9e6] bg-[#fafaf9] px-4 py-3 text-xs text-[#525252]">
            <p className="font-semibold text-[#1a1a1a]">Página de prueba</p>
            <p className="mt-1">
              Imprímela para calibrar la impresora: deben verse los dos bordes del área
              útil ({layout.printableMm} mm). La línea punteada de la vista previa marca
              esa área y no se imprime.
            </p>
            <button
              type="button"
              onClick={handlePrintTest}
              className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-[#f5f4f1]"
            >
              <Printer size={13} /> Imprimir página de prueba ({width} mm)
            </button>
          </div>
        </div>

        <div className="justify-self-center">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#737373]">
            Vista previa · {width} mm
          </p>
          <ReceiptWidthOverrideContext.Provider value={width}>
            <div className="w-fit rounded-xl border border-[#ebe9e6] bg-white shadow-sm">
              <ReceiptTestPage storeName={storeName} printedAt={printedAtRef.current} />
            </div>
            <ReceiptTestPagePrint storeName={storeName} printedAt={printedAtRef.current} />
          </ReceiptWidthOverrideContext.Provider>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-[#f5f4f1] px-5 py-4">
        {dirty && <span className="text-xs text-[#a8a29e]">Cambios sin guardar</span>}
        <button
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="flex h-9 items-center gap-2 rounded-lg bg-[#06b6d4] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95 disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
