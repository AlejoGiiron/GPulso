import { useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import type { Profile } from '@/types/database.types'
import { AuthContext } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function fetchProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, rbac_role:roles(name, permissions)')
        .eq('id', userId)
        .single()
      if (error) throw error
      // El cliente tipado no infiere la relación embebida (Database hecho a
      // mano, sin metadata de Relationships) → cast explícito al runtime real.
      const prof = data as unknown as Profile
      // SEGURIDAD (deuda #1, migración 037): un usuario desactivado no debe
      // conservar acceso. El servidor ya lo bloquea (get_my_store_id → NULL),
      // pero acá lo EXPULSAMOS explícitamente para no dejarlo en una sesión
      // muda sin datos. La política profiles_select (rama id = auth.uid())
      // permite leer el propio perfil aunque esté inactivo → sí llega is_active.
      if (prof && prof.is_active === false) {
        setProfile(null)
        await supabase.auth.signOut()
        toast.error('Tu cuenta está desactivada. Contacta al administrador.')
        return
      }
      setProfile(prof)
    } catch {
      // Un fallo de LECTURA del perfil (RLS, red, fila no visible un instante)
      // NO debe cerrar la sesión. Solo cerramos si la SESIÓN ya no es válida
      // (token expirado / refresh fallido). Así un problema transitorio no deja
      // al usuario en un bucle de logout.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        // Autenticación realmente inválida → cerrar sesión.
        await supabase.auth.signOut()
      } else {
        // Sesión válida pero el perfil no se pudo leer: mantener la sesión y
        // avisar. (refreshProfile, el del switcher, ya solo avisa.)
        toast.error(
          'No se pudo cargar el perfil. Revisa tu conexión e intenta de nuevo.',
        )
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        void fetchProfile(session.user.id)
      } else {
        setIsLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        void fetchProfile(session.user.id)
      } else {
        setProfile(null)
        setIsLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  // Recarga ligera del perfil: no cierra sesión ante un error transitorio
  // (a diferencia de fetchProfile en el arranque), solo avisa.
  async function refreshProfile() {
    const uid = user?.id
    if (!uid) return
    const { data, error } = await supabase
      .from('profiles')
      .select('*, rbac_role:roles(name, permissions)')
      .eq('id', uid)
      .single()
    if (error) {
      toast.error('No se pudo actualizar el perfil')
      return
    }
    const prof = data as unknown as Profile
    // Mismo enforcement que en fetchProfile: si el perfil quedó desactivado
    // (p. ej. un admin lo desactivó mientras la sesión estaba abierta), expulsar.
    if (prof && prof.is_active === false) {
      setProfile(null)
      await supabase.auth.signOut()
      toast.error('Tu cuenta está desactivada. Contacta al administrador.')
      return
    }
    setProfile(prof)
  }

  // Permisos RBAC del usuario, derivados del rol embebido. [] si no hay rol.
  const permissions = profile?.rbac_role?.permissions ?? []

  return (
    <AuthContext.Provider
      value={{ user, profile, permissions, isLoading, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  )
}
