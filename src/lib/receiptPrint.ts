import { useEffect } from 'react'
import { receiptPrintCss, type ReceiptLayout } from './receiptLayout'

// Inyecta el @media print de un comprobante térmico: aísla el contenedor
// indicado, oculta el resto del body y fija la hoja al ancho del papel de la
// tienda (58/80mm, ver receiptLayout). Si el ancho cambia con la página
// abierta, reescribe el <style> en vez de duplicarlo.
export function useReceiptPrintStyle(
  styleId: string,
  containerId: string,
  layout: ReceiptLayout,
) {
  const css = receiptPrintCss(containerId, layout)

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
