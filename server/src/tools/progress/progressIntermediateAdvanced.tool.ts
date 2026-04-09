import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UserModel, ExperienceLevel } from '../../database/models/UserSchema.js';
import { UserExerciseModel } from '../../database/models/UserExerciseSchema.js';
import { ExerciseModel } from '../../database/models/ExerciseSchema.js';
import { RepetitionsSchema } from '../../domain/exercises/types.js';
import { ensureUserExperienceLevel } from '../../domain/users/experienceProgression.js';

type ToolTextContent = { type: 'text'; text: string };

type ToolResponse = {
  content: ToolTextContent[];
  isError?: true;
};

const ObjectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex ObjectId')
  .describe('MongoDB ObjectId string reference');

const ExerciseReferenceSchema = z
  .object({
    exerciseId: ObjectIdSchema.optional().describe('Exercise reference id when known'),
    exerciseName: z.string().min(1).optional().describe('Exercise name when id is not available'),
  })
  .refine((value) => Boolean(value.exerciseId || value.exerciseName), {
    message: 'Either exerciseId or exerciseName is required',
  });

const WorkoutExerciseStatsSchema = ExerciseReferenceSchema.extend({
  weight: z.number().min(0).describe('Weight used for the exercise'),
  reps: RepetitionsSchema.describe('Repetitions achieved for the exercise'),
  sets: z.number().int().min(1).describe('Total sets completed'),
});

const CompletedSetSchema = z.object({
  weight: z.number().min(0).describe('Weight used for this set in kg'),
  reps: RepetitionsSchema.describe('Reps completed for this set'),
  rest: z.number().int().min(0).describe('Rest duration after this set in seconds'),
});

const WorkoutExerciseDetailedStatsSchema = ExerciseReferenceSchema.extend({
  sets: z.array(CompletedSetSchema).min(1).describe('All completed sets for this exercise'),
});

const ExercisesInputSchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return value;
  return value.flatMap((item) => (Array.isArray(item) ? item : [item]));
}, z.array(z.union([WorkoutExerciseStatsSchema, WorkoutExerciseDetailedStatsSchema])).min(1));

const ProgressIntermediateAdvancedInputSchema = z
  .object({
    userId: ObjectIdSchema.describe('User ObjectId for progress update'),
    exercises: ExercisesInputSchema,
  })
  .describe('Inputs for updating personal best and targets for intermediate/advanced users');

const progressIntermediateAdvancedToolDefinition = {
  name: 'athly.progress_intermediate_advanced',
  description: 'Updates personal bests and progression targets based on completed workout stats. RESPONSE FORMAT: Return JSON only in content[0].text with {"success":true,"data":[...]} on success, or {"code":"...","message":"..."} with isError=true on failure. Do not include markdown, emojis, or narrative text.',
  inputSchema: ProgressIntermediateAdvancedInputSchema,
  restricted: false,
};

type RepsValue = number | 'FAILURE' | string;

type NormalizedExerciseStats = {
  exerciseId?: string;
  exerciseName?: string;
  weight: number;
  reps: RepsValue;
  sets: number;
};

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const BEGINNER_BUMP_INCREMENT_KG = parsePositiveNumber(process.env.BEGINNER_BUMP_INCREMENT_KG, 2.5);
const BEGINNER_BUMP_INTERVAL_DAYS = parsePositiveNumber(process.env.BEGINNER_BUMP_INTERVAL_DAYS, 14);

function getMaxReps(reps: RepsValue | undefined): number | null {
  if (reps === undefined || reps === null) return null;
  if (typeof reps === 'number') return reps;
  if (reps === 'FAILURE') return null;
  const match = reps.match(/^(\d+)-(\d+)$/);
  if (!match) return null;
  return Number(match[2]);
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreNameMatch(query: string, candidate: string): number {
  const left = normalizeName(query);
  const right = normalizeName(candidate);

  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  if (right.includes(left) || left.includes(right)) {
    return 0.9;
  }

  const leftTokens = left.split(' ').filter((entry) => entry.length > 1);
  const rightTokens = right.split(' ').filter((entry) => entry.length > 1);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  const denominator = Math.max(leftTokens.length, rightTokens.length);
  return overlap / denominator;
}

export function registerProgressIntermediateAdvancedTool(server: McpServer) {
  const logToInspector = async (level: 'debug' | 'info' | 'warning' | 'error', data: unknown) => {
    try {
      await server.sendLoggingMessage({
        level,
        logger: progressIntermediateAdvancedToolDefinition.name,
        data,
      });
    } catch {
      // Best-effort logging only.
    }
  };

  server.registerTool(
    progressIntermediateAdvancedToolDefinition.name,
    {
      description: progressIntermediateAdvancedToolDefinition.description,
      inputSchema: progressIntermediateAdvancedToolDefinition.inputSchema,
    },
    async (args): Promise<ToolResponse> => {
      try {
        const parsed = ProgressIntermediateAdvancedInputSchema.parse(args);
        await logToInspector('debug', { event: 'input', payload: parsed });

        const normalizedExercises: NormalizedExerciseStats[] = parsed.exercises.map((exercise) => {
          if ('weight' in exercise && typeof exercise.sets === 'number') {
            return {
              exerciseId: exercise.exerciseId,
              exerciseName: exercise.exerciseName,
              weight: exercise.weight,
              reps: exercise.reps as RepsValue,
              sets: exercise.sets,
            };
          }

          if (!Array.isArray(exercise.sets)) {
            return {
              exerciseId: exercise.exerciseId,
              weight: 0,
              reps: 0,
              sets: 0,
            };
          }

          const detailedSets = exercise.sets;

          const topWeight = detailedSets.reduce(
            (max, setItem) => (setItem.weight > max ? setItem.weight : max),
            0
          );

          const topRepsNumeric = detailedSets.reduce((max, setItem) => {
            const repsMax = getMaxReps(setItem.reps as RepsValue);
            return repsMax !== null && repsMax > max ? repsMax : max;
          }, 0);

          return {
            exerciseId: exercise.exerciseId,
            exerciseName: exercise.exerciseName,
            weight: topWeight,
            reps: topRepsNumeric,
            sets: detailedSets.length,
          };
        });

        const user = await UserModel.findById(parsed.userId).lean();
        if (!user) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ code: 'USER_NOT_FOUND', message: 'User not found' }),
              },
            ],
            isError: true,
          };
        }

        const progression = await ensureUserExperienceLevel(user);
        const effectiveExperienceLevel = progression.experienceLevel ?? user.profile?.experienceLevel;
        const isBeginner = effectiveExperienceLevel === ExperienceLevel.BEGINNER;

        const userExerciseCards = await UserExerciseModel.find({ userId: parsed.userId })
          .select('exerciseId')
          .lean();

        const availableExerciseIds = new Set(
          userExerciseCards
            .map((entry) => entry.exerciseId?.toString())
            .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
        );

        const knownExercises = await ExerciseModel.find({
          _id: { $in: Array.from(availableExerciseIds) },
        })
          .select('_id name')
          .lean();

        const exerciseNameById = new Map<string, string>(
          knownExercises
            .map((entry) => {
              const id = entry._id?.toString();
              const name = typeof entry.name === 'string' ? entry.name : '';
              return id && name ? ([id, name] as const) : null;
            })
            .filter((entry): entry is readonly [string, string] => entry !== null)
        );

        const resolveExerciseId = (input: { exerciseId?: string; exerciseName?: string }): string | null => {
          if (input.exerciseId && availableExerciseIds.has(input.exerciseId)) {
            return input.exerciseId;
          }

          if (!input.exerciseName) {
            return null;
          }

          let bestMatch: { id: string; score: number } | null = null;
          for (const [id, name] of exerciseNameById.entries()) {
            const score = scoreNameMatch(input.exerciseName, name);
            if (!bestMatch || score > bestMatch.score) {
              bestMatch = { id, score };
            }
          }

          return bestMatch && bestMatch.score >= 0.6 ? bestMatch.id : null;
        };

        const results = await Promise.all(
          normalizedExercises.map(async (exercise) => {
            const resolvedExerciseId = resolveExerciseId({
              exerciseId: exercise.exerciseId,
              exerciseName: exercise.exerciseName,
            });

            if (!resolvedExerciseId) {
              return {
                exerciseId: exercise.exerciseId ?? exercise.exerciseName ?? 'unknown',
                updated: false,
                reason: 'USER_EXERCISE_NOT_FOUND',
              };
            }

            const doc = await UserExerciseModel.findOne({
              userId: parsed.userId,
              exerciseId: resolvedExerciseId,
            });

            if (!doc) {
              return {
                exerciseId: resolvedExerciseId,
                updated: false,
                reason: 'USER_EXERCISE_NOT_FOUND',
              };
            }

            const updates: Record<string, unknown> = {};
            let personalBestUpdated = false;
            let weightBumped = false;
            let newTargetWeight: number | null = null;

            const performedRepsMax = getMaxReps(exercise.reps as RepsValue);
            const currentBest = doc.personalBest;
            const currentBestRepsMax = getMaxReps(currentBest?.reps as RepsValue | undefined);

            if (
              !currentBest ||
              exercise.weight > currentBest.weight ||
              (exercise.weight === currentBest.weight &&
                performedRepsMax !== null &&
                (currentBestRepsMax === null || performedRepsMax > currentBestRepsMax))
            ) {
              updates.personalBest = {
                weight: exercise.weight,
                reps: exercise.reps,
                sets: exercise.sets,
                date: new Date(),
              };
              personalBestUpdated = true;
            }

            if (!isBeginner) {
              const targetReps = doc.currentTarget?.reps as RepsValue | undefined;
              const targetMax = getMaxReps(targetReps);
              const targetWeight = doc.currentTarget?.weight ?? 0;

              if (
                targetMax !== null &&
                performedRepsMax !== null &&
                performedRepsMax >= targetMax &&
                exercise.weight >= targetWeight
              ) {
                newTargetWeight = Number((targetWeight + 2.5).toFixed(2));
                updates['currentTarget.weight'] = newTargetWeight;
                weightBumped = true;
              }
            } else {
              const targetWeight = doc.currentTarget?.weight ?? 0;

              const lastBeginnerBumpAt = doc.currentTarget?.beginnerLastBumpAt ?? doc.createdAt;
              const eligibleAt = new Date(lastBeginnerBumpAt);
              eligibleAt.setDate(eligibleAt.getDate() + BEGINNER_BUMP_INTERVAL_DAYS);

              if (
                exercise.weight >= targetWeight &&
                new Date() >= eligibleAt
              ) {
                newTargetWeight = Number((targetWeight + BEGINNER_BUMP_INCREMENT_KG).toFixed(2));
                updates['currentTarget.weight'] = newTargetWeight;
                updates['currentTarget.beginnerLastBumpAt'] = new Date();
                weightBumped = true;
              }
            }

            if (Object.keys(updates).length > 0) {
              await UserExerciseModel.updateOne({ _id: doc._id }, { $set: updates });
            }

            return {
              exerciseId: resolvedExerciseId,
              updated: Object.keys(updates).length > 0,
              personalBestUpdated,
              weightBumped,
              newTargetWeight,
              skippedForBeginner: isBeginner,
              autoPromotedToIntermediate: progression.promoted,
            };
          })
        );

        const missingExerciseIds = results
          .filter((result) => result.reason === 'USER_EXERCISE_NOT_FOUND')
          .map((result) => result.exerciseId);

        if (missingExerciseIds.length > 0) {
          await logToInspector('warning', {
            event: 'user_exercise_cards_missing',
            count: missingExerciseIds.length,
            exerciseIds: missingExerciseIds,
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  code: 'USER_EXERCISE_CARD_NOT_FOUND',
                  message:
                    'Could not apply progression updates because one or more user exercise cards were not found for the provided userId and exerciseId pairs.',
                  data: {
                    missingExerciseIds,
                  },
                }),
              },
            ],
            isError: true,
          };
        }

        await logToInspector('info', { event: 'result', count: results.length });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, data: results }),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await logToInspector('error', { event: 'error', message });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ code: 'PROGRESS_INTERMEDIATE_ADVANCED_FAILED', message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
