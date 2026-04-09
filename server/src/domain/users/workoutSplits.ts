export const WORKOUT_SPLIT_VALUES = [
  'U/L',
  'PPL',
  'Chest and biceps/Back and triceps/Legs',
  'Upper/Lower/Full body',
  'UL/UL',
  'PPL/Upper body',
  'Torso/Limbs',
  'PPL/UL',
  'PPL/Arnold',
  'PPL/PPL',
  'UL/UL/UL',
] as const;

export type WorkoutSplit = (typeof WORKOUT_SPLIT_VALUES)[number];

const SPLIT_TEXT_MATCHERS: Array<{ value: WorkoutSplit; pattern: RegExp }> = [
  { value: 'U/L', pattern: /\bu\s*\/\s*l\b|upper\s*\/\s*lower|upper\s+lower/i },
  { value: 'PPL', pattern: /\bppl\b|push\s*\/\s*pull\s*\/\s*legs|push\s+pull\s+legs/i },
  { value: 'Chest and biceps/Back and triceps/Legs', pattern: /chest\s*and\s*biceps\s*\/\s*back\s*and\s*triceps\s*\/\s*legs/i },
  { value: 'Upper/Lower/Full body', pattern: /upper\s*\/\s*lower\s*\/\s*full\s*body/i },
  { value: 'UL/UL', pattern: /\bul\s*\/\s*ul\b|upper\s*\/\s*lower\s*\/\s*upper\s*\/\s*lower/i },
  { value: 'PPL/Upper body', pattern: /ppl\s*\/\s*upper\s*body|push\s*pull\s*legs\s*\/\s*upper\s*body/i },
  { value: 'Torso/Limbs', pattern: /torso\s*\/\s*limbs/i },
  { value: 'PPL/UL', pattern: /ppl\s*\/\s*ul|push\s*pull\s*legs\s*\/\s*upper\s*lower/i },
  { value: 'PPL/Arnold', pattern: /ppl\s*\/\s*arnold|push\s*pull\s*legs\s*\/\s*arnold/i },
  { value: 'PPL/PPL', pattern: /ppl\s*\/\s*ppl|push\s*pull\s*legs\s*\/\s*push\s*pull\s*legs/i },
  { value: 'UL/UL/UL', pattern: /ul\s*\/\s*ul\s*\/\s*ul|upper\s*lower\s*\/\s*upper\s*lower\s*\/\s*upper\s*lower/i },
];

export function detectWorkoutSplitFromText(input: string): WorkoutSplit | null {
  const normalized = input.trim();
  if (normalized.length === 0) {
    return null;
  }

  const exactMatch = WORKOUT_SPLIT_VALUES.find((value) => value.toLowerCase() === normalized.toLowerCase());
  if (exactMatch) {
    return exactMatch;
  }

  const matched = SPLIT_TEXT_MATCHERS.find((entry) => entry.pattern.test(normalized));
  return matched?.value ?? null;
}