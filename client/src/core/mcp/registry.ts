import type { ListPromptsResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js'
import { mcpClient } from './mcpClient.ts'

export type McpRegistrySnapshot = {
  tools: ListToolsResult['tools']
  prompts: ListPromptsResult['prompts']
  resources: string[]
  updatedAt: string | null
}

// MCP registry stores discovered server capabilities for downstream orchestration layers.
const snapshot: McpRegistrySnapshot = {
  tools: [],
  prompts: [],
  resources: [],
  updatedAt: null,
}

export async function refreshMcpRegistry(): Promise<McpRegistrySnapshot> {
  const [tools, prompts] = await Promise.all([mcpClient.listTools(), mcpClient.listPrompts()])

  snapshot.tools = tools.tools
  snapshot.prompts = prompts.prompts
  snapshot.updatedAt = new Date().toISOString()

  return getMcpRegistrySnapshot()
}

export async function refreshMcpRegistryWithToken(bearerToken?: string): Promise<McpRegistrySnapshot> {
  const [tools, prompts] = await Promise.all([
    mcpClient.listTools(bearerToken),
    mcpClient.listPrompts(bearerToken),
  ])

  snapshot.tools = tools.tools
  snapshot.prompts = prompts.prompts
  snapshot.updatedAt = new Date().toISOString()

  return getMcpRegistrySnapshot()
}

export function getMcpRegistrySnapshot(): McpRegistrySnapshot {
  return {
    tools: [...snapshot.tools],
    prompts: [...snapshot.prompts],
    resources: [...snapshot.resources],
    updatedAt: snapshot.updatedAt,
  }
}
