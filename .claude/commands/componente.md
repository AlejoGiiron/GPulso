---
description: Crea un componente React siguiendo las convenciones del proyecto (TypeScript strict, Tailwind, lucide-react).
argument-hint: <NombreComponente> [descripcion-breve]
---

Crea el componente **$ARGUMENTS** en el proyecto G-Pulso.

## Ubicación

Determina la carpeta correcta según el tipo:
- Componente de UI genérico reutilizable → `src/components/ui/`
- Componente de layout → `src/components/layout/`
- Específico de un módulo → `src/components/{modulo}/`
  (pos/, products/, inventory/, sales/, layaways/, credit/, cash/,
  suppliers/, repairs/, commissions/, config/)

## Requisitos del componente

- Componente funcional con React hooks
- Props tipadas con una interfaz explícita (sin `any`, sin `unknown` innecesario)
- Exportación nombrada (no `export default`)
- Íconos de `lucide-react` si se necesitan
- Clases de Tailwind CSS — paleta coherente con el proyecto:
  sidebar slate-900, **acento cian #06b6d4** (`cyan-500/600`, hover/activos
  `cyan-600` #0891b2, fondos suaves `cyan-50` #ecfeff, borde `cyan-200` #a5f3fc),
  fondo blanco/gris claro. **No usar violeta**: es la paleta de G-Mura, de donde
  se forkeó el proyecto.
- Tipografía: IBM Plex Sans en UI; **JetBrains Mono** en IMEI/seriales y precios
- Strings de UI en español (Colombia)
- Precios en COP con `Intl.NumberFormat('es-CO')`
- Sin comentarios que expliquen qué hace el código —
  solo los que expliquen *por qué* si hay algo no obvio
- Accesibilidad: añadir `aria-label` y `role` donde corresponda
  (botones sin texto visible, inputs sin label visible, diálogos)
- Si en la carpeta destino existe un archivo `index.ts`,
  exportar el nuevo componente desde ese archivo

## Si el componente maneja variantes

- Siempre incluir `variant_id` además de `product_id`
- El stock se consulta y descuenta por variante, nunca por producto
- Verificar `stock_qty > 0` antes de permitir agregar al carrito

## Si el componente recibe datos de Supabase

No hagas fetching dentro del componente. Recibe los datos como props
o usa un hook existente de `src/hooks/`. Si el hook no existe, créalo primero.

## Al terminar

Muestra la firma del componente y sus props principales.