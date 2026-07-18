import { useState, useEffect, useRef } from 'react'
import { Store as StoreIcon, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useStoreConfig, useResolvedConfig } from '@/hooks/useConfig'
import { useConfigMutations } from '@/hooks/useConfigMutations'

const TIMEZONES = [
  { value: 'America/Bogota', label: 'América/Bogotá (UTC-5)' },
  { value: 'America/Mexico_City', label: 'América/Ciudad de México (UTC-6)' },
  { value: 'America/Lima', label: 'América/Lima (UTC-5)' },
  { value: 'America/Buenos_Aires', label: 'América/Buenos Aires (UTC-3)' },
  { value: 'America/Santiago', label: 'América/Santiago (UTC-3)' },
]

function SkeletonField() {
  return <div className="h-10 w-full animate-pulse rounded-lg bg-slate-100" />
}

export default function StoreSection() {
  const { data: store, isLoading } = useStoreConfig()
  const config = useResolvedConfig()
  const { updateStore, updateStoreConfig, uploadLogo } = useConfigMutations()
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [timezone, setTimezone] = useState('America/Bogota')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!store) return
    setName(store.name)
    setAddress(store.address ?? '')
    setPhone(store.phone ?? '')
    setTimezone(config.timezone)
  }, [store, config])

  async function handleSave() {
    if (!name.trim()) {
      toast.error('El nombre de la tienda es requerido')
      return
    }
    setSaving(true)
    try {
      await updateStore.mutateAsync({
        name: name.trim(),
        address: address.trim() || null,
        phone: phone.trim() || null,
      })
      await updateStoreConfig.mutateAsync({ timezone })
      toast.success('Datos de la tienda guardados')
    } catch {
      // toast shown by mutation
    } finally {
      setSaving(false)
    }
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('El archivo debe ser una imagen')
      return
    }
    await uploadLogo.mutateAsync(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  const logoUrl = store?.logo_url
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <div className="space-y-6">
      <div className="rounded-[14px] border border-[#ebe9e6] bg-white">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#f5f4f1] px-5 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-100 text-cyan-600">
            <StoreIcon size={15} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#1a1a1a]">Datos de la tienda</h2>
            <p className="text-xs text-[#737373]">Información básica y apariencia</p>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-5 px-5 py-5">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <div className="relative">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Logo"
                  className="h-16 w-16 rounded-full object-cover shadow-[0_0_0_2px_#ebe9e6]"
                />
              ) : (
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-white"
                  style={{ background: 'linear-gradient(135deg,#22d3ee,#0891b2)' }}
                >
                  {initials || 'G'}
                </div>
              )}
              {uploadLogo.isPending && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                </div>
              )}
            </div>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleLogoChange(e)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploadLogo.isPending}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-[#ebe9e6] bg-white px-3 text-xs font-medium text-[#525252] hover:bg-slate-50 disabled:opacity-50"
              >
                <Upload size={12} />
                Cambiar logo
              </button>
              <p className="mt-1 text-[11px] text-[#a8a29e]">JPG, PNG o SVG</p>
            </div>
          </div>

          {/* Fields */}
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#525252]">
                Nombre de la tienda <span className="text-red-400">*</span>
              </label>
              {isLoading ? (
                <SkeletonField />
              ) : (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Tienda G-Pulso"
                  className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#525252]">Dirección</label>
              {isLoading ? (
                <SkeletonField />
              ) : (
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Calle 123 #45-67, Bogotá"
                  className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#525252]">Teléfono</label>
              {isLoading ? (
                <SkeletonField />
              ) : (
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+57 300 000 0000"
                  className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                />
              )}
            </div>
          </div>

          {/* Config */}
          <div className="border-t border-[#f5f4f1] pt-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.05em] text-[#737373]">
              Configuración regional
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#525252]">
                  Zona horaria
                </label>
                {isLoading ? (
                  <SkeletonField />
                ) : (
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-white px-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#525252]">Moneda</label>
                <input
                  value="COP — Peso colombiano"
                  disabled
                  className="h-10 w-full rounded-lg border border-[#ebe9e6] bg-[#f8f7f5] px-3 text-sm text-[#a8a29e]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-[#f5f4f1] px-5 py-4">
          <button
            onClick={() => void handleSave()}
            disabled={saving || isLoading}
            className="flex h-9 items-center gap-2 rounded-lg bg-[#06b6d4] px-4 text-sm font-semibold text-white shadow-[0_4px_12px_#06b6d440] hover:brightness-95 disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}
