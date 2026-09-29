// Formatos de fecha de los comprobantes, siempre en hora de Bogotá. Antes cada
// recibo tenía su propia copia de fmtDateTime.

const TZ = 'America/Bogota'

const dateTimeFmt = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TZ,
})

const timeFmt = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TZ,
})

const longDateFmt = new Intl.DateTimeFormat('es-CO', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  timeZone: TZ,
})

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

/** "28/09/2026, 19:07" */
export function fmtReceiptDateTime(value: string | Date): string {
  return dateTimeFmt.format(toDate(value))
}

/** "19:07" */
export function fmtReceiptTime(value: string | Date): string {
  return timeFmt.format(toDate(value))
}

/** "28 de septiembre de 2026" */
export function fmtReceiptLongDate(value: string | Date): string {
  return longDateFmt.format(toDate(value))
}
