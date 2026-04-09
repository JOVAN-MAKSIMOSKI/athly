import { connectionConfig } from '../config/connectionConfig.ts'
import type { AuthResponse, FitnessGoal, UnitSystem } from '../types/auth.ts'

type ErrorPayload = {
  code?: string
  message?: string
}

export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export type WorkoutSet = {
  weight: number
  reps?: string | number
  rest: number
  rpe?: number
  completed: boolean
}

export type WorkoutExercise = {
  exerciseId: string
  userExerciseId: string
  exerciseName: string
  equipment?: string
  formTips?: string[]
  notes?: string
  sets: WorkoutSet[]
}

export type StoredWorkout = {
  id: string
  name: string
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled'
  createdAt: string
  estimatedWorkoutTimeToFinish: number
  exercises: WorkoutExercise[]
}

type ListWorkoutsResponse = {
  status: string
  data: {
    workouts: StoredWorkout[]
  }
}

export type LoginPayload = {
  email: string
  password: string
}

export type SignupPayload = {
  email: string
  name: string
  password: string
  profile: {
    age?: number
    weight: number
    height: number
    experienceLevel?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
    goal?: FitnessGoal
    isMedicallyCleared?: boolean
    comfortableWithHeavierWeights: boolean
    workoutDurationMinutes: number
    workoutFrequencyPerWeek?: number
    availableEquipment?: string[]
    WorkoutSplit?: string
  }
  settings?: {
    units?: UnitSystem
    theme?: 'light' | 'dark'
  }
}

type UpdateWorkoutSplitPayload = {
  WorkoutSplit: string
}

type UpdateWorkoutSplitResponse = {
  status: string
  data: {
    user: AuthResponse['data']['user']
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T | ErrorPayload
  if (!response.ok) {
    const errorCode = typeof data === 'object' && data && 'code' in data && typeof data.code === 'string'
      ? data.code
      : undefined

    const errorMessage =
      typeof data === 'object' && data && 'message' in data && typeof data.message === 'string'
        ? data.message
        : `Request failed with status ${response.status}`

    throw new ApiError(errorMessage, response.status, errorCode)
  }

  return data as T
}

async function postWithoutBody<TResponse>(path: string): Promise<TResponse> {
  const response = await fetch(`${connectionConfig.apiBaseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  return parseResponse<TResponse>(response)
}

async function post<TResponse, TBody>(path: string, body: TBody): Promise<TResponse> {
  const response = await fetch(`${connectionConfig.apiBaseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  return parseResponse<TResponse>(response)
}

async function patch<TResponse, TBody>(path: string, body: TBody, authToken?: string): Promise<TResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  const response = await fetch(`${connectionConfig.apiBaseUrl}${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers,
    body: JSON.stringify(body),
  })

  return parseResponse<TResponse>(response)
}

async function get<TResponse>(path: string, authToken?: string): Promise<TResponse> {
  const headers: Record<string, string> = {}

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`
  }

  const response = await fetch(`${connectionConfig.apiBaseUrl}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers,
  })

  return parseResponse<TResponse>(response)
}

export const authApi = {
  // Auth endpoints are kept in one place so pages stay presentation-focused.
  login(payload: LoginPayload) {
    return post<AuthResponse, LoginPayload>('/auth/login', payload)
  },
  signup(payload: SignupPayload) {
    return post<AuthResponse, SignupPayload>('/auth/signup', payload)
  },
  refresh() {
    return postWithoutBody<AuthResponse>('/auth/refresh')
  },
  logout() {
    return postWithoutBody<{ status: string; message: string }>('/auth/logout')
  },
  updateWorkoutSplit(payload: UpdateWorkoutSplitPayload, authToken?: string) {
    return patch<UpdateWorkoutSplitResponse, UpdateWorkoutSplitPayload>('/auth/profile', payload, authToken)
  },
}

export const workoutsApi = {
  async list(authToken?: string): Promise<StoredWorkout[]> {
    const response = await get<ListWorkoutsResponse>('/workouts', authToken)
    return response.data.workouts
  },
}
