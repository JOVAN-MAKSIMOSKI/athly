import express, { type Request, type Response } from 'express'
import { z } from 'zod'
import { VertexAI } from '@google-cloud/vertexai'

const router = express.Router()
const LLM_ROUTE_VERSION = '2026-04-08-v2-model-routing'

const DEFAULT_VERTEX_V2_LIGHT_MODEL = 'gemini-2.5-flash-lite'
const DEFAULT_VERTEX_V2_STANDARD_MODEL = 'gemini-2.5-flash'
const DEFAULT_VERTEX_V2_COMPLEX_MODEL = 'gemini-2.5-pro'

type ModelComplexity = 'light' | 'standard' | 'complex'

type AuthenticatedRequest = Request & {
  auth?: {
    userId?: string
  }
}

const LlmMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
})

const LlmRequestSchema = z.object({
  messages: z.array(LlmMessageSchema).min(1),
  registry: z.object({
    tools: z.array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        inputSchema: z.unknown().optional(),
      }),
    ),
  }),
  maxTokens: z.number().int().positive().optional(),
  toolMode: z.enum(['auto', 'required']).optional(),
  allowedToolNames: z.array(z.string().min(1)).optional(),
})

function normalizeRole(role: 'system' | 'user' | 'assistant' | 'tool'): 'user' | 'model' {
  return role === 'user' ? 'user' : 'model'
}

type VertexSchema = {
  type?: string
  description?: string
  enum?: Array<string | number | boolean>
  format?: string
  nullable?: boolean
  items?: VertexSchema
  properties?: Record<string, VertexSchema>
  required?: string[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
}

function pickFirstSchemaVariant(variants: unknown[]): unknown {
  const objectVariant = variants.find((variant) => {
    if (!variant || typeof variant !== 'object') {
      return false
    }

    const typed = variant as Record<string, unknown>
    return typed.type === 'object'
  })

  if (objectVariant) {
    return objectVariant
  }

  const nonNullVariant = variants.find((variant) => {
    if (!variant || typeof variant !== 'object') {
      return false
    }

    const typed = variant as Record<string, unknown>
    return typed.type !== 'null'
  })

  return nonNullVariant ?? variants[0]
}

function inferPrimitiveType(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return 'string'
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number'
  }

  if (typeof value === 'boolean') {
    return 'boolean'
  }

  return undefined
}

function collapseUnionVariants(variants: unknown[]): { variant: unknown; nullable: boolean } {
  let nullable = false
  const nonNullVariants = variants.filter((variant) => {
    if (!variant || typeof variant !== 'object') {
      return true
    }

    const typed = variant as Record<string, unknown>
    if (typed.type === 'null' || typed.const === null) {
      nullable = true
      return false
    }

    return true
  })

  if (nonNullVariants.length === 0) {
    return { variant: variants[0], nullable }
  }

  return {
    variant: pickFirstSchemaVariant(nonNullVariants),
    nullable,
  }
}

function sanitizeVertexSchema(value: unknown): VertexSchema | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const source = value as Record<string, unknown>

  // Collapse union-style schemas to a single variant Vertex accepts.
  if (Array.isArray(source.anyOf) && source.anyOf.length > 0) {
    const collapsed = collapseUnionVariants(source.anyOf)
    const schema = sanitizeVertexSchema(collapsed.variant)
    if (schema && collapsed.nullable) {
      schema.nullable = true
    }
    return schema
  }

  if (Array.isArray(source.any_of) && source.any_of.length > 0) {
    const collapsed = collapseUnionVariants(source.any_of)
    const schema = sanitizeVertexSchema(collapsed.variant)
    if (schema && collapsed.nullable) {
      schema.nullable = true
    }
    return schema
  }

  if (Array.isArray(source.oneOf) && source.oneOf.length > 0) {
    const collapsed = collapseUnionVariants(source.oneOf)
    const schema = sanitizeVertexSchema(collapsed.variant)
    if (schema && collapsed.nullable) {
      schema.nullable = true
    }
    return schema
  }

  if (Array.isArray(source.one_of) && source.one_of.length > 0) {
    const collapsed = collapseUnionVariants(source.one_of)
    const schema = sanitizeVertexSchema(collapsed.variant)
    if (schema && collapsed.nullable) {
      schema.nullable = true
    }
    return schema
  }

  const schema: VertexSchema = {}

  if (Array.isArray(source.type)) {
    const firstType = source.type.find((entry) => typeof entry === 'string' && entry !== 'null')
    if (typeof firstType === 'string') {
      schema.type = firstType
    }
  } else if (typeof source.type === 'string') {
    schema.type = source.type
  }

  if (typeof source.description === 'string') {
    schema.description = source.description
  }

  if (typeof source.format === 'string') {
    schema.format = source.format
  }

  if (typeof source.minimum === 'number') {
    schema.minimum = source.minimum
  }

  if (typeof source.maximum === 'number') {
    schema.maximum = source.maximum
  }

  if (typeof source.minLength === 'number') {
    schema.minLength = source.minLength
  }

  if (typeof source.maxLength === 'number') {
    schema.maxLength = source.maxLength
  }

  if (typeof source.minItems === 'number') {
    schema.minItems = source.minItems
  }

  if (typeof source.maxItems === 'number') {
    schema.maxItems = source.maxItems
  }

  if (Array.isArray(source.enum)) {
    schema.enum = source.enum.filter(
      (entry): entry is string | number | boolean =>
        typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean',
    )
  }

  // Convert JSON Schema const to enum for Vertex compatibility.
  if (source.const !== undefined && schema.enum === undefined) {
    if (
      typeof source.const === 'string' ||
      typeof source.const === 'number' ||
      typeof source.const === 'boolean'
    ) {
      schema.enum = [source.const]
      if (!schema.type) {
        schema.type = inferPrimitiveType(source.const)
      }
    }
  }

  if (source.nullable === true || (Array.isArray(source.type) && source.type.includes('null'))) {
    schema.nullable = true
  }

  if (source.items) {
    const items = sanitizeVertexSchema(source.items)
    if (items) {
      schema.items = items
    }
  }

  if (source.properties && typeof source.properties === 'object') {
    const properties = Object.entries(source.properties as Record<string, unknown>).reduce<Record<string, VertexSchema>>(
      (acc, [key, propertyValue]) => {
        const sanitized = sanitizeVertexSchema(propertyValue)
        if (sanitized) {
          acc[key] = sanitized
        }
        return acc
      },
      {},
    )

    if (Object.keys(properties).length > 0) {
      schema.properties = properties
      if (!schema.type) {
        schema.type = 'object'
      }
    }
  }

  if (Array.isArray(source.required)) {
    const required = source.required.filter((entry): entry is string => typeof entry === 'string')
    if (required.length > 0) {
      schema.required = required
    }
  }

  return Object.keys(schema).length > 0 ? schema : null
}

function scrubForVertex(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => scrubForVertex(entry))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const source = value as Record<string, unknown>
  const output: Record<string, unknown> = {}

  if (Array.isArray(source.anyOf) && source.anyOf.length > 0) {
    const collapsed = collapseUnionVariants(source.anyOf)
    const scrubbed = scrubForVertex(collapsed.variant)
    if (!collapsed.nullable || !scrubbed || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) {
      return scrubbed
    }

    return {
      ...(scrubbed as Record<string, unknown>),
      nullable: true,
    }
  }
  if (Array.isArray(source.any_of) && source.any_of.length > 0) {
    const collapsed = collapseUnionVariants(source.any_of)
    const scrubbed = scrubForVertex(collapsed.variant)
    if (!collapsed.nullable || !scrubbed || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) {
      return scrubbed
    }

    return {
      ...(scrubbed as Record<string, unknown>),
      nullable: true,
    }
  }
  if (Array.isArray(source.oneOf) && source.oneOf.length > 0) {
    const collapsed = collapseUnionVariants(source.oneOf)
    const scrubbed = scrubForVertex(collapsed.variant)
    if (!collapsed.nullable || !scrubbed || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) {
      return scrubbed
    }

    return {
      ...(scrubbed as Record<string, unknown>),
      nullable: true,
    }
  }
  if (Array.isArray(source.one_of) && source.one_of.length > 0) {
    const collapsed = collapseUnionVariants(source.one_of)
    const scrubbed = scrubForVertex(collapsed.variant)
    if (!collapsed.nullable || !scrubbed || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) {
      return scrubbed
    }

    return {
      ...(scrubbed as Record<string, unknown>),
      nullable: true,
    }
  }

  for (const [key, raw] of Object.entries(source)) {
    if (key.startsWith('$')) {
      continue
    }

    if (key === 'const') {
      const constValue = raw
      if (
        (typeof constValue === 'string' || typeof constValue === 'number' || typeof constValue === 'boolean') &&
        output.enum === undefined
      ) {
        output.enum = [constValue]
        if (output.type === undefined) {
          const inferredType = inferPrimitiveType(constValue)
          if (inferredType) {
            output.type = inferredType
          }
        }
      }
      continue
    }

    if (key === 'allOf' || key === 'all_of' || key === 'not' || key === 'if' || key === 'then' || key === 'else') {
      continue
    }

    output[key] = scrubForVertex(raw)
  }

  return output
}

function toVertexFunctionParameters(inputSchema: unknown): {
  type: string
  properties: Record<string, unknown>
  required?: string[]
} | null {
  const sanitized = sanitizeVertexSchema(inputSchema)
  if (!sanitized) {
    return null
  }

  if (sanitized.type !== 'object' || !sanitized.properties) {
    return null
  }

  return {
    type: 'object',
    properties: sanitized.properties as Record<string, unknown>,
    required: sanitized.required,
  }
}

function toVertexFunctionName(name: string): string {
  const stripped = name.replace(/[^a-zA-Z0-9_]/g, '_')
  const collapsed = stripped.replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  return collapsed.length > 0 ? collapsed.slice(0, 64) : 'tool'
}

function isV2GeminiModel(modelId: string): boolean {
  return /^gemini-2(\.|-)/.test(modelId)
}

function coerceToV2GeminiModel(candidate: string, fallback: string): string {
  return isV2GeminiModel(candidate) ? candidate : fallback
}

function pickV2ModelForRequest(input: {
  forcedModel?: string
  maxTokens?: number
  toolCount: number
  toolMode?: 'auto' | 'required'
  messageCharCount: number
  messageCount: number
}): { modelId: string; complexity: ModelComplexity; reason: string } {
  const forcedModel = input.forcedModel?.trim()
  if (forcedModel) {
    return {
      modelId: coerceToV2GeminiModel(forcedModel, DEFAULT_VERTEX_V2_STANDARD_MODEL),
      complexity: 'standard',
      reason: 'forced_by_env',
    }
  }

  const lightModel = coerceToV2GeminiModel(
    process.env.VERTEX_AI_MODEL_LIGHT || DEFAULT_VERTEX_V2_LIGHT_MODEL,
    DEFAULT_VERTEX_V2_LIGHT_MODEL,
  )
  const standardModel = coerceToV2GeminiModel(
    process.env.VERTEX_AI_MODEL_STANDARD || DEFAULT_VERTEX_V2_STANDARD_MODEL,
    DEFAULT_VERTEX_V2_STANDARD_MODEL,
  )
  const complexModel = coerceToV2GeminiModel(
    process.env.VERTEX_AI_MODEL_COMPLEX || DEFAULT_VERTEX_V2_COMPLEX_MODEL,
    DEFAULT_VERTEX_V2_COMPLEX_MODEL,
  )

  const tokenBudget = input.maxTokens ?? 2048
  const requiresTools = input.toolCount > 0 || input.toolMode === 'required'

  const isComplex =
    requiresTools || tokenBudget > 2500 || input.messageCharCount > 4000 || input.messageCount > 8

  if (isComplex) {
    return { modelId: complexModel, complexity: 'complex', reason: 'tools_or_large_context' }
  }

  const isLight =
    !requiresTools && tokenBudget <= 1024 && input.messageCharCount <= 900 && input.messageCount <= 2

  if (isLight) {
    return { modelId: lightModel, complexity: 'light', reason: 'short_simple_prompt' }
  }

  return { modelId: standardModel, complexity: 'standard', reason: 'default_balanced' }
}

router.post('/message', express.json({ limit: '5mb' }), async (req: Request, res: Response) => {
  res.setHeader('x-athly-llm-route-version', LLM_ROUTE_VERSION)
  const parsed = LlmRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      code: 'INVALID_LLM_REQUEST',
      message: 'Invalid LLM request payload',
      details: parsed.error.flatten(),
    })
    return
  }

  const vertexProjectId = process.env.VERTEX_AI_PROJECT || ''
  const vertexLocation = process.env.VERTEX_AI_LOCATION || 'europe-west4'
  const forcedVertexModelId = process.env.VERTEX_AI_MODEL

  if (!vertexProjectId) {
    res.status(500).json({
      code: 'VERTEX_CONFIG_MISSING',
      message: 'VERTEX_AI_PROJECT is not configured on the server.',
    })
    return
  }

  try {
    const requestBody = parsed.data
    const systemMessages = requestBody.messages.filter((message) => message.role === 'system')
    const nonSystemMessages = requestBody.messages.filter((message) => message.role !== 'system')

    const authUserId = (req as AuthenticatedRequest).auth?.userId?.trim()
    const hiddenAuthContext = authUserId
      ? [
          'Authenticated runtime context (hidden from end user):',
          `- userId: ${authUserId}`,
          'Never ask the user for their user id.',
          'For any tool argument named "userId", always use this authenticated value.',
        ].join('\n')
      : ''

    const systemText = [
      hiddenAuthContext,
      systemMessages.map((message) => message.content.text).join('\n\n').trim(),
    ]
      .filter((value) => value.length > 0)
      .join('\n\n')
    const contents = nonSystemMessages.map((message) => ({
      role: normalizeRole(message.role),
      parts: [{ text: message.content.text }],
    }))

    const usedVertexNames = new Set<string>()
    const vertexNameToOriginalName = new Map<string, string>()
    const originalNameToVertexName = new Map<string, string>()

    const functionDeclarations = requestBody.registry.tools.map((tool, toolIndex) => {
      let vertexNameBase = toVertexFunctionName(tool.name)
      if (!vertexNameBase) {
        vertexNameBase = `tool_${toolIndex + 1}`
      }

      let vertexName = vertexNameBase
      let suffix = 2
      while (usedVertexNames.has(vertexName)) {
        const nextName = `${vertexNameBase}_${suffix}`
        vertexName = nextName.slice(0, 64)
        suffix += 1
      }

      usedVertexNames.add(vertexName)
      vertexNameToOriginalName.set(vertexName, tool.name)
      originalNameToVertexName.set(tool.name, vertexName)

      const declaration: {
        name: string
        description?: string
        parameters?: {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      } = {
        name: vertexName,
      }

      if (tool.description) {
        declaration.description = tool.description
      }

      const sanitized = toVertexFunctionParameters(tool.inputSchema)
      if (sanitized) {
        declaration.parameters = sanitized
      } else {
        console.error('[LLM][TOOLS][SCHEMA_SKIPPED]', {
          toolName: tool.name,
          reason: 'Tool schema could not be converted to Vertex-compatible format',
        })
      }

      return declaration
    })

    const cleanedFunctionDeclarations = scrubForVertex(functionDeclarations) as typeof functionDeclarations

    const totalMessageCharCount = requestBody.messages.reduce(
      (count, message) => count + message.content.text.length,
      0,
    )
    const modelSelection = pickV2ModelForRequest({
      forcedModel: forcedVertexModelId,
      maxTokens: requestBody.maxTokens,
      toolCount: functionDeclarations.length,
      toolMode: requestBody.toolMode,
      messageCharCount: totalMessageCharCount,
      messageCount: requestBody.messages.length,
    })

    const declarationPayload = JSON.stringify(cleanedFunctionDeclarations)
    console.error('[LLM][TOOLS][PAYLOAD_CHECK]', {
      routeVersion: LLM_ROUTE_VERSION,
      toolCount: functionDeclarations.length,
      hasSchemaKeyword: declarationPayload.includes('$schema'),
      hasConstKeyword: declarationPayload.includes('"const"'),
      hasAnyOfKeyword: declarationPayload.includes('anyOf') || declarationPayload.includes('any_of'),
      hasOneOfKeyword: declarationPayload.includes('oneOf') || declarationPayload.includes('one_of'),
    })

    const vertexAi = new VertexAI({ project: vertexProjectId, location: vertexLocation })
    const model = vertexAi.getGenerativeModel({ model: modelSelection.modelId })

    console.error('[LLM][MODEL_ROUTER]', {
      routeVersion: LLM_ROUTE_VERSION,
      location: vertexLocation,
      selectedModel: modelSelection.modelId,
      complexity: modelSelection.complexity,
      reason: modelSelection.reason,
      forcedModel: forcedVertexModelId || null,
      messageCount: requestBody.messages.length,
      messageCharCount: totalMessageCharCount,
      toolCount: functionDeclarations.length,
      maxTokens: requestBody.maxTokens ?? 2048,
    })

    const generationRequest: {
      contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
      generationConfig: { maxOutputTokens: number; temperature: number }
      systemInstruction?: { role: 'system'; parts: Array<{ text: string }> }
      tools?: Array<{ functionDeclarations: typeof functionDeclarations }>
      toolConfig?: {
        functionCallingConfig?: {
          mode: 'AUTO' | 'ANY' | 'NONE'
          allowedFunctionNames?: string[]
        }
      }
    } = {
      contents,
      generationConfig: {
        maxOutputTokens: requestBody.maxTokens ?? 2048,
        temperature: 0.3,
      },
    }

    if (systemText) {
      generationRequest.systemInstruction = {
        role: 'system',
        parts: [{ text: systemText }],
      }
    }

    if (functionDeclarations.length > 0) {
      generationRequest.tools = [{ functionDeclarations: cleanedFunctionDeclarations }]

      if (requestBody.toolMode === 'required') {
        const requestedAllowedNames = Array.isArray(requestBody.allowedToolNames)
          ? requestBody.allowedToolNames
          : []

        const allowedFunctionNames = requestedAllowedNames
          .map((toolName) => originalNameToVertexName.get(toolName))
          .filter((toolName): toolName is string => typeof toolName === 'string' && toolName.length > 0)

        generationRequest.toolConfig = {
          functionCallingConfig:
            allowedFunctionNames.length > 0
              ? {
                  mode: 'ANY',
                  allowedFunctionNames,
                }
              : {
                  mode: 'ANY',
                },
        }
      }
    }

    const response = await model.generateContent(generationRequest as never)
    const firstCandidate = response.response?.candidates?.[0]
    const finishReason =
      typeof firstCandidate?.finishReason === 'string' ? firstCandidate.finishReason : undefined
    const parts = firstCandidate?.content?.parts ?? []

    const text = parts
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .filter((value) => value.length > 0)
      .join('\n')
      .trim()

    const toolCalls = parts
      .filter((part) => typeof part.functionCall?.name === 'string' && part.functionCall.name.length > 0)
      .map((part) => ({
        name: vertexNameToOriginalName.get(part.functionCall!.name!) ?? part.functionCall!.name!,
        arguments: (part.functionCall?.args as Record<string, unknown> | undefined) ?? {},
      }))

    res.status(200).json({
      routeVersion: LLM_ROUTE_VERSION,
      text,
      toolCalls,
      finishReason,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Vertex provider error'
    res.status(502).json({
      routeVersion: LLM_ROUTE_VERSION,
      code: 'LLM_PROVIDER_ERROR',
      message,
    })
  }
})

export default router