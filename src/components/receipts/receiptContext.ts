import { createContext, useContext, useMemo, type CSSProperties } from 'react'
import { useResolvedConfig } from '@/hooks/useConfig'
import {
  receiptFontPx,
  receiptInk,
  receiptLayout,
  type ReceiptLayout,
  type ReceiptWidthMm,
} from '@/lib/receiptLayout'

/**
 * Ancho forzado para un sub-árbol (ej. la vista previa de Configuración antes
 * de guardar). Sin proveedor, los comprobantes usan el ancho de la tienda.
 */
export const ReceiptWidthOverrideContext = createContext<ReceiptWidthMm | null>(null)

/** Layout efectivo: el forzado por contexto o el configurado en la tienda. */
export function useReceiptLayout(): ReceiptLayout {
  const override = useContext(ReceiptWidthOverrideContext)
  const { receipt_width_mm } = useResolvedConfig()
  return useMemo(() => receiptLayout(override ?? receipt_width_mm), [override, receipt_width_mm])
}

export interface ReceiptInk {
  layout: ReceiptLayout
  /** Estilo del texto secundario: gris en 80mm, negro en 58mm. */
  muted: CSSProperties
  /** Color respetando el monocromo del 58mm. */
  color: (c: string) => string
  /** Tamaño de letra respetando el mínimo del ancho (10px en 58mm). */
  fs: (px: number) => number
}

export function useReceiptInk(): ReceiptInk {
  const layout = useReceiptLayout()
  return useMemo(
    () => ({
      layout,
      muted: { color: receiptInk(layout, '#525252') },
      color: (c: string) => receiptInk(layout, c),
      fs: (px: number) => receiptFontPx(layout, px),
    }),
    [layout],
  )
}
