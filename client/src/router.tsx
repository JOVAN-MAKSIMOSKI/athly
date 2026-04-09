import { Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from './views/AppLayout.tsx'
import { ProtectedRoute } from './components/routes/ProtectedRoute.tsx'
import HomePage from './views/HomePage.tsx'
import NotFoundPage from './views/NotFoundPage.tsx'
import LoginPage from './views/LoginPage.tsx'
import SignupPage from './views/SignupPage.tsx'
import UserProfilePage from './views/UserProfilePage.tsx'
import WorkoutsPage from './views/WorkoutsPage.tsx'

const fallback = <div className="px-4 py-8 text-sm text-slate-300">Loading...</div>

export const appRouter = createBrowserRouter([
	{
		path: '/',
		element: <AppLayout />,
		children: [
			{
				index: true,
				element: (
					<Suspense fallback={fallback}>
						<HomePage />
					</Suspense>
				),
			},
			{
				path: 'login',
				element: (
					<Suspense fallback={fallback}>
						<LoginPage />
					</Suspense>
				),
			},
			{
				path: 'signup',
				element: (
					<Suspense fallback={fallback}>
						<SignupPage />
					</Suspense>
				),
			},
			{
				path: 'workouts',
				element: (
					<ProtectedRoute>
						<Suspense fallback={fallback}>
							<WorkoutsPage />
						</Suspense>
					</ProtectedRoute>
				),
			},
			{
				path: 'profile',
				element: (
					<ProtectedRoute>
						<Suspense fallback={fallback}>
							<UserProfilePage />
						</Suspense>
					</ProtectedRoute>
				),
			},
		],
	},
	{
		path: '*',
		element: (
			<Suspense fallback={fallback}>
				<NotFoundPage />
			</Suspense>
		),
	},
])