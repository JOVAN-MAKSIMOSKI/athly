import { mcpClient } from '../mcp/mcpClient.ts'
import { refreshMcpRegistry } from '../mcp/registry.ts'
import { requestElicitation, requestSamplingApproval } from '../../state/protocolUiState.ts'

let startupPromise: Promise<void> | null = null

// Runtime bootstrap owns MCP lifecycle and protocol handler registration outside React.
export function initializeAgentRuntime(): Promise<void> {
  if (startupPromise) {
    return startupPromise
  }

  startupPromise = (async () => {
    await mcpClient.connect()
    await refreshMcpRegistry()

    mcpClient.setElicitationHandler(async (request) => requestElicitation(request))
    mcpClient.setSamplingHandler(async (request) => requestSamplingApproval(request))
  })()

  return startupPromise
}
