import { Link } from 'react-router-dom'

function NotFoundPage() {
	return (
		<div className="mx-auto mt-16 max-w-xl rounded-2xl border border-slate-700 bg-slate-900/70 p-6 text-center">
			<h1 className="text-2xl font-bold text-slate-100">Page not found</h1>
			<p className="mt-2 text-sm text-slate-300">The page you requested does not exist.</p>
			<Link
				to="/"
				className="mt-4 inline-block rounded-lg border border-sky-500 px-4 py-2 text-sm font-medium text-sky-200"
			>
				Go home
			</Link>
		</div>
	)
}

export default NotFoundPage