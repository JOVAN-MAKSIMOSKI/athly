import { RouterProvider } from 'react-router-dom'
import { ElicitationModal } from './components/mcp/ElicitationModal.tsx'
import { SamplingApprovalModal } from './components/mcp/SamplingApprovalModal.tsx'
import { useMCPProtocolHandlers } from './hooks/useMCPProtocolHandlers.ts'
import { appRouter } from './router.tsx'

function App() {
	const {
		elicitationRequest,
		samplingRequest,
		resolveElicitationAccept,
		resolveElicitationCancel,
		resolveElicitationDecline,
		resolveSamplingApprove,
		resolveSamplingDecline,
	} = useMCPProtocolHandlers()

	return (
		<>
			<RouterProvider router={appRouter} />
			{elicitationRequest ? (
				<ElicitationModal
					request={elicitationRequest}
					onAccept={resolveElicitationAccept}
					onCancel={resolveElicitationCancel}
					onDecline={resolveElicitationDecline}
				/>
			) : null}
			{samplingRequest ? (
				<SamplingApprovalModal
					request={samplingRequest}
					onApprove={resolveSamplingApprove}
					onDecline={resolveSamplingDecline}
				/>
			) : null}
		</>
	)
}

export default App
