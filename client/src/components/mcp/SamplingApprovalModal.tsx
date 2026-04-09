import type { CreateMessageRequest } from '@modelcontextprotocol/sdk/types.js'

type SamplingApprovalModalProps = {
	request: CreateMessageRequest
	onApprove: () => void
	onDecline: () => void
}

export function SamplingApprovalModal({ request, onApprove, onDecline }: SamplingApprovalModalProps) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
			<div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5">
				<h2 className="text-lg font-semibold text-slate-100">Approve AI reasoning request</h2>
				<p className="mt-2 text-sm text-slate-300">
					The server requested an LLM sampling call. Review and approve before execution.
				</p>

				<div className="mt-4 max-h-60 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">
					<pre className="whitespace-pre-wrap break-words">
						{JSON.stringify(
							{
								modelPreferences: request.params.modelPreferences,
								messageCount: request.params.messages.length,
								messages: request.params.messages,
							},
							null,
							2,
						)}
					</pre>
				</div>

				<div className="mt-4 flex items-center gap-2">
					<button
						type="button"
						onClick={onApprove}
						className="rounded-lg border border-sky-500 px-3 py-2 text-sm text-sky-200"
					>
						Approve
					</button>
					<button
						type="button"
						onClick={onDecline}
						className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200"
					>
						Decline
					</button>
				</div>
			</div>
		</div>
	)
}