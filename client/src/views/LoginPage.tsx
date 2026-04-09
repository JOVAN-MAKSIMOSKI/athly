import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { authApi } from '../connection/api.ts'
import { useAuth } from '../state/authSessionStore.ts'

function LoginPage() {
	const navigate = useNavigate()
	const location = useLocation()
	const { setSession } = useAuth()

	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')

	const redirectPath = useMemo(() => {
		if (location.state && typeof location.state === 'object' && 'from' in location.state) {
			const from = location.state.from
			if (typeof from === 'string') {
				return from
			}
		}
		return '/profile'
	}, [location.state])

	const loginMutation = useMutation({
		mutationFn: authApi.login,
		onSuccess: (response) => {
			setSession({
				token: response.token,
				user: response.data.user,
			})
			void navigate(redirectPath, { replace: true })
		},
	})

	return (
		<section className="flex min-h-screen w-full items-center justify-center px-4 py-10">
			<div className="w-full max-w-xl">
				<h2 className="text-center text-5xl font-semibold text-slate-800">Hello Again!</h2>
				<p className="mt-4 text-center text-base text-slate-500">
					Log in to continue your personalized training flow.
				</p>

				<form
				className="mt-10 grid gap-5"
				onSubmit={(event) => {
					event.preventDefault()
					loginMutation.mutate({ email, password })
				}}
				>
					<label className="grid gap-1.5 text-base text-slate-500">
						<span>Email</span>
						<input
							type="email"
							required
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="johnnybravo@afterglow.com"
							className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-lg text-slate-700 shadow-sm outline-none ring-sky-500/40 transition focus:ring-2"
						/>
					</label>

					<label className="grid gap-1.5 text-base text-slate-500">
						<span>Password</span>
						<input
							type="password"
							required
							minLength={6}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-lg text-slate-700 shadow-sm outline-none ring-sky-500/40 transition focus:ring-2"
						/>
					</label>

					<div className="mt-1 flex items-center justify-between text-sm text-slate-500">
						<label className="inline-flex items-center gap-2">
							<input type="checkbox" className="size-4 rounded border-slate-300" />
							<span>Remember me</span>
						</label>
						<span className="font-medium text-sky-700">Recovery Password</span>
					</div>

					{loginMutation.isError ? (
						<p className="text-sm text-rose-600">{(loginMutation.error as Error).message}</p>
					) : null}

					<button
						type="submit"
						disabled={loginMutation.isPending}
						className="mt-3 w-full rounded-xl bg-sky-700 px-5 py-4 text-base font-medium text-white transition hover:bg-sky-800 disabled:opacity-60"
					>
						{loginMutation.isPending ? 'Logging in...' : 'Login'}
					</button>
				</form>

				<p className="mt-6 text-center text-base text-slate-500">
					No account yet?{' '}
					<Link to="/signup" className="font-medium text-sky-700 underline-offset-2 hover:underline">
						Create one
					</Link>
				</p>
			</div>
		</section>
	)
}

export default LoginPage