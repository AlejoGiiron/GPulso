export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const

const COLOR_MAP: Record<string, string> = {
  negro: '#1a1a1a',
  blanco: '#f5f5f5',
  rojo: '#dc2626',
  azul: '#2563eb',
  verde: '#16a34a',
  amarillo: '#eab308',
  naranja: '#ea580c',
  rosa: '#ec4899',
  gris: '#6b7280',
  morado: '#0891b2',
  café: '#92400e',
  beige: '#d2b48c',
  celeste: '#38bdf8',
  turquesa: '#06b6d4',
  navy: '#1e3a5f',
  khaki: '#c3b091',
  fucsia: '#d946ef',
  crema: '#fef9c3',
  vino: '#7f1d1d',
}

export function getColorHex(name: string): string {
  return COLOR_MAP[name.toLowerCase().trim()] ?? '#a8a29e'
}

export function generateBarcode(): string {
  const ts = Date.now().toString().slice(-8)
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
  return `${ts}${rand}`
}

export function sortSizes(sizes: string[]): string[] {
  const ordered = SIZES as readonly string[]
  return [...sizes].sort((a, b) => {
    const ai = ordered.indexOf(a)
    const bi = ordered.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

export function stockState(qty: number, minStock: number): 'out' | 'low' | 'ok' {
  if (qty === 0) return 'out'
  if (qty <= minStock) return 'low'
  return 'ok'
}

// Rango de precios de las variantes ACTIVAS de un producto. Devuelve null si no
// hay variantes activas (no se muestra precio). Si min === max, todas valen lo
// mismo y la UI muestra un solo precio. El formateo (fmtCOP) queda en la UI.
export function priceRange(
  variants: { price: number; is_active: boolean }[],
): { min: number; max: number } | null {
  const prices = variants.filter((v) => v.is_active).map((v) => v.price)
  if (prices.length === 0) return null
  return { min: Math.min(...prices), max: Math.max(...prices) }
}
