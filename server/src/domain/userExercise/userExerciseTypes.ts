import { z } from 'zod';
import { RepRangeSchema, RepetitionsSchema } from '../exercises/types.js';

const ObjectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex ObjectId')
  .describe('MongoDB ObjectId string reference');

export const ProgressionMethodEnum = z.enum(['rpe', 'rep_range', 'two_x_to_failure']);
export type ProgressionMethod = z.infer<typeof ProgressionMethodEnum>;

export const UserExerciseCurrentTargetSchema = z
  .object({
    weight: z.number().min(0).describe('Target working weight in kg'),
    progressionMethod: ProgressionMethodEnum.describe('Progression method: use "rpe", "rep_range", or "two_x_to_failure"'),
    reps: RepetitionsSchema.optional().describe('Target repetitions or rep range (optional for beginner RPE progression)'),
    sets: z.number().int().min(1).describe('Target sets count, minimum 1'),
    beginnerLastBumpAt: z.date().optional().describe('Last time beginner progression increased target weight'),
    rpe: z.number().min(1).max(10).optional().describe('Target intensity on the RPE scale (optional for rep-range progression)'),
    restSeconds: z.number().int().min(0).optional().describe('Rest time between sets in seconds'),
    rirMin: z.number().min(0).max(6).optional().describe('Minimum reps in reserve target'),
    rirMax: z.number().min(0).max(6).optional().describe('Maximum reps in reserve target'),
    trainingType: z.enum(['hypertrophy', 'strength', 'endurance', 'mobility']).optional().describe('Baseline training style used for target generation'),
    supersetGroup: z.string().optional().describe('Superset pairing label for antagonistic exercise pairs'),
  })
  .superRefine((data, ctx) => {
    if (data.progressionMethod === 'rpe' && data.rpe === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rpe'],
        message: 'rpe is required when progressionMethod is "rpe"',
      });
    }

    if (data.progressionMethod === 'rep_range') {
      if (typeof data.reps !== 'string' || !RepRangeSchema.safeParse(data.reps).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reps'],
          message: 'reps must be a rep range like "8-12" when progressionMethod is "rep_range"',
        });
      }
    }

    if (data.progressionMethod === 'two_x_to_failure') {
      if (data.reps !== 'FAILURE') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reps'],
          message: 'reps must be "FAILURE" when progressionMethod is "two_x_to_failure"',
        });
      }

      if (data.sets !== 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sets'],
          message: 'sets must be 2 when progressionMethod is "two_x_to_failure"',
        });
      }
    }
  });

export const UserExercisePersonalBestSchema = z.object({
  weight: z.number().min(0).describe('Best recorded weight in kg'),
  reps: RepetitionsSchema.describe('Repetitions performed for the personal best'),
  sets: z.number().int().min(1).optional().describe('Sets performed for the personal best'),
  date: z.date().describe('Date when the personal best was recorded'),
});

export const UserExerciseSettingsSchema = z.object({
  isFavorite: z.boolean().describe('Whether the user marked this exercise as a favorite'),
  notes: z.string().optional().describe('Optional user notes for cues or equipment'),
});

export const UserExerciseSchema = z.object({
  id: z.string().optional().describe('UserExercise document id'),
  userId: ObjectIdSchema.describe('Owning user reference'),
  exerciseId: ObjectIdSchema.describe('Referenced exercise reference'),
  currentTarget: UserExerciseCurrentTargetSchema,
  personalBest: UserExercisePersonalBestSchema.optional(),
  settings: UserExerciseSettingsSchema,
  createdAt: z.date().optional().describe('Document creation timestamp'),
  updatedAt: z.date().optional().describe('Document update timestamp'),
});

export type UserExercise = z.infer<typeof UserExerciseSchema>;

export const CreateUserExerciseSchema = UserExerciseSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateUserExerciseInput = z.infer<typeof CreateUserExerciseSchema>;

export const UpdateUserExerciseSchema = CreateUserExerciseSchema.partial();

export type UpdateUserExerciseInput = z.infer<typeof UpdateUserExerciseSchema>;
