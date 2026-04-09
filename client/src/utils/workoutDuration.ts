export type WorkoutDurationOption = {
	label: string
	value: number
}

export const WORKOUT_DURATION_OPTIONS: WorkoutDurationOption[] = [
	{ label: '30-45 minutes', value: 45 },
	{ label: '45-60 minutes', value: 60 },
	{ label: '60-75 minutes', value: 75 },
	{ label: '75-90 minutes', value: 90 },
	{ label: '90+ minutes', value: 105 },
]

export function normalizeWorkoutDurationMinutes(minutes: number | null | undefined): number {
	if (typeof minutes !== 'number' || !Number.isFinite(minutes)) {
		return 60
	}

	if (minutes <= 45) {
		return 45
	}

	if (minutes <= 60) {
		return 60
	}

	if (minutes <= 75) {
		return 75
	}

	if (minutes <= 90) {
		return 90
	}

	return 105
}