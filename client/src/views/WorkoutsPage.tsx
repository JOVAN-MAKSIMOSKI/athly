import { useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  workoutsApi,
  type StoredWorkout,
  type WorkoutExercise,
  type WorkoutSet,
  type ReplaceExercisePayload,
} from '../connection/api.ts'
import { useAuth } from '../state/authSessionStore.ts'

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return undefined
    }

    const asNumber = Number(trimmed)
    return Number.isFinite(asNumber) ? asNumber : undefined
  }

  if (value && typeof value === 'object') {
    const maybeBsonNumber = value as {
      $numberInt?: unknown
      $numberLong?: unknown
      $numberDecimal?: unknown
      value?: unknown
    }

    if (typeof maybeBsonNumber.$numberDecimal === 'string') {
      const asNumber = Number(maybeBsonNumber.$numberDecimal)
      if (Number.isFinite(asNumber)) {
        return asNumber
      }
    }

    if (typeof maybeBsonNumber.$numberInt === 'string') {
      const asNumber = Number(maybeBsonNumber.$numberInt)
      if (Number.isFinite(asNumber)) {
        return asNumber
      }
    }

    if (typeof maybeBsonNumber.$numberLong === 'string') {
      const asNumber = Number(maybeBsonNumber.$numberLong)
      if (Number.isFinite(asNumber)) {
        return asNumber
      }
    }

    if (Object.prototype.hasOwnProperty.call(maybeBsonNumber, 'value')) {
      return coerceFiniteNumber(maybeBsonNumber.value)
    }
  }

  return undefined
}

function normalizeRepsValue(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return undefined
    }

    const rangeMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)$/i)
    if (rangeMatch) {
      const min = Number(rangeMatch[1])
      const max = Number(rangeMatch[2])
      if (Number.isFinite(min) && Number.isFinite(max)) {
        return `${Math.min(min, max)}-${Math.max(min, max)}`
      }
    }

    const asNumber = coerceFiniteNumber(trimmed)
    if (typeof asNumber === 'number') {
      return asNumber
    }

    return trimmed
  }

  if (value && typeof value === 'object') {
    const maybeRange = value as {
      min?: unknown
      max?: unknown
      value?: unknown
      $numberInt?: unknown
      $numberLong?: unknown
      $numberDecimal?: unknown
    }

    const min = coerceFiniteNumber(maybeRange.min)
    const max = coerceFiniteNumber(maybeRange.max)
    if (typeof min === 'number' && typeof max === 'number') {
      return `${Math.min(min, max)}-${Math.max(min, max)}`
    }

    if (Object.prototype.hasOwnProperty.call(maybeRange, 'value')) {
      const nestedValue = normalizeRepsValue(maybeRange.value)
      if (nestedValue !== undefined) {
        return nestedValue
      }
    }

    const bsonNumeric = coerceFiniteNumber({
      $numberDecimal: maybeRange.$numberDecimal,
      $numberInt: maybeRange.$numberInt,
      $numberLong: maybeRange.$numberLong,
    })

    if (typeof bsonNumeric === 'number') {
      return bsonNumeric
    }
  }

  return undefined
}

function normalizeTextValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function formatUniqueValues(values: unknown[], suffix = ''): string {
  const normalized = values
    .map((value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''))
    .filter((value) => value.length > 0)

  const unique = normalized.filter((value, index, list) => list.indexOf(value) === index)
  if (unique.length === 0) {
    return '-'
  }

  return unique.map((value) => `${value}${suffix}`).join(', ')
}

function summarizeReps(sets: WorkoutSet[]): string {
  const normalizedValues = sets
    .map((set) => normalizeRepsValue(set.reps))
    .filter((value): value is string | number => value !== undefined)

  if (normalizedValues.length === 0) {
    return '-'
  }

  const numericBounds = normalizedValues
    .map((value) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { min: value, max: value }
      }

      if (typeof value === 'string') {
        const trimmed = value.trim()
        const asNumber = Number(trimmed)
        if (Number.isFinite(asNumber)) {
          return { min: asNumber, max: asNumber }
        }

        const rangeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/)
        if (rangeMatch) {
          const min = Number(rangeMatch[1])
          const max = Number(rangeMatch[2])
          if (Number.isFinite(min) && Number.isFinite(max)) {
            return { min: Math.min(min, max), max: Math.max(min, max) }
          }
        }
      }

      return null
    })
    .filter((value): value is { min: number; max: number } => value !== null)

  if (numericBounds.length === normalizedValues.length) {
    const minReps = Math.min(...numericBounds.map((value) => value.min))
    const maxReps = Math.max(...numericBounds.map((value) => value.max))

    return minReps === maxReps ? String(minReps) : `${minReps}-${maxReps}`
  }

  return formatUniqueValues(normalizedValues)
}

function summarizeWeight(sets: WorkoutSet[]): string {
  return formatUniqueValues(sets.map((set) => set.weight), ' kg')
}

function summarizeRest(sets: WorkoutSet[]): string {
  return formatUniqueValues(sets.map((set) => set.rest), 's')
}

function summarizeNotes(notes: unknown): string {
  return normalizeTextValue(notes) ?? '-'
}

function WorkoutTable({
  workout,
  replacingKey,
  onReplace,
}: {
  workout: StoredWorkout
  replacingKey: string | null
  onReplace: (workoutId: string, exercise: WorkoutExercise) => Promise<void>
}) {
  return (
    <article className="w-full rounded-2xl border border-slate-200 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold text-slate-900">{workout.name}</h2>
        <span className="rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-600">
          {workout.status}
        </span>
      </div>
      <p className="mb-5 text-center text-sm text-slate-500">
        Created: {new Date(workout.createdAt).toLocaleString()}
        {` | Estimated ${workout.estimatedWorkoutTimeToFinish} min`}
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-left text-sm md:text-base">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-4 py-3 font-semibold">Exercise</th>
              <th className="px-4 py-3 font-semibold">Equipment</th>
              <th className="px-4 py-3 font-semibold">Sets</th>
              <th className="px-4 py-3 font-semibold min-w-[8rem]">Reps</th>
              <th className="px-4 py-3 font-semibold">Weight</th>
              <th className="px-4 py-3 font-semibold">Rest</th>
              <th className="px-4 py-3 font-semibold">Form Tips</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {workout.exercises.map((exercise: WorkoutExercise, index: number) => (
              <tr key={`${workout.id}-${exercise.userExerciseId}-${index}`} className="border-t border-slate-200 odd:bg-slate-50">
                <td className="px-4 py-3 text-slate-800">{exercise.exerciseName}</td>
                <td className="px-4 py-3 text-slate-700">{normalizeTextValue(exercise.equipment) ?? '-'}</td>
                <td className="px-4 py-3 text-slate-700">{exercise.sets.length}</td>
                <td className="px-4 py-3 text-slate-700">{summarizeReps(exercise.sets)}</td>
                <td className="px-4 py-3 text-slate-700">{summarizeWeight(exercise.sets)}</td>
                <td className="px-4 py-3 text-slate-700">{summarizeRest(exercise.sets)}</td>
                <td className="px-4 py-3 text-slate-600 min-w-[18rem]">
                  {exercise.formTips && exercise.formTips.length > 0
                    ? <ul className="list-disc pl-4 space-y-1">{exercise.formTips.map((tip, i) => <li key={i}>{tip}</li>)}</ul>
                    : summarizeNotes(exercise.notes)}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={replacingKey === `${workout.id}:${exercise.userExerciseId}`}
                    onClick={() => {
                      void onReplace(workout.id, exercise)
                    }}
                  >
                    {replacingKey === `${workout.id}:${exercise.userExerciseId}` ? 'Replacing...' : 'Replace'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}

function WorkoutsPage() {
  const { token, isAuthenticated, refreshSession } = useAuth()
  const [workouts, setWorkouts] = useState<StoredWorkout[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(() => isAuthenticated)
  const [error, setError] = useState<string | null>(null)
  const [replacingKey, setReplacingKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!isAuthenticated) {
      return () => {
        cancelled = true
      }
    }

    const loadWorkouts = async () => {
      await Promise.resolve()

      if (cancelled) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const items = await workoutsApi.list(token ?? undefined)
        if (!cancelled) {
          setWorkouts(items)
        }
      } catch (requestError) {
        if (cancelled) {
          return
        }

        if (requestError instanceof ApiError && requestError.status === 401) {
          try {
            const refreshedToken = await refreshSession()
            if (refreshedToken) {
              const items = await workoutsApi.list(refreshedToken)
              if (!cancelled) {
                setWorkouts(items)
                setError(null)
              }
              return
            }
          } catch {
            // Fall through to generic error handling.
          }
        }

        const message = requestError instanceof Error ? requestError.message : 'Failed to load workouts'
        setError(message)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadWorkouts()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, refreshSession, token])

  const handleReplaceExercise = async (workoutId: string, exercise: WorkoutExercise) => {
    const rowKey = `${workoutId}:${exercise.userExerciseId}`
    setReplacingKey(rowKey)
    setError(null)

    const payload: ReplaceExercisePayload = {
      workoutId,
      userExerciseId: exercise.userExerciseId,
      query: `Find a similar replacement for ${exercise.exerciseName}`,
      filters: {
        equipment: exercise.equipment,
      },
      limit: 6,
    }

    try {
      const result = await workoutsApi.replaceExercise(payload, token ?? undefined)
      setWorkouts((current) =>
        current.map((workout) => {
          if (workout.id !== workoutId) return workout

          return {
            ...workout,
            exercises: workout.exercises.map((entry) =>
              entry.userExerciseId === exercise.userExerciseId ? result.updatedExercise : entry
            ),
          }
        })
      )
      return
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        try {
          const refreshedToken = await refreshSession()
          if (refreshedToken) {
            const result = await workoutsApi.replaceExercise(payload, refreshedToken)
            setWorkouts((current) =>
              current.map((workout) => {
                if (workout.id !== workoutId) return workout

                return {
                  ...workout,
                  exercises: workout.exercises.map((entry) =>
                    entry.userExerciseId === exercise.userExerciseId ? result.updatedExercise : entry
                  ),
                }
              })
            )
            return
          }
        } catch {
          // Fall through to generic error handling.
        }
      }

      const message = requestError instanceof Error ? requestError.message : 'Failed to replace exercise'
      if (requestError instanceof ApiError && requestError.code) {
        setError(`${requestError.code}: ${message}`)
      } else {
        setError(message)
      }
    } finally {
      setReplacingKey(null)
    }
  }

  const content = useMemo(() => {
    if (!isAuthenticated) {
      return <p className="text-center text-base text-slate-500">Sign in to view saved workouts.</p>
    }

    if (isLoading) {
      return <p className="text-center text-base text-slate-500">Loading workouts...</p>
    }

    if (error) {
      return <p className="text-center text-base text-rose-600">{error}</p>
    }

    if (workouts.length === 0) {
      return <p className="text-center text-base text-slate-500">No saved workouts yet. Generate one in Coach Chat and it will show up here.</p>
    }

    return (
      <div className="space-y-5">
        {workouts.map((workout) => (
          <WorkoutTable
            key={workout.id}
            workout={workout}
            replacingKey={replacingKey}
            onReplace={handleReplaceExercise}
          />
        ))}
      </div>
    )
  }, [error, isAuthenticated, isLoading, replacingKey, workouts])

  return (
    <section className="mx-auto w-full space-y-5 py-4">
      <div className="text-center">
        <h1 className="text-3xl font-semibold text-slate-900">Saved Workouts</h1>
        <p className="mt-2 text-base text-slate-500">Every saved workout appears here as its own table with exercise details.</p>
      </div>

      {content}
    </section>
  )
}

export default WorkoutsPage