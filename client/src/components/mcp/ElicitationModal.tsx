import type { ElicitRequest } from '@modelcontextprotocol/sdk/types.js'
import { DynamicSchemaForm } from './DynamicSchemaForm.tsx'
import type { ElicitationContent } from '../../types/mcp.ts'

type ElicitationModalProps = {
	request: ElicitRequest
	onAccept: (content: ElicitationContent) => void
	onCancel: () => void
	onDecline: () => void
}

export function ElicitationModal({ request, onAccept, onCancel, onDecline }: ElicitationModalProps) {
	if (!('requestedSchema' in request.params)) {
		return null
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
			<div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5">
				<h2 className="text-lg font-semibold text-slate-100">Additional information needed</h2>
				<p className="mt-2 text-sm text-slate-300">{request.params.message}</p>

				<DynamicSchemaForm schema={request.params.requestedSchema} onSubmit={onAccept} />

				<div className="mt-4 flex items-center gap-2">
					<button
						type="button"
						onClick={onDecline}
						className="rounded-lg border border-amber-500 px-3 py-2 text-sm text-amber-200"
					>
						Decline
					</button>
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200"
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	)
}