import { useEffect, useMemo, useRef, useState } from 'react'
import { Store, ChevronDown, Check, AlertTriangle, Loader2 } from 'lucide-react'
import { useMyStores, useSwitchStore } from '@/hooks/useStores'
import { useCurrentShift } from '@/hooks/useCashShift'
import { useCartStore } from '@/stores/cartStore'
import type { MyStore } from '@/types/database.types'

export function StoreSwitcher() {
  const { data: stores = [], isLoading } = useMyStores()
  const switchStore = useSwitchStore()
  const { data: currentShift } = useCurrentShift()
  const cartItems = useCartStore((s) => s.items)
  const clearCart = useCartStore((s) => s.clear)

  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<MyStore | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const active = useMemo(
    () => stores.find((s) => s.is_current) ?? stores[0] ?? null,
    [stores],
  )

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setPending(null)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  function performSwitch(target: MyStore) {
    // Al cambiar de tienda el carrito en curso ya no aplica → limpiarlo.
    if (cartItems.length > 0) clearCart()
    switchStore.mutate(
      { store_id: target.store_id, store_name: target.store_name },
      {
        onSettled: () => {
          setOpen(false)
          setPending(null)
        },
      },
    )
  }

  function handleSelect(target: MyStore) {
    if (target.store_id === active?.store_id) {
      setOpen(false)
      return
    }
    // Avisar si hay turno abierto o carrito con ítems antes de cambiar.
    if (currentShift || cartItems.length > 0) {
      setPending(target)
      return
    }
    performSwitch(target)
  }

  // Cargando inicial
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
        <Store size={13} className="text-gray-400" />
        <span className="h-3 w-20 animate-pulse rounded bg-gray-100" />
      </div>
    )
  }

  // Una sola tienda (vendedor o admin con una): texto estático, no clickeable
  if (stores.length <= 1) {
    return (
      <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-gray-600">
        <Store size={14} className="text-gray-400" />
        <span className="font-medium">{active?.store_name ?? '—'}</span>
      </div>
    )
  }

  // Multi-tienda: dropdown
  const switching = switchStore.isPending

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={switching}
        className="flex items-center gap-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-sm font-medium text-cyan-700 transition-colors hover:bg-cyan-100 disabled:opacity-70"
      >
        {switching ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Store size={14} />
        )}
        <span className="max-w-[160px] truncate">{active?.store_name ?? '—'}</span>
        <ChevronDown
          size={14}
          className="transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[280px] overflow-hidden rounded-xl border border-[#ebe9e6] bg-white shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
          {pending ? (
            // Confirmación cuando hay turno abierto o carrito en curso
            <div className="p-4">
              <div className="mb-2 flex items-center gap-2 text-amber-600">
                <AlertTriangle size={16} />
                <p className="text-sm font-semibold">Confirma el cambio</p>
              </div>
              <div className="space-y-1.5 text-[12.5px] text-[#525252]">
                {currentShift && (
                  <p>
                    Tienes un turno abierto en{' '}
                    <span className="font-semibold">{active?.store_name}</span>. Seguirá
                    abierto; no se cierra al cambiar.
                  </p>
                )}
                {cartItems.length > 0 && (
                  <p>
                    Hay una venta en progreso ({cartItems.length} ítem
                    {cartItems.length !== 1 ? 's' : ''}). Se perderá al cambiar.
                  </p>
                )}
                <p className="pt-1">
                  Cambiar a <span className="font-semibold">{pending.store_name}</span>?
                </p>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setPending(null)}
                  className="h-9 flex-1 rounded-lg border border-[#ebe9e6] text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => performSwitch(pending)}
                  disabled={switching}
                  className="h-9 flex-1 rounded-lg bg-[#06b6d4] text-sm font-semibold text-white hover:bg-[#0891b2] disabled:opacity-60"
                >
                  {switching ? 'Cambiando…' : 'Cambiar'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="border-b border-[#f5f4f1] px-4 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
                  Cambiar de tienda
                </p>
              </div>
              <div className="max-h-[320px] overflow-y-auto py-1">
                {stores.map((s) => {
                  const isActive = s.store_id === active?.store_id
                  return (
                    <button
                      key={s.store_id}
                      onClick={() => handleSelect(s)}
                      disabled={switching}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[#fafaf9] disabled:opacity-60"
                    >
                      <span className="flex items-center gap-2.5">
                        <Store
                          size={14}
                          className={isActive ? 'text-[#06b6d4]' : 'text-[#a8a29e]'}
                        />
                        <span
                          className={
                            isActive
                              ? 'font-semibold text-[#1a1a1a]'
                              : 'text-[#525252]'
                          }
                        >
                          {s.store_name}
                        </span>
                      </span>
                      {isActive && <Check size={15} className="text-[#06b6d4]" />}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
