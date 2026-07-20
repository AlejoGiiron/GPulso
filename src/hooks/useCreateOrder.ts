import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import toast from 'react-hot-toast'
import { fmtCOP } from '@/lib/formatters'
import type { Order, PaymentMethod } from '@/types/database.types'
import { assertValidPayments, primaryPaymentMethod } from '@/lib/orderPayments'
import { orderTotals } from '@/stores/cartStore'
import type { CartItem } from '@/stores/cartStore'
import { isValidGiftReason } from '@/lib/giftReasons'

// Una línea de pago de la venta: método + monto.
export interface OrderPaymentLine {
  method: PaymentMethod
  amount: number
}

export interface CreateOrderInput {
  items: CartItem[]
  customer_id: string | null
  payments: OrderPaymentLine[]
  cash_received?: number
  surcharge?: number
}

// Error de venta que además señala qué UNIDAD serializada se perdió (para que el
// POS marque la línea en rojo). failedUnitId sale del mensaje de claim_unit.
export class CreateOrderError extends Error {
  failedUnitId: string | null
  constructor(message: string, failedUnitId: string | null = null) {
    super(message)
    this.name = 'CreateOrderError'
    this.failedUnitId = failedUnitId
  }
}

// Extrae "unit_id=<uuid>" del mensaje crudo de la RPC (claim_unit) si lo trae.
function extractFailedUnitId(message: string): string | null {
  const m = message.match(/unit_id=([0-9a-fA-F-]{36})/)
  return m ? m[1] : null
}

export function useCreateOrder() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateOrderInput): Promise<Order> => {
      const storeId = getActiveStoreId(profile)
      const userId = profile?.id
      if (!storeId || !userId) {
        throw new CreateOrderError('Sesión inválida. Vuelve a iniciar sesión.')
      }
      if (input.items.length === 0) {
        throw new CreateOrderError('El carrito está vacío')
      }

      // Validación client-side (feedback rápido; el servidor revalida y el store
      // ya clampeó el precio al tope). No re-chequea el mínimo por ítem acá.
      for (const item of input.items) {
        if (!item.variant_id || !item.product_id) {
          throw new CreateOrderError('Ítem inválido en el carrito (falta variante o producto)')
        }
        if (item.qty <= 0) throw new CreateOrderError(`Cantidad inválida para ${item.name}`)
        if (item.unit_price < 0 || item.list_price < 0) {
          throw new CreateOrderError(`Precio inválido para ${item.name}`)
        }
        if (item.unit_price > item.list_price) {
          throw new CreateOrderError(
            `Precio inválido para ${item.name}: el final (${fmtCOP(item.unit_price)}) supera el catálogo (${fmtCOP(item.list_price)}).`,
          )
        }
        if (item.isGift) {
          if (!isValidGiftReason(item.giftReason)) {
            throw new CreateOrderError(`Regalo sin motivo válido para ${item.name}.`)
          }
          if (item.unit_price !== 0) {
            throw new CreateOrderError(`Un ítem de regalo debe tener precio 0 (${item.name}).`)
          }
        }
      }

      const { subtotal, discount, surcharge, total } = orderTotals(input.items, input.surcharge)
      if (total < 0) throw new CreateOrderError('El total no puede ser negativo')

      assertValidPayments(input.payments, total)
      const primaryMethod = primaryPaymentMethod(input.payments)

      // Venta ATÓMICA en servidor (migración 041): orden + ítems + claims de
      // unidades + pagos, todo o nada. Retira el multi-INSERT client-side.
      const p_items = input.items.map((it) => ({
        variant_id: it.variant_id,
        product_id: it.product_id,
        qty: it.qty,
        unit_price: it.unit_price,
        list_price: it.list_price,
        is_gift: it.isGift,
        gift_reason: it.isGift ? it.giftReason : null,
        // Equipo serializado: la unidad EXACTA a reclamar. Accesorio: null.
        unit_id: it.unit_id,
      }))
      const p_payments = input.payments.map((p) => ({ method: p.method, amount: p.amount }))

      const { data: orderId, error } = await supabase.rpc('create_order' as never, {
        p_customer_id: input.customer_id,
        p_cash_received: input.cash_received ?? null,
        p_subtotal: subtotal,
        p_discount: discount,
        p_surcharge: surcharge,
        p_total: total,
        p_primary_method: primaryMethod,
        p_items,
        p_payments,
      } as never)

      if (error) {
        throw new CreateOrderError(error.message, extractFailedUnitId(error.message))
      }

      // La RPC devuelve el uuid; traemos la orden para el ticket.
      const { data: order, error: fetchErr } = await supabase
        .from('orders')
        .select()
        .eq('id' as never, orderId as never)
        .single()
      if (fetchErr || !order) {
        // La venta SÍ se guardó (la RPC commiteó); solo falló el fetch del ticket.
        throw new CreateOrderError('Venta guardada, pero no se pudo cargar el comprobante. Búscala en el historial.')
      }
      return order as Order
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      void queryClient.invalidateQueries({ queryKey: ['sales-history'] })
      void queryClient.invalidateQueries({ queryKey: ['variants'] })
      void queryClient.invalidateQueries({ queryKey: ['products'] })
      void queryClient.invalidateQueries({ queryKey: ['pos-products'] })
      void queryClient.invalidateQueries({ queryKey: ['units'] })
      void queryClient.invalidateQueries({ queryKey: ['stock-movements'] })
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      void queryClient.invalidateQueries({ queryKey: ['cash-shift'] })
    },

    onError: (err: Error) => {
      // El POS maneja el fallo de claim (marca la línea); acá solo el toast base.
      toast.error(err.message)
    },
  })
}
