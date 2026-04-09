import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  CallToolResultSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  type CallToolResult,
  type ClientCapabilities,
  type CreateMessageRequest,
  type ElicitRequest,
  type GetPromptResult,
  type ListPromptsResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import { connectionConfig } from '../../config/connectionConfig.ts'

// MCP layer owns transport, handshake, request wiring, and JSON-RPC operations.
const clientCapabilities: ClientCapabilities = {
  sampling: {},
  roots: { listChanged: false },
  elicitation: {
    form: { applyDefaults: true },
  },
}

class McpClient {
  private client: Client

  private transport: StreamableHTTPClientTransport | null = null
  private isConnected = false
  private connectPromise: Promise<void> | null = null
  private lastBearerToken: string | undefined
  private elicitationHandler:
    | ((request: ElicitRequest) => Promise<Record<string, unknown>> | Record<string, unknown>)
    | null = null
  private samplingHandler:
    | ((request: CreateMessageRequest) => Promise<Record<string, unknown>> | Record<string, unknown>)
    | null = null
  private debugCounter = 0

  constructor() {
    this.client = this.createClient()
  }

  private createClient(): Client {
    const instance = new Client(
      {
        name: 'athly-web',
        version: '0.1.0',
      },
      { capabilities: clientCapabilities },
    )

    instance.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: connectionConfig.allowedRootPaths.map((rootPath: string) => ({
        uri: `file://${rootPath.replace(/^\.\//, '/')}`,
        name: rootPath,
      })),
    }))

    if (this.elicitationHandler) {
      instance.setRequestHandler(ElicitRequestSchema, async (request) => this.elicitationHandler!(request))
    }

    if (this.samplingHandler) {
      instance.setRequestHandler(CreateMessageRequestSchema, async (request) => this.samplingHandler!(request))
    }

    return instance
  }

  private async resetConnectionState(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close()
      } catch {
        // no-op
      }
    }

    this.transport = null
    this.isConnected = false
    this.connectPromise = null
    this.client = this.createClient()
  }

  private endpoint(): URL {
    const base = connectionConfig.apiBaseUrl.replace(/\/$/, '')
    const path = connectionConfig.mcpPath.startsWith('/')
      ? connectionConfig.mcpPath
      : `/${connectionConfig.mcpPath}`
    return new URL(`${base}${path}`)
  }

  private debug(event: string, data?: Record<string, unknown>) {
    this.debugCounter += 1
    console.log(`[MCP][CLIENT][${this.debugCounter}] ${event}`, {
      isConnected: this.isConnected,
      hasTransport: Boolean(this.transport),
      sessionId: this.transport?.sessionId ?? null,
      ...data,
    })
  }

  private async establishConnection(bearerToken?: string): Promise<void> {
    this.debug('establishConnection:start', {
      endpoint: this.endpoint().toString(),
      hasBearerToken: Boolean(bearerToken),
    })

    this.transport = new StreamableHTTPClientTransport(this.endpoint(), {
      requestInit: {
        credentials: 'include',
        headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : undefined,
      },
    })
    this.lastBearerToken = bearerToken

    this.connectPromise = this.client.connect(this.transport).then(() => {
      this.isConnected = true
      this.debug('establishConnection:connected')
    })

    try {
      await this.connectPromise
    } finally {
      this.connectPromise = null
    }
  }

  async connect(bearerToken?: string): Promise<void> {
    this.debug('connect:called', {
      hasBearerToken: Boolean(bearerToken),
      tokenChanged: this.lastBearerToken !== bearerToken,
    })

    if (this.isConnected && this.lastBearerToken !== bearerToken) {
      this.debug('connect:tokenChangedReset')
      await this.resetConnectionState()
    }

    if (this.isConnected) {
      this.debug('connect:alreadyConnected')
      return
    }

    if (this.connectPromise) {
      this.debug('connect:awaitExistingPromise')
      return this.connectPromise
    }

    let lastError: unknown = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      this.debug('connect:attempt', { attempt: attempt + 1 })
      try {
        await this.establishConnection(bearerToken)
        this.debug('connect:success', { attempt: attempt + 1 })
        return
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error)
        this.debug('connect:error', {
          attempt: attempt + 1,
          message,
        })
        await this.resetConnectionState()

        if (!message.includes('Server already initialized')) {
          throw error
        }
      }
    }

    this.debug('connect:failedAfterRetries', {
      message: lastError instanceof Error ? lastError.message : String(lastError),
    })
    throw lastError
  }

  async disconnect(): Promise<void> {
    await this.resetConnectionState()
  }

  getSessionId(): string | undefined {
    return this.transport?.sessionId
  }

  setElicitationHandler(
    handler: (request: ElicitRequest) => Promise<Record<string, unknown>> | Record<string, unknown>,
  ) {
    this.elicitationHandler = handler
    this.client.setRequestHandler(ElicitRequestSchema, async (request) => handler(request))
  }

  setSamplingHandler(
    handler: (request: CreateMessageRequest) => Promise<Record<string, unknown>> | Record<string, unknown>,
  ) {
    this.samplingHandler = handler
    this.client.setRequestHandler(CreateMessageRequestSchema, async (request) => handler(request))
  }

  async listTools(bearerToken?: string): Promise<ListToolsResult> {
    this.debug('listTools:called')
    await this.connect(bearerToken)
    return this.client.listTools()
  }

  async listPrompts(bearerToken?: string): Promise<ListPromptsResult> {
    this.debug('listPrompts:called')
    await this.connect(bearerToken)
    return this.client.listPrompts()
  }

  async getPrompt(name: string, args: Record<string, string> = {}, bearerToken?: string): Promise<GetPromptResult> {
    this.debug('getPrompt:called', { name })
    await this.connect(bearerToken)
    return this.client.getPrompt({ name, arguments: args })
  }

  async callTool(name: string, args: Record<string, unknown>, bearerToken?: string): Promise<CallToolResult> {
    this.debug('callTool:called', { name, argumentKeys: Object.keys(args) })
    await this.connect(bearerToken)
    const response = await this.client.request(
      {
        method: 'tools/call',
        params: {
          name,
          arguments: args,
        },
      },
      CallToolResultSchema,
    )
    return response
  }
}

export const mcpClient = new McpClient()
