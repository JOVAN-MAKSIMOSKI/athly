import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { authApi } from '../connection/api.ts'
import {
	AuthContext,
	loadInitialSession,
	type AuthSession,
	type AuthContextValue,
} from '../state/authSessionStore.ts'

const AUTH_STORAGE_KEY = 'auth_session'

function isJwtExpired(token: string): boolean {
	try {
		const parts = token.split('.')
		if (parts.length < 2) {
			return true
		}

		const payload = JSON.parse(window.atob(parts[1])) as { exp?: number }
		if (typeof payload.exp !== 'number') {
			return false
		}

		return payload.exp <= Math.floor(Date.now() / 1000)
	} catch {
		return true
	}
}

function getJwtExpiryMs(token: string): number | null {
	try {
		const parts = token.split('.')
		if (parts.length < 2) {
			return null
		}

		const payload = JSON.parse(window.atob(parts[1])) as { exp?: number }
		if (typeof payload.exp !== 'number') {
			return null
		}

		return payload.exp * 1000
	} catch {
		return null
	}
}

export function AuthProvider({ children }: PropsWithChildren) {
	const [session, setSessionState] = useState<AuthSession | null>(() => loadInitialSession())
	const refreshInFlightRef = useRef<Promise<string | null> | null>(null)

	const setSession = useCallback((nextSession: AuthSession) => {
		setSessionState(nextSession)
		localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession))
	}, [])

	const clearSession = useCallback(() => {
		setSessionState(null)
		localStorage.removeItem(AUTH_STORAGE_KEY)
	}, [])

	const refreshSession = useCallback(async (): Promise<string | null> => {
		if (refreshInFlightRef.current) {
			return refreshInFlightRef.current
		}

		const refreshPromise = (async (): Promise<string | null> => {
			try {
				const response = await authApi.refresh()
				const nextSession: AuthSession = {
					token: response.token,
					user: response.data.user,
				}
				setSession(nextSession)
				return nextSession.token
			} catch {
				clearSession()
				return null
			} finally {
				refreshInFlightRef.current = null
			}
		})()

		refreshInFlightRef.current = refreshPromise
		return refreshPromise
	}, [clearSession, setSession])

	useEffect(() => {
		if (!session?.token) {
			return
		}

		const tokenExpiryMs = getJwtExpiryMs(session.token)
		if (tokenExpiryMs === null) {
			return
		}

		if (isJwtExpired(session.token)) {
			void refreshSession()
			return
		}

		const refreshLeadMs = 60_000
		const delayMs = Math.max(0, tokenExpiryMs - Date.now() - refreshLeadMs)
		const timeoutId = window.setTimeout(() => {
			void refreshSession()
		}, delayMs)

		return () => {
			window.clearTimeout(timeoutId)
		}
	}, [refreshSession, session?.token])

	const value = useMemo<AuthContextValue>(
		() => ({
			token: session?.token ?? null,
			user: session?.user ?? null,
			isAuthenticated: Boolean(session?.token && session?.user),
			setSession,
			clearSession,
			refreshSession,
		}),
		[clearSession, refreshSession, session?.token, session?.user, setSession],
	)

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

