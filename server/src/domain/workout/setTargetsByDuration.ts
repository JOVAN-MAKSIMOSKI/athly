export type WorkoutDurationBucket = '30-45' | '45-60' | '60-75' | '75-90' | '90+';

export type SetRange = {
  min: number;
  max: number | null; // null = open-ended (e.g. 27+)
};

export type DurationSetTargets = {
  bucket: WorkoutDurationBucket;
  totalWorkingSets: SetRange;
  largeMuscleGroupSets: SetRange;
  smallMuscleGroupSets: SetRange;
  accessoryIsolationSets: SetRange;
};

export const DURATION_SET_TARGETS_BY_BUCKET: Record<WorkoutDurationBucket, DurationSetTargets> = {
  '30-45': {
    bucket: '30-45',
    totalWorkingSets: { min: 7, max: 12 },
    largeMuscleGroupSets: { min: 6, max: 9 },
    smallMuscleGroupSets: { min: 2, max: 3 },
    accessoryIsolationSets: { min: 0, max: 1 },
  },
  '45-60': {
    bucket: '45-60',
    totalWorkingSets: { min: 12, max: 17 },
    largeMuscleGroupSets: { min: 9, max: 12 },
    smallMuscleGroupSets: { min: 3, max: 4 },
    accessoryIsolationSets: { min: 1, max: 2 },
  },
  '60-75': {
    bucket: '60-75',
    totalWorkingSets: { min: 17, max: 22 },
    largeMuscleGroupSets: { min: 12, max: 15 },
    smallMuscleGroupSets: { min: 4, max: 6 },
    accessoryIsolationSets: { min: 2, max: 3 },
  },
  '75-90': {
    bucket: '75-90',
    totalWorkingSets: { min: 22, max: 27 },
    largeMuscleGroupSets: { min: 15, max: 18 },
    smallMuscleGroupSets: { min: 6, max: 8 },
    accessoryIsolationSets: { min: 3, max: 4 },
  },
  '90+': {
    bucket: '90+',
    totalWorkingSets: { min: 27, max: null },
    largeMuscleGroupSets: { min: 18, max: 21 },
    smallMuscleGroupSets: { min: 8, max: 10 },
    accessoryIsolationSets: { min: 5, max: null },
  },
};

export function getWorkoutDurationBucket(availableTimeMinutes: number): WorkoutDurationBucket {
  if (availableTimeMinutes <= 45) return '30-45';
  if (availableTimeMinutes <= 60) return '45-60';
  if (availableTimeMinutes <= 75) return '60-75';
  if (availableTimeMinutes <= 90) return '75-90';
  return '90+';
}

export function resolveDurationSetTargets(availableTimeMinutes: number): DurationSetTargets {
  const bucket = getWorkoutDurationBucket(availableTimeMinutes);
  return DURATION_SET_TARGETS_BY_BUCKET[bucket];
}