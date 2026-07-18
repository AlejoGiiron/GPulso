import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'

interface ProtectedRouteProps {
  children: ReactNode
  /** Permiso RBAC requerido para entrar a la ruta. Si se omite, basta con estar
   *  autenticado. El control de acceso real lo impone el RLS; esto evita que un
   *  usuario aterrice en una página que no le corresponde. */
  permission?: string
}

export default function ProtectedRoute({ children, permission }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth()
  const { can } = usePermissions()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (permission && !can(permission)) {
    return <Navigate to="/ventas" replace />
  }

  return <>{children}</>
}
