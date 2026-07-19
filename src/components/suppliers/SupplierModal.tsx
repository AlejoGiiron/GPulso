import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import {
  useCreateSupplier,
  useUpdateSupplier,
  type SupplierFormData,
} from '@/hooks/useSupplierMutations'
import type { Supplier } from '@/types/database.types'

interface SupplierModalProps {
  supplier?: Supplier | null
  onClose: () => void
  onSaved?: (supplier: Supplier) => void
}

const LABEL =
  'mb-1.5 block text-[12px] font-semibold uppercase tracking-[.05em] text-[#737373]'
const INPUT =
  'h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none transition focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]'

export default function SupplierModal({
  supplier,
  onClose,
  onSaved,
}: SupplierModalProps) {
  const isEdit = !!supplier
  const [form, setForm] = useState<SupplierFormData>({
    name: supplier?.name ?? '',
    nit: supplier?.nit ?? '',
    contact_name: supplier?.contact_name ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    address: supplier?.address ?? '',
    payment_terms_days: supplier?.payment_terms_days ?? 30,
    notes: supplier?.notes ?? '',
  })

  const createSupplier = useCreateSupplier()
  const updateSupplier = useUpdateSupplier()
  const isPending = createSupplier.isPending || updateSupplier.isPending

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  function setField<K extends keyof SupplierFormData>(
    key: K,
    value: SupplierFormData[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit() {
    if (!form.name.trim()) return
    if (isEdit && supplier) {
      updateSupplier.mutate(
        { id: supplier.id, data: form },
        { onSuccess: (s) => { onSaved?.(s); onClose() } },
      )
    } else {
      createSupplier.mutate(form, {
        onSuccess: (s) => { onSaved?.(s); onClose() },
      })
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(15,23,42,0.5)] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[90vh] w-full max-w-[540px] flex-col rounded-2xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-[#f5f4f1] px-7 py-5">
          <div>
            <h2
              className="tracking-[-0.025em]"
              style={{ fontFamily: 'Bricolage Grotesque, sans-serif', fontSize: 22, fontWeight: 600 }}
            >
              {isEdit ? 'Editar proveedor' : 'Nuevo proveedor'}
            </h2>
            <p className="mt-1 text-sm text-[#737373]">
              {isEdit
                ? 'Actualiza los datos del proveedor.'
                : 'Registra un proveedor para gestionar facturas de compra.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-[#f5f4f1] text-[#525252] hover:bg-[#ebe9e6]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-7 py-5">
          <div>
            <label className={LABEL}>Nombre *</label>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Ej. Distribuciones El Éxito"
              className={INPUT}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>NIT</label>
              <input
                value={form.nit}
                onChange={(e) => setField('nit', e.target.value)}
                placeholder="900.123.456-7"
                className={`${INPUT} font-mono`}
              />
            </div>
            <div>
              <label className={LABEL}>Días de pago</label>
              <input
                type="number"
                min={0}
                value={form.payment_terms_days}
                onChange={(e) =>
                  setField('payment_terms_days', Number(e.target.value))
                }
                className={`${INPUT} font-mono`}
              />
            </div>
          </div>

          <div>
            <label className={LABEL}>Contacto</label>
            <input
              value={form.contact_name}
              onChange={(e) => setField('contact_name', e.target.value)}
              placeholder="Nombre de la persona de contacto"
              className={INPUT}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Teléfono</label>
              <input
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                placeholder="3001234567"
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>Email</label>
              <input
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                placeholder="correo@proveedor.com"
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label className={LABEL}>Dirección</label>
            <input
              value={form.address}
              onChange={(e) => setField('address', e.target.value)}
              placeholder="Dirección del proveedor"
              className={INPUT}
            />
          </div>

          <div>
            <label className={LABEL}>Notas</label>
            <textarea
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder="Información adicional sobre este proveedor…"
              rows={3}
              className="w-full resize-none rounded-lg border border-[#ebe9e6] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#06b6d4] focus:shadow-[0_0_0_4px_#06b6d41a]"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-3 border-t border-[#f5f4f1] px-7 py-5">
          <button
            onClick={onClose}
            className="h-[42px] flex-1 rounded-lg border border-[#ebe9e6] text-sm font-medium text-[#404040] hover:bg-[#f8f7f5]"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !form.name.trim()}
            className="h-[42px] flex-1 rounded-lg bg-[#06b6d4] text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] transition hover:bg-[#0891b2] disabled:opacity-50"
          >
            {isPending
              ? 'Guardando…'
              : isEdit
                ? 'Guardar cambios'
                : 'Crear proveedor'}
          </button>
        </div>
      </div>
    </div>
  )
}
