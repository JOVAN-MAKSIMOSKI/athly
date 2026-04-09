import type { CreateMessageRequest, ElicitRequest, ElicitResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElicitationContent } from '../types/mcp.ts'

const REQUEST_TIMEOUT_MS = 60_000
const SAMPLING_AUDIT_LOG_KEY = 'athly:sampling-audit-log'

type SamplingResult = {
  model: string
  role: 'assistant'
  stopReason: 'endTurn'
  content: {
    type: 'text'
    text: string
  }
}

type ProtocolSnapshot = {
  elicitationRequest: ElicitRequest | null
  samplingRequest: CreateMessageRequest | null
}

const approvedSamplingResult: SamplingResult = {
  model: 'athly-human-review',
  role: 'assistant',
  stopReason: 'endTurn',
  content: {
    type: 'text',
    text: 'Sampling request approved. Connect a client-side model provider to execute LLM generation.',
  },
}

const declinedSamplingResult: SamplingResult = {
  model: 'athly-human-review',
  role: 'assistant',
  stopReason: 'endTurn',
  content: {
    type: 'text',
    text: 'Sampling request was declined by the user.',
  },
}

let snapshot: ProtocolSnapshot = {
  elicitationRequest: null,
  samplingRequest: null,
}

let pendingElicitationResolve: ((result: ElicitResult) => void) | null = null
let pendingSamplingResolve: ((result: SamplingResult) => void) | null = null
let pendingElicitationTimeoutId: number | null = null
let pendingSamplingTimeoutId: number | null = null

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

function appendSamplingAuditLog(request: CreateMessageRequest) {
  const existing = localStorage.getItem(SAMPLING_AUDIT_LOG_KEY)
  const parsed = existing ? (JSON.parse(existing) as unknown[]) : []

  parsed.push({
    timestamp: new Date().toISOString(),
    messageCount: request.params.messages.length,
    maxTokens: request.params.maxTokens,
    modelPreferences: request.params.modelPreferences,
  })

  localStorage.setItem(SAMPLING_AUDIT_LOG_KEY, JSON.stringify(parsed.slice(-200)))
}

function clearElicitationPending() {
  if (pendingElicitationTimeoutId !== null) {
    window.clearTimeout(pendingElicitationTimeoutId)
    pendingElicitationTimeoutId = null
  }
  pendingElicitationResolve = null
}

function clearSamplingPending() {
  if (pendingSamplingTimeoutId !== null) {
    window.clearTimeout(pendingSamplingTimeoutId)
    pendingSamplingTimeoutId = null
  }
  pendingSamplingResolve = null
}

// Non-React subscribers allow orchestration and UI to coordinate through shared state.
export function subscribeProtocolUiState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getProtocolUiSnapshot(): ProtocolSnapshot {
  return snapshot
}

export function requestElicitation(request: ElicitRequest): Promise<ElicitResult> {
  if (pendingElicitationResolve) {
    pendingElicitationResolve({ action: 'cancel' })
    clearElicitationPending()
  }

  snapshot = {
    ...snapshot,
    elicitationRequest: request,
  }
  notify()

  return new Promise<ElicitResult>((resolve) => {
    pendingElicitationResolve = resolve
    pendingElicitationTimeoutId = window.setTimeout(() => {
      resolveElicitationCancel()
    }, REQUEST_TIMEOUT_MS)
  })
}

export function requestSamplingApproval(request: CreateMessageRequest): Promise<SamplingResult> {
  appendSamplingAuditLog(request)

  if (pendingSamplingResolve) {
    pendingSamplingResolve(declinedSamplingResult)
    clearSamplingPending()
  }

  snapshot = {
    ...snapshot,
    samplingRequest: request,
  }
  notify()

  return new Promise<SamplingResult>((resolve) => {
    pendingSamplingResolve = resolve
    pendingSamplingTimeoutId = window.setTimeout(() => {
      resolveSamplingDecline()
    }, REQUEST_TIMEOUT_MS)
  })
}

export function resolveElicitationAccept(content: ElicitationContent) {
  if (!pendingElicitationResolve) {
    return
  }

  const resolve = pendingElicitationResolve
  clearElicitationPending()
  snapshot = {
    ...snapshot,
    elicitationRequest: null,
  }
  notify()
  resolve({ action: 'accept', content })
}

export function resolveElicitationDecline() {
  if (!pendingElicitationResolve) {
    return
  }

  const resolve = pendingElicitationResolve
  clearElicitationPending()
  snapshot = {
    ...snapshot,
    elicitationRequest: null,
  }
  notify()
  resolve({ action: 'decline' })
}

export function resolveElicitationCancel() {
  if (!pendingElicitationResolve) {
    return
  }

  const resolve = pendingElicitationResolve
  clearElicitationPending()
  snapshot = {
    ...snapshot,
    elicitationRequest: null,
  }
  notify()
  resolve({ action: 'cancel' })
}

export function resolveSamplingApprove() {
  if (!pendingSamplingResolve) {
    return
  }

  const resolve = pendingSamplingResolve
  clearSamplingPending()
  snapshot = {
    ...snapshot,
    samplingRequest: null,
  }
  notify()
  resolve(approvedSamplingResult)
}

export function resolveSamplingDecline() {
  if (!pendingSamplingResolve) {
    return
  }

  const resolve = pendingSamplingResolve
  clearSamplingPending()
  snapshot = {
    ...snapshot,
    samplingRequest: null,
  }
  notify()
  resolve(declinedSamplingResult)
}
