import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import LoadingScreen from '@/components/LoadingScreen'
import { useAuthStore } from '@/stores/authStore'

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)

  if (!initialized) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  return <>{children}</>
}

export function RequireManager({ children }: { children: ReactNode }) {
  const profile = useAuthStore((s) => s.profile)

  if (!profile) return <Navigate to="/rooms" replace />
  if (profile.role !== 'manager') return <Navigate to="/rooms" replace />

  return <>{children}</>
}

export function RequireManagerOrSupervisor({ children }: { children: ReactNode }) {
  const profile = useAuthStore((s) => s.profile)

  if (!profile) return <Navigate to="/rooms" replace />
  if (profile.role !== 'manager' && profile.role !== 'supervisor') return <Navigate to="/rooms" replace />

  return <>{children}</>
}

