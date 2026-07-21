import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import type { CommissionMethod, CreditCommission, Profile } from '@/types/database.types'

// Hooks del módulo de comisiones por crédito (Fase 4). El registro es SIEMPRE
// vía la RPC register_credit_commission (atómica, valida turno/permiso/reparto);
// las lecturas respetan el RLS: quien tiene comisiones.gestionar ve todo lo de la
// tienda, un trabajador sin el permiso ve SOLO lo suyo.

export interface CommissionFilters {
  /** 'YYYY-MM-DD' inclusive (día civil). */
  from: string
  /** 'YYYY-MM-DD' inclusive (día civil). */
  to: string
  /** Filtro por trabajador (solo aplica a quien puede ver todo). */
  workerId?: string | 'all'
}

export interface CommissionRow extends CreditCommission {
  worker_name: string
  customer_name: string | null
  /** Nombre del trabajador ORIGINAL si la comisión fue reasignada. */
  original_worker_name: string | null
  /** true si es efectivo imputada a un turno YA cerrado (no reversible). */
  shift_closed: boolean
  /** ¿Se puede anular? consignación o efectivo-turno-abierto, y aún no anulada. */
  reversible: boolean
}

type RawCommission = CreditCommission & {
  worker: { full_name: string } | null
  customer: { full_name: string } | null
  original_worker: { full_name: string } | null
  shift: { closed_at: string | null } | null
}

// ── Lista del período ─────────────────────────────────────────────────────────

export function useCommissionsList(filters: CommissionFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<CommissionRow[]>({
    queryKey: ['credit-commissions', storeId, filters],
    queryFn: async () => {
      // Las ANULADAS se traen igual (se muestran marcadas); los cálculos que NO
      // deben contarlas (reporte quincenal, totales) las excluyen aparte
      // (commissionCalc.summarizeByWorker/sumActive).
      let q = supabase
        .from('credit_commissions')
        .select(
          `*,
           worker:worker_id(full_name),
           customer:customer_id(full_name),
           original_worker:original_worker_id(full_name),
           shift:shift_id(closed_at)`,
        )
        .eq('store_id' as never, storeId)
        .gte('fecha' as never, filters.from)
        .lte('fecha' as never, filters.to)
        .order('fecha' as never, { ascending: false })
        .order('created_at' as never, { ascending: false })

      if (filters.workerId && filters.workerId !== 'all') {
        q = q.eq('worker_id' as never, filters.workerId)
      }

      const { data, error } = await q
      if (error) throw error

      return ((data ?? []) as unknown as RawCommission[]).map((r) => {
        const shiftClosed = r.metodo === 'efectivo' && !!r.shift?.closed_at
        const reversible =
          !r.reversed_at && (r.metodo === 'consignacion' || !shiftClosed)
        return {
          ...r,
          monto_total: Number(r.monto_total),
          monto_local: Number(r.monto_local),
          monto_trabajador: Number(r.monto_trabajador),
          worker_name: r.worker?.full_name ?? 'Trabajador',
          customer_name: r.customer?.full_name ?? null,
          original_worker_name: r.original_worker?.full_name ?? null,
          shift_closed: shiftClosed,
          reversible,
        }
      })
    },
    enabled: !!storeId && !!filters.from && !!filters.to,
    staleTime: 30_000,
  })
}

// ── Trabajadores de la tienda (para el selector) ──────────────────────────────

export function useStoreWorkers() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<Profile[]>({
    queryKey: ['store-workers', storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('store_id' as never, storeId)
        .eq('is_active' as never, true)
        .order('full_name' as never)
      if (error) throw error
      return (data ?? []) as unknown as Profile[]
    },
    enabled: !!storeId,
    staleTime: 5 * 60 * 1_000,
  })
}

// ── Registrar comisión (RPC atómica) ──────────────────────────────────────────

export interface RegisterCommissionInput {
  worker_id: string
  metodo: CommissionMethod
  monto_total: number
  monto_local: number
  monto_trabajador: number
  customer_id?: string | null
  /** 'YYYY-MM-DD'; si se omite, la RPC usa el día de Bogotá. */
  fecha?: string | null
  notas?: string | null
}

export function useRegisterCommission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RegisterCommissionInput): Promise<string> => {
      const { data, error } = await supabase.rpc(
        'register_credit_commission' as never,
        {
          p_worker_id: input.worker_id,
          p_metodo: input.metodo,
          p_monto_total: input.monto_total,
          p_monto_local: input.monto_local,
          p_monto_trabajador: input.monto_trabajador,
          p_customer_id: input.customer_id ?? null,
          p_fecha: input.fecha ?? null,
          p_notas: input.notas ?? null,
        } as never,
      )
      if (error) throw error
      return data as unknown as string
    },
    onSuccess: (_id, input) => {
      qc.invalidateQueries({ queryKey: ['credit-commissions'] })
      // Una comisión en efectivo entró al cajón → afecta el cuadre del turno.
      if (input.metodo === 'efectivo') {
        qc.invalidateQueries({ queryKey: ['shift-closing'] })
        qc.invalidateQueries({ queryKey: ['shift-history'] })
      }
      toast.success('Comisión registrada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Corrección (050): reverso + reasignación, ambos por RPC ───────────────────
// No hay edición directa desde el cliente (tabla RPC-only). El reverso es una
// ANULACIÓN con traza (la fila no se borra); la reasignación cambia el
// beneficiario dejando traza. La regla de turno la aplica la RPC en el servidor.

export function useReverseCommission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: CommissionRow): Promise<void> => {
      const { error } = await supabase.rpc('reverse_credit_commission' as never, {
        p_id: row.id,
      } as never)
      if (error) throw error
    },
    onSuccess: (_v, row) => {
      qc.invalidateQueries({ queryKey: ['credit-commissions'] })
      // Anular una efectivo (turno abierto) baja el efectivo esperado del turno.
      if (row.metodo === 'efectivo') {
        qc.invalidateQueries({ queryKey: ['shift-closing'] })
        qc.invalidateQueries({ queryKey: ['shift-history'] })
      }
      toast.success('Comisión anulada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useReassignCommissionWorker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      newWorkerId: string
    }): Promise<void> => {
      const { error } = await supabase.rpc('reassign_commission_worker' as never, {
        p_id: input.id,
        p_new_worker: input.newWorkerId,
      } as never)
      if (error) throw error
    },
    onSuccess: () => {
      // Reasignar NO toca el efectivo esperado (caja-safe): solo cambia a quién
      // se le paga la quincena. No se invalidan las queries del cuadre.
      qc.invalidateQueries({ queryKey: ['credit-commissions'] })
      toast.success('Comisión reasignada')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
