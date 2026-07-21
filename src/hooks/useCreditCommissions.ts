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
}

type RawCommission = CreditCommission & {
  worker: { full_name: string } | null
  customer: { full_name: string } | null
}

// ── Lista del período ─────────────────────────────────────────────────────────

export function useCommissionsList(filters: CommissionFilters) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery<CommissionRow[]>({
    queryKey: ['credit-commissions', storeId, filters],
    queryFn: async () => {
      let q = supabase
        .from('credit_commissions')
        .select(
          `*,
           worker:worker_id(full_name),
           customer:customer_id(full_name)`,
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

      return ((data ?? []) as unknown as RawCommission[]).map((r) => ({
        ...r,
        monto_total: Number(r.monto_total),
        monto_local: Number(r.monto_local),
        monto_trabajador: Number(r.monto_trabajador),
        worker_name: r.worker?.full_name ?? 'Trabajador',
        customer_name: r.customer?.full_name ?? null,
      }))
    },
    enabled: !!storeId && !!filters.from && !!filters.to,
    staleTime: 30_000,
  })
}

// ── Reporte quincenal por trabajador ──────────────────────────────────────────
// Deriva del mismo listado (una sola fuente): agrupa por trabajador y suma lo
// que se le paga (monto_trabajador). Es lo que reemplaza el cuaderno.

export interface WorkerCommissionReport {
  worker_id: string
  worker_name: string
  count: number
  totalWorker: number
  totalLocal: number
  totalCommission: number
}

export function summarizeByWorker(rows: CommissionRow[]): WorkerCommissionReport[] {
  const map = new Map<string, WorkerCommissionReport>()
  for (const r of rows) {
    const prev =
      map.get(r.worker_id) ??
      ({
        worker_id: r.worker_id,
        worker_name: r.worker_name,
        count: 0,
        totalWorker: 0,
        totalLocal: 0,
        totalCommission: 0,
      } satisfies WorkerCommissionReport)
    prev.count += 1
    prev.totalWorker += r.monto_trabajador
    prev.totalLocal += r.monto_local
    prev.totalCommission += r.monto_total
    map.set(r.worker_id, prev)
  }
  return Array.from(map.values()).sort((a, b) => b.totalWorker - a.totalWorker)
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

// NOTA: no hay borrado/edición desde el cliente. La tabla es RPC-only para
// escritura (048); la corrección/reverso irá por una RPC dedicada que valida el
// estado del turno (Fase 4 punto 2, pendiente de aprobación).
