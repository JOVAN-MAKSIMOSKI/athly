import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UserModel, ExperienceLevel } from '../../database/models/UserSchema.js';
import { UserExerciseModel } from '../../database/models/UserExerciseSchema.js';
import { ExerciseModel } from '../../database/models/ExerciseSchema.js';
import type { Repetitions } from '../../domain/exercises/types.js';
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

const CompletedSetSchema = z.object({
  weight: z.number().min(0).describe('Weight used for this set in kg'),
  reps: z.number().int().min(0).describe('Reps completed for this set'),
  rest: z.number().int().min(0).describe('Rest duration after this set in seconds'),
});

const ExerciseReferenceSchema = z
  .object({
    exerciseId: ObjectIdSchema.optional().describe('Exercise reference id when known'),
    exerciseName: z.string().min(1).optional().describe('Exercise name when id is not available'),
  })
  .refine((value) => Boolean(value.exerciseId || value.exerciseName), {
    message: 'Either exerciseId or exerciseName is required',
  });

const CompletedExerciseSchema = ExerciseReferenceSchema.extend({
  sets: z.array(CompletedSetSchema).min(1).describe('All completed sets for this exercise'),
});

const ExercisesInputSchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return value;

  const flattened = value.flatMap((item) => (Array.isArray(item) ? item : [item]));
  return flattened;
}, z.array(CompletedExerciseSchema).min(1));

const TrackProgressIntermediateAdvancedInputSchema = z
  .object({
    userId: ObjectIdSchema.describe('User ObjectId for progress tracking'),
    exercises: ExercisesInputSchema,
  })
  .describe('Per-exercise completed set stats for tracking personal best updates');

const trackProgressIntermediateAdvancedToolDefinition = {
  name: 'athly.track_progress_intermediate_advanced',
  description: 'Tracks per-set workout stats and updates personal best records. RESPONSE FORMAT: Return JSON only in content[0].text with {"success":true,"data":[...]} on success, or {"code":"...","message":"..."} with isError=true on failure. Do not include markdown, emojis, or narrative text.',
  inputSchema: TrackProgressIntermediateAdvancedInputSchema,
  restricted: false,
};

function repsToNumber(reps: Repetitions | undefined): number {
  if (reps === undefined || reps === null) return 0;
  if (typeof reps === 'number') return reps;
  if (reps === 'FAILURE') return 0;

  const match = reps.match(/^(\d+)-(\d+)$/);
  if (!match) return 0;
  return Number(match[2]);
}

function getPreviousTotalReps(reps: Repetitions | undefined, sets: number | undefined): number {
  const repsValue = repsToNumber(reps);
  const setsValue = sets ?? 1;
  return repsValue * setsValue;
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

export function registerTrackProgressIntermediateAdvancedTool(server: McpServer) {
  const logToInspector = async (level: 'debug' | 'info' | 'warning' | 'error', data: unknown) => {
    try {
      await server.sendLoggingMessage({
        level,
        logger: trackProgressIntermediateAdvancedToolDefinition.name,
        data,
      });
    } catch {
      // Best-effort logging only.
    }
  };

  server.registerTool(
    trackProgressIntermediateAdvancedToolDefinition.name,
    {
      description: trackProgressIntermediateAdvancedToolDefinition.description,
      inputSchema: trackProgressIntermediateAdvancedToolDefinition.inputSchema,
    },
    async (args): Promise<ToolResponse> => {
      try {
        const parsed = TrackProgressIntermediateAdvancedInputSchema.parse(args);
        await logToInspector('debug', { event: 'input', payload: parsed });

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
          parsed.exercises.map(async (exercise) => {
            const resolvedExerciseId = resolveExerciseId({
              exerciseId: exercise.exerciseId,
              exerciseName: exercise.exerciseName,
            });

            if (!resolvedExerciseId) {
              return {
                exerciseId: exercise.exerciseId ?? exercise.exerciseName ?? 'unknown',
                updated: false,
                personalBestUpdated: false,
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
                personalBestUpdated: false,
                reason: 'USER_EXERCISE_NOT_FOUND',
              };
            }

            const performedTotalReps = exercise.sets.reduce((sum, setItem) => sum + setItem.reps, 0);
            const performedMaxWeight = exercise.sets.reduce(
              (max, setItem) => (setItem.weight > max ? setItem.weight : max),
              0
            );

            const currentBest = doc.personalBest;
            const currentBestWeight = currentBest?.weight ?? 0;
            const currentBestTotalReps = getPreviousTotalReps(
              currentBest?.reps as Repetitions | undefined,
              currentBest?.sets
            );

            const personalBestMissingOrZero =
              !currentBest ||
              currentBest.weight === undefined ||
              currentBest.weight === null ||
              currentBest.weight <= 0;

            let shouldUpdatePersonalBest = false;
            if (personalBestMissingOrZero) {
              shouldUpdatePersonalBest = true;
            } else if (performedMaxWeight > currentBestWeight) {
              shouldUpdatePersonalBest = true;
            } else if (performedMaxWeight === currentBestWeight && performedTotalReps > currentBestTotalReps) {
              shouldUpdatePersonalBest = true;
            }

            if (shouldUpdatePersonalBest) {
              await UserExerciseModel.updateOne(
                { _id: doc._id },
                {
                  $set: {
                    personalBest: {
                      weight: performedMaxWeight,
                      reps: performedTotalReps,
                      sets: 1,
                      date: new Date(),
                    },
                  },
                }
              );
            }

            return {
              exerciseId: resolvedExerciseId,
              updated: shouldUpdatePersonalBest,
              personalBestUpdated: shouldUpdatePersonalBest,
              isBeginner,
              autoPromotedToIntermediate: progression.promoted,
              summary: {
                performedMaxWeight,
                performedTotalReps,
              },
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
                    'Could not log progression because one or more user exercise cards were not found for the provided userId and exerciseId pairs.',
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
              text: JSON.stringify({ code: 'TRACK_PROGRESS_INTERMEDIATE_ADVANCED_FAILED', message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
