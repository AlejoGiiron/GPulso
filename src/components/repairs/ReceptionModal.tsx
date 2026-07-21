import { useState } from 'react'
import { X, Search, UserPlus, Lock, ShieldAlert, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCustomerSearch } from '@/hooks/useCustomers'
import { useCreateCustomer } from '@/hooks/useCustomerMutations'
import { useCreateRepair } from '@/hooks/useRepairMutations'
import { useStoreConfig } from '@/hooks/useConfig'
import {
  CHECKLIST_DANOS,
  CHECKLIST_VERIFICACIONES,
} from '@/lib/repairs'
import type { Customer, RepairChecklist, RepairOrder } from '@/types/database.types'
import {
  RepairReceptionReceipt,
  RepairReceptionReceiptPrint,
} from './RepairReceipts'

interface Props {
  onClose: () => void
  onCreated?: (repair: RepairOrder) => void
}

export function ReceptionModal({ onClose, onCreated }: Props) {
  const { data: store } = useStoreConfig()
  const resolvedStoreName = store?.name ?? 'Taller'
  const create = useCreateRepair()

  // Cliente
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [search, setSearch] = useState('')
  const { data: results = [], isFetching } = useCustomerSearch(search)
  const [creatingCustomer, setCreatingCustomer] = useState(false)

  // Equipo
  const [marca, setMarca] = useState('')
  const [modelo, setModelo] = useState('')
  const [imei, setImei] = useState('')
  const [color, setColor] = useState('')
  const [falla, setFalla] = useState('')
  const [danos, setDanos] = useState<Record<string, boolean>>({})
  const [verif, setVerif] = useState<Record<string, boolean>>({})
  const [observaciones, setObservaciones] = useState('')
  const [accesorios, setAccesorios] = useState('')
  const [password, setPassword] = useState('')
  const [precio, setPrecio] = useState('')

  // Comprobante tras crear
  const [created, setCreated] = useState<RepairOrder | null>(null)

  const canSubmit =
    !!customer && marca.trim() && modelo.trim() && falla.trim() && !create.isPending

  const handleSubmit = async () => {
    if (!customer) return toast.error('Selecciona o crea el cliente')
    if (!marca.trim() || !modelo.trim()) return toast.error('Falta marca o modelo')
    if (!falla.trim()) return toast.error('Describe la falla')
    const checklist: RepairChecklist = { danos, verificaciones: verif }
    const repair = await create.mutateAsync({
      customer_id: customer.id,
      marca,
      modelo,
      imei_serial: imei || null,
      color: color || null,
      falla_reportada: falla,
      checklist,
      observaciones: observaciones || null,
      accesorios: accesorios || null,
      password_equipo: password || null,
      precio: precio.trim() ? Math.max(0, Math.round(Number(precio))) : null,
    })
    setCreated(repair)
    onCreated?.(repair)
  }

  // Vista de comprobante tras crear.
  if (created) {
    const receiptData = {
      order_number: created.order_number,
      marca: created.marca,
      modelo: created.modelo,
      imei_serial: created.imei_serial,
      color: created.color,
      created_at: created.created_at,
      customer_name: customer?.full_name ?? '—',
      customer_phone: customer?.phone ?? null,
      falla_reportada: created.falla_reportada,
      checklist: created.checklist,
      accesorios: created.accesorios,
      observaciones: created.observaciones,
    }
    return (
      <ModalShell title={`Equipo recibido · #${created.order_number}`} onClose={onClose}>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-[300px] rounded-lg border border-gray-200 bg-white shadow-sm">
            <RepairReceptionReceipt data={receiptData} storeName={resolvedStoreName} printedAt={new Date()} />
          </div>
          <RepairReceptionReceiptPrint data={receiptData} storeName={resolvedStoreName} printedAt={new Date()} />
        </div>
        <Footer>
          <button onClick={onClose} className="btn-secondary">Cerrar</button>
          <button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1.5">
            <Printer size={15} /> Imprimir recepción
          </button>
        </Footer>
      </ModalShell>
    )
  }

  return (
    <ModalShell title="Recibir equipo" onClose={onClose}>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {/* Cliente */}
        <Section label="Cliente">
          {customer ? (
            <div className="flex items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2">
              <div>
                <div className="text-sm font-semibold text-gray-900">{customer.full_name}</div>
                <div className="text-xs text-gray-500">{customer.phone ?? 'Sin teléfono'}</div>
              </div>
              <button onClick={() => setCustomer(null)} className="text-xs font-medium text-cyan-700 hover:underline">
                Cambiar
              </button>
            </div>
          ) : creatingCustomer ? (
            <QuickCreateCustomer
              onCancel={() => setCreatingCustomer(false)}
              onCreated={(c) => {
                setCustomer(c)
                setCreatingCustomer(false)
              }}
            />
          ) : (
            <div>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar cliente por nombre o teléfono…"
                  className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                />
              </div>
              {search.trim().length >= 2 && (
                <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-gray-100">
                  {isFetching && <div className="px-3 py-2 text-xs text-gray-400">Buscando…</div>}
                  {!isFetching && results.length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-400">Sin resultados</div>
                  )}
                  {results.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCustomer(c)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      <span className="font-medium text-gray-800">{c.full_name}</span>
                      <span className="text-xs text-gray-400">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setCreatingCustomer(true)}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-cyan-700 hover:underline"
              >
                <UserPlus size={13} /> Crear cliente nuevo
              </button>
            </div>
          )}
        </Section>

        {/* Equipo */}
        <Section label="Equipo">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marca *"><input value={marca} onChange={(e) => setMarca(e.target.value)} className="inp" placeholder="Samsung" /></Field>
            <Field label="Modelo *"><input value={modelo} onChange={(e) => setModelo(e.target.value)} className="inp" placeholder="A10" /></Field>
            <Field label="IMEI / Serial">
              <input value={imei} onChange={(e) => setImei(e.target.value)} className="inp font-mono" placeholder="Sin validación" />
            </Field>
            <Field label="Color"><input value={color} onChange={(e) => setColor(e.target.value)} className="inp" placeholder="Negro" /></Field>
          </div>
        </Section>

        {/* Falla */}
        <Section label="Falla reportada *">
          <textarea value={falla} onChange={(e) => setFalla(e.target.value)} rows={2} className="inp resize-none" placeholder="No enciende, pantalla partida…" />
        </Section>

        {/* Checklist — dos semánticas */}
        <div className="grid grid-cols-2 gap-4">
          <ChecklistGroup title="Daños al recibir" tone="amber" items={CHECKLIST_DANOS} values={danos} onToggle={(k) => setDanos((v) => ({ ...v, [k]: !v[k] }))} />
          <ChecklistGroup title="Verificaciones" tone="emerald" items={CHECKLIST_VERIFICACIONES} values={verif} onToggle={(k) => setVerif((v) => ({ ...v, [k]: !v[k] }))} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Accesorios"><input value={accesorios} onChange={(e) => setAccesorios(e.target.value)} className="inp" placeholder="Cargador, forro…" /></Field>
          <Field label="Precio estimado (opcional)"><input value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^\d]/g, ''))} className="inp font-mono" placeholder="0" inputMode="numeric" /></Field>
        </div>

        <Section label="Observaciones">
          <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} className="inp resize-none" placeholder="Notas internas del técnico…" />
        </Section>

        {/* Contraseña confidencial */}
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
            <Lock size={13} /> Contraseña del equipo · confidencial
          </label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-mono focus:border-amber-400 focus:outline-none"
            placeholder="Patrón / PIN — nunca va en el comprobante"
          />
          <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
            <ShieldAlert size={11} /> Solo visible para el taller. No se imprime en la copia del cliente.
          </p>
        </div>
      </div>

      <Footer>
        <button onClick={onClose} className="btn-secondary">Cancelar</button>
        <button onClick={handleSubmit} disabled={!canSubmit} className="btn-primary disabled:opacity-40">
          {create.isPending ? 'Guardando…' : 'Recibir equipo'}
        </button>
      </Footer>
    </ModalShell>
  )
}

// ── Subcomponentes ─────────────────────────────────────────────────────────────

function QuickCreateCustomer({ onCancel, onCreated }: { onCancel: () => void; onCreated: (c: Customer) => void }) {
  const createCustomer = useCreateCustomer()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const submit = async () => {
    if (!name.trim()) return toast.error('El nombre es obligatorio')
    const c = await createCustomer.mutateAsync({ full_name: name.trim(), phone: phone.trim(), email: '', document_id: '', notes: '' })
    onCreated(c)
  }
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3">
      <input value={name} onChange={(e) => setName(e.target.value)} className="inp" placeholder="Nombre completo *" autoFocus />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} className="inp" placeholder="Teléfono" inputMode="tel" />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs font-medium text-gray-500 hover:underline">Cancelar</button>
        <button onClick={submit} disabled={createCustomer.isPending} className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-40">
          Crear y usar
        </button>
      </div>
    </div>
  )
}

function ChecklistGroup({
  title,
  tone,
  items,
  values,
  onToggle,
}: {
  title: string
  tone: 'amber' | 'emerald'
  items: { key: string; label: string }[]
  values: Record<string, boolean>
  onToggle: (key: string) => void
}) {
  const on =
    tone === 'amber'
      ? 'border-amber-300 bg-amber-100 text-amber-800'
      : 'border-emerald-300 bg-emerald-100 text-emerald-800'
  return (
    <div>
      <div className={`mb-1.5 text-xs font-semibold ${tone === 'amber' ? 'text-amber-700' : 'text-emerald-700'}`}>{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => onToggle(it.key)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              values[it.key] ? on : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-gray-500">{label}</span>
      {children}
    </label>
  )
}

export function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-shrink-0 justify-end gap-2 border-t border-gray-100 px-5 py-3.5">{children}</div>
  )
}
