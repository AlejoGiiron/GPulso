import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import type { Organization } from '@/types/database.types'
import type { OrgConfig } from '@/types/config.types'

/**
 * Configuración por defecto de la organización. El valor de `layaway_terms`
 * son EXACTAMENTE las dos frases que el recibo del separado mostraba
 * hardcodeadas (LayawayReceipt.tsx), sin el guion inicial (el recibo antepone
 * "- " al renderizar). Así el ticket NO cambia visualmente hasta que el
 * negocio edite las condiciones desde Configuración → Separados.
 */
export const DEFAULT_ORG_CONFIG: OrgConfig = {
  layaway_terms: [
    'Los abonos no se reembolsan al cancelar.',
    'Si pasa la fecha de vencimiento sin completar, el separado expira.',
  ],
}

/**
 * Aplica los defaults sobre el jsonb crudo de organizations.config. Espejo de
 * resolveConfig (tienda). Si `layaway_terms` falta o viene como lista vacía,
 * cae al default para que el recibo nunca quede sin condiciones.
 */
export function resolveOrgConfig(
  raw: Record<string, unknown> | null | undefined,
): OrgConfig {
  if (!raw) return { ...DEFAULT_ORG_CONFIG }
  const r = raw as Partial<OrgConfig>
  return {
    ...DEFAULT_ORG_CONFIG,
    ...r,
    layaway_terms:
      Array.isArray(r.layaway_terms) && r.layaway_terms.length > 0
        ? r.layaway_terms
        : DEFAULT_ORG_CONFIG.layaway_terms,
  }
}

/**
 * Trae la fila de la organización del usuario (organizations.config). El RLS
 * (organizations_select_own) ya limita a la propia org; el .eq por id es
 * defensa en profundidad + clave de cache. Cache 5 min como useStoreConfig.
 */
export function useOrgConfig() {
  const { profile } = useAuth()
  const orgId = profile?.organization_id ?? ''

  return useQuery<Organization>({
    queryKey: ['organization', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id' as never, orgId)
        .single()
      if (error) throw error
      return data as unknown as Organization
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1_000,
  })
}

/**
 * Config de organización resuelta (con defaults aplicados). Gemelo de
 * useResolvedConfig; memoiza por referencia de la fila de la org.
 */
export function useResolvedOrgConfig(): OrgConfig {
  const { data: org } = useOrgConfig()
  return useMemo(() => resolveOrgConfig(org?.config ?? null), [org])
}

/**
 * Nombre del negocio (organizations.name) para encabezados de comprobantes.
 * Cadena vacía mientras carga: el recibo cae al nombre de la tienda. Reemplaza
 * el "G-MURA" fijo heredado del fork.
 */
export function useBusinessName(): string {
  const { data: org } = useOrgConfig()
  return org?.name?.trim() ?? ''
}

/**
 * Mutación fetch-merge-update sobre organizations.config (mismo patrón que
 * updateStoreConfig, pero a nivel de organización). La RLS de la 031
 * (organizations_update_config) garantiza que solo pasa con config.gestionar
 * sobre la propia org — no confiamos solo en la UI. Invalida el cache al éxito.
 */
export function useOrgConfigMutations() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const orgId = profile?.organization_id ?? ''

  const updateOrgConfig = useMutation({
    mutationFn: async (config: Partial<OrgConfig>) => {
      const { data, error: fetchErr } = await supabase
        .from('organizations')
        .select('config')
        .eq('id' as never, orgId)
        .single()
      if (fetchErr) throw fetchErr
      const current =
        ((data as unknown) as { config: Record<string, unknown> | null }).config ?? {}
      const merged = { ...current, ...config }
      const { error } = await supabase
        .from('organizations')
        .update({ config: merged } as never)
        .eq('id' as never, orgId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organization', orgId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return { updateOrgConfig }
}
