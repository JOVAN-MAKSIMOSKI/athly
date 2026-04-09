import { useSyncExternalStore } from 'react'
import type { ElicitationContent } from '../types/mcp.ts'
import {
  getProtocolUiSnapshot,
  resolveElicitationAccept,
  resolveElicitationCancel,
  resolveElicitationDecline,
  resolveSamplingApprove,
  resolveSamplingDecline,
  subscribeProtocolUiState,
} from '../state/protocolUiState.ts'

export function useMCPProtocolHandlers() {
  // Hook is now UI-only: it subscribes to external protocol state and dispatches UI decisions.
  const snapshot = useSyncExternalStore(subscribeProtocolUiState, getProtocolUiSnapshot, getProtocolUiSnapshot)

  return {
    elicitationRequest: snapshot.elicitationRequest,
    samplingRequest: snapshot.samplingRequest,
    resolveElicitationAccept: (content: ElicitationContent) => resolveElicitationAccept(content),
    resolveElicitationCancel,
    resolveElicitationDecline,
    resolveSamplingApprove,
    resolveSamplingDecline,
  }
}