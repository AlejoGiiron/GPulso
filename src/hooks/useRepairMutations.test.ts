import { describe, it, expect } from 'vitest'
import { advanceRepairStatus } from './useRepairMutations'

/**
 * `advanceRepairStatus` pasó de ser un UPDATE plano con guarda en cliente a un
 * wrapper de la RPC `advance_repair_status` (migración 20260728_1630). Toda la
 * validación —transiciones, precio para 'listo', rechazo de 'entregado',
 * permisos, tienda— vive ahora en la BD y se prueba en
 * scripts/test-advance-repair-status.sql (13 casos contra el lab).
 *
 * Lo que se prueba ACÁ es el contrato del wrapper, que es lo único que queda en
 * TypeScript:
 *   1. llama a la RPC correcta con los parámetros correctos;
 *   2. NO escribe la tabla por ningún camino (el hueco que se cerró);
 *   3. propaga el error de la RPC TAL CUAL, sin envolverlo en un genérico —
 *      los mensajes están redactados para el usuario final y perderlos
 *      convertiría "usa Entregar y cobrar" en "algo salió mal".
 */
function makeFakeClient(opts: { rpcError?: unknown } = {}) {
  const calls = {
    rpc: [] as { fn: string; params: unknown }[],
    fromCount: 0,
  }

  const client = {
    rpc(fn: string, params: unknown) {
      calls.rpc.push({ fn, params })
      return Promise.resolve({ data: null, error: opts.rpcError ?? null })
    },
    // Si algún día alguien reintroduce un UPDATE directo, estos tests lo cazan.
    from() {
      calls.fromCount += 1
      throw new Error('advanceRepairStatus NO debe tocar la tabla directamente')
    },
  }

  return { client: client as unknown as Parameters<typeof advanceRepairStatus>[0], calls }
}

describe('advanceRepairStatus — wrapper de la RPC', () => {
  it('llama a advance_repair_status con el id y el estado destino', async () => {
    const { client, calls } = makeFakeClient()
    await expect(advanceRepairStatus(client, 'rep-1', 'listo')).resolves.toBeUndefined()
    expect(calls.rpc).toHaveLength(1)
    expect(calls.rpc[0].fn).toBe('advance_repair_status')
    expect(calls.rpc[0].params).toEqual({ p_repair_id: 'rep-1', p_new_status: 'listo' })
  })

  it('usa la misma RPC para el retroceso listo → en_reparacion', async () => {
    const { client, calls } = makeFakeClient()
    await advanceRepairStatus(client, 'rep-2', 'en_reparacion')
    expect(calls.rpc[0].params).toEqual({
      p_repair_id: 'rep-2',
      p_new_status: 'en_reparacion',
    })
  })

  it('NO escribe repair_orders directamente (el hueco cerrado)', async () => {
    const { client, calls } = makeFakeClient()
    await advanceRepairStatus(client, 'rep-3', 'en_reparacion')
    expect(calls.fromCount).toBe(0)
  })

  it('propaga el error de la RPC tal cual, sin envolverlo', async () => {
    const msg =
      'La entrega se registra con el cobro, no cambiando el estado. Usa la acción "Entregar y cobrar"'
    const { client } = makeFakeClient({ rpcError: new Error(msg) })
    await expect(advanceRepairStatus(client, 'rep-4', 'entregado')).rejects.toThrow(msg)
  })

  it('propaga también el error de transición, que explica el flujo al usuario', async () => {
    const msg = 'Transición no permitida: recibido → listo.'
    const { client } = makeFakeClient({ rpcError: new Error(msg) })
    await expect(advanceRepairStatus(client, 'rep-5', 'listo')).rejects.toThrow(msg)
  })
})
