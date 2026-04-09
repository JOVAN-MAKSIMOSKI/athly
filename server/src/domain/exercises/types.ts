import { z } from 'zod';

// ============================================================================
// ENUMS & LITERALS
// ============================================================================

//**later should be renamed into categories for each muscle group  */
export const MuscleGroupEnum = z.enum([
  'upper-chest',
  'mid-chest',
  'lower-chest',
  'pecs',
  'front-delts',
  'lateral-delts',
  'rear-delts',
  'neck',
  'romboids',
  'traps',
  'middle-back',
  'lats',
  'lower-back',
  'bicep-long-head',
  'bicep-short-head',
  'brachialis',
  'brachioradialis',
  'triceps-long-head',
  'triceps-lateral-head',
  'triceps-medial-head',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'upper-abs',
  'mid-abs',
  'lower-abs',
  'obliques',
  'hips',
  'inner-thigh',
]);

export type MuscleGroup = z.infer<typeof MuscleGroupEnum>;

export const MuscleSizeCategoryEnum = z.enum(['large', 'small']);
export type MuscleSizeCategory = z.infer<typeof MuscleSizeCategoryEnum>;

export const LARGE_MUSCLE_GROUPS: readonly MuscleGroup[] = [
  'upper-chest',
  'mid-chest',
  'lower-chest',
  'pecs',
  'lats',
  'middle-back',
  'lower-back',
  'romboids',
  'traps',
  'quads',
  'hamstrings',
  'glutes',
  'inner-thigh',
];

export const SMALL_MUSCLE_GROUPS: readonly MuscleGroup[] = [
  'front-delts',
  'lateral-delts',
  'rear-delts',
  'bicep-long-head',
  'bicep-short-head',
  'brachialis',
  'brachioradialis',
  'triceps-long-head',
  'triceps-lateral-head',
  'triceps-medial-head',
  'upper-abs',
  'mid-abs',
  'lower-abs',
  'obliques',
  'calves',
  'forearms',
  'neck',
  'hips',
];

const LARGE_MUSCLE_GROUP_SET = new Set<MuscleGroup>(LARGE_MUSCLE_GROUPS);

export function isLargeMuscleGroup(muscleGroup: MuscleGroup): boolean {
  return LARGE_MUSCLE_GROUP_SET.has(muscleGroup);
}

export function isSmallMuscleGroup(muscleGroup: MuscleGroup): boolean {
  return !isLargeMuscleGroup(muscleGroup);
}

export function getMuscleSizeCategory(muscleGroup: MuscleGroup): MuscleSizeCategory {
  return isLargeMuscleGroup(muscleGroup) ? 'large' : 'small';
}

export const EquipmentEnum = z.enum([
  'barbell',
  'barbell + bench',
  'dumbbell',
  'dumbbell + bench',
  'kettlebell',
  'bodyweight',
  'machine',
  'cable',
  'smith-machine',
  'pull-up-bar',
  'resistance-band',
]);

export type Equipment = z.infer<typeof EquipmentEnum>;

export const RepRangeSchema = z
  .string()
  .regex(/^\d+-\d+$/, 'Rep range must be like "8-10"')
  .describe('Rep range progression target like "6-8" or "8-12"');

export type RepRange = z.infer<typeof RepRangeSchema>;

export const RepetitionsSchema = z.union([
  z.number().int().min(1),
  z.literal('FAILURE'),
  RepRangeSchema,
]).describe('Number of repetitions, "FAILURE", or a range like "8-10"');

export type Repetitions = z.infer<typeof RepetitionsSchema>;

// ============================================================================
// EXERCISE SCHEMA & TYPE
// ============================================================================

// NOTE: Base schema split out to avoid .omit() on refined schemas.
export const BaseExerciseSchema = z.object({
  id: z.string().describe('Unique exercise identifier'),
  name: z.string().min(1).describe('Exercise name'),
  targetMuscle: MuscleGroupEnum.describe('Primary muscle group targeted'),
  secondaryMuscles: z
    .array(MuscleGroupEnum)
    .describe('Secondary muscle groups involved'),
  equipment: EquipmentEnum.describe('Equipment required for exercise'),
 // mechanic : z.enum(['compound', 'isolation']).describe('Type of movement mechanic'),
  compound: z.boolean().describe('Whether the exercise is a compound movement'),
  force: z.enum(['push', 'pull', 'legs']).describe('Type of force applied'),
  category: z
    .array(z.enum(['strength', 'hypertrophy', 'endurance', 'mobility']))
    .min(1)
    .max(2)
    .describe('Exercise categories (primary at index 0, optional secondary at index 1)'),
  possibleInjuries: z
    .array(z.string().min(1))
    .default([])
    .describe('Possible injury areas to consider (e.g., "shoulder", "knee")'),
  formTips: z
    .array(z.string().min(1))
    .min(1)
    .describe('Array of form tips and cues for proper execution'),
  createdAt: z.date().optional().describe('Exercise creation timestamp'),
  updatedAt: z.date().optional().describe('Last exercise update timestamp'),
});

// NOTE: Shared refinement guard to keep secondary muscles clean.
const withSecondaryMuscleGuard = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((data: z.infer<T>, ctx) => {
    const secondary = (data as { secondaryMuscles?: unknown }).secondaryMuscles;
    const target = (data as { targetMuscle?: unknown }).targetMuscle;

    // Validate that secondaryMuscles don't include targetMuscle
    if (Array.isArray(secondary) && typeof target === 'string' && secondary.includes(target)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondaryMuscles'],
        message: 'Secondary muscles cannot include the target muscle',
      });
    }
  });

export const ExerciseSchema = withSecondaryMuscleGuard(BaseExerciseSchema);

export type Exercise = z.infer<typeof ExerciseSchema>;

// ============================================================================
// EXERCISE CREATION SCHEMA (for adding new exercises)
// ============================================================================

export const CreateExerciseSchema = withSecondaryMuscleGuard(BaseExerciseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}));

export type CreateExerciseInput = z.infer<typeof CreateExerciseSchema>;

// ============================================================================
// EXERCISE UPDATE SCHEMA (for updating exercises)
// ============================================================================

// NOTE: Use base schema for partial updates to avoid .partial() on refined schema.
export const UpdateExerciseSchema = withSecondaryMuscleGuard(
  BaseExerciseSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  }).partial()
);

export type UpdateExerciseInput = z.infer<typeof UpdateExerciseSchema>;

// ============================================================================
// EXERCISE LIBRARY SCHEMA (filtered by user preferences) ***MAY USE THIS ALOT IN THE FUTURE***
// ============================================================================

export const ExerciseLibraryFilterSchema = z.object({
  equipment: z.array(EquipmentEnum).optional().describe('Filter by equipment access'),
  muscleGroups: z.array(MuscleGroupEnum).optional().describe('Filter by target or secondary muscles'),
  experienceLevel: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner').describe('Filter by difficulty'),
});

export type ExerciseLibraryFilter = z.infer<typeof ExerciseLibraryFilterSchema>;
