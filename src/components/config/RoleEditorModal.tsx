import { useState } from 'react'
import { X, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import { useRoleMutations } from '@/hooks/useRoleMutations'
import { PERMISSION_GROUPS } from '@/lib/permissionsCatalog'
import type { Role } from '@/types/database.types'

interface RoleEditorModalProps {
  role: Role | null // null = crear
  onClose: () => void
}

export function RoleEditorModal({ role, onClose }: RoleEditorModalProps) {
  const isEdit = !!role
  const { createRole, updateRole } = useRoleMutations()
  const [name, setName] = useState(role?.name ?? '')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(role?.permissions ?? []),
  )

  const pending = createRole.isPending || updateRole.isPending

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('El nombre del rol es requerido')
      return
    }
    // El rol Dueño es inmutable: no debería llegar aquí, pero se bloquea.
    if (role?.permissions.includes('*')) {
      toast.error('El rol Dueño no se puede editar')
      return
    }
    const permissions = [...selected]
    try {
      if (isEdit && role) {
        await updateRole.mutateAsync({ id: role.id, name: trimmed, permissions })
      } else {
        await createRole.mutateAsync({ name: trimmed, permissions })
      }
      onClose()
    } catch {
      // toast mostrado por la mutación
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-[560px] flex-col rounded-[14px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-start justify-between border-b border-[#f5f4f1] px-6 py-5">
          <div>
            <h2
              className="text-[22px] font-semibold leading-tight tracking-[-0.025em] text-[#1a1a1a]"
              style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
            >
              {isEdit ? 'Editar rol' : 'Nuevo rol'}
            </h2>
            <p className="mt-0.5 text-[13px] text-[#737373]">
              Define qué puede hacer quien tenga este rol
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] hover:bg-[#ebe9e6]"
          >
            <X size={14} className="text-[#525252]" />
          </button>
        </div>

        {/* Body */}
        <form
          id="role-editor-form"
          onSubmit={(e) => void handleSubmit(e)}
          className="flex-1 overflow-y-auto px-6 py-5"
        >
          <div className="mb-5">
            <label className="mb-1.5 block text-xs font-medium text-[#525252]">
              Nombre del rol
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Encargado de tienda"
              className="h-10 w-full rounded-lg border border-[#ebe9e6] px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </div>

          <p className="mb-2 text-xs font-medium text-[#525252]">Permisos</p>
          <div className="space-y-4">
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-[#a8a29e]">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.permissions.map((perm) => {
                    const checked = selected.has(perm.key)
                    return (
                      <button
                        key={perm.key}
                        type="button"
                        onClick={() => toggle(perm.key)}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#ebe9e6] bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-[#f8f7f5]"
                      >
                        <span className="text-[#1a1a1a]">{perm.label}</span>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                            checked
                              ? 'border-cyan-500 bg-cyan-500 text-white'
                              : 'border-[#ebe9e6] bg-white'
                          }`}
                        >
                          {checked && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M20 6L9 17l-5-5"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </form>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-[#f5f4f1] px-6 py-4">
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-[#f8f7f5] px-3 py-2 text-[11px] text-[#737373]">
            <Info size={13} className="mt-0.5 shrink-0 text-[#a8a29e]" />
            <span>
              Los cambios de permisos se aplican cuando cada usuario cierra sesión y
              vuelve a entrar.
            </span>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-10 flex-1 rounded-lg border border-[#ebe9e6] bg-white text-sm font-medium text-[#525252] hover:bg-[#f8f7f5]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="role-editor-form"
              disabled={pending}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#06b6d4] text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95 disabled:opacity-60"
            >
              {pending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear rol'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
