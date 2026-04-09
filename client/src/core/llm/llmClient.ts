import { connectionConfig } from '../../config/connectionConfig.ts'

type LlmCapabilitySnapshot = {
  tools: Array<{
    name: string
    description?: string
    inputSchema?: unknown
  }>
}

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool'

export type LlmMessage = {
  role: LlmRole
  content: {
    type: 'text'
    text: string
  }
}

export type LlmToolCall = {
  name: string
  arguments: Record<string, unknown>
}

export type LlmResponse = {
  text: string
  toolCalls?: LlmToolCall[]
  finishReason?: string
}

export type LlmRequest = {
  messages: LlmMessage[]
  registry: LlmCapabilitySnapshot
  maxTokens?: number
  toolMode?: 'auto' | 'required'
  allowedToolNames?: string[]
}

type VertexGenerateContentResponse = {
  text: string
  toolCalls?: LlmToolCall[]
  finishReason?: string
}

function buildVertexRequestBody(request: LlmRequest) {
  return {
    messages: request.messages,
    registry: {
      tools: request.registry.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    },
    maxTokens: request.maxTokens,
    toolMode: request.toolMode,
    allowedToolNames: request.allowedToolNames,
  }
}

function parseVertexResponse(response: VertexGenerateContentResponse): LlmResponse {
  return {
    text: response.text,
    toolCalls: response.toolCalls ?? [],
    finishReason: response.finishReason,
  }
}

// LLM layer only talks to provider APIs and does not know MCP transport details.
export async function createMessageWithProvider(
  request: LlmRequest,
  authToken?: string,
): Promise<LlmResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  const response = await fetch(`${connectionConfig.apiBaseUrl}/llm/message`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(buildVertexRequestBody(request)),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`LLM provider request failed (${response.status}): ${message}`)
  }

  const payload = (await response.json()) as VertexGenerateContentResponse
  return parseVertexResponse(payload)
}
