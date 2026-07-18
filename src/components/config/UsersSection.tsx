import { useEffect, useState } from 'react'
import { Users, Plus, X, Store, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStoreUsers } from '@/hooks/useConfig'
import { useConfigMutations } from '@/hooks/useConfigMutations'
import { useAuth } from '@/hooks/useAuth'
import { useMyStores } from '@/hooks/useStores'
import {
  useUserStoreAccess,
  useGrantStoreAccess,
  useRevokeStoreAccess,
} from '@/hooks/useUserStores'
import { useRoles } from '@/hooks/useRoles'
import { usePermissions } from '@/hooks/usePermissions'
import { isManagerRole } from '@/lib/permissions'
import type { Profile } from '@/types/database.types'

// ─── Store Access Panel (solo admins) ─────────────────────────────────────────

function StoreAccessPanel({ user }: { user: Profile }) {
  // Tiendas que el admin actual puede delegar = sus propias tiendas accesibles.
  const { data: assignable = [], isLoading: loadingStores } = useMyStores()
  const { data: access = [], isLoading: loadingAccess } = useUserStoreAccess(user.id)
  const grant = useGrantStoreAccess()
  const revoke = useRevokeStoreAccess()

  const accessSet = new Set(access)
  const busy = grant.isPending || revoke.isPending

  function toggle(storeId: string, isBase: boolean) {
    if (isBase) {
      toast.error('No puedes quitar la tienda base del usuario')
      return
    }
    if (accessSet.has(storeId)) {
      revoke.mutate({ userId: user.id, storeId })
    } else {
      grant.mutate({ userId: user.id, storeId })
    }
  }

  return (
    <div className="border-t border-[#f5f4f1] bg-[#fafaf9] px-5 py-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
        Tiendas con acceso
      </p>
      {loadingStores || loadingAccess ? (
        <div className="space-y-1.5">
          {[1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {assignable.map((s) => {
            const isBase = s.store_id === user.store_id
            const checked = accessSet.has(s.store_id) || isBase
            return (
              <button
                key={s.store_id}
                onClick={() => toggle(s.store_id, isBase)}
                disabled={busy}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#ebe9e6] bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-[#f8f7f5] disabled:opacity-60"
              >
                <span className="flex items-center gap-2.5">
                  <Store size={14} className="text-[#a8a29e]" />
                  <span className="text-[#1a1a1a]">{s.store_name}</span>
                  {isBase && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                      base
                    </span>
                  )}
                </span>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                    checked
                      ? 'border-cyan-500 bg-cyan-500 text-white'
                      : 'border-[#ebe9e6] bg-white'
                  }`}
                >
                  {checked && <Check size={13} />}
                </span>
              </button>
            )
          })}
          <p className="pt-1 text-[11px] text-[#a8a29e]">
            Solo puedes delegar tiendas a las que tú tienes acceso.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Avatar ──────────────────────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)' }}
    >
      {initials}
    </div>
  )
}

// ─── Role Badge ───────────────────────────────────────────────────────────────

function RoleBadge({ name, manager }: { name: string; manager: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        manager ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {name}
    </span>
  )
}

// ─── Create User Modal ────────────────────────────────────────────────────────

interface CreateUserModalProps {
  onClose: () => void
  onCreated: () => void
}

function CreateUserModal({ onClose, onCreated }: CreateUserModalProps) {
  const { createUser } = useConfigMutations()
  const { data: roles = [] } = useRoles()
  const { isOwner } = usePermissions()
  // Solo se pueden asignar tiendas a las que el admin actual tiene acceso.
  const { data: myStores = [], isLoading: loadingStores } = useMyStores()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [roleId, setRoleId] = useState<string>('')
  // Orden importa: la primera es la base / activa inicial.
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([])

  // El rol Dueño ('*') solo lo puede asignar otro Dueño.
  const availableRoles = roles.filter((r) => isOwner || !r.permissions.includes('*'))
  const selectedRole = roles.find((r) => r.id === roleId) ?? null
  // Un rol "gestor" (usuarios.gestionar / '*') habilita multi-tienda.
  const manager = selectedRole ? isManagerRole(selectedRole.permissions) : false

  // Preseleccionar un rol por defecto (el primero no-gestor, típicamente Vendedor).
  useEffect(() => {
    if (!roleId && availableRoles.length > 0) {
      const operativo = availableRoles.find((r) => !isManagerRole(r.permissions))
      setRoleId((operativo ?? availableRoles[0]).id)
    }
  }, [availableRoles, roleId])

  // Si solo hay una tienda asignable, se preselecciona.
  useEffect(() => {
    if (myStores.length === 1 && selectedStoreIds.length === 0) {
      setSelectedStoreIds([myStores[0].store_id])
    }
  }, [myStores, selectedStoreIds.length])

  function handleRoleChange(nextId: string) {
    setRoleId(nextId)
    const next = roles.find((r) => r.id === nextId)
    // Un rol no-gestor solo puede tener una tienda: recorta la selección.
    if (next && !isManagerRole(next.permissions)) {
      setSelectedStoreIds((prev) => prev.slice(0, 1))
    }
  }

  function toggleStore(storeId: string) {
    setSelectedStoreIds((prev) => {
      if (!manager) return [storeId]
      return prev.includes(storeId)
        ? prev.filter((id) => id !== storeId)
        : [...prev, storeId]
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      toast.error('Todos los campos son requeridos')
      return
    }
    if (!roleId) {
      toast.error('Selecciona un rol')
      return
    }
    if (selectedStoreIds.length === 0) {
      toast.error('Selecciona al menos una tienda')
      return
    }
    try {
      await createUser.mutateAsync({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        role_id: roleId,
        store_ids: selectedStoreIds,
      })
      onCreated()
    } catch {
      // toast shown by mutation
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-[480px] rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#f5f4f1] px-6 py-5">
          <div>
            <h2
              className="text-[22px] font-semibold leading-tight tracking-[-0.025em] text-[#1a1a1a]"
              style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
            >
              Nuevo usuario
            </h2>
            <p className="mt-0.5 text-[13px] text-[#737373]">Crear acceso para un colaborador</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Nombre completo
            </label>
            <input
              autoFocus
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ana García"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Correo electrónico
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ana@tienda.com"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Contraseña temporal
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">Rol</label>
            <select
              value={roleId}
              onChange={(e) => handleRoleChange(e.target.value)}
              className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            >
              {availableRoles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* Tiendas */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              {manager ? 'Tiendas con acceso' : 'Tienda'}
            </label>
            {loadingStores ? (
              <div className="space-y-1.5">
                {[1, 2].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : myStores.length === 0 ? (
              <p className="text-xs text-[#a8a29e]">No tienes tiendas para asignar.</p>
            ) : (
              <div className="space-y-1.5">
                {myStores.map((s) => {
                  const idx = selectedStoreIds.indexOf(s.store_id)
                  const checked = idx !== -1
                  const isBase = idx === 0
                  return (
                    <button
                      key={s.store_id}
                      type="button"
                      onClick={() => toggleStore(s.store_id)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#ebe9e6] bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-[#f8f7f5]"
                    >
                      <span className="flex items-center gap-2.5">
                        <Store size={14} className="text-[#a8a29e]" />
                        <span className="text-[#1a1a1a]">{s.store_name}</span>
                        {manager && isBase && (
                          <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
                            principal
                          </span>
                        )}
                      </span>
                      <span
                        className={`flex h-5 w-5 items-center justify-center border ${
                          manager ? 'rounded-md' : 'rounded-full'
                        } ${
                          checked
                            ? 'border-cyan-500 bg-cyan-500 text-white'
                            : 'border-[#ebe9e6] bg-white'
                        }`}
                      >
                        {checked && <Check size={13} />}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            {manager && myStores.length > 0 && (
              <p className="mt-1.5 text-[11px] text-[#a8a29e]">
                La primera tienda será su tienda principal y la activa al iniciar
                sesión.
              </p>
            )}
          </div>

          {/* Footer */}
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
              disabled={createUser.isPending}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#06b6d4] text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95 disabled:opacity-60"
            >
              {createUser.isPending ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── User Row ─────────────────────────────────────────────────────────────────

function UserRow({ user }: { user: Profile }) {
  const { profile: currentProfile } = useAuth()
  const { updateUserRole, toggleUserActive } = useConfigMutations()
  const { data: roles = [] } = useRoles()
  const { isOwner } = usePermissions()
  const isSelf = user.id === currentProfile?.id
  const [showStores, setShowStores] = useState(false)

  // Rol RBAC del usuario (por role_id). Fallback al enum legacy si no se encuentra.
  const userRole = roles.find((r) => r.id === user.role_id) ?? null
  const roleName = userRole?.name ?? (user.role === 'admin' ? 'Admin' : 'Vendedor')
  const manager = userRole ? isManagerRole(userRole.permissions) : user.role === 'admin'
  // El rol Dueño ('*') solo lo puede asignar otro Dueño.
  const assignableRoles = roles.filter((r) => isOwner || !r.permissions.includes('*'))

  // Conteo de tiendas con acceso (solo gestores multi-tienda). Requiere la
  // política admin SELECT de user_stores (migración 014) para leer accesos.
  const { data: storeAccess = [] } = useUserStoreAccess(manager ? user.id : null)

  return (
    <div className="border-b border-[#f5f4f1] last:border-0">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <Avatar name={user.full_name} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1a1a1a] truncate">
            {user.full_name}
            {isSelf && (
              <span className="ml-2 text-[11px] font-normal text-[#a8a29e]">(tú)</span>
            )}
          </p>
          <p className="text-xs text-[#737373] truncate">{user.email}</p>
        </div>

        <RoleBadge name={roleName} manager={manager} />

        {/* Tiendas con acceso (solo gestores multi-tienda) */}
        {manager && (
          <button
            onClick={() => setShowStores((v) => !v)}
            title="Tiendas con acceso"
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
              showStores
                ? 'border-cyan-300 bg-cyan-50 text-cyan-700'
                : 'border-[#ebe9e6] bg-white text-[#525252] hover:bg-slate-50'
            }`}
          >
            <Store size={13} />
            Tiendas{storeAccess.length > 0 ? ` (${storeAccess.length})` : ''}
          </button>
        )}

        {/* Role select (roles RBAC de la org) */}
        {!isSelf && (
          <select
            value={user.role_id ?? ''}
            onChange={(e) =>
              void updateUserRole.mutateAsync({ id: user.id, roleId: e.target.value })
            }
            className="h-8 rounded-lg border border-[#ebe9e6] bg-white px-2 text-xs text-[#525252] outline-none focus:border-cyan-400"
          >
            {/* Si el rol actual no está entre los asignables (p. ej. Dueño y no
                soy Dueño), se muestra igual para no perder la selección. */}
            {userRole && !assignableRoles.some((r) => r.id === userRole.id) && (
              <option value={userRole.id}>{userRole.name}</option>
            )}
            {assignableRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}

        {/* Active toggle */}
        {!isSelf && (
          <button
            onClick={() =>
              void toggleUserActive.mutateAsync({ id: user.id, is_active: !user.is_active })
            }
            title={user.is_active ? 'Desactivar acceso' : 'Activar acceso'}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
              user.is_active ? 'bg-cyan-500' : 'bg-slate-200'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                user.is_active ? 'translate-x-4' : 'translate-x-1'
              }`}
            />
          </button>
        )}
      </div>

      {manager && showStores && <StoreAccessPanel user={user} />}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function UsersSection() {
  const { data: users = [], isLoading } = useStoreUsers()
  const [showModal, setShowModal] = useState(false)

  const activeUsers = users.filter((u) => u.is_active)
  const inactiveUsers = users.filter((u) => !u.is_active)

  return (
    <div className="space-y-6">
      <div className="rounded-[14px] border border-[#ebe9e6] bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f5f4f1] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-100 text-cyan-600">
              <Users size={15} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#1a1a1a]">Usuarios</h2>
              <p className="text-xs text-[#737373]">
                {activeUsers.length} activo{activeUsers.length !== 1 ? 's' : ''}
                {inactiveUsers.length > 0 &&
                  ` · ${inactiveUsers.length} inactivo${inactiveUsers.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-slate-50"
          >
            <Plus size={13} />
            Nuevo usuario
          </button>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="space-y-0 p-0">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-3.5"
              >
                <div className="h-9 w-9 animate-pulse rounded-full bg-slate-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-32 animate-pulse rounded bg-slate-100" />
                  <div className="h-3 w-48 animate-pulse rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
              <Users size={22} className="text-slate-300" />
            </div>
            <p className="text-sm font-medium text-slate-500">Sin usuarios</p>
          </div>
        ) : (
          <>
            {activeUsers.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
            {inactiveUsers.length > 0 && (
              <div className="border-t border-[#f5f4f1] pt-2">
                <p className="mb-1 px-5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Inactivos
                </p>
                {inactiveUsers.map((u) => (
                  <UserRow key={u.id} user={u} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <CreateUserModal
          onClose={() => setShowModal(false)}
          onCreated={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
