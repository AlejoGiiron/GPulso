import {
  Banknote,
  CreditCard,
  ArrowLeftRight,
  Smartphone,
  HandCoins,
  type LucideIcon,
} from 'lucide-react'
import type { PaymentMethod } from '@/types/database.types'

export type PaymentColorToken = 'emerald' | 'cyan' | 'blue' | 'pink' | 'amber'

export interface PaymentMethodMeta {
  label: string
  color: PaymentColorToken
  hex: string
  icon: LucideIcon
}

export const PAYMENT_METHODS: Record<PaymentMethod, PaymentMethodMeta> = {
  cash: {
    label: 'Efectivo',
    color: 'emerald',
    hex: '#10b981',
    icon: Banknote,
  },
  card: {
    label: 'Tarjeta',
    color: 'cyan',
    hex: '#06b6d4',
    icon: CreditCard,
  },
  transfer: {
    label: 'Transferencia',
    color: 'blue',
    hex: '#3b82f6',
    icon: ArrowLeftRight,
  },
  addi: {
    label: 'Addi',
    color: 'pink',
    hex: '#ec4899',
    icon: Smartphone,
  },
  // Venta FIADA (029). NO es un método seleccionable en el POS (no está en
  // PAYMENT_METHOD_KEYS): marca la venta como a crédito. El efectivo real entra
  // por credit_payments con su propio método (cash/card/…).
  credit: {
    label: 'Fiado',
    color: 'amber',
    hex: '#f59e0b',
    icon: HandCoins,
  },
}

// Métodos SELECCIONABLES por el cajero en el POS. 'credit' se excluye a
// propósito: fiar es un flujo aparte (permiso ventas.fiar), no un método de pago.
export const PAYMENT_METHOD_KEYS = [
  'cash',
  'card',
  'transfer',
  'addi',
] as const

export function getPaymentLabel(method: PaymentMethod): string {
  return PAYMENT_METHODS[method].label
}

export function getPaymentColor(method: PaymentMethod): string {
  return PAYMENT_METHODS[method].hex
}

export function getPaymentIcon(method: PaymentMethod): LucideIcon {
  return PAYMENT_METHODS[method].icon
}

// Migra valores legacy ('nequi') a 'transfer' en arrays de configuración.
export function migrateLegacyPaymentMethods(methods: string[]): PaymentMethod[] {
  const seen = new Set<PaymentMethod>()
  for (const m of methods) {
    const normalized = m === 'nequi' ? 'transfer' : m
    if ((PAYMENT_METHOD_KEYS as readonly string[]).includes(normalized)) {
      seen.add(normalized as PaymentMethod)
    }
  }
  return Array.from(seen)
}
