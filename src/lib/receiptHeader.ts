// Encabezado de los comprobantes: nombre del NEGOCIO (organizations.name) en
// grande y la TIENDA debajo. Reemplaza el "G-MURA" fijo heredado del fork.
//
// - Mientras la organización no carga (businessName vacío) el título cae al
//   nombre de la tienda, para no imprimir nunca un encabezado vacío.
// - La tienda se muestra como subtítulo solo si aporta algo (existe y difiere
//   del título).

export interface ReceiptHeaderNames {
  title: string
  subtitle: string | null
}

export function receiptHeaderNames(
  businessName: string | null | undefined,
  storeName: string | null | undefined,
): ReceiptHeaderNames {
  const business = businessName?.trim() ?? ''
  const store = storeName?.trim() ?? ''
  const title = business || store
  const subtitle = store && store !== title ? store : null
  return { title, subtitle }
}
