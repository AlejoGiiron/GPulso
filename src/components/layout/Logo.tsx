// Logo de G-Pulso — marca "pulso": cuadro cian redondeado con un trazo de
// electrocardiograma en slate-900. Es un PLACEHOLDER inline (SVG) mientras
// llega el asset final del cliente. Para reemplazarlo basta cambiar el SVG de
// aquí; el resto de la app consume <Logo /> y no necesita tocarse.
//
// Colores de marca (design system G-Pulso):
//   · cuadro:  cian #06b6d4
//   · trazo:   slate-900 #0f172a
//
// Referencia visual: _design/gpulso/ (lienzo aprobado de la ronda 1).

interface LogoProps {
  /** Lado del cuadro en px (el SVG es cuadrado). Default 34. */
  size?: number
  /** Clase extra para el <svg> (posicionamiento, sombra, etc.). */
  className?: string
}

export function Logo({ size = 34, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 34 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="G-Pulso"
    >
      <rect width="34" height="34" rx="9" fill="#06b6d4" />
      <path
        d="M5 17 H12 L14.5 17 L16.5 9 L19.5 25 L21.5 17 L29 17"
        stroke="#0f172a"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
