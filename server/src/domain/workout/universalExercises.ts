export const UNIVERSAL_EXERCISE_KEYWORDS: readonly string[] = [
  // legs
  'squat',
  'leg press',
  'romanian deadlift',
  'rdl',
  'deadlift',
  'split squat',
  'bulgarian split squat',
  'lunge',
  'leg extension',
  'leg curl',
  'calf raise',
  'hip abduction',
  'hip adduction',
  'hip thrust',

  // upper body
  'bench press',
  'chest press',
  'machine chest press',
  'incline bench press',
  'incline press',
  'overhead press',
  'shoulder press',
  'lateral raise',
  'dip',
  'triceps extension',
  'triceps pushdown',
  'triceps pressdown',
  'lat pulldown',
  'seated row',
  'cable row',
  'T-bar row',
  'machine row',
  'kelso shrugs',
  'bent-over row',
  'reverse pec deck',
  'rear delt fly',
  'reverse fly',
  'pec deck',
  'pull-up',
  'chin-up',
  'bicep curl',
  'barbell curl',
  'dumbbell curl',
  'cable curl',
   'preacher curl',
  'cable fly',
  'hammer curl',
 
  'bayesian curl',
] as const;

function normalizeExerciseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[-_/]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isUniversalExerciseName(exerciseName: string): boolean {
  const normalized = normalizeExerciseText(exerciseName);
  if (normalized.length === 0) {
    return false;
  }

  return UNIVERSAL_EXERCISE_KEYWORDS.some((keyword) => normalized.includes(normalizeExerciseText(keyword)));
}
