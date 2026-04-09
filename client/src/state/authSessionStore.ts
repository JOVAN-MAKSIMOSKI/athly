import { createContext, useContext } from 'react'
import type { AuthenticatedUser } from '../types/auth.ts'

const AUTH_STORAGE_KEY = 'auth_session'

export type AuthSession = {
  token: string
  user: AuthenticatedUser
}

export type AuthContextValue = {
  token: string | null
  user: AuthenticatedUser | null
  isAuthenticated: boolean
  setSession: (nextSession: AuthSession) => void
  clearSession: () => void
  refreshSession: () => Promise<string | null>
}

export const AuthContext = createContext<AuthContextValue>({
  token: null,
  user: null,
  isAuthenticated: false,
  setSession: () => undefined,
  clearSession: () => undefined,
  refreshSession: async () => null,
})

export function loadInitialSession(): AuthSession | null {
  const rawSession = localStorage.getItem(AUTH_STORAGE_KEY)
  if (!rawSession) {
    return null
  }

  try {
    const parsedSession = JSON.parse(rawSession) as Partial<AuthSession>
    const hasValidToken = typeof parsedSession?.token === 'string' && parsedSession.token.length > 0
    const hasValidUser = typeof parsedSession?.user === 'object' && parsedSession.user !== null

    if (hasValidToken && hasValidUser) {
      return parsedSession as AuthSession
    }
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  }

  return null
}

export function useAuth() {
  return useContext(AuthContext)
}
