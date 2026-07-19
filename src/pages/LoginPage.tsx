import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Logo } from '@/components/layout/Logo'

const loginSchema = z.object({
  email: z.string().email('Correo electrónico inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
})

const FEATURES = [
  {
    n: '01',
    title: 'Inventario de tecnología',
    desc: 'Celulares, cómputo y accesorios con stock en tiempo real.',
  },
  {
    n: '02',
    title: 'Escáner integrado',
    desc: 'Lee códigos de barras directo desde el lector.',
  },
  {
    n: '03',
    title: 'Devoluciones simples',
    desc: 'Cambios y reembolsos en menos de 30 segundos.',
  },
]

export default function LoginPage() {
  const { user, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!isLoading && user) {
    return <Navigate to="/ventas" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    const result = loginSchema.safeParse({ email, password })
    if (!result.success) {
      toast.error(result.error.errors[0].message)
      return
    }

    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: result.data.email,
      password: result.data.password,
    })

    if (error) {
      toast.error('Credenciales incorrectas. Verificá tu correo y contraseña.')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden font-sans" style={{ background: '#f8f7f5' }}>
      {/* Panel izquierdo — slate-900 */}
      <aside
        className="relative flex flex-col overflow-hidden bg-slate-900 text-white"
        style={{ flex: '0 0 40%', padding: '40px 44px' }}
      >
        {/* Glow cian */}
        <div
          className="pointer-events-none absolute"
          style={{
            top: -120,
            right: -120,
            width: 380,
            height: 380,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(6,182,212,0.27) 0%, transparent 65%)',
          }}
        />

        {/* Wordmark */}
        <div className="relative flex items-center gap-3">
          <Logo size={36} className="flex-shrink-0" />
          <span className="text-xl font-semibold tracking-tight">
            G-Pulso<span className="text-cyan-400">.</span>
          </span>
        </div>

        {/* Contenido central */}
        <div className="relative flex flex-1 flex-col justify-center" style={{ maxWidth: 420 }}>
          <h1
            className="mb-4 font-semibold leading-tight text-white"
            style={{ fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.03em' }}
          >
            El punto de venta hecho para{' '}
            <em className="not-italic text-cyan-400">tiendas de tecnología</em>.
          </h1>
          <p className="mb-9 leading-relaxed text-slate-400" style={{ fontSize: 15 }}>
            Construido alrededor de equipos, accesorios y taller de reparaciones.
          </p>

          {/* Lista de features */}
          <div
            className="flex flex-col border-t pt-6"
            style={{ gap: 18, borderColor: 'rgba(148,163,184,0.18)' }}
          >
            {FEATURES.map((f) => (
              <div key={f.n} className="flex gap-4">
                <span
                  className="min-w-[24px] pt-0.5 font-semibold text-cyan-400 tabular-nums"
                  style={{ fontSize: 13 }}
                >
                  {f.n}
                </span>
                <div>
                  <div className="mb-1 font-medium text-white" style={{ fontSize: 14.5 }}>
                    {f.title}
                  </div>
                  <div className="leading-snug text-slate-400" style={{ fontSize: 13 }}>
                    {f.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative flex justify-between text-xs text-slate-500">
          <span>v1.0.0</span>
          <span>© 2026 G-Pulso</span>
        </div>
      </aside>

      {/* Panel derecho — formulario */}
      <main className="relative flex flex-1 items-center justify-center p-12">
        {/* Indicador en línea */}
        <div className="absolute right-8 top-7 flex items-center gap-2 text-xs text-neutral-500">
          <span
            className="h-1.5 w-1.5 rounded-full bg-emerald-500"
            style={{ boxShadow: '0 0 0 3px rgba(22,163,74,0.15)' }}
          />
          En línea
        </div>

        {/* Formulario */}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex w-full flex-col"
          style={{ maxWidth: 380, gap: 18 }}
        >
          <div>
            <h2
              className="mb-1.5 font-semibold leading-tight tracking-tight text-neutral-900"
              style={{ fontSize: 28, letterSpacing: '-0.025em' }}
            >
              Ingresar
            </h2>
            <p className="text-sm leading-relaxed text-neutral-500">
              Acceso para administradores y vendedores.
            </p>
          </div>

          {/* Correo */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-neutral-600">Correo</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@tienda.co"
              autoComplete="email"
              required
              className="h-[46px] w-full rounded-[10px] border border-stone-200 bg-white px-3.5 text-[14.5px] outline-none transition focus:border-cyan-500 focus:ring-[4px] focus:ring-cyan-500/10"
            />
          </label>

          {/* Contraseña */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-neutral-600">Contraseña</span>
            <div className="flex h-[46px] overflow-hidden rounded-[10px] border border-stone-200 bg-white transition focus-within:border-cyan-500 focus-within:ring-[4px] focus-within:ring-cyan-500/10">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className="flex-1 bg-transparent pl-3.5 text-[14.5px] outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="px-3 text-neutral-400 transition hover:text-neutral-600"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>

          {/* Botón enviar */}
          <button
            type="submit"
            disabled={submitting}
            className="flex h-[50px] items-center justify-center gap-2 rounded-[10px] bg-cyan-500 text-[15px] font-semibold text-white transition hover:bg-cyan-600 disabled:cursor-wait disabled:opacity-80"
            style={{ boxShadow: '0 6px 18px rgba(139,92,246,0.27)' }}
          >
            {submitting ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Verificando…
              </>
            ) : (
              <>
                Ingresar
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>
      </main>
    </div>
  )
}
