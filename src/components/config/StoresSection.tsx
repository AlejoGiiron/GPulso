import { useState } from 'react'
import { Building2, Plus, X, MapPin, Phone, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { getActiveStoreId } from '@/hooks/useActiveStoreId'
import {
  useAllMyStoresDetailed,
  useCreateStore,
  useUpdateStore,
  useToggleStoreActive,
} from '@/hooks/useStores'
import type { Store } from '@/types/database.types'

// ─── Create / Edit modal ──────────────────────────────────────────────────────

interface StoreModalProps {
  store: Store | null // null = crear
  onClose: () => void
}

function StoreModal({ store, onClose }: StoreModalProps) {
  const isEdit = !!store
  const createStore = useCreateStore()
  const updateStore = useUpdateStore()
  const [name, setName] = useState(store?.name ?? '')
  const [address, setAddress] = useState(store?.address ?? '')
  const [phone, setPhone] = useState(store?.phone ?? '')

  const pending = createStore.isPending || updateStore.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('El nombre de la sucursal es requerido')
      return
    }
    const payload = {
      name: trimmed,
      address: address.trim() || null,
      phone: phone.trim() || null,
    }
    try {
      if (isEdit) {
        await updateStore.mutateAsync({ id: store.id, ...payload })
      } else {
        await createStore.mutateAsync(payload)
        toast.success(`Sucursal "${trimmed}" creada. Ya tienes acceso a ella.`)
        toast(
          'La sucursal está lista. Recuerda configurar sus productos, métodos de pago y abrir un turno de caja antes de vender.',
          { icon: 'ℹ️', duration: 6_000 },
        )
      }
      onClose()
    } catch {
      // toast shown by mutation onError
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-[480px] rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[#f5f4f1] px-6 py-5">
          <div>
            <h2
              className="text-[22px] font-semibold leading-tight tracking-[-0.025em] text-[#1a1a1a]"
              style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
            >
              {isEdit ? 'Editar sucursal' : 'Nueva sucursal'}
            </h2>
            <p className="mt-0.5 text-[13px] text-[#737373]">
              {isEdit
                ? 'Actualiza los datos de la sucursal'
                : 'Crea una sucursal nueva e independiente'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Nombre de la sucursal
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sucursal Centro"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Dirección
            </label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Cra 1 #2-3"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Teléfono
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="3001234567"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>

          {!isEdit && (
            <p className="rounded-lg bg-[#f8f7f5] px-3 py-2 text-[11px] text-[#737373]">
              Cada sucursal es independiente: no se copian productos ni
              configuración. Tendrás acceso a ella apenas se cree.
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#06b6d4] text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95 disabled:opacity-60"
            >
              {pending
                ? 'Guardando…'
                : isEdit
                  ? 'Guardar cambios'
                  : 'Crear sucursal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Store row ────────────────────────────────────────────────────────────────

function StoreRow({
  store,
  isCurrent,
  onEdit,
}: {
  store: Store
  isCurrent: boolean
  onEdit: () => void
}) {
  const toggleActive = useToggleStoreActive()

  return (
    <div className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-3.5 last:border-0">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-100 text-cyan-600">
        <Building2 size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-[#1a1a1a]">{store.name}</p>
          {isCurrent && (
            <span className="shrink-0 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold text-cyan-700">
              Tienda actual
            </span>
          )}
          {!store.is_active && (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
              Inactiva
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#737373]">
          {store.address && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={11} /> {store.address}
            </span>
          )}
          {store.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone size={11} /> {store.phone}
            </span>
          )}
          {!store.address && !store.phone && (
            <span className="text-[#a8a29e]">Sin dirección ni teléfono</span>
          )}
        </div>
      </div>

      {/* Toggle activa/inactiva */}
      <button
        onClick={() =>
          void toggleActive.mutateAsync({ id: store.id, is_active: !store.is_active })
        }
        disabled={toggleActive.isPending}
        title={store.is_active ? 'Desactivar sucursal' : 'Activar sucursal'}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-60 ${
          store.is_active ? 'bg-cyan-500' : 'bg-slate-200'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
            store.is_active ? 'translate-x-4' : 'translate-x-1'
          }`}
        />
      </button>

      <button
        onClick={onEdit}
        title="Editar sucursal"
        className="flex h-8 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-2.5 text-xs font-medium text-[#525252] hover:bg-slate-50"
      >
        <Pencil size={13} />
        Editar
      </button>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StoresSection() {
  const { profile } = useAuth()
  const { data: stores = [], isLoading } = useAllMyStoresDetailed()
  const [modalStore, setModalStore] = useState<Store | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const currentStoreId = getActiveStoreId(profile)

  return (
    <div className="rounded-[14px] border border-[#ebe9e6] bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#f5f4f1] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-100 text-cyan-600">
            <Building2 size={15} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#1a1a1a]">Sucursales</h2>
            <p className="text-xs text-[#737373]">
              {stores.length} sucursal{stores.length !== 1 ? 'es' : ''} con acceso
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-slate-50"
        >
          <Plus size={13} />
          Nueva sucursal
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div>
          {[1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-3.5 last:border-0"
            >
              <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-48 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : stores.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
            <Building2 size={22} className="text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-500">Sin sucursales</p>
        </div>
      ) : (
        stores.map((s) => (
          <StoreRow
            key={s.id}
            store={s}
            isCurrent={s.id === currentStoreId}
            onEdit={() => setModalStore(s)}
          />
        ))
      )}

      {(showCreate || modalStore) && (
        <StoreModal
          store={modalStore}
          onClose={() => {
            setShowCreate(false)
            setModalStore(null)
          }}
        />
      )}
    </div>
  )
}
