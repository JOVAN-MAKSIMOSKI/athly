import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { authApi } from '../connection/api.ts'
import { useAuth } from '../state/authSessionStore.ts'

const navItem = ({ isActive }: { isActive: boolean }) =>
	`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-[1.08rem] transition-colors ${
		isActive
			? 'bg-slate-200 text-slate-900'
			: 'text-slate-700 hover:bg-slate-200/70'
	}`

const iconBaseClass =
	'grid size-6 shrink-0 place-items-center rounded-md bg-slate-300 text-[0.65rem] font-semibold text-slate-600 transition-colors'

const activeIconClass = 'bg-sky-100 text-sky-700'

export function AppLayout() {
	const { isAuthenticated, clearSession } = useAuth()
	const navigate = useNavigate()

	return (
		<div className="min-h-screen w-full bg-white">
			<aside className="fixed left-0 top-0 z-20 h-screen w-80 overflow-y-auto bg-slate-100 p-5">
					<Link to="/" className="text-xs font-medium tracking-[0.2em] text-sky-600">
						ATHLY
					</Link>
					<h1 className="mt-2 text-3xl font-bold text-slate-900">Train smarter.</h1>
					<p className="mt-1 text-sm text-slate-600">Recover better with guided coaching.</p>

					<nav className="mt-7 space-y-1.5">
						<NavLink to="/" className={navItem} end>
							{({ isActive }) => (
								<>
									<span className={`${iconBaseClass} ${isActive ? activeIconClass : ''}`}>HM</span>
									<span>Home</span>
								</>
							)}
						</NavLink>
						<NavLink to="/profile" className={navItem}>
							{({ isActive }) => (
								<>
									<span className={`${iconBaseClass} ${isActive ? activeIconClass : ''}`}>PF</span>
									<span>Profile</span>
								</>
							)}
						</NavLink>
						{isAuthenticated ? (
							<NavLink to="/workouts" className={navItem}>
								{({ isActive }) => (
									<>
										<span className={`${iconBaseClass} ${isActive ? activeIconClass : ''}`}>WO</span>
										<span>Workouts</span>
									</>
								)}
							</NavLink>
						) : null}
					</nav>

					{!isAuthenticated ? (
						<nav className="mt-5 space-y-1.5">
							<NavLink to="/login" className={navItem}>
								{({ isActive }) => (
									<>
										<span className={`${iconBaseClass} ${isActive ? activeIconClass : ''}`}>LI</span>
										<span>Log in</span>
									</>
								)}
							</NavLink>
							<NavLink to="/signup" className={navItem}>
								{({ isActive }) => (
									<>
										<span className={`${iconBaseClass} ${isActive ? activeIconClass : ''}`}>SU</span>
										<span>Sign up</span>
									</>
								)}
							</NavLink>
						</nav>
					) : null}

					<div className="mt-6 border-t border-slate-300 pt-4">
						<p className="px-1 text-xs uppercase tracking-[0.12em] text-slate-500">Workspace</p>
						<div className="mt-2 space-y-1.5">
							<div className="flex items-center gap-3 rounded-xl px-4 py-3 text-[1.08rem] text-slate-500">
								<span className={iconBaseClass}>IN</span>
								<span>Inbox</span>
							</div>
							<div className="flex items-center gap-3 rounded-xl px-4 py-3 text-[1.08rem] text-slate-500">
								<span className={iconBaseClass}>AN</span>
								<span>Analytics</span>
							</div>
							<div className="flex items-center gap-3 rounded-xl px-4 py-3 text-[1.08rem] text-slate-500">
								<span className={iconBaseClass}>KB</span>
								<span>Knowledge</span>
							</div>
						</div>
					</div>

					{isAuthenticated ? (
						<button
							type="button"
							onClick={() => {
								void authApi.logout().catch(() => undefined)
								clearSession()
								void navigate('/login', { replace: true })
							}}
							className="mt-6 w-full rounded-xl bg-rose-50 px-4 py-3 text-left text-[1.08rem] text-rose-700 transition-colors hover:bg-rose-100"
						>
							Log out
						</button>
					) : null}
				</aside>

			<main className="ml-0 min-h-screen p-3 md:ml-80 md:p-0">
				<Outlet />
			</main>
		</div>
	)
}