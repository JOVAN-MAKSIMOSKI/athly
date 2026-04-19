import type { MuscleGroup } from '../exercises/types.js';
import { getWorkoutDurationBucket, type WorkoutDurationBucket } from './setTargetsByDuration.js';

export type TrainingType = 'hypertrophy' | 'strength' | 'endurance' | 'mobility';
export type MovementType = 'compound' | 'isolation';

export interface WorkoutTargetInputExercise {
  exerciseId: string;
  name?: string;
  force: 'push' | 'pull' | 'legs';
  targetMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  movementType?: MovementType;
}

export interface WorkoutTargetExercise {
  exerciseId: string;
  sets: number;
  reps: string;
  restSeconds: number;
  rirMin: number;
  rirMax: number;
  rpe: number;
  coachNote: string;
  movementType: MovementType;
  supersetGroup?: string;
  estimatedDurationSeconds: number;
}

export interface BuildWorkoutTargetsParams {
  trainingType: TrainingType;
  exercises: WorkoutTargetInputExercise[];
  availableTimeMinutes: number;
  preserveExerciseCount?: boolean;
}

export interface BuildWorkoutTargetsResult {
  trainingType: TrainingType;
  exercises: WorkoutTargetExercise[];
  estimatedDurationSeconds: number;
  rulesApplied: Array<'drop_volume' | 'compress_rest' | 'supersets' | 'cull_accessories' | 'weekly_minimum_allocation'>;
  removedExerciseIds: string[];
}

export type WeeklyMuscleBucket =
  | 'chest'
  | 'back'
  | 'quads'
  | 'hamstrings'
  | 'biceps'
  | 'triceps'
  | 'side_rear_delts'
  | 'calves_abs';

export interface WeeklyTargetRange {
  min: number;
  max: number;
}

export interface DurationBasedWeeklyTargetNorm {
  bucket: WorkoutDurationBucket;
  weeklyTargetRanges: Record<WeeklyMuscleBucket, WeeklyTargetRange>;
}

export interface WeeklyQuotaState {
  target: WeeklyTargetRange;
  achieved: number;
}

export interface WeeklyPlannerExercise {
  dayIndex: number;
  dayAvailableTimeMinutes: number;
  input: WorkoutTargetInputExercise;
  target: WorkoutTargetExercise;
}

export interface AllocateWeeklyMinimumSetsParams {
  trainingType: TrainingType;
  availableTimeMinutes?: number;
  exercises: WeeklyPlannerExercise[];
}

export interface AllocateWeeklyMinimumSetsResult {
  exercises: WeeklyPlannerExercise[];
  weeklyQuota: Record<WeeklyMuscleBucket, WeeklyQuotaState>;
  rulesApplied: string[];
  unmetMinimumBuckets: WeeklyMuscleBucket[];
}

export interface WorkoutDurationEstimateInputExercise {
  sets: number;
  reps?: string;
  restSeconds?: number;
  movementType: MovementType;
  force: 'push' | 'pull' | 'legs';
  name?: string;
  supersetGroup?: string;
}

interface BaselineProfile {
  minSets: number;
  maxSets: number;
  reps: string;
  restSeconds: number;
  minRestSeconds: number;
  rirMin: number;
  rirMax: number;
  rpe: number;
  coachNote: string;
}

const HYPERTROPHY_COMPOUND_MINUTES_PER_SET = 3.5;
const HYPERTROPHY_ISOLATION_MINUTES_PER_SET = 2.8;
const HYPERTROPHY_COMPOUND_REST_SECONDS = 150;
const HYPERTROPHY_ISOLATION_REST_SECONDS = 120;

const HYPERTROPHY_WEEKLY_TARGET_RANGES: Record<WeeklyMuscleBucket, WeeklyTargetRange> = {
  chest: { min: 10, max: 14 },
  back: { min: 12, max: 16 },
  quads: { min: 10, max: 14 },
  hamstrings: { min: 8, max: 12 },
  biceps: { min: 6, max: 10 },
  triceps: { min: 6, max: 10 },
  side_rear_delts: { min: 8, max: 12 },
  calves_abs: { min: 6, max: 10 },
};

export const HYPERTROPHY_WEEKLY_TARGET_NORMS_BY_DURATION: Record<
  WorkoutDurationBucket,
  DurationBasedWeeklyTargetNorm
> = {
  '30-45': {
    bucket: '30-45',
    weeklyTargetRanges: {
      chest: { min: 6, max: 10 },
      back: { min: 8, max: 12 },
      quads: { min: 6, max: 10 },
      hamstrings: { min: 4, max: 8 },
      side_rear_delts: { min: 6, max: 10 },
      biceps: { min: 4, max: 8 },
      triceps: { min: 4, max: 8 },
      calves_abs: { min: 4, max: 8 },
    },
  },
  '45-60': {
    bucket: '45-60',
    weeklyTargetRanges: {
      chest: { min: 10, max: 14 },
      back: { min: 12, max: 16 },
      quads: { min: 10, max: 14 },
      hamstrings: { min: 8, max: 12 },
      side_rear_delts: { min: 8, max: 12 },
      biceps: { min: 6, max: 10 },
      triceps: { min: 6, max: 10 },
      calves_abs: { min: 6, max: 10 },
    },
  },
  '60-75': {
    bucket: '60-75',
    weeklyTargetRanges: {
      chest: { min: 14, max: 18 },
      back: { min: 16, max: 20 },
      quads: { min: 14, max: 18 },
      hamstrings: { min: 10, max: 14 },
      side_rear_delts: { min: 12, max: 16 },
      biceps: { min: 10, max: 14 },
      triceps: { min: 10, max: 14 },
      calves_abs: { min: 8, max: 12 },
    },
  },
  '75-90': {
    bucket: '75-90',
    weeklyTargetRanges: {
      chest: { min: 18, max: 22 },
      back: { min: 20, max: 24 },
      quads: { min: 18, max: 22 },
      hamstrings: { min: 12, max: 16 },
      side_rear_delts: { min: 16, max: 20 },
      biceps: { min: 12, max: 16 },
      triceps: { min: 12, max: 16 },
      calves_abs: { min: 10, max: 14 },
    },
  },
  '90+': {
    bucket: '90+',
    weeklyTargetRanges: {
      chest: { min: 22, max: 26 },
      back: { min: 24, max: 28 },
      quads: { min: 22, max: 26 },
      hamstrings: { min: 16, max: 20 },
      side_rear_delts: { min: 20, max: 24 },
      biceps: { min: 14, max: 18 },
      triceps: { min: 14, max: 18 },
      calves_abs: { min: 12, max: 16 },
    },
  },
};

const BASELINE_PROFILES: Record<TrainingType, BaselineProfile> = {
  hypertrophy: {
    minSets: 3,
    maxSets: 4,
    reps: '8-12',
    restSeconds: 150,
    minRestSeconds: 90,
    rirMin: 1,
    rirMax: 2,
    rpe: 8.5,
    coachNote: 'Sweet spot for volume: moderate load, moderate rest.',
  },
  strength: {
    minSets: 3,
    maxSets: 5,
    reps: '3-6',
    restSeconds: 180,
    minRestSeconds: 120,
    rirMin: 1,
    rirMax: 1,
    rpe: 9,
    coachNote: 'Low reps and long rest for neural recovery and ATP replenishment.',
  },
  endurance: {
    minSets: 2,
    maxSets: 3,
    reps: '15-20',
    restSeconds: 45,
    minRestSeconds: 20,
    rirMin: 3,
    rirMax: 4,
    rpe: 7,
    coachNote: 'Chase metabolic fatigue with short rest and sustained effort.',
  },
  mobility: {
    minSets: 1,
    maxSets: 2,
    reps: '8-10',
    restSeconds: 15,
    minRestSeconds: 0,
    rirMin: 4,
    rirMax: 5,
    rpe: 6,
    coachNote: 'Prioritize control and range of motion, not fatigue.',
  },
};

function isHeavyCompound(force: 'push' | 'pull' | 'legs', movementType: MovementType, exerciseName?: string): boolean {
  if (movementType !== 'compound') {
    return false;
  }

  const name = (exerciseName ?? '').toLowerCase();
  const heavyKeywords = [
    'squat',
    'deadlift',
    'bench press',
    'barbell row',
    'overhead press',
    'military press',
    'pull-up',
    'weighted pull-up',
    'pendlay row',
    'front squat',
    'romanian deadlift',
  ];

  if (heavyKeywords.some((keyword) => name.includes(keyword))) {
    return true;
  }

  if (force === 'legs') {
    const mediumLegPatterns = ['lunge', 'step-up', 'split squat', 'leg press'];
    return !mediumLegPatterns.some((pattern) => name.includes(pattern));
  }

  return false;
}

function pickRepRangeForExercise(
  trainingType: TrainingType,
  movementType: MovementType,
  force: 'push' | 'pull' | 'legs',
  exerciseName?: string
): string {
  if (trainingType === 'hypertrophy') {
    if (movementType === 'isolation') {
      return '10-12';
    }

    if (isHeavyCompound(force, movementType, exerciseName)) {
      return '6-8';
    }

    return '8-10';
  }

  if (trainingType === 'strength') {
    return movementType === 'compound' ? '3-5' : '5-6';
  }

  if (trainingType === 'endurance') {
    return movementType === 'compound' ? '15-18' : '18-22';
  }

  return '8-10';
}

function pickRestSecondsForExercise(trainingType: TrainingType, movementType: MovementType, repRange: string): number {
  if (trainingType !== 'hypertrophy') {
    return BASELINE_PROFILES[trainingType].restSeconds;
  }

  if (movementType === 'compound') {
    return HYPERTROPHY_COMPOUND_REST_SECONDS;
  }

  return HYPERTROPHY_ISOLATION_REST_SECONDS;
}

function clampSetCount(value: number, profile: BaselineProfile): number {
  return Math.max(profile.minSets, Math.min(profile.maxSets, value));
}

function pickSetCountForExercise(
  trainingType: TrainingType,
  movementType: MovementType,
  force: 'push' | 'pull' | 'legs'
): number {
  const profile = BASELINE_PROFILES[trainingType];

  if (trainingType === 'hypertrophy') {
    if (movementType === 'compound') {
      const base = force === 'legs' ? profile.maxSets : profile.maxSets - 1;
      return clampSetCount(base, profile);
    }

    return clampSetCount(profile.minSets, profile);
  }

  if (trainingType === 'strength') {
    if (movementType === 'compound') {
      return clampSetCount(profile.maxSets, profile);
    }

    return clampSetCount(profile.minSets + 1, profile);
  }

  if (trainingType === 'endurance') {
    if (movementType === 'compound') {
      return clampSetCount(profile.maxSets, profile);
    }

    return clampSetCount(profile.minSets, profile);
  }

  if (movementType === 'compound') {
    return clampSetCount(profile.maxSets, profile);
  }

  return clampSetCount(profile.minSets, profile);
}

function getMaxSetsCapForTrainingType(trainingType: TrainingType, movementType: MovementType): number {
  if (trainingType === 'hypertrophy') {
    return 4;
  }

  if (trainingType === 'strength') {
    return movementType === 'compound' ? 6 : 5;
  }

  if (trainingType === 'endurance') {
    return movementType === 'compound' ? 5 : 4;
  }

  return 4;
}

export function resolveWeeklyTargetRanges(trainingType: TrainingType): Record<WeeklyMuscleBucket, WeeklyTargetRange> {
  if (trainingType === 'hypertrophy') {
    return HYPERTROPHY_WEEKLY_TARGET_RANGES;
  }

  return {
    chest: { min: 0, max: 0 },
    back: { min: 0, max: 0 },
    quads: { min: 0, max: 0 },
    hamstrings: { min: 0, max: 0 },
    biceps: { min: 0, max: 0 },
    triceps: { min: 0, max: 0 },
    side_rear_delts: { min: 0, max: 0 },
    calves_abs: { min: 0, max: 0 },
  };
}

export function resolveHypertrophyWeeklyTargetNormByDuration(
  availableTimeMinutes: number
): DurationBasedWeeklyTargetNorm {
  const bucket = getWorkoutDurationBucket(availableTimeMinutes);
  return HYPERTROPHY_WEEKLY_TARGET_NORMS_BY_DURATION[bucket];
}

export function mapMuscleGroupToWeeklyBucket(targetMuscle: MuscleGroup): WeeklyMuscleBucket | null {
  if (targetMuscle === 'pecs' || targetMuscle.includes('chest')) {
    return 'chest';
  }

  if (
    targetMuscle.includes('lats') ||
    targetMuscle.includes('middle-back') ||
    targetMuscle.includes('lower-back') ||
    targetMuscle.includes('romboids') ||
    targetMuscle.includes('traps')
  ) {
    return 'back';
  }

  if (targetMuscle.includes('quads')) {
    return 'quads';
  }

  if (targetMuscle.includes('hamstrings')) {
    return 'hamstrings';
  }

  if (targetMuscle.includes('bicep') || targetMuscle.includes('brachialis') || targetMuscle.includes('brachioradialis')) {
    return 'biceps';
  }

  if (targetMuscle.includes('triceps')) {
    return 'triceps';
  }

  if (targetMuscle.includes('lateral-delts') || targetMuscle.includes('rear-delts')) {
    return 'side_rear_delts';
  }

  if (
    targetMuscle.includes('calves') ||
    targetMuscle.includes('abs') ||
    targetMuscle.includes('obliques')
  ) {
    return 'calves_abs';
  }

  return null;
}

function getPerSetTimeGainSeconds(trainingType: TrainingType, exercise: WorkoutTargetExercise): number {
  if (trainingType === 'hypertrophy') {
    return estimateHypertrophyExerciseDurationSeconds(1, exercise.movementType);
  }

  const activePerSetSeconds = estimateActiveTimePerSetSeconds(exercise.reps, exercise.movementType);
  return activePerSetSeconds + exercise.restSeconds;
}

function getSetContributionByBucket(input: WorkoutTargetInputExercise): Array<{ bucket: WeeklyMuscleBucket; weight: number }> {
  const contributionByBucket = new Map<WeeklyMuscleBucket, number>();

  const primaryBucket = mapMuscleGroupToWeeklyBucket(input.targetMuscle);
  if (primaryBucket) {
    contributionByBucket.set(primaryBucket, (contributionByBucket.get(primaryBucket) ?? 0) + 1);
  }

  for (const secondaryMuscle of input.secondaryMuscles) {
    const secondaryBucket = mapMuscleGroupToWeeklyBucket(secondaryMuscle);
    if (!secondaryBucket) {
      continue;
    }

    contributionByBucket.set(secondaryBucket, (contributionByBucket.get(secondaryBucket) ?? 0) + 0.5);
  }

  return [...contributionByBucket.entries()].map(([bucket, weight]) => ({ bucket, weight }));
}

function initializeWeeklyQuotaState(
  trainingType: TrainingType,
  availableTimeMinutes?: number
): Record<WeeklyMuscleBucket, WeeklyQuotaState> {
  const ranges =
    trainingType === 'hypertrophy' && typeof availableTimeMinutes === 'number' && Number.isFinite(availableTimeMinutes)
      ? resolveHypertrophyWeeklyTargetNormByDuration(availableTimeMinutes).weeklyTargetRanges
      : resolveWeeklyTargetRanges(trainingType);

  return {
    chest: { target: ranges.chest, achieved: 0 },
    back: { target: ranges.back, achieved: 0 },
    quads: { target: ranges.quads, achieved: 0 },
    hamstrings: { target: ranges.hamstrings, achieved: 0 },
    biceps: { target: ranges.biceps, achieved: 0 },
    triceps: { target: ranges.triceps, achieved: 0 },
    side_rear_delts: { target: ranges.side_rear_delts, achieved: 0 },
    calves_abs: { target: ranges.calves_abs, achieved: 0 },
  };
}

export function allocateSetsToWeeklyMinimums(
  params: AllocateWeeklyMinimumSetsParams
): AllocateWeeklyMinimumSetsResult {
  const rulesApplied: string[] = [];
  const weeklyQuota = initializeWeeklyQuotaState(params.trainingType, params.availableTimeMinutes);
  const plannedExercises = params.exercises.map((exercise) => ({
    ...exercise,
    target: {
      ...exercise.target,
    },
  }));

  const dayBudgetSecondsByDay = new Map<number, number>();
  const dayEstimatedSecondsByDay = new Map<number, number>();

  for (const exercise of plannedExercises) {
    if (!dayBudgetSecondsByDay.has(exercise.dayIndex)) {
      dayBudgetSecondsByDay.set(exercise.dayIndex, Math.round(exercise.dayAvailableTimeMinutes * 60));
    }
  }

  for (const [dayIndex] of dayBudgetSecondsByDay) {
    const dayExercises = plannedExercises
      .filter((exercise) => exercise.dayIndex === dayIndex)
      .map((exercise) => exercise.target);

    dayEstimatedSecondsByDay.set(dayIndex, estimateWorkoutDurationSeconds(params.trainingType, dayExercises));
  }

  const applyCurrentSetContributions = () => {
    for (const bucket of Object.keys(weeklyQuota) as WeeklyMuscleBucket[]) {
      weeklyQuota[bucket].achieved = 0;
    }

    for (const exercise of plannedExercises) {
      const contributions = getSetContributionByBucket(exercise.input);
      for (const contribution of contributions) {
        weeklyQuota[contribution.bucket].achieved += contribution.weight * exercise.target.sets;
      }
    }
  };

  applyCurrentSetContributions();

  const hasRemainingWeeklyMinimumDeficit = () =>
    (Object.keys(weeklyQuota) as WeeklyMuscleBucket[]).some(
      (bucket) => weeklyQuota[bucket].target.min > 0 && weeklyQuota[bucket].achieved < weeklyQuota[bucket].target.min
    );

  let safetyIterations = 0;
  while (hasRemainingWeeklyMinimumDeficit() && safetyIterations < 5000) {
    safetyIterations += 1;

    let bestExerciseIndex = -1;
    let bestScore = 0;

    for (let index = 0; index < plannedExercises.length; index += 1) {
      const exercise = plannedExercises[index];
      if (!exercise) {
        continue;
      }

      const maxSetCap = getMaxSetsCapForTrainingType(params.trainingType, exercise.target.movementType);
      if (exercise.target.sets >= maxSetCap) {
        continue;
      }

      const dayBudget = dayBudgetSecondsByDay.get(exercise.dayIndex) ?? 0;
      const dayEstimated = dayEstimatedSecondsByDay.get(exercise.dayIndex) ?? 0;
      const perSetTimeGain = getPerSetTimeGainSeconds(params.trainingType, exercise.target);

      if (dayEstimated + perSetTimeGain > dayBudget) {
        continue;
      }

      const contributions = getSetContributionByBucket(exercise.input);
      if (contributions.length === 0) {
        continue;
      }

      let deficitCoverage = 0;
      for (const contribution of contributions) {
        const bucketState = weeklyQuota[contribution.bucket];
        const deficit = Math.max(0, bucketState.target.min - bucketState.achieved);
        deficitCoverage += Math.min(deficit, contribution.weight);
      }

      if (deficitCoverage <= 0) {
        continue;
      }

      const score = deficitCoverage / Math.max(1, perSetTimeGain);
      if (score > bestScore) {
        bestScore = score;
        bestExerciseIndex = index;
      }
    }

    if (bestExerciseIndex < 0) {
      break;
    }

    const chosen = plannedExercises[bestExerciseIndex]!;
    const perSetTimeGain = getPerSetTimeGainSeconds(params.trainingType, chosen.target);
    chosen.target.sets += 1;
    dayEstimatedSecondsByDay.set(
      chosen.dayIndex,
      (dayEstimatedSecondsByDay.get(chosen.dayIndex) ?? 0) + perSetTimeGain
    );

    const contributions = getSetContributionByBucket(chosen.input);
    for (const contribution of contributions) {
      weeklyQuota[contribution.bucket].achieved += contribution.weight;
    }
  }

  if (safetyIterations > 0) {
    rulesApplied.push('weekly_minimum_allocation');
  }

  const unmetMinimumBuckets = (Object.keys(weeklyQuota) as WeeklyMuscleBucket[]).filter(
    (bucket) => weeklyQuota[bucket].target.min > 0 && weeklyQuota[bucket].achieved < weeklyQuota[bucket].target.min
  );

  return {
    exercises: plannedExercises,
    weeklyQuota,
    rulesApplied,
    unmetMinimumBuckets,
  };
}

const WEEKLY_BUCKET_DISPLAY_NAMES: Record<WeeklyMuscleBucket, string> = {
  chest: 'Chest',
  back: 'Back',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  biceps: 'Biceps',
  triceps: 'Triceps',
  side_rear_delts: 'Side/Rear Delts',
  calves_abs: 'Calves/Abs',
};

function getHypertrophyWeeklySetTarget(targetMuscle: MuscleGroup, availableTimeMinutes: number): string {
  const bucket = mapMuscleGroupToWeeklyBucket(targetMuscle);
  if (!bucket) {
    return 'Weekly target: Adjust total weekly sets by muscle demand and recovery.';
  }

  const range = resolveHypertrophyWeeklyTargetNormByDuration(availableTimeMinutes).weeklyTargetRanges[bucket];
  const displayName = WEEKLY_BUCKET_DISPLAY_NAMES[bucket];
  return `Weekly target: ${displayName} ${range.min}-${range.max} sets.`;
}

function parseRepsToAverage(reps: string): number {
  const rangeMatch = reps.match(/(\d+)\s*-\s*(\d+)/);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    return Math.round((min + max) / 2);
  }

  const plusMatch = reps.match(/(\d+)\s*\+/);
  if (plusMatch) {
    return Number(plusMatch[1]);
  }

  const single = Number(reps);
  return Number.isFinite(single) && single > 0 ? Math.round(single) : 10;
}

function estimateActiveTimePerSetSeconds(reps: string, movementType: MovementType): number {
  if (reps.trim().toUpperCase() === 'FAILURE') {
    return movementType === 'compound' ? 70 : 37;
  }

  const averageReps = parseRepsToAverage(reps);
  return averageReps * 4;
}

function estimateExerciseDurationSeconds(
  sets: number,
  reps: string,
  movementType: MovementType,
  restSeconds: number,
  restMultiplier = 1
): number {
  const activeTimePerSetSeconds = estimateActiveTimePerSetSeconds(reps, movementType);
  const activeTime = sets * activeTimePerSetSeconds;
  const restTime = Math.max(0, sets - 1) * restSeconds * restMultiplier;
  return Math.round(activeTime + restTime);
}

function estimateHypertrophyExerciseDurationSeconds(sets: number, movementType: MovementType): number {
  const minutesPerSet = movementType === 'compound'
    ? HYPERTROPHY_COMPOUND_MINUTES_PER_SET
    : HYPERTROPHY_ISOLATION_MINUTES_PER_SET;

  return Math.round(sets * minutesPerSet * 60);
}

function estimateWorkoutDurationSeconds(trainingType: TrainingType, exercises: WorkoutTargetExercise[]): number {
  const supersetCounts = new Map<string, number>();
  for (const exercise of exercises) {
    if (!exercise.supersetGroup) {
      continue;
    }

    supersetCounts.set(exercise.supersetGroup, (supersetCounts.get(exercise.supersetGroup) ?? 0) + 1);
  }

  return exercises.reduce((total, exercise) => {
    if (trainingType === 'hypertrophy') {
      return total + estimateHypertrophyExerciseDurationSeconds(exercise.sets, exercise.movementType);
    }

    const hasValidSupersetPair =
      exercise.supersetGroup !== undefined && (supersetCounts.get(exercise.supersetGroup) ?? 0) === 2;
    const restMultiplier = hasValidSupersetPair ? 0.5 : 1;
    return total + estimateExerciseDurationSeconds(
      exercise.sets,
      exercise.reps,
      exercise.movementType,
      exercise.restSeconds,
      restMultiplier
    );
  }, 0);
}

export function estimateWorkoutDurationMinutes(params: {
  trainingType: TrainingType;
  exercises: WorkoutDurationEstimateInputExercise[];
}): number {
  const normalizedExercises: WorkoutTargetExercise[] = params.exercises.map((exercise, index) => {
    const repRange =
      typeof exercise.reps === 'string' && exercise.reps.trim().length > 0
        ? exercise.reps
        : pickRepRangeForExercise(params.trainingType, exercise.movementType, exercise.force, exercise.name);

    return {
      exerciseId: `estimate-${index + 1}`,
      sets: exercise.sets,
      reps: repRange,
      restSeconds:
        typeof exercise.restSeconds === 'number' && Number.isFinite(exercise.restSeconds)
          ? Math.max(0, Math.floor(exercise.restSeconds))
          : pickRestSecondsForExercise(params.trainingType, exercise.movementType, repRange),
      rirMin: 0,
      rirMax: 0,
      rpe: 0,
      coachNote: '',
      movementType: exercise.movementType,
      supersetGroup: exercise.supersetGroup,
      estimatedDurationSeconds: 0,
    };
  });

  return Math.max(1, Math.ceil(estimateWorkoutDurationSeconds(params.trainingType, normalizedExercises) / 60));
}

function inferMovementType(force: 'push' | 'pull' | 'legs', secondaryMuscles: MuscleGroup[]): MovementType {
  if (force === 'legs') {
    return 'compound';
  }

  return secondaryMuscles.length >= 2 ? 'compound' : 'isolation';
}

function getAntagonistBucket(force: 'push' | 'pull' | 'legs', targetMuscle: MuscleGroup): 'push' | 'pull' | null {
  if (force === 'push') return 'push';
  if (force === 'pull') return 'pull';

  const pushMuscles = ['chest', 'pec', 'delts', 'triceps'];
  const pullMuscles = ['back', 'bicep', 'brachialis', 'brachioradialis', 'romboids', 'traps', 'lats'];

  if (pushMuscles.some((key) => targetMuscle.includes(key))) {
    return 'push';
  }

  if (pullMuscles.some((key) => targetMuscle.includes(key))) {
    return 'pull';
  }

  return null;
}

function clearSupersetGroups(exercises: WorkoutTargetExercise[]): void {
  for (const exercise of exercises) {
    delete exercise.supersetGroup;
  }
}

function applySupersetPairing(exercises: WorkoutTargetExercise[], inputs: WorkoutTargetInputExercise[]): boolean {
  clearSupersetGroups(exercises);

  const pushIndexes: number[] = [];
  const pullIndexes: number[] = [];

  for (let index = 0; index < exercises.length; index += 1) {
    const input = inputs[index];
    if (!input) {
      continue;
    }

    const bucket = getAntagonistBucket(input.force, input.targetMuscle);
    if (bucket === 'push') {
      pushIndexes.push(index);
    } else if (bucket === 'pull') {
      pullIndexes.push(index);
    }
  }

  const pairCount = Math.min(pushIndexes.length, pullIndexes.length);
  for (let index = 0; index < pairCount; index += 1) {
    const pushIndex = pushIndexes[index];
    const pullIndex = pullIndexes[index];
    if (pushIndex === undefined || pullIndex === undefined) {
      continue;
    }

    const supersetGroup = `SS${index + 1}`;
    exercises[pushIndex]!.supersetGroup = supersetGroup;
    exercises[pullIndex]!.supersetGroup = supersetGroup;
  }

  return pairCount > 0;
}

export function buildWorkoutTargets(params: BuildWorkoutTargetsParams): BuildWorkoutTargetsResult {
  const profile = BASELINE_PROFILES[params.trainingType];
  const targetLowerBoundSeconds = Math.max(60, Math.floor(params.availableTimeMinutes * 60 * 0.85));
  const minimumExerciseCount = params.preserveExerciseCount ? params.exercises.length : 1;

  let exercises = params.exercises.map<WorkoutTargetExercise>((exercise) => {
    const movementType = exercise.movementType ?? inferMovementType(exercise.force, exercise.secondaryMuscles);
    const repRange = pickRepRangeForExercise(params.trainingType, movementType, exercise.force, exercise.name);
    const sets = pickSetCountForExercise(params.trainingType, movementType, exercise.force);
    const hypertrophyWeeklyTarget =
      params.trainingType === 'hypertrophy'
        ? getHypertrophyWeeklySetTarget(exercise.targetMuscle, params.availableTimeMinutes)
        : undefined;
    return {
    exerciseId: exercise.exerciseId,
    sets,
    reps: repRange,
    restSeconds: pickRestSecondsForExercise(params.trainingType, movementType, repRange),
    rirMin: profile.rirMin,
    rirMax: profile.rirMax,
    rpe: profile.rpe,
    coachNote: hypertrophyWeeklyTarget ? `${profile.coachNote} ${hypertrophyWeeklyTarget}` : profile.coachNote,
    movementType,
    estimatedDurationSeconds: 0,
    };
  });

  const rulesApplied: BuildWorkoutTargetsResult['rulesApplied'] = [];
  const removedExerciseIds: string[] = [];
  const durationLimitSeconds = Math.round(params.availableTimeMinutes * 60);

  if (params.trainingType === 'hypertrophy' && exercises.length > 0) {
    const allocationResult = allocateSetsToWeeklyMinimums({
      trainingType: params.trainingType,
      availableTimeMinutes: params.availableTimeMinutes,
      exercises: exercises.map((target, index) => ({
        dayIndex: 0,
        dayAvailableTimeMinutes: params.availableTimeMinutes,
        input: params.exercises[index]!,
        target,
      })),
    });

    exercises = allocationResult.exercises.map((exercise) => exercise.target);

    if (allocationResult.rulesApplied.includes('weekly_minimum_allocation')) {
      rulesApplied.push('weekly_minimum_allocation');
    }
  }

  const refreshExerciseEstimates = () => {
    const supersetCounts = new Map<string, number>();
    for (const exercise of exercises) {
      if (!exercise.supersetGroup) continue;
      supersetCounts.set(exercise.supersetGroup, (supersetCounts.get(exercise.supersetGroup) ?? 0) + 1);
    }

    for (const exercise of exercises) {
      if (params.trainingType === 'hypertrophy') {
        exercise.estimatedDurationSeconds = estimateHypertrophyExerciseDurationSeconds(
          exercise.sets,
          exercise.movementType
        );
        continue;
      }

      const hasValidSupersetPair =
        exercise.supersetGroup !== undefined && (supersetCounts.get(exercise.supersetGroup) ?? 0) === 2;
      const restMultiplier = hasValidSupersetPair ? 0.5 : 1;
      exercise.estimatedDurationSeconds = estimateExerciseDurationSeconds(
        exercise.sets,
        exercise.reps,
        exercise.movementType,
        exercise.restSeconds,
        restMultiplier
      );
    }
  };

  const estimateTotal = () => {
    refreshExerciseEstimates();
    return estimateWorkoutDurationSeconds(params.trainingType, exercises);
  };

  const removeExerciseIndexes = (indexes: number[]) => {
    const toRemove = new Set(indexes);
    if (toRemove.size === 0) {
      return;
    }

    const nextExercises: WorkoutTargetExercise[] = [];
    const nextInputs: WorkoutTargetInputExercise[] = [];

    for (let index = 0; index < exercises.length; index += 1) {
      if (toRemove.has(index)) {
        removedExerciseIds.push(exercises[index]!.exerciseId);
        continue;
      }

      nextExercises.push(exercises[index]!);
      const inputExercise = params.exercises[index];
      if (inputExercise) {
        nextInputs.push(inputExercise);
      }
    }

    exercises = nextExercises;
    params.exercises = nextInputs;
  };

  const reduceVolumeBySets = (minSetsPerExercise: number) => {
    const overshootSeconds = totalDuration - durationLimitSeconds;
    if (durationLimitSeconds <= 0 || overshootSeconds <= 0) {
      return false;
    }

    const candidates = exercises
      .map((exercise, index) => {
        const activePerSetSeconds = estimateActiveTimePerSetSeconds(exercise.reps, exercise.movementType);
        const perSetSavingsSeconds =
          params.trainingType === 'hypertrophy'
            ? estimateHypertrophyExerciseDurationSeconds(1, exercise.movementType)
            : activePerSetSeconds + exercise.restSeconds;

        return {
          index,
          perSetSavingsSeconds,
          removableSets: Math.max(0, exercise.sets - minSetsPerExercise),
          movementType: exercise.movementType,
        };
      })
      .filter((candidate) => candidate.removableSets > 0)
      .sort((left, right) => {
        if (right.perSetSavingsSeconds !== left.perSetSavingsSeconds) {
          return right.perSetSavingsSeconds - left.perSetSavingsSeconds;
        }

        if (left.movementType !== right.movementType) {
          return left.movementType === 'isolation' ? -1 : 1;
        }

        return left.index - right.index;
      });

    let remainingOvershoot = overshootSeconds;
    let changed = false;

    for (const candidate of candidates) {
      if (remainingOvershoot <= 0) {
        break;
      }

      const exercise = exercises[candidate.index];
      if (!exercise) {
        continue;
      }

      const requiredSetDrops = Math.ceil(remainingOvershoot / candidate.perSetSavingsSeconds);
      const setDrops = Math.min(candidate.removableSets, requiredSetDrops);
      if (setDrops <= 0) {
        continue;
      }

      exercise.sets -= setDrops;
      remainingOvershoot -= setDrops * candidate.perSetSavingsSeconds;
      changed = true;
    }

    return changed;
  };

  const compressRestToLimit = () => {
    const overshootSeconds = totalDuration - durationLimitSeconds;
    if (durationLimitSeconds <= 0 || overshootSeconds <= 0) {
      return false;
    }

    let reducibleRestSeconds = 0;
    for (const exercise of exercises) {
      const restSegments = Math.max(0, exercise.sets - 1);
      if (restSegments === 0) {
        continue;
      }

      reducibleRestSeconds += restSegments * Math.max(0, exercise.restSeconds - profile.minRestSeconds);
    }

    if (reducibleRestSeconds <= 0) {
      return false;
    }

    const ratio = Math.min(1, overshootSeconds / reducibleRestSeconds);
    let changed = false;

    for (const exercise of exercises) {
      const reduciblePerRest = Math.max(0, exercise.restSeconds - profile.minRestSeconds);
      if (reduciblePerRest <= 0) {
        continue;
      }

      const reduction = Math.floor(reduciblePerRest * ratio);
      if (reduction <= 0) {
        continue;
      }

      exercise.restSeconds = Math.max(profile.minRestSeconds, exercise.restSeconds - reduction);
      changed = true;
    }

    totalDuration = estimateTotal();

    const residualOvershoot = totalDuration - durationLimitSeconds;
    if (residualOvershoot > 0) {
      const prioritized = exercises
        .map((exercise, index) => ({
          index,
          segments: Math.max(0, exercise.sets - 1),
          reducible: Math.max(0, exercise.restSeconds - profile.minRestSeconds),
        }))
        .filter((entry) => entry.segments > 0 && entry.reducible > 0)
        .sort((left, right) => {
          if (right.segments !== left.segments) {
            return right.segments - left.segments;
          }

          return right.reducible - left.reducible;
        });

      let remaining = residualOvershoot;
      for (const entry of prioritized) {
        if (remaining <= 0) {
          break;
        }

        const exercise = exercises[entry.index];
        if (!exercise) {
          continue;
        }

        const neededReductionPerRest = Math.ceil(remaining / entry.segments);
        const additionalReduction = Math.min(entry.reducible, neededReductionPerRest);
        if (additionalReduction <= 0) {
          continue;
        }

        exercise.restSeconds = Math.max(profile.minRestSeconds, exercise.restSeconds - additionalReduction);
        remaining -= additionalReduction * entry.segments;
        changed = true;
      }
    }

    return changed;
  };

  const cullExercisesToLimit = () => {
    const overshootSeconds = totalDuration - durationLimitSeconds;
    if (durationLimitSeconds <= 0 || overshootSeconds <= 0 || exercises.length <= minimumExerciseCount) {
      return false;
    }

    refreshExerciseEstimates();

    const removalCandidates = exercises
      .map((exercise, index) => ({
        index,
        movementType: exercise.movementType,
        estimatedDurationSeconds: exercise.estimatedDurationSeconds,
      }))
      .sort((left, right) => {
        if (left.movementType !== right.movementType) {
          return left.movementType === 'isolation' ? -1 : 1;
        }

        if (right.estimatedDurationSeconds !== left.estimatedDurationSeconds) {
          return right.estimatedDurationSeconds - left.estimatedDurationSeconds;
        }

        return left.index - right.index;
      });

    let remainingOvershoot = overshootSeconds;
    let remainingAllowedRemovals = exercises.length - minimumExerciseCount;
    const indexesToRemove: number[] = [];

    for (const candidate of removalCandidates) {
      if (remainingOvershoot <= 0 || remainingAllowedRemovals <= 0) {
        break;
      }

      indexesToRemove.push(candidate.index);
      remainingOvershoot -= candidate.estimatedDurationSeconds;
      remainingAllowedRemovals -= 1;
    }

    if (indexesToRemove.length === 0) {
      return false;
    }

    removeExerciseIndexes(indexesToRemove);
    return true;
  };

  const getMaxSetsCap = (movementType: MovementType): number => {
    return getMaxSetsCapForTrainingType(params.trainingType, movementType);
  };

  const expandVolumeToTarget = () => {
    if (durationLimitSeconds <= 0 || totalDuration >= targetLowerBoundSeconds) {
      return false;
    }

    const candidates = exercises
      .map((exercise, index) => {
        const activePerSetSeconds = estimateActiveTimePerSetSeconds(exercise.reps, exercise.movementType);
        const perSetGainSeconds =
          params.trainingType === 'hypertrophy'
            ? estimateHypertrophyExerciseDurationSeconds(1, exercise.movementType)
            : activePerSetSeconds + exercise.restSeconds;
        const maxSetCap = getMaxSetsCap(exercise.movementType);
        const addableSets = Math.max(0, maxSetCap - exercise.sets);

        return {
          index,
          perSetGainSeconds,
          addableSets,
          movementType: exercise.movementType,
        };
      })
      .filter((candidate) => candidate.addableSets > 0)
      .sort((left, right) => {
        if (right.perSetGainSeconds !== left.perSetGainSeconds) {
          return right.perSetGainSeconds - left.perSetGainSeconds;
        }

        if (left.movementType !== right.movementType) {
          return left.movementType === 'compound' ? -1 : 1;
        }

        return left.index - right.index;
      });

    let remainingUnderTarget = targetLowerBoundSeconds - totalDuration;
    let changed = false;

    for (const candidate of candidates) {
      if (remainingUnderTarget <= 0) {
        break;
      }

      const exercise = exercises[candidate.index];
      if (!exercise) {
        continue;
      }

      const neededSetAdds = Math.ceil(remainingUnderTarget / candidate.perSetGainSeconds);
      const setAdds = Math.min(candidate.addableSets, neededSetAdds);
      if (setAdds <= 0) {
        continue;
      }

      exercise.sets += setAdds;
      remainingUnderTarget -= setAdds * candidate.perSetGainSeconds;
      changed = true;
    }

    return changed;
  };

  let totalDuration = estimateTotal();

  const expandedVolume = expandVolumeToTarget();
  if (expandedVolume) {
    totalDuration = estimateTotal();
  }

  if (params.trainingType === 'hypertrophy') {
    if (totalDuration > durationLimitSeconds) {
      const reducedVolume = reduceVolumeBySets(1);
      totalDuration = estimateTotal();

      if (reducedVolume) {
        rulesApplied.push('drop_volume');
      }

      if (totalDuration > durationLimitSeconds && exercises.length > 1) {
        const culled = cullExercisesToLimit();
        if (culled) {
          rulesApplied.push('cull_accessories');
          totalDuration = estimateTotal();
        }
      }
    }
  } else {
    if (totalDuration > durationLimitSeconds) {
      const reducedVolume = reduceVolumeBySets(profile.minSets);
      totalDuration = estimateTotal();

      if (reducedVolume) {
        rulesApplied.push('drop_volume');
      }
    }

    if (totalDuration > durationLimitSeconds) {
      const compressedRest = compressRestToLimit();
      totalDuration = estimateTotal();

      if (compressedRest) {
        rulesApplied.push('compress_rest');
      }
    }

    if (totalDuration >= durationLimitSeconds) {
      const supersetsApplied = applySupersetPairing(exercises, params.exercises);
      totalDuration = estimateTotal();
      if (supersetsApplied) {
        rulesApplied.push('supersets');
      }
    }

    if (totalDuration >= durationLimitSeconds && exercises.length > 1) {
      const culled = cullExercisesToLimit();
      if (culled) {
        applySupersetPairing(exercises, params.exercises);
        totalDuration = estimateTotal();
        rulesApplied.push('cull_accessories');
      }
    }
  }

  refreshExerciseEstimates();
  totalDuration = estimateWorkoutDurationSeconds(params.trainingType, exercises);

  return {
    trainingType: params.trainingType,
    exercises,
    estimatedDurationSeconds: totalDuration,
    rulesApplied,
    removedExerciseIds,
  };
}
