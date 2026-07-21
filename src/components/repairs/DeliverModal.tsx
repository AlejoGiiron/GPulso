import { useState } from 'react'
import { Printer, Banknote, CreditCard, ArrowLeftRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { useDeliverRepair } from '@/hooks/useRepairMutations'
import { useStoreConfig } from '@/hooks/useConfig'
import { fmtCOP } from '@/lib/formatters'
import type { PaymentMethod, RepairOrder, Order } from '@/types/database.types'
import { ModalShell, Footer } from './ReceptionModal'
import { RepairDeliveryReceipt, RepairDeliveryReceiptPrint } from './RepairReceipts'

interface Props {
  repair: Pick<RepairOrder, 'id' | 'order_number' | 'marca' | 'modelo' | 'imei_serial' | 'color' | 'precio'>
  customerName: string
  onClose: () => void
  onDelivered?: () => void
}

const METHODS: { key: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { key: 'cash', label: 'Efectivo', icon: Banknote },
  { key: 'card', label: 'Tarjeta', icon: CreditCard },
  { key: 'transfer', label: 'Transferencia', icon: ArrowLeftRight },
]

export function DeliverModal({ repair, customerName, onClose, onDelivered }: Props) {
  const { data: store } = useStoreConfig()
  const storeName = store?.name ?? 'Taller'
  const deliver = useDeliverRepair()

  const precio = repair.precio ?? 0
  const isWarranty = precio === 0

  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [received, setReceived] = useState('')
  const [delivered, setDelivered] = useState<Order | null>(null)

  const receivedNum = Number(received) || 0
  const change = method === 'cash' && receivedNum > precio ? receivedNum - precio : 0
  const cashShort = method === 'cash' && !isWarranty && receivedNum < precio

  const handleDeliver = async () => {
    if (repair.precio === null) return toast.error('Define el precio antes de entregar')
    const order = await deliver.mutateAsync({
      repairId: repair.id,
      payments: isWarranty ? [] : [{ method, amount: precio }],
      cash_received: method === 'cash' ? receivedNum || precio : null,
    })
    setDelivered(order)
    onDelivered?.()
  }

  if (delivered) {
    const receiptData = {
      order_number: repair.order_number,
      marca: repair.marca,
      modelo: repair.modelo,
      imei_serial: repair.imei_serial,
      color: repair.color,
      delivered_at: delivered.created_at,
      customer_name: customerName,
      precio,
      payment_method: method,
      cash_received: method === 'cash' ? receivedNum || precio : null,
    }
    return (
      <ModalShell title={`Entrega cobrada · #${repair.order_number}`} onClose={onClose}>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-[300px] rounded-lg border border-gray-200 bg-white shadow-sm">
            <RepairDeliveryReceipt data={receiptData} storeName={storeName} printedAt={new Date()} />
          </div>
          <RepairDeliveryReceiptPrint data={receiptData} storeName={storeName} printedAt={new Date()} />
        </div>
        <Footer>
          <button onClick={onClose} className="btn-secondary">Cerrar</button>
          <button onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1.5">
            <Printer size={15} /> Imprimir entrega
          </button>
        </Footer>
      </ModalShell>
    )
  }

  return (
    <ModalShell title={`Entregar y cobrar · #${repair.order_number}`} onClose={onClose}>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-gray-500">Total a cobrar</div>
          <div className="mt-1 font-mono text-3xl font-bold text-gray-900">{fmtCOP(precio)}</div>
          {isWarranty && (
            <div className="mt-1 inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              Garantía · sin cobro
            </div>
          )}
        </div>

        {!isWarranty && (
          <>
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Método de pago</div>
              <div className="grid grid-cols-3 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMethod(m.key)}
                    className={`flex flex-col items-center gap-1 rounded-xl border py-3 transition-colors ${
                      method === m.key ? 'border-cyan-400 bg-cyan-50 text-cyan-700' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <m.icon size={18} />
                    <span className="text-xs font-medium">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {method === 'cash' && (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-gray-500">Recibe</label>
                <input
                  value={received}
                  onChange={(e) => setReceived(e.target.value.replace(/[^\d]/g, ''))}
                  className="inp font-mono text-lg"
                  placeholder={String(precio)}
                  inputMode="numeric"
                  autoFocus
                />
                <div className="mt-1.5 flex justify-between text-sm">
                  <span className="text-gray-500">Cambio</span>
                  <span className={`font-mono font-semibold ${cashShort ? 'text-red-500' : 'text-emerald-600'}`}>
                    {cashShort ? 'Faltan ' + fmtCOP(precio - receivedNum) : fmtCOP(change)}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Footer>
        <button onClick={onClose} className="btn-secondary">Cancelar</button>
        <button onClick={handleDeliver} disabled={deliver.isPending} className="btn-primary disabled:opacity-40">
          {deliver.isPending ? 'Cobrando…' : isWarranty ? 'Entregar (garantía)' : 'Cobrar y entregar'}
        </button>
      </Footer>
    </ModalShell>
  )
}
