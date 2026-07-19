import { useEffect, useRef } from 'react'
import { X, Camera } from 'lucide-react'

interface BarcodeScannerProps {
  startCamera: (elementId: string) => Promise<void>
  stopCamera: () => void
  onClose: () => void
}

export default function BarcodeScanner({ startCamera, stopCamera, onClose }: BarcodeScannerProps) {
  const viewfinderIdRef = useRef(`bcs-${Math.random().toString(36).slice(2)}`)
  const viewfinderId = viewfinderIdRef.current

  // Guardar refs para no incluir en deps del effect de inicio
  const startRef = useRef(startCamera)
  const stopRef = useRef(stopCamera)
  useEffect(() => {
    startRef.current = startCamera
    stopRef.current = stopCamera
  })

  useEffect(() => {
    void startRef.current(viewfinderId)
    return () => stopRef.current()
  }, [viewfinderId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(15,23,42,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-2xl shadow-2xl"
        style={{ background: '#0f172a' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Camera size={16} className="text-cyan-400" />
            <p className="text-sm font-semibold text-white">Escanear código</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: 'rgba(148,163,184,0.15)' }}
          >
            <X size={14} className="text-slate-400" />
          </button>
        </div>

        {/* Viewfinder */}
        <div
          className="relative mx-5 mb-2 overflow-hidden rounded-xl bg-black"
          style={{ aspectRatio: '4/3' }}
        >
          {/* Quagga inyecta video + canvas aquí */}
          <div
            id={viewfinderId}
            className="absolute inset-0"
            style={{ position: 'relative' }}
          />

          {/* Corner guides */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-52 w-52">
              {/* Esquinas en cian */}
              <span
                className="absolute left-0 top-0 h-7 w-7"
                style={{
                  borderTop: '3px solid #06b6d4',
                  borderLeft: '3px solid #06b6d4',
                  borderTopLeftRadius: 6,
                }}
              />
              <span
                className="absolute right-0 top-0 h-7 w-7"
                style={{
                  borderTop: '3px solid #06b6d4',
                  borderRight: '3px solid #06b6d4',
                  borderTopRightRadius: 6,
                }}
              />
              <span
                className="absolute bottom-0 left-0 h-7 w-7"
                style={{
                  borderBottom: '3px solid #06b6d4',
                  borderLeft: '3px solid #06b6d4',
                  borderBottomLeftRadius: 6,
                }}
              />
              <span
                className="absolute bottom-0 right-0 h-7 w-7"
                style={{
                  borderBottom: '3px solid #06b6d4',
                  borderRight: '3px solid #06b6d4',
                  borderBottomRightRadius: 6,
                }}
              />

              {/* Línea de escaneo animada */}
              <div
                className="absolute inset-x-4 top-1/2 h-px -translate-y-1/2"
                style={{ background: 'rgba(139,92,246,0.7)' }}
              />
            </div>
          </div>
        </div>

        <p className="pb-5 pt-2 text-center text-xs" style={{ color: '#64748b' }}>
          Apunta al código de barras del producto
        </p>
      </div>
    </div>
  )
}
