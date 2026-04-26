type ActiveWorkoutContext = {
  id: string
  name: string
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled'
  estimatedWorkoutTimeToFinish: number
  startedAtMs: number
  exerciseNames: string[]
}

const ACTIVE_WORKOUT_CONTEXT_KEY = 'athly:active-workout-context'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function setActiveWorkoutContext(context: ActiveWorkoutContext): void {
  window.localStorage.setItem(ACTIVE_WORKOUT_CONTEXT_KEY, JSON.stringify(context))
}

export function clearActiveWorkoutContext(): void {
  window.localStorage.removeItem(ACTIVE_WORKOUT_CONTEXT_KEY)
}

export function getActiveWorkoutContext(): ActiveWorkoutContext | null {
  const raw = window.localStorage.getItem(ACTIVE_WORKOUT_CONTEXT_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) {
      return null
    }

    const id = typeof parsed.id === 'string' ? parsed.id.trim() : ''
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
    const status =
      parsed.status === 'planned' ||
      parsed.status === 'in_progress' ||
      parsed.status === 'completed' ||
      parsed.status === 'cancelled'
        ? parsed.status
        : null
    const estimatedWorkoutTimeToFinish =
      typeof parsed.estimatedWorkoutTimeToFinish === 'number' && Number.isFinite(parsed.estimatedWorkoutTimeToFinish)
        ? Math.max(1, Math.floor(parsed.estimatedWorkoutTimeToFinish))
        : 1
    const startedAtMs =
      typeof parsed.startedAtMs === 'number' && Number.isFinite(parsed.startedAtMs)
        ? Math.max(0, Math.floor(parsed.startedAtMs))
        : Date.now()
    const exerciseNames = Array.isArray(parsed.exerciseNames)
      ? parsed.exerciseNames
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => entry.trim())
      : []

    if (!id || !name || !status) {
      return null
    }

    return {
      id,
      name,
      status,
      estimatedWorkoutTimeToFinish,
      startedAtMs,
      exerciseNames,
    }
  } catch {
    return null
  }
}
