// Frontend auth/user types mirror server auth responses.
export type ExperienceLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
export type FitnessGoal = 'STRENGTH' | 'HYPERTROPHY' | 'ENDURANCE' | 'WEIGHT_LOSS'
export type UnitSystem = 'METRIC' | 'IMPERIAL'

export type AuthenticatedUser = {
  _id: string
  email: string
  name: string
  profile: {
    age?: number
    weight: number
    height: number
    experienceLevel?: ExperienceLevel
    goal?: FitnessGoal
    isMedicallyCleared?: boolean
    comfortableWithHeavierWeights: boolean
    workoutDurationMinutes: number
    workoutFrequencyPerWeek: number
    availableEquipment?: string[]
    WorkoutSplit?: string
  }
  settings?: {
    units?: UnitSystem
    theme?: 'light' | 'dark'
  }
}

export type AuthResponse = {
  status: string
  token: string
  data: {
    user: AuthenticatedUser
  }
}