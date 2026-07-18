import { useState } from 'react'
import { ShieldCheck, Plus, Pencil, Trash2, Lock, AlertTriangle } from 'lucide-react'
import { useRoles } from '@/hooks/useRoles'
import { useRoleMutations } from '@/hooks/useRoleMutations'
import { RoleEditorModal } from './RoleEditorModal'
import type { Role } from '@/types/database.types'

// ─── Confirmación de borrado ──────────────────────────────────────────────────

function DeleteRoleModal({
  role,
  onClose,
}: {
  role: Role
  onClose: () => void
}) {
  const { deleteRole } = useRoleMutations()
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-[420px] rounded-[14px] bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2 text-red-600">
          <AlertTriangle size={18} />
          <h2 className="text-base font-semibold">Eliminar rol</h2>
        </div>
        <p className="text-sm text-[#525252]">
          ¿Seguro que quieres eliminar el rol{' '}
          <span className="font-semibold">{role.name}</span>? Los usuarios que lo
          tengan quedarán sin rol hasta que les asignes otro.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
          >
            Cancelar
          </button>
          <button
            onClick={() =>
              deleteRole.mutate(role.id, { onSuccess: onClose })
            }
            disabled={deleteRole.isPending}
            className="h-10 flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {deleteRole.isPending ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Fila de rol ──────────────────────────────────────────────────────────────

function RoleRow({
  role,
  onEdit,
  onDelete,
}: {
  role: Role
  onEdit: () => void
  onDelete: () => void
}) {
  const isOwner = role.permissions.includes('*')
  const summary = isOwner
    ? 'Acceso total'
    : `${role.permissions.length} permiso${role.permissions.length !== 1 ? 's' : ''}`

  return (
    <div className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-3.5 last:border-0">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-100 text-cyan-600">
        <ShieldCheck size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-[#1a1a1a]">{role.name}</p>
          {isOwner && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
              <Lock size={10} /> Rol protegido
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-[#737373]">{summary}</p>
      </div>

      {/* El rol Dueño ('*') es inmutable: sin editar ni borrar */}
      {!isOwner && (
        <>
          <button
            onClick={onEdit}
            title="Editar rol"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-2.5 text-xs font-medium text-[#525252] hover:bg-slate-50"
          >
            <Pencil size={13} /> Editar
          </button>
          <button
            onClick={onDelete}
            title="Eliminar rol"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#ebe9e6] bg-white text-[#737373] hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={13} />
          </button>
        </>
      )}
    </div>
  )
}

// ─── Sección ──────────────────────────────────────────────────────────────────

export default function RolesSection() {
  const { data: roles = [], isLoading } = useRoles()
  const [editing, setEditing] = useState<Role | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Role | null>(null)

  return (
    <div className="rounded-[14px] border border-[#ebe9e6] bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#f5f4f1] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-100 text-cyan-600">
            <ShieldCheck size={15} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#1a1a1a]">Roles y permisos</h2>
            <p className="text-xs text-[#737373]">
              {roles.length} rol{roles.length !== 1 ? 'es' : ''}
            </p>
          </div>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-slate-50"
        >
          <Plus size={13} />
          Crear rol
        </button>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-3.5 last:border-0"
            >
              <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        roles.map((r) => (
          <RoleRow
            key={r.id}
            role={r}
            onEdit={() => setEditing(r)}
            onDelete={() => setDeleting(r)}
          />
        ))
      )}

      {(creating || editing) && (
        <RoleEditorModal
          role={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
      {deleting && (
        <DeleteRoleModal role={deleting} onClose={() => setDeleting(null)} />
      )}
    </div>
  )
}
