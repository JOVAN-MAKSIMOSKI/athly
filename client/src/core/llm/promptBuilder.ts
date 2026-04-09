import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { LlmMessage } from './llmClient.ts'

const MAX_TOOL_RESULT_CHARS = 12_000

function serializeForModel(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ code: 'TOOL_RESULT_SERIALIZATION_FAILED' })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseToolJsonPayload(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return null
  }

  const firstTextBlock = result.content.find(
    (entry) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string',
  ) as { text?: string } | undefined

  if (!firstTextBlock?.text) {
    return null
  }

  try {
    const parsed = JSON.parse(firstTextBlock.text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function compactSearchExercisesPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const data = isRecord(payload.data) ? payload.data : {}
  const items = Array.isArray(data.items) ? data.items : []
  const compactItems = items.slice(0, 12).map((item) => {
    if (!isRecord(item)) {
      return item
    }

    return {
      id: item.id,
      name: item.name,
      targetMuscle: item.targetMuscle,
      equipment: item.equipment,
      compound: item.compound,
      force: item.force,
      category: item.category,
    }
  })

  return {
    success: payload.success,
    data: {
      total: data.total,
      limit: data.limit,
      offset: data.offset,
      items: compactItems,
    },
  }
}

function compactCreateUserExercisesPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const data = Array.isArray(payload.data) ? payload.data : []
  const compactData = data.slice(0, 30).map((entry) => {
    if (!isRecord(entry)) {
      return entry
    }

    const currentTarget = isRecord(entry.currentTarget) ? entry.currentTarget : {}
    return {
      userExerciseId: entry._id ?? entry.id,
      exerciseId: entry.exerciseId,
      currentTarget: {
        progressionMethod: currentTarget.progressionMethod,
        sets: currentTarget.sets,
        reps: currentTarget.reps,
        rpe: currentTarget.rpe,
        restSeconds: currentTarget.restSeconds,
        trainingType: currentTarget.trainingType,
        supersetGroup: currentTarget.supersetGroup,
      },
    }
  })

  return {
    success: payload.success,
    generationMeta: payload.generationMeta,
    data: compactData,
  }
}

function compactCreateWorkoutPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const data = isRecord(payload.data) ? payload.data : {}
  const exercises = Array.isArray(data.exercises) ? data.exercises : []

  return {
    success: payload.success,
    data: {
      id: data._id ?? data.id,
      name: data.name,
      status: data.status,
      estimatedWorkoutTimeToFinish: data.estimatedWorkoutTimeToFinish,
      exerciseCount: exercises.length,
    },
  }
}

function compactGenerateWorkoutPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const data = isRecord(payload.data) ? payload.data : {}
  const workout = isRecord(data.workout) ? data.workout : {}
  const exercises = Array.isArray(data.exercises) ? data.exercises : []

  return {
    success: payload.success,
    data: {
      workout: {
        id: workout.id ?? workout._id,
        name: workout.name,
        status: workout.status,
        estimatedWorkoutTimeToFinish: workout.estimatedWorkoutTimeToFinish,
      },
      focus: data.focus,
      trainingType: data.trainingType,
      progressionMethod: data.progressionMethod,
      respectedConstraints: data.respectedConstraints,
      rulesApplied: data.rulesApplied,
      exercises: exercises.slice(0, 12).map((entry) => {
        if (!isRecord(entry)) {
          return entry
        }

        return {
          name: entry.name,
          equipment: entry.equipment,
          targetMuscle: entry.targetMuscle,
          sets: entry.sets,
          reps: entry.reps,
          rpe: entry.rpe,
          restSeconds: entry.restSeconds,
          weight: entry.weight,
          note: entry.note,
        }
      }),
    },
  }
}

function buildCompactToolResult(toolName: string, result: unknown): unknown {
  const payload = parseToolJsonPayload(result)
  if (!payload) {
    return { toolName, result }
  }

  if (toolName === 'athly.search_exercises') {
    return { toolName, result: compactSearchExercisesPayload(payload) }
  }

  if (toolName === 'athly.create_user_exercises') {
    return { toolName, result: compactCreateUserExercisesPayload(payload) }
  }

  if (toolName === 'athly.create_workout_plan') {
    return { toolName, result: compactCreateWorkoutPayload(payload) }
  }

  if (toolName === 'athly.generate_workout') {
    return { toolName, result: compactGenerateWorkoutPayload(payload) }
  }

  return { toolName, result: payload }
}

type LlmCapabilitySnapshot = {
  tools: Array<{ name: string }>
}

// Prompt builder constructs model inputs and keeps formatting concerns out of UI/transport layers.
export function buildAgentMessages(input: {
  systemInstructions: string | null
  userMessage: string
  history: LlmMessage[]
  registry: LlmCapabilitySnapshot
}): LlmMessage[] {
  const systemSummary = input.systemInstructions
    ? `${input.systemInstructions}\n\nAvailable tools: ${input.registry.tools.map((tool) => tool.name).join(', ') || 'none'}.`
    : `Available tools: ${input.registry.tools.map((tool) => tool.name).join(', ') || 'none'}.`

  const baseMessages: LlmMessage[] = [
    {
      role: 'system',
      content: { type: 'text', text: systemSummary },
    },
    ...input.history,
    {
      role: 'user',
      content: { type: 'text', text: input.userMessage },
    },
  ]

  return baseMessages
}

export function formatToolResultForModel(toolName: string, result: unknown): LlmMessage {
  const compactResult = buildCompactToolResult(toolName, result)
  const serialized = serializeForModel(compactResult)
  const text =
    serialized.length <= MAX_TOOL_RESULT_CHARS
      ? serialized
      : JSON.stringify({
          toolName,
          truncated: true,
          totalChars: serialized.length,
          preview: serialized.slice(0, MAX_TOOL_RESULT_CHARS),
        })

  return {
    role: 'tool',
    content: {
      type: 'text',
      text,
    },
  }
}

export async function fetchSystemInstructions(client: Client): Promise<string | null> {
  try {
    const prompts = await client.listPrompts({})
    const systemPrompt = prompts.prompts.find((prompt) => prompt.name === 'system-instructions')
    if (!systemPrompt) {
      return null
    }

    const promptContent = await client.getPrompt({
      name: 'system-instructions',
      arguments: {},
    })

    const systemMessage = promptContent.messages[0]
    if (!systemMessage || systemMessage.content.type !== 'text') {
      return null
    }

    return systemMessage.content.text
  } catch {
    return null
  }
}

export async function prependSystemInstructions(
  client: Client,
  messages: Array<{ role: 'user' | 'assistant'; content: { type: string; text: string } }>,
  systemInstructions?: string | null,
): Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: { type: string; text: string } }>> {
  const instructions = systemInstructions ?? (await fetchSystemInstructions(client))

  if (!instructions) {
    return messages as Array<{
      role: 'system' | 'user' | 'assistant'
      content: { type: string; text: string }
    }>
  }

  const systemMessage = {
    role: 'system' as const,
    content: {
      type: 'text' as const,
      text: instructions,
    },
  }

  return [systemMessage, ...messages]
}

export async function initializeSystemInstructions(client: Client): Promise<string | null> {
  return fetchSystemInstructions(client)
}
