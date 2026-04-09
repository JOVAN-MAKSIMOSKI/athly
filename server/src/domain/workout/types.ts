import { z } from 'zod';
import { RepetitionsSchema } from '../exercises/types.js';

const ObjectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex ObjectId');

// ============================================================================
// SUB-SCHEMAS
// ============================================================================

export const SetSchema = z.object({
  weight: z.number().min(0).describe('Weight used for the set in kg'),
  reps: RepetitionsSchema.optional().describe('Repetitions performed in the set (optional for beginner RPE progression)'),
  rest: z.number().int().min(0).describe('Rest duration after the set in seconds'),
  rpe: z.number().min(1).max(10).optional().describe('Rate of Perceived Exertion for the set'),
  completed: z.boolean().default(false).describe('Whether the set was completed'),
});

export type Set = z.infer<typeof SetSchema>;

export const WorkoutExerciseSchema = z.object({
  exerciseId: ObjectIdSchema.describe('Reference to the global exercise library'),
  userExerciseId: ObjectIdSchema.describe('Reference to the user-specific exercise settings'),
  sets: z.array(SetSchema).min(1).describe('Array of sets performed for this exercise'),
  notes: z.string().optional().describe('Optional notes for this exercise in the workout'),
});

export type WorkoutExercise = z.infer<typeof WorkoutExerciseSchema>;

// ============================================================================
// WORKOUT SCHEMA & TYPE
// ============================================================================

export const WorkoutSchema = z.object({
  id: z.string().optional().describe('Unique workout identifier'),
  userId: ObjectIdSchema.describe('User ObjectId reference'),
  name: z.string().min(1).default('New Workout').describe('Workout name'),
  status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).default('planned').describe('Current status of the workout'),
  startTime: z.date().optional().describe('Workout start time'),
  endTime: z.date().optional().describe('Workout end time'),
  estimatedWorkoutTimeToFinish: z.number().int().min(1).describe('Estimated time to finish the workout in minutes'),
  exercises: z.array(WorkoutExerciseSchema).describe('List of exercises performed in this workout'),
  notes: z.string().optional().describe('Optional workout notes'),
  createdAt: z.date().optional().describe('Workout creation timestamp'),
  updatedAt: z.date().optional().describe('Workout update timestamp'),
});

export type Workout = z.infer<typeof WorkoutSchema>;

// ============================================================================
// WORKOUT CREATION SCHEMA (for creating new workouts)
// ============================================================================

export const CreateWorkoutSchema = WorkoutSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  startTime: z.date().optional(),
});

export type CreateWorkoutInput = z.infer<typeof CreateWorkoutSchema>;

// ============================================================================
// WORKOUT UPDATE SCHEMA (for updating workouts)
// ============================================================================

export const UpdateWorkoutSchema = CreateWorkoutSchema.partial();

export type UpdateWorkoutInput = z.infer<typeof UpdateWorkoutSchema>;
