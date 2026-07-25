import { describe, it, expect } from 'vitest'
import { advanceRepairStatus, REPAIR_READY_PRICE_ERROR } from './useRepairMutations'

/**
 * Fake mínimo del query builder de Supabase para probar la guarda de avance sin
 * red. Reproduce el encadenamiento que usa advanceRepairStatus:
 *   - lectura:  .from().select().eq().single()  → resuelve { data, error }
 *   - escritura: .from().update().eq()          → awaitable, resuelve { error }
 */
function makeFakeClient(
  row: { precio: number | null } | null,
  opts: { selectError?: unknown; updateError?: unknown } = {},
) {
  const calls = { updateCount: 0, lastUpdatePatch: undefined as unknown, selectCount: 0 }

  const builder = {
    select() {
      calls.selectCount += 1
      return builder
    },
    update(patch: unknown) {
      calls.updateCount += 1
      calls.lastUpdatePatch = patch
      return builder
    },
    eq() {
      return builder
    },
    single() {
      return Promise.resolve({ data: row, error: opts.selectError ?? null })
    },
    // Hace awaitable el chain de UPDATE (que no termina en .single()).
    then<R>(resolve: (v: { error: unknown }) => R): Promise<R> {
      return Promise.resolve({ error: opts.updateError ?? null }).then(resolve)
    },
  }

  const client = { from: () => builder }
  // El cast refleja lo que hace el resto del código con el client de Supabase.
  return { client: client as unknown as Parameters<typeof advanceRepairStatus>[0], calls }
}

describe('advanceRepairStatus — guarda precio-para-listo', () => {
  it('rechaza pasar a "listo" cuando el precio en BD es null (no escribe estado)', async () => {
    const { client, calls } = makeFakeClient({ precio: null })
    await expect(advanceRepairStatus(client, 'rep-1', 'listo')).rejects.toThrow(
      REPAIR_READY_PRICE_ERROR,
    )
    expect(calls.updateCount).toBe(0)
  })

  it('rechaza también cuando la orden no existe (data null)', async () => {
    const { client, calls } = makeFakeClient(null)
    await expect(advanceRepairStatus(client, 'rep-x', 'listo')).rejects.toThrow(
      REPAIR_READY_PRICE_ERROR,
    )
    expect(calls.updateCount).toBe(0)
  })

  it('permite pasar a "listo" cuando el precio en BD está definido', async () => {
    const { client, calls } = makeFakeClient({ precio: 500000 })
    await expect(advanceRepairStatus(client, 'rep-2', 'listo')).resolves.toBeUndefined()
    expect(calls.updateCount).toBe(1)
    expect(calls.lastUpdatePatch).toEqual({ status: 'listo' })
  })

  it('valida el precio de BD, no lo que el llamador recuerde pasar (raíz del bug)', async () => {
    // La firma ya no acepta precio; con precio real en BD debe avanzar.
    const { client } = makeFakeClient({ precio: 1 })
    await expect(advanceRepairStatus(client, 'rep-3', 'listo')).resolves.toBeUndefined()
  })

  it('no valida precio para transiciones que no son "listo"', async () => {
    const { client, calls } = makeFakeClient({ precio: null })
    await expect(advanceRepairStatus(client, 'rep-4', 'en_reparacion')).resolves.toBeUndefined()
    expect(calls.selectCount).toBe(0) // no relee precio
    expect(calls.updateCount).toBe(1)
    expect(calls.lastUpdatePatch).toEqual({ status: 'en_reparacion' })
  })

  it('propaga un error de lectura del precio sin escribir estado', async () => {
    const { client, calls } = makeFakeClient({ precio: 500000 }, { selectError: new Error('rls') })
    await expect(advanceRepairStatus(client, 'rep-5', 'listo')).rejects.toThrow('rls')
    expect(calls.updateCount).toBe(0)
  })
})
