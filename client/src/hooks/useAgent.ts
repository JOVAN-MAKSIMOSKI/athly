import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ElicitRequest } from '@modelcontextprotocol/sdk/types.js'
import type { LlmMessage } from '../core/llm/llmClient.ts'
import { createMessageWithProvider } from '../core/llm/llmClient.ts'
import { formatToolResultForModel } from '../core/llm/promptBuilder.ts'
import { mcpClient } from '../core/mcp/mcpClient.ts'
import { getMcpRegistrySnapshot, refreshMcpRegistryWithToken } from '../core/mcp/registry.ts'
import { requestElicitation, requestSamplingApproval } from '../state/protocolUiState.ts'
import { useAuth } from '../state/authSessionStore.ts'
import { getActiveWorkoutContext } from '../state/activeWorkoutContext.ts'

type UseAgentOptions = {
  maxLoops?: number
  timeoutMs?: number
  maxTokens?: number
}

type UseAgentResult = {
  messages: LlmMessage[]
  isRunning: boolean
  error: string | null
  run: (userText: string) => Promise<void>
  triggerOnboarding: (selectedSplit?: string) => void
  clear: () => void
}

const MAX_REQUEST_CHAR_BUDGET = 85_000
const CHAT_STORAGE_KEY_PREFIX = 'athly_chat_messages'
const POST_SIGNUP_MESSAGE_FLAG_KEY_PREFIX = 'athly:post-signup-message'
const POST_SIGNUP_MESSAGE_FLAG_KEY_GLOBAL = 'athly:post-signup-message'
const POST_SIGNUP_ASSISTANT_MESSAGE_TEXT = "What's on the agenda today?"
const ONBOARDING_FIRED_FLAG_KEY_PREFIX = 'athly:onboarding-fired'
const ENABLE_WORKOUT_AUTO_COMMIT_FALLBACK = false

function buildOnboardingPrompt(selectedSplit?: string): string {
  const splitLine = selectedSplit?.trim().length
    ? `Great choice with ${selectedSplit.trim()}.`
    : 'Great choice on your split.'

  return [
    `${splitLine} Let us finish onboarding with 2 quick check-ins so I can coach safely and accurately.`,
    '',
    '1. Any injuries, pain, soreness, or movement restrictions I should program around?',
    '2. How is your current energy and recovery (sleep, stress, fatigue)?',
    '',
    'Reply in one message and I will personalize your next sessions.',
  ].join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function estimateMessagesCharSize(messages: LlmMessage[]): number {
  return messages.reduce((total, message) => total + message.content.text.length + 32, 0)
}

function compactMessagesForRequest(messages: LlmMessage[], maxChars: number): LlmMessage[] {
  if (messages.length <= 1) {
    return messages
  }

  if (estimateMessagesCharSize(messages) <= maxChars) {
    return messages
  }

  const preserved: LlmMessage[] = [messages[0]]
  const remainder = messages.slice(1)
  const keptFromTail: LlmMessage[] = []
  let currentSize = estimateMessagesCharSize(preserved)

  for (let index = remainder.length - 1; index >= 0; index -= 1) {
    const candidate = remainder[index]
    const candidateSize = candidate.content.text.length + 32
    if (currentSize + candidateSize > maxChars) {
      continue
    }

    keptFromTail.unshift(candidate)
    currentSize += candidateSize
  }

  return [...preserved, ...keptFromTail]
}

function isJwtExpired(token: string): boolean {
  try {
    const parts = token.split('.')
    if (parts.length < 2) {
      return true
    }

    const payload = decodeJwtPayload(parts[1]) as { exp?: number } | null
    if (!payload) {
      return true
    }
    if (typeof payload.exp !== 'number') {
      return false
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    return payload.exp <= nowSeconds
  } catch {
    return true
  }
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = normalized.length % 4
  const padded = remainder === 0 ? normalized : `${normalized}${'='.repeat(4 - remainder)}`
  return window.atob(padded)
}

function decodeJwtPayload(payloadSegment: string): Record<string, unknown> | null {
  try {
    const decoded = decodeBase64Url(payloadSegment)
    const parsed = JSON.parse(decoded)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function extractAuthenticatedUserId(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) {
      return null
    }

    const payload = decodeJwtPayload(parts[1]) as { id?: unknown; sub?: unknown } | null
    if (!payload) {
      return null
    }
    if (typeof payload.id === 'string' && payload.id.trim().length > 0) {
      return payload.id.trim()
    }

    if (typeof payload.sub === 'string' && payload.sub.trim().length > 0) {
      return payload.sub.trim()
    }

    return null
  } catch {
    return null
  }
}

function extractObjectIdString(value: unknown): string | null {
  if (typeof value === 'string' && /^[a-f\d]{24}$/i.test(value.trim())) {
    return value.trim()
  }

  if (!isRecord(value)) {
    return null
  }

  const oid = value.$oid
  if (typeof oid === 'string' && /^[a-f\d]{24}$/i.test(oid.trim())) {
    return oid.trim()
  }

  const nestedId = value._id ?? value.id
  if (typeof nestedId === 'string' && /^[a-f\d]{24}$/i.test(nestedId.trim())) {
    return nestedId.trim()
  }

  return null
}

function isPersistableMessage(message: LlmMessage): boolean {
  return message.role === 'user' || message.role === 'assistant'
}

function stripLegacyWorkoutSummary(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n')
  const hasWorkoutIntro =
    /\b(?:here(?:'|’)s|here is)\s+your\b[\s\S]*\b(?:session|workout)\b/i.test(normalized) ||
    /let me know if you have any questions about the exercises\./i.test(normalized)
  const hasPlainWorkoutTable =
    /(?:^|\n)\s*exercise\s+weight\s+reps\s+sets\s+rest\s*(?:\n|$)/i.test(normalized) ||
    /(?:^|\n)\s*exercise\s+sets\s+reps\s+weight\s+rest\s+notes\s*(?:\n|$)/i.test(normalized)
  const hasWorkoutFollowUp = /how does this look\?\s*we can make adjustments based on your feedback\.?/i.test(normalized)

  if ((hasWorkoutIntro && hasPlainWorkoutTable) || (hasPlainWorkoutTable && hasWorkoutFollowUp)) {
    return ''
  }

  return text
}

function sanitizeConversationMessages(messages: LlmMessage[]): LlmMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== 'assistant') {
      return [message]
    }

    const sanitizedText = sanitizeAssistantFacingText(message.content.text)
    if (sanitizedText.length === 0) {
      return []
    }

    if (sanitizedText === message.content.text) {
      return [message]
    }

    return [
      {
        ...message,
        content: {
          ...message.content,
          text: sanitizedText,
        },
      },
    ]
  })
}

function areMessageListsEqual(left: LlmMessage[], right: LlmMessage[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((message, index) => {
    const other = right[index]
    return message.role === other.role && message.content.type === other.content.type && message.content.text === other.content.text
  })
}

function parseStoredMessages(raw: string): LlmMessage[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    const safeMessages = parsed.filter((entry): entry is LlmMessage => {
      if (!isRecord(entry)) {
        return false
      }

      const role = entry.role
      const content = entry.content

      return (
        (role === 'user' || role === 'assistant') &&
        isRecord(content) &&
        content.type === 'text' &&
        typeof content.text === 'string'
      )
    })

    // Sanitize any previously persisted assistant messages so legacy leaks are removed on load.
    return sanitizeConversationMessages(safeMessages)
  } catch {
    return []
  }
}

function stripThoughtProcess(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n')

  // Drop explicit thought blocks starting with THOUGHT/THINKING/REASONING style headers.
  const thoughtHeader = /^\s*(THOUGHT|THINKING|REASONING|INTERNAL PLAN)\b[\s\S]*$/im
  if (thoughtHeader.test(normalized)) {
    return ''
  }

  // Remove prefixed reasoning lines that can leak internal planning.
  const withoutReasoningLines = normalized
    .split('\n')
    .filter((line) => !/^\s*(Thought|Thinking|Reasoning)\s*[:-]/i.test(line))
    .join('\n')

  return withoutReasoningLines
}

function redactInternalIds(text: string): string {
  let output = text

  // Remove labels that explicitly expose internal identifiers.
  output = output.replace(/\b(workout\s*id|user\s*id|exercise\s*id|user\s*exercise\s*id|log\s*id)\s*:\s*[^\n]+/gi, '')

  // Redact key-value pairs that expose ids in JSON-like text.
  output = output.replace(/(["']?(?:userId|exerciseId|userExerciseId|workoutId|logId|_id|id)["']?\s*[:=]\s*)["']?[a-f0-9]{24}["']?/gi, '$1[redacted]')

  // Redact bare Mongo ObjectId-like tokens.
  output = output.replace(/\b[a-f0-9]{24}\b/gi, '[redacted]')

  return output
}

function sanitizeAssistantFacingText(text: string): string {
  const withoutThoughts = stripThoughtProcess(text)
  const withoutLegacyWorkoutSummary = stripLegacyWorkoutSummary(withoutThoughts)
  const redacted = redactInternalIds(withoutLegacyWorkoutSummary)
  return redacted
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function humanizeStructuredAssistantText(text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      status?: string
      summary?: string
      workoutSaved?: boolean | null
      workoutId?: string | null
      appliedRules?: string[]
      nextSteps?: string[]
    }

    if (typeof parsed !== 'object' || parsed === null || typeof parsed.summary !== 'string') {
      return text
    }

    const lines: string[] = [parsed.summary.trim()]

    if (parsed.workoutSaved === true) {
      lines.push('')
      lines.push('Saved successfully.')
    }

    if (Array.isArray(parsed.appliedRules) && parsed.appliedRules.length > 0) {
      lines.push('')
      lines.push('Applied adjustments:')
      for (const rule of parsed.appliedRules) {
        lines.push(`- ${rule}`)
      }
    }

    if (Array.isArray(parsed.nextSteps) && parsed.nextSteps.length > 0) {
      lines.push('')
      lines.push('Next steps:')
      for (const step of parsed.nextSteps) {
        lines.push(`- ${step}`)
      }
    }

    return sanitizeAssistantFacingText(lines.join('\n'))
  } catch {
    return sanitizeAssistantFacingText(text)
  }
}

function toolInputSchemaHasUserId(inputSchema: unknown): boolean {
  if (!isRecord(inputSchema)) {
    return false
  }

  const properties = inputSchema.properties
  if (!isRecord(properties)) {
    return false
  }

  return 'userId' in properties
}

function normalizeToolNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/^athly[._-]?/, '')
    .replace(/[^a-z0-9]/g, '')
}

function isToolNameMatch(actualName: string, expectedName: string): boolean {
  return normalizeToolNameForMatch(actualName) === normalizeToolNameForMatch(expectedName)
}

function toolLikelyRequiresUserId(toolName: string): boolean {
  const normalized = normalizeToolNameForMatch(toolName)
  const userScopedTools = [
    'getuserprofile',
    'generateworkout',
    'createuserexercises',
    'createworkoutplan',
    'trackprogressintermediateadvanced',
    'updateuserexercisepreferredweight',
  ]

  return userScopedTools.includes(normalized)
}

function resolveToolNameFromRegistry(rawToolName: string): string {
  const registryTools = getMcpRegistrySnapshot().tools
  const availableNames = registryTools.map((tool) => tool.name)

  const canonicalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/^athly[._-]?/, '')
      .replace(/[^a-z0-9]/g, '')

  if (availableNames.includes(rawToolName)) {
    return rawToolName
  }

  const candidates = new Set<string>()
  candidates.add(rawToolName)
  candidates.add(rawToolName.trim())

  if (!rawToolName.startsWith('athly.')) {
    candidates.add(`athly.${rawToolName}`)
  }

  // Vertex and models may emit underscores instead of dots.
  const dotified = rawToolName.replace(/_/g, '.')
  candidates.add(dotified)

  if (!dotified.startsWith('athly.')) {
    candidates.add(`athly.${dotified}`)
  }

  // Handle names like "athly_create_user_exercises" -> "athly.create_user_exercises".
  if (rawToolName.startsWith('athly_')) {
    candidates.add(`athly.${rawToolName.slice('athly_'.length)}`)
  }

  for (const candidate of candidates) {
    if (availableNames.includes(candidate)) {
      return candidate
    }
  }

  const rawCanonical = canonicalize(rawToolName)
  const canonicalMatch = registryTools.find((tool) => canonicalize(tool.name) === rawCanonical)
  if (canonicalMatch) {
    return canonicalMatch.name
  }

  return rawToolName
}

function extractToolTextPayload(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) {
    return null
  }

  const content = result.content
  if (!Array.isArray(content)) {
    return null
  }

  const firstTextBlock = content.find(
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

function extractRawToolText(result: unknown): string | null {
  if (!isRecord(result)) {
    return null
  }

  const content = result.content
  if (!Array.isArray(content)) {
    return null
  }

  const firstTextBlock = content.find(
    (entry) => isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string',
  ) as { text?: string } | undefined

  if (!firstTextBlock?.text) {
    return null
  }

  const normalized = firstTextBlock.text.trim()
  return normalized.length > 0 ? normalized : null
}

function stringifyToolDetailValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value.trim() : null
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => stringifyToolDetailValue(entry))
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)

    return parts.length > 0 ? parts.join('; ') : null
  }

  if (isRecord(value)) {
    const formattedEntries = Object.entries(value)
      .map(([key, entry]) => {
        const normalized = stringifyToolDetailValue(entry)
        return normalized ? `${key}: ${normalized}` : null
      })
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)

    return formattedEntries.length > 0 ? formattedEntries.join('; ') : null
  }

  return null
}

function formatToolFailureMessage(input: {
  payload: Record<string, unknown> | null
  fallbackMessage: string
  rawToolText?: string | null
}): string {
  const { payload, fallbackMessage, rawToolText } = input

  if (!payload) {
    if (typeof rawToolText === 'string' && rawToolText.trim().length > 0) {
      const compactRaw = rawToolText.replace(/\s+/g, ' ').trim()
      const clippedRaw = compactRaw.length > 500 ? `${compactRaw.slice(0, 500)}…` : compactRaw
      const enriched = sanitizeAssistantFacingText(
        `${fallbackMessage} | Raw tool response: ${clippedRaw}`,
      )

      return enriched.length > 0 ? enriched : fallbackMessage
    }

    return fallbackMessage
  }

  const message = typeof payload.message === 'string' && payload.message.trim().length > 0
    ? payload.message.trim()
    : fallbackMessage
  const code = typeof payload.code === 'string' && payload.code.trim().length > 0
    ? payload.code.trim()
    : null
  const details = stringifyToolDetailValue(payload.details)

  const parts = [message]
  if (code) {
    parts.push(`Code: ${code}`)
  }
  if (details) {
    parts.push(`Details: ${details}`)
  }

  return sanitizeAssistantFacingText(parts.join(' | ')) || fallbackMessage
}

function extractExerciseIdsFromSearchPayload(payload: Record<string, unknown> | null): string[] {
  if (!payload) {
    return []
  }

  const data = isRecord(payload.data) ? payload.data : null
  if (!data) {
    return []
  }

  const items = Array.isArray(data.items) ? data.items : []
  const ids: string[] = []

  for (const item of items) {
    if (!isRecord(item)) {
      continue
    }

    const id = extractObjectIdString(item.id) ?? extractObjectIdString(item._id)
    if (id) {
      ids.push(id)
    }
  }

  return ids
}

function normalizeProgressionMethod(value: unknown): 'rep_range' | 'rpe' | 'two_x_to_failure' | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_')
  if (normalized === 'rep_range' || normalized === 'reprange' || normalized === 'rep-range') {
    return 'rep_range'
  }

  if (normalized === 'rpe') {
    return 'rpe'
  }

  if (
    normalized === 'two_x_to_failure' ||
    normalized === '2x_to_failure' ||
    normalized === '2x-failure' ||
    normalized === '2x_failure' ||
    normalized === '2x_to_faliour' ||
    normalized === '2x_to_failure_method'
  ) {
    return 'two_x_to_failure'
  }

  return undefined
}

function normalizeRepRange(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
    const rounded = Math.max(1, Math.floor(value))
    return `${rounded}-${rounded}`
  }

  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return undefined
  }

  const exactRangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/)
  if (exactRangeMatch) {
    const minReps = Number(exactRangeMatch[1])
    const maxReps = Number(exactRangeMatch[2])
    if (Number.isFinite(minReps) && Number.isFinite(maxReps) && minReps >= 1 && maxReps >= minReps) {
      return `${minReps}-${maxReps}`
    }
  }

  const singleNumberMatch = trimmed.match(/^(\d+)$/)
  if (singleNumberMatch) {
    const reps = Number(singleNumberMatch[1])
    if (Number.isFinite(reps) && reps >= 1) {
      return `${reps}-${reps}`
    }
  }

  return undefined
}

function sanitizeCreateUserExercisesArguments(argumentsInput: Record<string, unknown>): Record<string, unknown> {
  const exercises = Array.isArray(argumentsInput.exercises) ? argumentsInput.exercises : null
  if (!exercises) {
    return argumentsInput
  }

  const sanitizedExercises = exercises.map((exercise) => {
    if (!isRecord(exercise)) {
      return exercise
    }

    const currentTarget = isRecord(exercise.currentTarget) ? exercise.currentTarget : null
    if (!currentTarget) {
      return exercise
    }

    const progressionMethod = normalizeProgressionMethod(currentTarget.progressionMethod)
    if (progressionMethod === 'rep_range') {
      const normalizedReps = normalizeRepRange(currentTarget.reps) ?? '8-12'
      return {
        ...exercise,
        currentTarget: {
          ...currentTarget,
          progressionMethod: 'rep_range',
          reps: normalizedReps,
        },
      }
    }

    if (progressionMethod === 'rpe') {
      const rpe = typeof currentTarget.rpe === 'number' && Number.isFinite(currentTarget.rpe)
        ? Math.min(10, Math.max(1, currentTarget.rpe))
        : 8

      return {
        ...exercise,
        currentTarget: {
          ...currentTarget,
          progressionMethod: 'rpe',
          rpe,
        },
      }
    }

    if (progressionMethod === 'two_x_to_failure') {
      return {
        ...exercise,
        currentTarget: {
          ...currentTarget,
          progressionMethod: 'two_x_to_failure',
          sets: 2,
          reps: 'FAILURE',
          rpe: undefined,
        },
      }
    }

    return exercise
  })

  return {
    ...argumentsInput,
    exercises: sanitizedExercises,
  }
}

function buildWorkoutCommitArgumentsFromUserExercises(input: {
  userId: string
  createUserExercisesPayload: Record<string, unknown>
  userText: string
}): Record<string, unknown> | null {
  type CommitSet = {
    weight: number
    reps?: string | number
    rest: number
    rpe?: number
    completed: boolean
  }

  type CommitExercise = {
    exerciseId: string
    userExerciseId: string
    sets: CommitSet[]
  }

  const rows = Array.isArray(input.createUserExercisesPayload.data)
    ? input.createUserExercisesPayload.data
    : []

  const exercises = rows.reduce<CommitExercise[]>((acc, row) => {
      if (!isRecord(row)) {
        return acc
      }

      const exerciseId = extractObjectIdString(row.exerciseId)
      const userExerciseId = extractObjectIdString(row._id) ?? extractObjectIdString(row.id)

      const currentTarget = isRecord(row.currentTarget) ? row.currentTarget : {}
      const targetSets = typeof currentTarget.sets === 'number' && currentTarget.sets > 0 ? Math.floor(currentTarget.sets) : 0
      const weight = typeof currentTarget.weight === 'number' ? currentTarget.weight : 0
      const restSeconds = typeof currentTarget.restSeconds === 'number' ? Math.max(0, Math.floor(currentTarget.restSeconds)) : 90
      const reps =
        typeof currentTarget.reps === 'string' || typeof currentTarget.reps === 'number'
          ? currentTarget.reps
          : undefined
      const rpe = typeof currentTarget.rpe === 'number' ? currentTarget.rpe : undefined

      if (!exerciseId || !userExerciseId || targetSets < 1) {
        return acc
      }

      acc.push({
        exerciseId,
        userExerciseId,
        sets: Array.from({ length: targetSets }, () => ({
          weight,
          reps,
          rest: restSeconds,
          rpe,
          completed: false,
        })),
      })

      return acc
    }, [])

  if (exercises.length === 0) {
    return null
  }

  const generationMeta = isRecord(input.createUserExercisesPayload.generationMeta)
    ? input.createUserExercisesPayload.generationMeta
    : null
  const estimatedWorkoutTimeToFinish =
    generationMeta &&
    typeof generationMeta.estimatedDurationMinutes === 'number' &&
    Number.isFinite(generationMeta.estimatedDurationMinutes) &&
    generationMeta.estimatedDurationMinutes >= 1
      ? Math.ceil(generationMeta.estimatedDurationMinutes)
      : null

  if (estimatedWorkoutTimeToFinish === null) {
    return null
  }

  const lowerText = input.userText.toLowerCase()
  const dayLabel =
    lowerText.includes('pull')
      ? 'Pull Day'
      : lowerText.includes('legs')
        ? 'Leg Day'
        : lowerText.includes('push')
          ? 'Push Day'
          : 'Workout'

  return {
    userId: input.userId,
    name: `${dayLabel} Plan`,
    status: 'planned',
    estimatedWorkoutTimeToFinish,
    exercises,
  }
}

function isElicitationRequired(input: {
  result: unknown
  toolName: string
}): {
  required: boolean
  message: string
  missingFields: string[]
} {
  const normalizedToolName = normalizeToolNameForMatch(input.toolName)
  const disallowedToolsForClientElicitation = new Set([
    'trackprogressintermediateadvanced',
    'progressintermediateadvanced',
  ])

  if (disallowedToolsForClientElicitation.has(normalizedToolName)) {
    return { required: false, message: '', missingFields: [] }
  }

  const result = input.result

  if (!isRecord(result) || result.isError !== true) {
    return { required: false, message: '', missingFields: [] }
  }

  const payload = extractToolTextPayload(result)
  if (!payload) {
    return { required: false, message: '', missingFields: [] }
  }

  const code = typeof payload.code === 'string' ? payload.code.toUpperCase() : ''
  const message = typeof payload.message === 'string' ? payload.message : 'Additional parameters are required.'
  const data = isRecord(payload.data) ? payload.data : {}

  const hasExplicitElicitationCode =
    code === 'ELICITATION_REQUIRED' ||
    code === 'MISSING_REQUIRED_FIELDS' ||
    code === 'MISSING_REQUIRED_PARAMS' ||
    code === 'MISSING_PARAMS'
  const hasElicitationMessage = /missing|required|provide/i.test(message)

  const missingFieldsFromData = [data.missingFields, data.requiredFields]
    .flatMap((entry) => (Array.isArray(entry) ? entry : []))
    .filter((entry): entry is string => typeof entry === 'string')

  return {
    required:
      hasExplicitElicitationCode ||
      (missingFieldsFromData.length > 0 && hasElicitationMessage),
    message,
    missingFields: missingFieldsFromData,
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise
      .then((result) => {
        window.clearTimeout(timeoutId)
        resolve(result)
      })
      .catch((error) => {
        window.clearTimeout(timeoutId)
        reject(error)
      })
  })
}

function isObjectSchemaWithProperties(
  value: unknown,
): value is {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
} {
  if (!isRecord(value)) {
    return false
  }

  return value.type === 'object' && isRecord(value.properties)
}

function buildRequestedSchema(
  inputSchema: unknown,
  missingFields: string[],
): {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
} {
  if (isObjectSchemaWithProperties(inputSchema)) {
    const required = Array.isArray(inputSchema.required)
      ? inputSchema.required.filter((entry): entry is string => typeof entry === 'string')
      : missingFields

    return {
      type: 'object',
      properties: inputSchema.properties,
      required,
    }
  }

  const properties = missingFields.reduce<Record<string, unknown>>((acc, field) => {
    acc[field] = { type: 'string', title: field }
    return acc
  }, {})

  return {
    type: 'object',
    properties,
    required: missingFields,
  }
}

async function requestGuardInjection(input: {
  toolName: string
  message: string
  missingFields: string[]
  inputSchema?: unknown
}): Promise<Record<string, unknown> | null> {
  const request = {
    method: 'elicitation/request',
    params: {
      message: `${input.message}\n\nTool: ${input.toolName}`,
      requestedSchema: buildRequestedSchema(input.inputSchema, input.missingFields),
    },
  } as unknown as ElicitRequest

  const result = await requestElicitation(request)
  if (result.action !== 'accept' || !result.content) {
    return null
  }

  return result.content as Record<string, unknown>
}

async function fetchSystemInstructionsFromMcp(bearerToken?: string): Promise<string | null> {
  try {
    const prompts = await mcpClient.listPrompts(bearerToken)
    const hasSystemInstructions = prompts.prompts.some((prompt) => prompt.name === 'system-instructions')
    if (!hasSystemInstructions) {
      return null
    }

    const prompt = await mcpClient.getPrompt('system-instructions', {}, bearerToken)
    const firstMessage = prompt.messages[0]

    if (!firstMessage || firstMessage.content.type !== 'text') {
      return null
    }

    return firstMessage.content.text
  } catch {
    return null
  }
}

function resolveWorkflowPromptName(userText: string): string | null {
  const normalized = userText.toLowerCase()

  // Detect completed workout logging intents before workout generation intents.
  const explicitProgressIntentPattern =
    /(progress|\bpr\b|personal best|how am i doing|track(ed)?|history|last workout|improving|i did|i completed|i finished|logged|log my progress)/

  const completedSetLogPattern =
    /(did|completed|finished|performed|hit)\b[\s\S]{0,120}\b\d+\s*sets?\b[\s\S]{0,80}\b\d+\s*reps?\b/

  const hasWeightMention = /\b\d+(?:\.\d+)?\s*(kg|kgs|kilograms?)\b/.test(normalized)

  if (explicitProgressIntentPattern.test(normalized)) {
    return 'progress-intermediate-advanced'
  }

  if (completedSetLogPattern.test(normalized) && hasWeightMention) {
    return 'progress-intermediate-advanced'
  }

  const explicitWeightPreferencePattern =
    /(preferred weight|target weight|update weight|exercise weight|make\s+the\s+weight|change\s+the\s+weight|increase\s+the\s+weight|decrease\s+the\s+weight|weight\s*bump|bump\s+(the\s+)?weight|bump\s+it|raise\s+it|lower\s+it|set\s+it\s+to\s*\d+(?:\.\d+)?\s*(kg|kgs|kilograms?)|can\s*we\s+make\s+it\s*\d+(?:\.\d+)?\s*(kg|kgs|kilograms?)|from\s*\d+(?:\.\d+)?\s*(kg|kgs|kilograms?)\s*to\s*\d+(?:\.\d+)?\s*(kg|kgs|kilograms?)|too\s+(easy|light|heavy)|way\s+too\s+(easy|light|heavy))/

  const adjustmentVerbPattern =
    /\b(bump|increase|decrease|raise|lower|adjust|change|update|set|make)\b/

  const exerciseContextPattern =
    /\b(bench|press|row|pulldown|curl|extension|squat|deadlift|lunge|fly|raise|dip|pushdown|pullup|chinup|exercise|set|sets|reps)\b/

  if (explicitWeightPreferencePattern.test(normalized)) {
    return 'user-exercise-weight-preference'
  }

  // If user mentions an exercise context + adjustment verb + numeric weight, treat as weight preference.
  if (hasWeightMention && adjustmentVerbPattern.test(normalized) && exerciseContextPattern.test(normalized)) {
    return 'user-exercise-weight-preference'
  }

  const workoutCreationVerbPattern =
    /\b(create|creating|generate|generating|generated|make|making|plan|planning|planned)\b/

  const workoutContextPattern =
    /(workout|routine|session|training\s*plan|program|split|ppl|push|pull|legs|leg\s*day|full\s*body|upper\s*body|lower\s*body|arms?\s*day|chest\s*day|back\s*day|shoulder\s*day|biceps?|triceps?|quads?|hamstrings?|glutes?|calves?)/

  if (workoutCreationVerbPattern.test(normalized) && workoutContextPattern.test(normalized)) {
    return 'workout-creation-plan'
  }

  return null
}

function getAllowedToolNamesForWorkflow(workflowPromptName: string | null): string[] | null {
  if (workflowPromptName === 'workout-creation-plan') {
    return ['athly.generate_workout']
  }

  if (workflowPromptName === 'progress-intermediate-advanced') {
    return [
      'athly.get_user_profile',
      'athly.search_exercises',
      'athly.track_progress_intermediate_advanced',
      'athly.progress_intermediate_advanced',
      'athly.update_user_exercise_preferred_weight',
    ]
  }

  if (workflowPromptName === 'user-exercise-weight-preference') {
    return [
      'athly.get_user_profile',
      'athly.update_user_exercise_preferred_weight',
      'athly.search_exercises',
    ]
  }

  return null
}

function looksLikeMetaPlanningText(text: string): boolean {
  const normalized = text.toLowerCase()
  return (
    /\b(i need to|i will|let'?s try|first,? i|next,? i|i must inform)\b/.test(normalized) ||
    /\btool\b/.test(normalized) ||
    /\bathly[._][a-z_]+\b/.test(normalized) ||
    /\bnot found\b/.test(normalized)
  )
}

type WorkoutStrictState = {
  profileFetched: boolean
  searchCalls: number
  requiredSearchCalls: number
  createUserExercisesSuccess: boolean
  createWorkoutPlanSuccess: boolean
  generateWorkoutSuccess: boolean
}

function resolveRequiredWorkoutSearchCalls(userText: string): number {
  const normalized = userText.toLowerCase()

  if (/(full body|full-body|total body)/.test(normalized)) {
    return 3
  }

  if (/(legs|leg\s*day)/.test(normalized)) {
    return 2
  }

  if (/(arms?\s*day|chest\s*day|back\s*day|shoulder\s*day|biceps?|triceps?|quads?|hamstrings?|glutes?|calves?)/.test(normalized)) {
    return 2
  }

  if (/(push|pull)/.test(normalized)) {
    return 2
  }

  if (/(pull|push|ppl|workout|training plan|program)/.test(normalized)) {
    return 2
  }

  return 1
}

function createInitialWorkoutStrictState(userText: string): WorkoutStrictState {
  return {
    profileFetched: true,
    searchCalls: resolveRequiredWorkoutSearchCalls(userText),
    requiredSearchCalls: resolveRequiredWorkoutSearchCalls(userText),
    createUserExercisesSuccess: true,
    createWorkoutPlanSuccess: false,
    generateWorkoutSuccess: false,
  }
}

function getNextRequiredWorkoutToolName(state: WorkoutStrictState): string {
  if (!state.createWorkoutPlanSuccess) {
    return 'athly.generate_workout'
  }

  return 'athly.generate_workout'
}

function getAllowedWorkoutToolNames(state: WorkoutStrictState): string[] {
  if (!state.createWorkoutPlanSuccess) {
    return ['athly.generate_workout']
  }

  return []
}

function resolveStrictWorkoutSequenceViolation(input: {
  state: WorkoutStrictState
  toolName: string
}): string | null {
  const { state, toolName } = input

  if (!state.createWorkoutPlanSuccess && !isToolNameMatch(toolName, 'athly.generate_workout')) {
    return 'Strict workout mode requires athly.generate_workout as the only workout tool call.'
  }

  return null
}

function markWorkoutStrictToolProgress(input: {
  state: WorkoutStrictState
  toolName: string
  isError: boolean
  payload: Record<string, unknown> | null
}): void {
  const { state, toolName, isError, payload } = input

  if (isToolNameMatch(toolName, 'athly.get_user_profile') && !isError) {
    state.profileFetched = true
    return
  }

  if (isToolNameMatch(toolName, 'athly.search_exercises') && !isError) {
    state.searchCalls += 1
    return
  }

  if (isToolNameMatch(toolName, 'athly.create_user_exercises') && payload?.success === true) {
    state.createUserExercisesSuccess = true
    return
  }

  if (isToolNameMatch(toolName, 'athly.create_workout_plan') && payload?.success === true) {
    state.createWorkoutPlanSuccess = true
    state.generateWorkoutSuccess = true
    return
  }

  if (isToolNameMatch(toolName, 'athly.generate_workout') && payload?.success === true) {
    state.createWorkoutPlanSuccess = true
    state.generateWorkoutSuccess = true
  }
}

async function fetchPromptTextFromMcp(
  name: string,
  bearerToken?: string,
  promptArguments: Record<string, string> = {},
): Promise<string | null> {
  try {
    const prompt = await mcpClient.getPrompt(name, promptArguments, bearerToken)
    const firstMessage = prompt.messages[0]

    if (!firstMessage || firstMessage.content.type !== 'text') {
      return null
    }

    return firstMessage.content.text
  } catch {
    return null
  }
}

export function useAgent(options: UseAgentOptions = {}): UseAgentResult {
  const [messages, setMessages] = useState<LlmMessage[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isStorageHydrated, setIsStorageHydrated] = useState(false)
  const { token, clearSession, refreshSession } = useAuth()

  const messagesRef = useRef<LlmMessage[]>([])
  const authenticatedUserId = useMemo(() => (token ? extractAuthenticatedUserId(token) : null), [token])
  const messagesStorageKey = useMemo(
    () => (authenticatedUserId ? `${CHAT_STORAGE_KEY_PREFIX}:${authenticatedUserId}` : null),
    [authenticatedUserId],
  )
  const onboardingFiredFlagKey = authenticatedUserId
    ? `${ONBOARDING_FIRED_FLAG_KEY_PREFIX}:${authenticatedUserId}`
    : null

  useEffect(() => {
    setIsStorageHydrated(false)

    if (!messagesStorageKey) {
      messagesRef.current = []
      setMessages([])
      setIsStorageHydrated(true)
      return
    }

    const raw = window.localStorage.getItem(messagesStorageKey)
    if (!raw) {
      const postSignupFlagKey = `${POST_SIGNUP_MESSAGE_FLAG_KEY_PREFIX}:${authenticatedUserId}`
      const hasUserScopedFlag = window.sessionStorage.getItem(postSignupFlagKey) === '1'
      const hasGlobalFlag = window.sessionStorage.getItem(POST_SIGNUP_MESSAGE_FLAG_KEY_GLOBAL) === '1'
      const shouldShowPostSignupMessage = hasUserScopedFlag || hasGlobalFlag

      if (shouldShowPostSignupMessage) {
        const seededMessages: LlmMessage[] = [
          {
            role: 'assistant',
            content: { type: 'text', text: POST_SIGNUP_ASSISTANT_MESSAGE_TEXT },
          },
        ]
        window.sessionStorage.removeItem(postSignupFlagKey)
        window.sessionStorage.removeItem(POST_SIGNUP_MESSAGE_FLAG_KEY_GLOBAL)
        messagesRef.current = seededMessages
        setMessages(seededMessages)
      } else {
        messagesRef.current = []
        setMessages([])
      }

      setIsStorageHydrated(true)
      return
    }

    const restored = parseStoredMessages(raw)
    messagesRef.current = restored
    setMessages(restored)
    setIsStorageHydrated(true)
  }, [authenticatedUserId, messagesStorageKey])

  useEffect(() => {
    const sanitizedMessages = sanitizeConversationMessages(messages)

    if (!areMessageListsEqual(messages, sanitizedMessages)) {
      messagesRef.current = sanitizedMessages
      setMessages(sanitizedMessages)
      return
    }

    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    if (!messagesStorageKey || !isStorageHydrated) {
      return
    }

    const visibleMessages = messages.filter(isPersistableMessage)
    if (visibleMessages.length === 0) {
      window.localStorage.removeItem(messagesStorageKey)
      return
    }

    window.localStorage.setItem(messagesStorageKey, JSON.stringify(visibleMessages))
  }, [isStorageHydrated, messages, messagesStorageKey])

  const clear = useCallback(() => {
    if (messagesStorageKey) {
      window.localStorage.removeItem(messagesStorageKey)
    }
    messagesRef.current = []
    setMessages([])
    setError(null)
  }, [messagesStorageKey])

  const triggerOnboarding = useCallback(async (selectedSplit?: string) => {
    if (!onboardingFiredFlagKey) {
      return
    }

    const hasFlag = window.sessionStorage.getItem(onboardingFiredFlagKey) === '1'
    const hasVisibleHistory = messagesRef.current.some(isPersistableMessage)

    if (hasFlag && hasVisibleHistory) {
      return
    }

    const split = selectedSplit?.trim()
    const promptArgs: Record<string, string> = split ? { split } : {}
    const runtimeOnboardingText = token
      ? await fetchPromptTextFromMcp('onboarding-followup', token, promptArgs)
      : null

    const onboardingMessage: LlmMessage = {
      role: 'assistant',
      content: {
        type: 'text',
        text: runtimeOnboardingText ?? buildOnboardingPrompt(selectedSplit),
      },
    }

    const nextMessages = [...messagesRef.current, onboardingMessage]
    window.sessionStorage.setItem(onboardingFiredFlagKey, '1')
    messagesRef.current = nextMessages
    setMessages(nextMessages)
  }, [onboardingFiredFlagKey, token])

  const run = useCallback(
    async (userText: string) => {
      if (isRunning || userText.trim().length === 0) {
        return
      }

      let activeToken = token

      if (!activeToken) {
        setError('You are not authenticated. Please log in again.')
        return
      }

      if (isJwtExpired(activeToken)) {
        const refreshedToken = await refreshSession()
        if (!refreshedToken) {
          setError('Your session has expired. Please log in again.')
          return
        }

        activeToken = refreshedToken
      }

      const timeoutMs = options.timeoutMs ?? 30_000
      const maxLoops = options.maxLoops ?? 15
      const maxTokens = options.maxTokens ?? 2048
      const requestUserId = extractAuthenticatedUserId(activeToken)

      setError(null)
      setIsRunning(true)

      const userMessage: LlmMessage = {
        role: 'user',
        content: { type: 'text', text: userText },
      }

      let workingMessages = [...messagesRef.current, userMessage]
      setMessages(workingMessages)
      let assistantTextProduced = false
      let completedWithFinalResponse = false
      let hasSuccessfulWorkoutSave = false
      let latestCreateUserExercisesPayload: Record<string, unknown> | null = null
      let workoutSaveFailureMessage: string | null = null
      let strictSequenceViolation: string | null = null
      let generateWorkoutTerminalFailure = false
      const discoveredExerciseIds = new Set<string>()

      try {
        console.error('[AGENT][CONNECT][PRE]', {
          apiBaseUrl: window.location.origin,
          targetMcpBase: 'connectionConfig.apiBaseUrl + connectionConfig.mcpPath',
          hasToken: Boolean(activeToken),
          userMessageLength: userText.length,
        })
        mcpClient.setElicitationHandler(async (request) => requestElicitation(request))
        mcpClient.setSamplingHandler(async (request) => requestSamplingApproval(request))
        await withTimeout(mcpClient.connect(activeToken), timeoutMs, 'MCP connect')
        console.error('[AGENT][CONNECT][OK] MCP connected')
        await withTimeout(refreshMcpRegistryWithToken(activeToken), timeoutMs, 'MCP registry refresh')
        console.error('[AGENT][REGISTRY][OK] MCP registry refreshed')
        const systemInstructions = await withTimeout(
          fetchSystemInstructionsFromMcp(activeToken),
          timeoutMs,
          'System prompt fetch',
        )
        const workflowPromptName = resolveWorkflowPromptName(userText)
        console.error('[AGENT] workflowPromptName', { workflowPromptName, userText: userText.slice(0, 80) })
        const workflowInstructions = workflowPromptName
          ? await withTimeout(
              fetchPromptTextFromMcp(workflowPromptName, activeToken),
              timeoutMs,
              `Workflow prompt fetch: ${workflowPromptName}`,
            )
          : null

        const activeWorkoutContext = getActiveWorkoutContext()
        const workoutStartFlowInstructions = activeWorkoutContext
          ? await withTimeout(
              fetchPromptTextFromMcp('workout-start-flow', activeToken),
              timeoutMs,
              'Workflow prompt fetch: workout-start-flow',
            )
          : null
        const activeWorkoutSystemContext = activeWorkoutContext
          ? [
              'Active workout context (hidden from end user):',
              `- activeWorkoutId: ${activeWorkoutContext.id}`,
              `- workoutName: ${activeWorkoutContext.name}`,
              `- status: ${activeWorkoutContext.status}`,
              `- estimatedDurationMinutes: ${activeWorkoutContext.estimatedWorkoutTimeToFinish}`,
              `- exerciseNames: ${activeWorkoutContext.exerciseNames.slice(0, 20).join(', ')}`,
              'When the user refers to "this workout", "current workout", or workout progress, use only this active workout context.',
              'Do not reference other saved workouts unless the user explicitly asks to switch workouts.',
            ].join('\n')
          : ''

        const mergedSystemInstructions = [
          systemInstructions,
          activeWorkoutSystemContext,
          workoutStartFlowInstructions,
          workflowInstructions,
        ]
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          .join('\n\n')
        const isStrictWorkoutFlow = workflowPromptName === 'workout-creation-plan'
        const workoutStrictState = isStrictWorkoutFlow ? createInitialWorkoutStrictState(userText) : null

        let continuationInstruction: string | null = null

        for (let loopIndex = 0; loopIndex < maxLoops; loopIndex += 1) {
          let workoutWriteToolCalledThisLoop = false

          const systemMessageText = [mergedSystemInstructions, continuationInstruction]
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .join('\n\n')

          continuationInstruction = null

          const requestMessages = systemMessageText
            ? [
                {
                  role: 'system' as const,
                  content: { type: 'text' as const, text: systemMessageText },
                },
                ...workingMessages,
              ]
            : workingMessages

          const compactedRequestMessages = compactMessagesForRequest(requestMessages, MAX_REQUEST_CHAR_BUDGET)

          const currentRegistry = getMcpRegistrySnapshot()
          const workflowAllowedToolNames = getAllowedToolNamesForWorkflow(workflowPromptName)
          const strictWorkoutAllowedToolNames =
            isStrictWorkoutFlow && workoutStrictState ? getAllowedWorkoutToolNames(workoutStrictState) : []
          const effectiveAllowedToolNames =
            isStrictWorkoutFlow && strictWorkoutAllowedToolNames.length > 0
              ? strictWorkoutAllowedToolNames
              : workflowAllowedToolNames ?? []
          const registryForLoop =
            effectiveAllowedToolNames.length > 0
              ? {
                  ...currentRegistry,
                  tools: currentRegistry.tools.filter((tool) =>
                    effectiveAllowedToolNames.some((allowedName) => isToolNameMatch(tool.name, allowedName)),
                  ),
                }
              : currentRegistry

          const llmResponse = await withTimeout(
            createMessageWithProvider({
              messages: compactedRequestMessages,
              registry: registryForLoop,
              maxTokens,
              toolMode:
                isStrictWorkoutFlow && workoutStrictState && strictWorkoutAllowedToolNames.length > 0
                  ? 'required'
                  : 'auto',
              allowedToolNames:
                effectiveAllowedToolNames.length > 0
                  ? registryForLoop.tools.map((tool) => tool.name)
                  : undefined,
            }, activeToken),
            timeoutMs,
            'LLM provider call',
          )

          const toolCalls = llmResponse.toolCalls ?? []

          if (toolCalls.length === 0 && llmResponse.text.trim().length > 0) {
            const isWorkflowTurn = workflowPromptName !== null
            const shouldSuppressSuccessfulWorkoutWorkflowReply =
              workflowPromptName === 'workout-creation-plan' && hasSuccessfulWorkoutSave
            
            const workflowStillPending =
              workflowPromptName === 'workout-creation-plan' && !hasSuccessfulWorkoutSave
            if (
              isWorkflowTurn &&
              loopIndex < maxLoops - 1 &&
              (looksLikeMetaPlanningText(llmResponse.text) || workflowStillPending)
            ) {
              if (isStrictWorkoutFlow && workoutStrictState) {
                const nextToolName = getNextRequiredWorkoutToolName(workoutStrictState)
                continuationInstruction =
                  `Strict workout mode is active. Call ${nextToolName} now. ` +
                  'Return only tool calls until the workout is successfully saved.'
                continue
              }

              continuationInstruction =
                'Do not describe your plan. Execute the required tools now, then provide only the final user-facing result.'
              continue
            }

            if (shouldSuppressSuccessfulWorkoutWorkflowReply) {
              assistantTextProduced = true
              completedWithFinalResponse = true
              break
            }

            const safeAssistantText = humanizeStructuredAssistantText(llmResponse.text)
            if (safeAssistantText.length === 0) {
              if (loopIndex < maxLoops - 1) {
                continuationInstruction =
                  isWorkflowTurn
                    ? 'Do not explain your process. Execute required tools now and return final result only.'
                    : 'Continue exactly where you stopped. Do not restart and do not repeat previous text.'
                continue
              }

              break
            }

            const assistantMessage: LlmMessage = {
              role: 'assistant',
              content: { type: 'text', text: safeAssistantText },
            }
            workingMessages = [...workingMessages, assistantMessage]
            setMessages(workingMessages)
            assistantTextProduced = true
            completedWithFinalResponse = true
          }

          if (toolCalls.length === 0) {
            if (llmResponse.finishReason === 'MAX_TOKENS' && loopIndex < maxLoops - 1) {
              continuationInstruction =
                'Continue exactly where you stopped. Do not restart and do not repeat previous text.'
              continue
            }

            break
          }

          for (const toolCall of toolCalls) {
            const resolvedToolName = resolveToolNameFromRegistry(toolCall.name)
            const isWorkoutWriteTool =
              isToolNameMatch(resolvedToolName, 'athly.generate_workout') ||
              isToolNameMatch(resolvedToolName, 'athly.create_workout_plan')

            if (isWorkoutWriteTool && hasSuccessfulWorkoutSave) {
              console.error('[AGENT] skipping duplicate workout write tool call after successful save', {
                toolName: resolvedToolName,
              })
              continue
            }

            if (isWorkoutWriteTool && workoutWriteToolCalledThisLoop) {
              console.error('[AGENT] skipping additional workout write tool call in same loop', {
                toolName: resolvedToolName,
              })
              continue
            }
            if (isStrictWorkoutFlow && workoutStrictState) {
              const sequenceViolation = resolveStrictWorkoutSequenceViolation({
                state: workoutStrictState,
                toolName: resolvedToolName,
              })

              if (sequenceViolation) {
                strictSequenceViolation = sequenceViolation
                workoutSaveFailureMessage = sequenceViolation
                break
              }
            }

            const toolMetadata = getMcpRegistrySnapshot().tools.find((tool) => tool.name === resolvedToolName)
            const shouldInjectUserId =
              Boolean(requestUserId) &&
              (toolLikelyRequiresUserId(resolvedToolName) || toolInputSchemaHasUserId(toolMetadata?.inputSchema))

            let callArguments: Record<string, unknown> = {
              ...toolCall.arguments,
              ...(shouldInjectUserId && requestUserId ? { userId: requestUserId } : {}),
            }

            if (isToolNameMatch(resolvedToolName, 'athly.create_user_exercises')) {
              callArguments = sanitizeCreateUserExercisesArguments(callArguments)
            }

            let toolResult = await withTimeout(
              mcpClient.callTool(resolvedToolName, callArguments, activeToken),
              timeoutMs,
              `Tool call: ${resolvedToolName}`,
            )

            if (isWorkoutWriteTool) {
              workoutWriteToolCalledThisLoop = true
            }

            for (let attempt = 0; attempt < 2; attempt += 1) {
              const elicitation = isElicitationRequired({
                result: toolResult,
                toolName: resolvedToolName,
              })
              if (!elicitation.required) {
                break
              }

              const injectedValues = await requestGuardInjection({
                toolName: toolCall.name,
                message: elicitation.message,
                missingFields: elicitation.missingFields,
                inputSchema: toolMetadata?.inputSchema,
              })

              if (!injectedValues) {
                throw new Error(`Elicitation canceled for tool ${toolCall.name}.`)
              }

              callArguments = {
                ...callArguments,
                ...injectedValues,
              }

              if (isToolNameMatch(resolvedToolName, 'athly.create_user_exercises')) {
                callArguments = sanitizeCreateUserExercisesArguments(callArguments)
              }

              toolResult = await withTimeout(
                mcpClient.callTool(resolvedToolName, callArguments, activeToken),
                timeoutMs,
                `Tool call (with elicitation): ${resolvedToolName}`,
              )
            }

            if (isToolNameMatch(resolvedToolName, 'athly.generate_workout')) {
              const payload = extractToolTextPayload(toolResult)
              const rawToolText = extractRawToolText(toolResult)
              const failureCode =
                typeof payload?.code === 'string' && payload.code.trim().length > 0
                  ? payload.code.trim().toUpperCase()
                  : null
              console.error('[AGENT] generate_workout result', {
                isError: toolResult.isError ?? false,
                success: payload?.success ?? null,
                message: payload?.message ?? null,
                code: failureCode,
                workoutId: extractObjectIdString((payload?.data as Record<string, unknown> | undefined)?.workout),
              })
              if (payload?.success === true) {
                hasSuccessfulWorkoutSave = true
                generateWorkoutTerminalFailure = false
                workoutSaveFailureMessage = null
              } else {
                workoutSaveFailureMessage = formatToolFailureMessage({
                  payload,
                  fallbackMessage: 'Workout generation failed.',
                  rawToolText,
                })

                if (
                  failureCode === 'GENERATE_WORKOUT_NO_EXERCISES' ||
                  failureCode === 'USER_NOT_FOUND'
                ) {
                  generateWorkoutTerminalFailure = true
                }
              }

              if (isStrictWorkoutFlow && workoutStrictState) {
                markWorkoutStrictToolProgress({
                  state: workoutStrictState,
                  toolName: resolvedToolName,
                  isError: toolResult.isError === true,
                  payload,
                })
              }
            }

            if (isToolNameMatch(resolvedToolName, 'athly.create_workout_plan')) {
              const payload = extractToolTextPayload(toolResult)
              const rawToolText = extractRawToolText(toolResult)
              console.error('[AGENT] create_workout_plan result', {
                isError: toolResult.isError ?? false,
                success: payload?.success ?? null,
                message: payload?.message ?? null,
                workoutId: (payload?.data as { _id?: string })?._id ?? null,
              })
              if (payload?.success === true) {
                hasSuccessfulWorkoutSave = true
                workoutSaveFailureMessage = null
              } else {
                workoutSaveFailureMessage = formatToolFailureMessage({
                  payload,
                  fallbackMessage: 'Workout save failed.',
                  rawToolText,
                })
              }

              if (isStrictWorkoutFlow && workoutStrictState) {
                markWorkoutStrictToolProgress({
                  state: workoutStrictState,
                  toolName: resolvedToolName,
                  isError: toolResult.isError === true,
                  payload,
                })
              }
            }

            if (isToolNameMatch(resolvedToolName, 'athly.create_user_exercises')) {
              const parsedPayload = extractToolTextPayload(toolResult)
              const rawToolText = extractRawToolText(toolResult)
              console.error('[AGENT] create_user_exercises result', {
                isError: toolResult.isError ?? false,
                success: parsedPayload?.success ?? null,
                dataCount: Array.isArray(parsedPayload?.data) ? parsedPayload.data.length : null,
                message: parsedPayload?.message ?? null,
                generationMeta: parsedPayload?.generationMeta ?? null,
                rawToolTextPreview:
                  typeof rawToolText === 'string' ? rawToolText.slice(0, 280) : null,
              })
              if (parsedPayload && parsedPayload.success === true) {
                latestCreateUserExercisesPayload = parsedPayload
                workoutSaveFailureMessage = null
              } else {
                const failure = formatToolFailureMessage({
                  payload: parsedPayload,
                  fallbackMessage: 'Creating user exercise records failed.',
                  rawToolText,
                })
                workoutSaveFailureMessage = workoutSaveFailureMessage ?? failure
              }

              if (isStrictWorkoutFlow && workoutStrictState) {
                markWorkoutStrictToolProgress({
                  state: workoutStrictState,
                  toolName: resolvedToolName,
                  isError: toolResult.isError === true,
                  payload: parsedPayload,
                })
              }
            }

            if (
              isStrictWorkoutFlow &&
              workoutStrictState &&
              (isToolNameMatch(resolvedToolName, 'athly.get_user_profile') ||
                isToolNameMatch(resolvedToolName, 'athly.search_exercises'))
            ) {
              const payload = extractToolTextPayload(toolResult)

              if (isToolNameMatch(resolvedToolName, 'athly.search_exercises')) {
                const discoveredFromThisCall = extractExerciseIdsFromSearchPayload(payload)
                for (const exerciseId of discoveredFromThisCall) {
                  discoveredExerciseIds.add(exerciseId)
                }
              }

              markWorkoutStrictToolProgress({
                state: workoutStrictState,
                toolName: resolvedToolName,
                isError: toolResult.isError === true,
                payload,
              })
            }

            const toolMessage = formatToolResultForModel(resolvedToolName, toolResult)
            workingMessages = [...workingMessages, toolMessage]
            setMessages(workingMessages)
          }

          if (strictSequenceViolation) {
            break
          }

          if (
            isStrictWorkoutFlow &&
            workoutStrictState &&
            !workoutStrictState.generateWorkoutSuccess &&
            !generateWorkoutTerminalFailure &&
            loopIndex < maxLoops - 1
          ) {
            continuationInstruction =
              'Strict workout mode is active. Call athly.generate_workout now using the user request. Return only tool calls.'
            continue
          }
        }

        const shouldAutoCommitWorkout =
          ENABLE_WORKOUT_AUTO_COMMIT_FALLBACK &&
          !hasSuccessfulWorkoutSave &&
          Boolean(requestUserId) &&
          latestCreateUserExercisesPayload !== null

        console.error('[AGENT] auto-commit check', {
          autoCommitFallbackEnabled: ENABLE_WORKOUT_AUTO_COMMIT_FALLBACK,
          shouldAutoCommitWorkout,
          hasSuccessfulWorkoutSave,
          hasUserId: Boolean(requestUserId),
          hasUserExercisesPayload: latestCreateUserExercisesPayload !== null,
          workoutSaveFailureMessage,
        })

        if (shouldAutoCommitWorkout && requestUserId && latestCreateUserExercisesPayload) {
          const commitArgs = buildWorkoutCommitArgumentsFromUserExercises({
            userId: requestUserId,
            createUserExercisesPayload: latestCreateUserExercisesPayload,
            userText,
          })

          if (commitArgs) {
            console.error('[AGENT] auto-commit args', {
              exerciseCount: Array.isArray(commitArgs.exercises) ? (commitArgs.exercises as unknown[]).length : 0,
              userId: commitArgs.userId,
              name: commitArgs.name,
            })
            try {
              const commitResult = await withTimeout(
                mcpClient.callTool('athly.create_workout_plan', commitArgs, activeToken),
                timeoutMs,
                'Tool call: athly.create_workout_plan (auto-commit fallback)',
              )

              const toolMessage = formatToolResultForModel('athly.create_workout_plan', commitResult)
              workingMessages = [...workingMessages, toolMessage]
              setMessages(workingMessages)

              const payload = extractToolTextPayload(commitResult)
              const rawToolText = extractRawToolText(commitResult)
              if (payload?.success === true) {
                hasSuccessfulWorkoutSave = true
                workoutSaveFailureMessage = null
                if (isStrictWorkoutFlow && workoutStrictState) {
                  workoutStrictState.createWorkoutPlanSuccess = true
                }
              } else {
                workoutSaveFailureMessage = formatToolFailureMessage({
                  payload,
                  fallbackMessage: 'Auto-save retry failed.',
                  rawToolText,
                })
              }
            } catch (commitError) {
              workoutSaveFailureMessage =
                commitError instanceof Error ? commitError.message : 'Auto-save retry failed.'
            }
          } else {
            console.error('[AGENT] auto-commit SKIPPED: buildWorkoutCommitArgumentsFromUserExercises returned null', {
              payloadDataCount: Array.isArray(latestCreateUserExercisesPayload?.data)
                ? (latestCreateUserExercisesPayload!.data as unknown[]).length
                : null,
            })
            workoutSaveFailureMessage = 'Auto-save could not build a valid workout payload from generated exercises.'
          }
        }

        const endedWithoutWorkoutSave = workflowPromptName === 'workout-creation-plan' && !hasSuccessfulWorkoutSave

        const strictWorkoutIncomplete =
          isStrictWorkoutFlow &&
          workoutStrictState !== null &&
          !workoutStrictState.createWorkoutPlanSuccess

        if (strictWorkoutIncomplete && !workoutSaveFailureMessage) {
          const nextRequiredTool = getNextRequiredWorkoutToolName(workoutStrictState)
          workoutSaveFailureMessage =
            `Strict workout workflow did not complete the required tool call. Pending: ${nextRequiredTool}.`
        }

        if (endedWithoutWorkoutSave && !workoutSaveFailureMessage) {
          workoutSaveFailureMessage = 'The workout workflow completed, but no successful save was confirmed.'
        }

        if (!hasSuccessfulWorkoutSave && workoutSaveFailureMessage) {
          const saveFailureMessage: LlmMessage = {
            role: 'assistant',
            content: {
              type: 'text',
              text: sanitizeAssistantFacingText(
                `I created your workout plan, but I could not save it to the database. I retried once and it still failed. Reason: ${workoutSaveFailureMessage} Please try again in a moment.`,
              ),
            },
          }
          workingMessages = [...workingMessages, saveFailureMessage]
          setMessages(workingMessages)
          assistantTextProduced = true
          completedWithFinalResponse = true
        }

        const shouldSuppressSuccessfulWorkoutWorkflowReply =
          workflowPromptName === 'workout-creation-plan' && hasSuccessfulWorkoutSave && !workoutSaveFailureMessage

        if (shouldSuppressSuccessfulWorkoutWorkflowReply) {
          assistantTextProduced = true
          completedWithFinalResponse = true
        }

        if (!completedWithFinalResponse) {
          const finalizationMessages = compactMessagesForRequest(
            [
              {
                role: 'system' as const,
                content: {
                  type: 'text' as const,
                  text: [
                    'Provide the final user-facing response based on previous tool results.',
                    'Do not call tools.',
                    'Respond in natural, coach-like language.',
                    'When returning a workout plan, format exercises in a markdown table with columns: Exercise | Sets | Reps | Weight | Rest | Notes.',
                    'If a workout was saved, explicitly confirm that it was saved.',
                    'If a workout was not saved, clearly state that save failed and ask the user to retry.',
                    'Never include thought process or internal reasoning steps.',
                    'Never include internal IDs such as userId, exerciseId, userExerciseId, workoutId, logId, _id, or ObjectId.',
                    'Keep it concise and readable for humans.',
                  ].join(' '),
                },
              },
              ...workingMessages,
            ],
            MAX_REQUEST_CHAR_BUDGET,
          )

          const finalizationResponse = await withTimeout(
            createMessageWithProvider(
              {
                messages: finalizationMessages,
                registry: { tools: [] },
                maxTokens,
              },
              activeToken,
            ),
            timeoutMs,
            'LLM finalization call',
          )

          if (finalizationResponse.text.trim().length > 0) {
            const safeAssistantText = humanizeStructuredAssistantText(finalizationResponse.text)
            if (safeAssistantText.length > 0) {
              const assistantMessage: LlmMessage = {
                role: 'assistant',
                content: { type: 'text', text: safeAssistantText },
              }
              workingMessages = [...workingMessages, assistantMessage]
              setMessages(workingMessages)
              assistantTextProduced = true
            }
          }
        }

        if (!assistantTextProduced) {
          const fallbackMessage: LlmMessage = {
            role: 'assistant',
            content: {
              type: 'text',
              text: 'I could not finalize a visible response this turn. Please try again with a more specific request (for example: "Create and save a push-day workout").',
            },
          }
          workingMessages = [...workingMessages, fallbackMessage]
          setMessages(workingMessages)
        }
      } catch (runError) {
        const message = runError instanceof Error ? runError.message : 'Unexpected agent failure'
        if (message.includes('UNAUTHORIZED') || message.includes('Invalid or expired token')) {
          const refreshedToken = await refreshSession()
          if (!refreshedToken) {
            clearSession()
            setError('Session invalid or expired. Please log in again.')
            return
          }

          setError('Session refreshed. Please send your last message again.')
          return
        }

        console.error('[AGENT][RUN][ERROR]', {
          message,
          error: runError,
        })
        setError(sanitizeAssistantFacingText(message) || 'Unexpected agent failure')
      } finally {
        setIsRunning(false)
      }
    },
    [clearSession, isRunning, options.maxLoops, options.maxTokens, options.timeoutMs, refreshSession, token],
  )

  return {
    messages,
    isRunning,
    error,
    run,
    triggerOnboarding,
    clear,
  }
}
