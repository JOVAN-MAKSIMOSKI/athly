import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UserModel } from '../../database/models/UserSchema.js';
import { WORKOUT_SPLIT_VALUES, type WorkoutSplit } from '../../domain/users/workoutSplits.js';
import { ensureUserExperienceLevel } from '../../domain/users/experienceProgression.js';
import {
  generateWorkoutDayForUser,
  type GenerateWorkoutDayResult,
} from './generateWorkout.tool.js';

type ToolTextContent = { type: 'text'; text: string };

type ToolResponse = {
  content: ToolTextContent[];
  isError?: true;
};

type SplitDayPlan = {
  dayIndex: number;
  label: string;
  request: string;
};

const ObjectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex ObjectId')
  .describe('MongoDB ObjectId string reference');

const SplitPlannerInputSchema = z
  .object({
    userId: ObjectIdSchema.describe('User ObjectId to create split plan for'),
    split: z.enum(WORKOUT_SPLIT_VALUES).optional().describe('Optional split override; defaults to profile.WorkoutSplit'),
    startDate: z
      .string()
      .datetime()
      .optional()
      .describe('Optional ISO datetime for first planned day. Defaults to now.'),
    createPlaceholders: z
      .boolean()
      .optional()
      .default(true)
      .describe('If true, generate and save full workouts with exercises for all split days.'),
  })
  .describe('Inputs for split-wide workout planning');

const splitPlannerToolDefinition = {
  name: 'athly.plan_split_workouts',
  description:
    'Plans all days for the selected split in one call and can create planned workout placeholders for each day. RESPONSE FORMAT: Return JSON only in content[0].text with {"success":true,"data":{...}} on success, or {"code":"...","message":"..."} with isError=true on failure. Do not include markdown, emojis, or narrative text.',
  inputSchema: SplitPlannerInputSchema,
  restricted: false,
};

function buildSplitDayPlans(split: WorkoutSplit): SplitDayPlan[] {
  switch (split) {
    case 'U/L':
      return [
        { dayIndex: 1, label: 'Upper Body', request: 'upper body hypertrophy session' },
        { dayIndex: 2, label: 'Lower Body', request: 'lower body hypertrophy session' },
      ];
    case 'PPL':
      return [
        { dayIndex: 1, label: 'Push', request: 'push day hypertrophy session' },
        { dayIndex: 2, label: 'Pull', request: 'pull day hypertrophy session' },
        { dayIndex: 3, label: 'Legs', request: 'leg day hypertrophy session' },
      ];
    case 'Chest and biceps/Back and triceps/Legs':
      return [
        { dayIndex: 1, label: 'Chest and Biceps', request: 'chest and biceps hypertrophy session' },
        { dayIndex: 2, label: 'Back and Triceps', request: 'back and triceps hypertrophy session' },
        { dayIndex: 3, label: 'Legs', request: 'leg day hypertrophy session' },
      ];
    case 'Upper/Lower/Full body':
      return [
        { dayIndex: 1, label: 'Upper Body', request: 'upper body hypertrophy session' },
        { dayIndex: 2, label: 'Lower Body', request: 'lower body hypertrophy session' },
        { dayIndex: 3, label: 'Full Body', request: 'full body hypertrophy session' },
      ];
    case 'UL/UL':
      return [
        { dayIndex: 1, label: 'Upper Body A', request: 'upper body hypertrophy session A' },
        { dayIndex: 2, label: 'Lower Body A', request: 'lower body hypertrophy session A' },
        { dayIndex: 3, label: 'Upper Body B', request: 'upper body hypertrophy session B' },
        { dayIndex: 4, label: 'Lower Body B', request: 'lower body hypertrophy session B' },
      ];
    case 'PPL/Upper body':
      return [
        { dayIndex: 1, label: 'Push', request: 'push day hypertrophy session' },
        { dayIndex: 2, label: 'Pull', request: 'pull day hypertrophy session' },
        { dayIndex: 3, label: 'Legs', request: 'leg day hypertrophy session' },
        { dayIndex: 4, label: 'Upper Body', request: 'upper body hypertrophy session' },
      ];
    case 'Torso/Limbs':
      return [
        { dayIndex: 1, label: 'Torso', request: 'upper torso hypertrophy session' },
        { dayIndex: 2, label: 'Limbs', request: 'arms and legs hypertrophy session' },
      ];
    case 'PPL/UL':
      return [
        { dayIndex: 1, label: 'Push', request: 'push day hypertrophy session' },
        { dayIndex: 2, label: 'Pull', request: 'pull day hypertrophy session' },
        { dayIndex: 3, label: 'Legs', request: 'leg day hypertrophy session' },
        { dayIndex: 4, label: 'Upper Body', request: 'upper body hypertrophy session' },
        { dayIndex: 5, label: 'Lower Body', request: 'lower body hypertrophy session' },
      ];
    case 'PPL/Arnold':
      return [
        { dayIndex: 1, label: 'Push', request: 'push day hypertrophy session' },
        { dayIndex: 2, label: 'Pull', request: 'pull day hypertrophy session' },
        { dayIndex: 3, label: 'Legs', request: 'leg day hypertrophy session' },
        { dayIndex: 4, label: 'Chest and Back', request: 'chest and back hypertrophy session' },
        { dayIndex: 5, label: 'Shoulders and Arms', request: 'shoulders and arms hypertrophy session' },
      ];
    case 'PPL/PPL':
      return [
        { dayIndex: 1, label: 'Push A', request: 'push day hypertrophy session A' },
        { dayIndex: 2, label: 'Pull A', request: 'pull day hypertrophy session A' },
        { dayIndex: 3, label: 'Legs A', request: 'leg day hypertrophy session A' },
        { dayIndex: 4, label: 'Push B', request: 'push day hypertrophy session B' },
        { dayIndex: 5, label: 'Pull B', request: 'pull day hypertrophy session B' },
        { dayIndex: 6, label: 'Legs B', request: 'leg day hypertrophy session B' },
      ];
    case 'UL/UL/UL':
      return [
        { dayIndex: 1, label: 'Upper A', request: 'upper body hypertrophy session A' },
        { dayIndex: 2, label: 'Lower A', request: 'lower body hypertrophy session A' },
        { dayIndex: 3, label: 'Upper B', request: 'upper body hypertrophy session B' },
        { dayIndex: 4, label: 'Lower B', request: 'lower body hypertrophy session B' },
        { dayIndex: 5, label: 'Upper C', request: 'upper body hypertrophy session C' },
        { dayIndex: 6, label: 'Lower C', request: 'lower body hypertrophy session C' },
      ];
    default:
      return [
        { dayIndex: 1, label: 'Push', request: 'push day hypertrophy session' },
        { dayIndex: 2, label: 'Pull', request: 'pull day hypertrophy session' },
        { dayIndex: 3, label: 'Legs', request: 'leg day hypertrophy session' },
      ];
  }
}

export function registerSplitPlannerTool(server: McpServer) {
  const logToInspector = async (level: 'debug' | 'info' | 'warning' | 'error', data: unknown) => {
    try {
      await server.sendLoggingMessage({
        level,
        logger: splitPlannerToolDefinition.name,
        data,
      });
    } catch {
      // Best-effort logging only.
    }
  };

  server.registerTool(
    splitPlannerToolDefinition.name,
    {
      description: splitPlannerToolDefinition.description,
      inputSchema: splitPlannerToolDefinition.inputSchema,
    },
    async (args): Promise<ToolResponse> => {
      try {
        const parsed = SplitPlannerInputSchema.parse(args);
        await logToInspector('debug', { event: 'input', payload: parsed });

        const user = await UserModel.findById(parsed.userId)
          .select('name profile createdAt')
          .lean();

        if (!user) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ code: 'USER_NOT_FOUND', message: 'User not found' }) }],
            isError: true,
          };
        }

        const progression = await ensureUserExperienceLevel(user);
        const experienceLevel = progression.experienceLevel ?? user.profile?.experienceLevel;

        const split = parsed.split ?? user.profile?.WorkoutSplit;
        if (!split) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ code: 'SPLIT_NOT_SET', message: 'No split selected for this user' }) }],
            isError: true,
          };
        }

        const dayPlans = buildSplitDayPlans(split);
        const baseDate = parsed.startDate ? new Date(parsed.startDate) : new Date();

        type PlannedDay = {
          dayIndex: number;
          label: string;
          request: string;
          startTime: string;
          workoutId?: string;
          trainingType?: string;
          exerciseCount?: number;
          estimatedWorkoutTimeToFinish?: number;
        };

        const plannedWorkouts: PlannedDay[] = [];
        const generatedResults: GenerateWorkoutDayResult[] = [];

        for (const day of dayPlans) {
          const startTime = new Date(baseDate);
          startTime.setDate(baseDate.getDate() + (day.dayIndex - 1));

          if (parsed.createPlaceholders) {
            const result = await generateWorkoutDayForUser({
              userId: parsed.userId,
              request: day.request,
              user,
              experienceLevel,
              logFn: logToInspector,
            });

            generatedResults.push(result);
            plannedWorkouts.push({
              dayIndex: day.dayIndex,
              label: day.label,
              request: day.request,
              startTime: startTime.toISOString(),
              workoutId: result.workoutId,
              trainingType: result.trainingType,
              exerciseCount: result.exercises.length,
              estimatedWorkoutTimeToFinish: result.estimatedWorkoutTimeToFinish,
            });
          } else {
            plannedWorkouts.push({
              dayIndex: day.dayIndex,
              label: day.label,
              request: day.request,
              startTime: startTime.toISOString(),
            });
          }
        }

        // Aggregate weekly set totals across all generated days for observability.
        const weeklySetTotals: Record<string, number> = {};
        for (const result of generatedResults) {
          for (const exercise of result.exercises) {
            const key = exercise.targetMuscle;
            weeklySetTotals[key] = (weeklySetTotals[key] ?? 0) + exercise.sets;
          }
        }

        const responsePayload = {
          success: true,
          data: {
            userId: parsed.userId,
            split,
            dayCount: dayPlans.length,
            workoutsGenerated: parsed.createPlaceholders,
            weeklySetTotals: parsed.createPlaceholders ? weeklySetTotals : undefined,
            days: plannedWorkouts,
          },
        };

        await logToInspector('info', {
          event: 'split_planned',
          userId: parsed.userId,
          split,
          dayCount: dayPlans.length,
          placeholdersCreated: parsed.createPlaceholders,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(responsePayload) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await logToInspector('error', { event: 'error', message });

        return {
          content: [{ type: 'text', text: JSON.stringify({ code: 'SPLIT_PLANNER_FAILED', message }) }],
          isError: true,
        };
      }
    }
  );
}
