import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ErrorBoundary } from 'react-error-boundary'
import type { PropsWithChildren } from 'react'
import { AuthProvider } from '../context/AuthContext.tsx'

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			refetchOnWindowFocus: false,
			staleTime: 30_000,
		},
	},
})

function ErrorFallback() {
	return (
		<div className="mx-auto mt-10 max-w-3xl rounded-xl border border-red-400/40 bg-red-950/50 p-6">
			<h1 className="text-xl font-semibold text-red-100">Something went wrong</h1>
			<p className="mt-2 text-sm text-red-200/80">Please refresh and try again.</p>
		</div>
	)
}

export function AppProviders({ children }: PropsWithChildren) {
	return (
		<ErrorBoundary fallbackRender={ErrorFallback}>
			<AuthProvider>
				<QueryClientProvider client={queryClient}>
					{children}
					{import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
				</QueryClientProvider>
			</AuthProvider>
		</ErrorBoundary>
	)
}