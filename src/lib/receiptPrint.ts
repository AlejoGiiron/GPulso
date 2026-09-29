import { useEffect } from 'react'
import { receiptPrintCss, type ReceiptLayout } from './receiptLayout'

/**
 * Inyecta un <style> de impresión con id fijo. Si el CSS cambia con la página
 * abierta (otro ancho de papel, otro tamaño de etiqueta), reescribe el mismo
 * <style> en vez de duplicarlo; lo quita al desmontar.
 */
export function usePrintCss(styleId: string, css: string) {
  useEffect(() => {
    let style = document.getElementById(styleId) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      document.head.appendChild(style)
    }
    style.textContent = css
    return () => {
      document.getElementById(styleId)?.remove()
    }
  }, [styleId, css])
}

// @media print de un comprobante térmico: aísla el contenedor indicado, oculta
// el resto del body y fija la hoja al ancho del papel de la tienda (58/80mm,
// ver receiptLayout).
export function useReceiptPrintStyle(
  styleId: string,
  containerId: string,
  layout: ReceiptLayout,
) {
  usePrintCss(styleId, receiptPrintCss(containerId, layout))
}
