import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'
import { getActiveStoreId } from './useActiveStoreId'
import { useDebounce } from './useDebounce'
import { daysOverdue } from '@/lib/invoices'
import type {
  InvoiceStatus,
  PaymentMethod,
  PurchaseInvoice,
} from '@/types/database.types'

const PAGE_SIZE = 50

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InvoiceListRow {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  status: InvoiceStatus
  total: number
  paid_amount: number
  pending_amount: number
  days_overdue: number | null
  supplier_id: string
  supplier_name: string
  created_by_name: string
}

export interface InvoiceListResult {
  rows: InvoiceListRow[]
  total: number
  page: number
  pageCount: number
}

export interface InvoiceListFilters {
  search?: string
  supplierId?: string
  status?: InvoiceStatus | 'all'
  dateFrom?: string
  dateTo?: string
  page?: number
}

export interface InvoiceItemDetail {
  id: string
  variant_id: string
  product_id: string
  product_name: string
  brand: string | null
  size: string | null
  color: string | null
  sku: string | null
  qty: number
  unit_cost: number
  subtotal: number
  update_cost: boolean
  // Fase 2 (C2a): recepción de seriales por línea serializada.
  is_serialized: boolean
  received_serials: string[]
}

export interface InvoicePaymentDetail {
  id: string
  amount: number
  payment_date: string
  payment_method: PaymentMethod
  reference: string | null
  notes: string | null
  created_by_name: string
  created_at: string
  shift_id: string | null
}

export interface InvoiceDetailData {
  invoice: PurchaseInvoice
  supplier_name: string
  created_by_name: string
  items: InvoiceItemDetail[]
  payments: InvoicePaymentDetail[]
  pending_amount: number
  days_overdue: number | null
}

export interface PurchaseVariantOption {
  id: string
  product_id: string
  product_name: string
  brand: string | null
  size: string | null
  color: string | null
  sku: string | null
  barcode: string | null
  cost_price: number | null
  price: number
  stock_qty: number
  reserved_qty: number
}

// ── useInvoiceList ────────────────────────────────────────────────────────────

interface RawListInvoice {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  status: InvoiceStatus
  total: number
  paid_amount: number
  supplier_id: string
  suppliers: { name: string } | null
  profiles: { full_name: string } | null
}

export function useInvoiceList(filters: InvoiceListFilters = {}) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)
  const dq = useDebounce((filters.search ?? '').trim(), 300)
  const page = filters.page ?? 1
  const status = filters.status ?? 'all'
  const supplierId = filters.supplierId ?? ''
  const dateFrom = filters.dateFrom ?? ''
  const dateTo = filters.dateTo ?? ''

  return useQuery({
    queryKey: [
      'purchase-invoices',
      'list',
      storeId,
      dq,
      status,
      supplierId,
      dateFrom,
      dateTo,
      page,
    ],
    queryFn: async (): Promise<InvoiceListResult> => {
      const from = (page - 1) * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      let q = supabase
        .from('purchase_invoices')
        .select(
          'id, invoice_number, invoice_date, due_date, status, total, paid_amount, supplier_id, suppliers(name), profiles(full_name)',
          { count: 'exact' },
        )
        .eq('store_id' as never, storeId)
        .order('invoice_date' as never, { ascending: false })
        .range(from, to)

      if (status !== 'all') q = q.eq('status' as never, status)
      if (supplierId) q = q.eq('supplier_id' as never, supplierId)
      if (dateFrom) q = q.gte('invoice_date' as never, dateFrom)
      if (dateTo) q = q.lte('invoice_date' as never, dateTo)
      if (dq.length >= 1) q = q.ilike('invoice_number' as never, `%${dq}%`)

      const { data, error, count } = await q
      if (error) throw error

      const rows: InvoiceListRow[] = (data ?? []).map((row) => {
        const r = row as unknown as RawListInvoice
        const total = Number(r.total)
        const paid = Number(r.paid_amount)
        return {
          id: r.id,
          invoice_number: r.invoice_number,
          invoice_date: r.invoice_date,
          due_date: r.due_date,
          status: r.status,
          total,
          paid_amount: paid,
          pending_amount: total - paid,
          days_overdue: daysOverdue(r.due_date, r.status),
          supplier_id: r.supplier_id,
          supplier_name: r.suppliers?.name ?? 'Proveedor eliminado',
          created_by_name: r.profiles?.full_name ?? '—',
        }
      })

      const totalCount = count ?? 0
      return {
        rows,
        total: totalCount,
        page,
        pageCount: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
      }
    },
    enabled: !!storeId,
    staleTime: 20_000,
    placeholderData: keepPreviousData,
  })
}

// ── useInvoiceDetail ──────────────────────────────────────────────────────────

interface RawDetailItem {
  id: string
  variant_id: string
  product_id: string
  qty: number
  unit_cost: number
  subtotal: number
  update_cost: boolean
  variants: { size: string | null; color: string | null; sku: string | null } | null
  products: { name: string; brand: string | null; is_serialized: boolean } | null
}

interface RawDetailPayment {
  id: string
  amount: number
  payment_date: string
  payment_method: PaymentMethod
  reference: string | null
  notes: string | null
  created_at: string
  shift_id: string | null
  profiles: { full_name: string } | null
}

interface RawInvoiceDetail extends PurchaseInvoice {
  suppliers: { name: string } | null
  profiles: { full_name: string } | null
  purchase_invoice_items: RawDetailItem[]
  supplier_payments: RawDetailPayment[]
}

export function useInvoiceDetail(id: string | null) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['purchase-invoices', 'detail', id, storeId],
    queryFn: async (): Promise<InvoiceDetailData | null> => {
      if (!id) return null

      const { data, error } = await supabase
        .from('purchase_invoices')
        .select(
          `*,
           suppliers(name),
           profiles(full_name),
           purchase_invoice_items(
             id, variant_id, product_id, qty, unit_cost, subtotal, update_cost,
             variants(size, color, sku), products(name, brand, is_serialized)
           ),
           supplier_payments(
             id, amount, payment_date, payment_method, reference, notes,
             created_at, shift_id, profiles(full_name)
           )`,
        )
        .eq('id' as never, id)
        .eq('store_id' as never, storeId)
        .single()
      if (error) throw error

      const r = data as unknown as RawInvoiceDetail

      // Seriales ya recibidos por línea serializada (C2a): una consulta acotada
      // a las líneas de esta factura, agrupados client-side por línea.
      const serialLineIds = (r.purchase_invoice_items ?? [])
        .filter((it) => it.products?.is_serialized)
        .map((it) => it.id)
      const serialsByItem: Record<string, string[]> = {}
      if (serialLineIds.length > 0) {
        const { data: unitRows } = await supabase
          .from('units')
          .select('serial, purchase_invoice_item_id')
          .in('purchase_invoice_item_id' as never, serialLineIds as never)
          .order('created_at' as never, { ascending: true })
        for (const u of (unitRows ?? []) as { serial: string; purchase_invoice_item_id: string }[]) {
          ;(serialsByItem[u.purchase_invoice_item_id] ??= []).push(u.serial)
        }
      }

      const items: InvoiceItemDetail[] = (r.purchase_invoice_items ?? []).map(
        (it) => ({
          id: it.id,
          variant_id: it.variant_id,
          product_id: it.product_id,
          product_name: it.products?.name ?? 'Producto eliminado',
          brand: it.products?.brand ?? null,
          size: it.variants?.size ?? null,
          color: it.variants?.color ?? null,
          sku: it.variants?.sku ?? null,
          qty: it.qty,
          unit_cost: Number(it.unit_cost),
          subtotal: Number(it.subtotal),
          update_cost: it.update_cost,
          is_serialized: it.products?.is_serialized ?? false,
          received_serials: serialsByItem[it.id] ?? [],
        }),
      )

      const payments: InvoicePaymentDetail[] = (r.supplier_payments ?? [])
        .map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          payment_date: p.payment_date,
          payment_method: p.payment_method,
          reference: p.reference,
          notes: p.notes,
          created_by_name: p.profiles?.full_name ?? '—',
          created_at: p.created_at,
          shift_id: p.shift_id,
        }))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

      const invoice: PurchaseInvoice = {
        id: r.id,
        invoice_number: r.invoice_number,
        store_id: r.store_id,
        supplier_id: r.supplier_id,
        created_by: r.created_by,
        invoice_date: r.invoice_date,
        due_date: r.due_date,
        status: r.status,
        subtotal: Number(r.subtotal),
        tax: Number(r.tax),
        total: Number(r.total),
        paid_amount: Number(r.paid_amount),
        notes: r.notes,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }

      return {
        invoice,
        supplier_name: r.suppliers?.name ?? 'Proveedor eliminado',
        created_by_name: r.profiles?.full_name ?? '—',
        items,
        payments,
        pending_amount: invoice.total - invoice.paid_amount,
        days_overdue: daysOverdue(invoice.due_date, invoice.status),
      }
    },
    enabled: !!id && !!storeId,
    staleTime: 15_000,
  })
}

// ── usePendingInvoices ────────────────────────────────────────────────────────

export function usePendingInvoices() {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)

  return useQuery({
    queryKey: ['purchase-invoices', 'pending', storeId],
    queryFn: async (): Promise<InvoiceListRow[]> => {
      const { data, error } = await supabase
        .from('purchase_invoices')
        .select(
          'id, invoice_number, invoice_date, due_date, status, total, paid_amount, supplier_id, suppliers(name), profiles(full_name)',
        )
        .eq('store_id' as never, storeId)
        .in('status' as never, ['pending', 'partial'])
        .order('due_date' as never, { ascending: true, nullsFirst: false })
      if (error) throw error

      return (data ?? []).map((row) => {
        const r = row as unknown as RawListInvoice
        const total = Number(r.total)
        const paid = Number(r.paid_amount)
        return {
          id: r.id,
          invoice_number: r.invoice_number,
          invoice_date: r.invoice_date,
          due_date: r.due_date,
          status: r.status,
          total,
          paid_amount: paid,
          pending_amount: total - paid,
          days_overdue: daysOverdue(r.due_date, r.status),
          supplier_id: r.supplier_id,
          supplier_name: r.suppliers?.name ?? 'Proveedor eliminado',
          created_by_name: r.profiles?.full_name ?? '—',
        }
      })
    },
    enabled: !!storeId,
    staleTime: 20_000,
  })
}

// ── usePurchaseVariantSearch ──────────────────────────────────────────────────
// Busca variantes activas por nombre de producto, SKU, talla, color o barcode.
// Devuelve cost_price para precargar el costo del item en la factura.

interface RawSearchVariant {
  id: string
  product_id: string
  size: string | null
  color: string | null
  price: number
  cost_price: number | null
  stock_qty: number
  reserved_qty: number
  sku: string | null
  barcode: string | null
  products: { name: string; brand: string | null } | null
}

export function usePurchaseVariantSearch(query: string) {
  const { profile } = useAuth()
  const storeId = getActiveStoreId(profile)
  const dq = useDebounce(query.trim(), 300)

  return useQuery({
    queryKey: ['purchase-invoices', 'variant-search', storeId, dq],
    queryFn: async (): Promise<PurchaseVariantOption[]> => {
      if (dq.length < 2) return []

      const columns =
        'id, product_id, size, color, price, cost_price, stock_qty, reserved_qty, sku, barcode, products(name, brand)'

      const toOption = (r: RawSearchVariant): PurchaseVariantOption => ({
        id: r.id,
        product_id: r.product_id,
        product_name: r.products?.name ?? '',
        brand: r.products?.brand ?? null,
        size: r.size,
        color: r.color,
        sku: r.sku,
        barcode: r.barcode,
        cost_price: r.cost_price != null ? Number(r.cost_price) : null,
        price: Number(r.price),
        stock_qty: r.stock_qty,
        reserved_qty: r.reserved_qty,
      })

      // Query 1: SKU, talla, color o barcode
      const q1 = await supabase
        .from('variants')
        .select(columns)
        .eq('store_id' as never, storeId)
        .eq('is_active' as never, true)
        .or(
          `sku.ilike.%${dq}%,size.ilike.%${dq}%,color.ilike.%${dq}%,barcode.ilike.%${dq}%` as never,
        )
        .limit(50)
      if (q1.error) throw q1.error

      // Query 2: por nombre de producto
      const { data: prodMatches, error: pErr } = await supabase
        .from('products')
        .select('id')
        .eq('store_id' as never, storeId)
        .ilike('name' as never, `%${dq}%`)
        .limit(20)
      if (pErr) throw pErr

      const productIds = (prodMatches ?? []).map((p) => (p as { id: string }).id)

      let q2Results: RawSearchVariant[] = []
      if (productIds.length > 0) {
        const q2 = await supabase
          .from('variants')
          .select(columns)
          .eq('store_id' as never, storeId)
          .eq('is_active' as never, true)
          .in('product_id' as never, productIds)
          .limit(50)
        if (q2.error) throw q2.error
        q2Results = (q2.data ?? []) as unknown as RawSearchVariant[]
      }

      const seen = new Map<string, PurchaseVariantOption>()
      for (const v of (q1.data ?? []) as unknown as RawSearchVariant[]) {
        seen.set(v.id, toOption(v))
      }
      for (const v of q2Results) {
        if (!seen.has(v.id)) seen.set(v.id, toOption(v))
      }
      return Array.from(seen.values()).slice(0, 50)
    },
    enabled: !!storeId && dq.length >= 2,
    staleTime: 15_000,
  })
}
