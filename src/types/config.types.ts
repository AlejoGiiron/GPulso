export interface StoreColorConfig {
  name: string
  hex: string
}

export interface LabelFields {
  sku: boolean
  name: boolean
  size_color: boolean
  price: boolean
}

/**
 * @deprecated Reemplazado por LabelSize + label_sizes. Se conserva el tipo
 * únicamente para que la migración lazy en resolveConfig pueda leer el
 * label_format de configuraciones viejas y mapearlo a un label_default_size_id.
 */
export type LabelFormat = '38x25' | '50x30' | '58x40'

export interface LabelSize {
  id: string
  name: string
  width_mm: number
  height_mm: number
}

export interface SizeTypeConfig {
  id: string
  label: string
  sizes: string[]
}

export type LayawayInitialPaymentMode = 'none' | 'fixed' | 'percent'
export type LayawayDiscountMode = 'none' | 'fixed'

/**
 * Configuración a nivel de ORGANIZACIÓN (todo el negocio, no por tienda).
 * Vive en organizations.config (jsonb). A diferencia de StoreConfig, es UNA
 * sola para todas las sedes. Escribir requiere el permiso config.gestionar
 * (garantizado por la política RLS organizations_update_config, migración 031).
 */
export interface OrgConfig {
  /**
   * Texto de condiciones que se imprime en el recibo del separado, como lista
   * de líneas (una condición por renglón). Editable desde Configuración →
   * Separados. Si queda vacío se cae al DEFAULT_ORG_CONFIG (ver useOrg.ts) para
   * que el recibo nunca quede sin condiciones.
   */
  layaway_terms: string[]
}

export interface StoreConfig {
  timezone: string
  currency: string
  size_types: SizeTypeConfig[]
  colors: StoreColorConfig[]
  brands: string[]
  return_days_limit: number
  adjustment_reasons: string[]
  payment_methods: string[]
  expense_reasons: string[]
  payment_qr_url: string | null
  label_sizes: LabelSize[]
  label_default_size_id: string
  /**
   * @deprecated Reemplazado por label_sizes + label_default_size_id. Solo se
   * conserva opcional para que la migración lazy lea config vieja; no se
   * escribe ni se muestra. El precio/escalado real sale de label_sizes.
   */
  label_format?: LabelFormat
  label_fields: LabelFields
  layaway_initial_payment_mode: LayawayInitialPaymentMode
  layaway_initial_payment_value: number
  layaway_default_days: number
  // ── Comisiones por crédito (Fase 4) ──────────────────────────────────────────
  // Monto total por defecto de una comisión (COP). CONFIGURABLE: las comisiones
  // cambian, nunca se hardcodea. Es solo el default del formulario; cada comisión
  // puede registrarse con otro monto.
  commission_default_amount: number
  // Fracción del total que le toca al TRABAJADOR (0..1). Por defecto 0.5 (50/50);
  // editable por si algún día cambia el criterio de reparto. El local recibe el
  // resto (1 - fracción).
  commission_worker_share: number
  // Tope de descuento por ítem (en pesos): rebaja máxima permitida por unidad
  // al vender o crear separados. Límite DURO. 0 = no se permite descuento.
  // El precio final mínimo de un ítem es max(0, list_price - max_item_discount).
  max_item_discount: number
  // @deprecated — reemplazado por el descuento por ítem (max_item_discount).
  // Ya no se configura ni se muestra; se conserva en el tipo para no romper
  // datos guardados. La lógica de separados se reemplaza en la fase 7.
  layaway_discount_mode: LayawayDiscountMode
  // @deprecated — ver layaway_discount_mode.
  layaway_discount_value: number
}
