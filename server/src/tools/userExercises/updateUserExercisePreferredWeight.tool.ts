import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ExerciseModel } from '../../database/models/ExerciseSchema.js';
import { UserExerciseModel } from '../../database/models/UserExerciseSchema.js';

type ToolTextContent = { type: 'text'; text: string };

type ToolResponse = {
  content: ToolTextContent[];
  isError?: true;
};

const ObjectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex ObjectId')
  .describe('MongoDB ObjectId string reference');

function parsePreferredWeightKg(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    const numeric = normalized.match(/\d+(?:\.\d+)?/);
    if (numeric) {
      const parsed = Number(numeric[0]);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  }

  throw new Error('preferredWeightKg must be a non-negative number');
}

const UpdateUserExercisePreferredWeightInputSchema = z
  .object({
    userId: ObjectIdSchema.describe('User ObjectId that owns the exercise card'),
    exerciseName: z.string().min(1).describe('Exercise name to resolve into an exercise id'),
    preferredWeightKg: z.preprocess(parsePreferredWeightKg, z.number().min(0)).describe('User preferred target weight in kg'),
  })
  .describe('Inputs for updating a user exercise target weight by exercise name');

const updateUserExercisePreferredWeightToolDefinition = {
  name: 'athly.update_user_exercise_preferred_weight',
  description: 'Finds exercise by name and updates the user exercise current target weight. RESPONSE FORMAT: Return JSON only in content[0].text with {"success":true,"data":{...}} on success, or {"code":"...","message":"...","data":{...}} with isError=true on failure. Do not include markdown, emojis, or narrative text.',
  inputSchema: UpdateUserExercisePreferredWeightInputSchema,
  restricted: false,
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeName(value: string): string[] {
  return normalizeName(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function toBigrams(value: string): string[] {
  const compact = normalizeName(value).replace(/\s+/g, '');
  if (compact.length < 2) {
    return compact.length === 1 ? [compact] : [];
  }

  const bigrams: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    bigrams.push(compact.slice(index, index + 2));
  }

  return bigrams;
}

function bigramSimilarity(left: string, right: string): number {
  const leftBigrams = toBigrams(left);
  const rightBigrams = toBigrams(right);

  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return 0;
  }

  const rightCounts = new Map<string, number>();
  for (const gram of rightBigrams) {
    rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1);
  }

  let intersection = 0;
  for (const gram of leftBigrams) {
    const count = rightCounts.get(gram) ?? 0;
    if (count > 0) {
      intersection += 1;
      rightCounts.set(gram, count - 1);
    }
  }

  const denominator = leftBigrams.length + rightBigrams.length;
  return denominator > 0 ? (2 * intersection) / denominator : 0;
}

function scoreNameMatch(query: string, candidate: string): number {
  const normalizedQuery = normalizeName(query);
  const normalizedCandidate = normalizeName(candidate);

  if (!normalizedQuery || !normalizedCandidate) {
    return 0;
  }

  if (normalizedQuery === normalizedCandidate) {
    return 1;
  }

  if (
    normalizedCandidate.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedCandidate)
  ) {
    return 0.9;
  }

  const queryTokens = tokenizeName(normalizedQuery);
  const candidateTokens = tokenizeName(normalizedCandidate);
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const overlap = queryTokens.filter((token) => candidateSet.has(token)).length;
  const denominator = Math.max(queryTokens.length, candidateTokens.length);
  const tokenScore = overlap / denominator;
  const fuzzyScore = bigramSimilarity(normalizedQuery, normalizedCandidate);

  return Math.max(tokenScore, fuzzyScore * 0.95);
}

async function resolveUserExerciseByName(userId: string, exerciseName: string): Promise<{
  userExerciseId: string;
  exerciseId: string;
  matchedExerciseName: string;
  score: number;
} | null> {
  const userExercises = await UserExerciseModel.find({ userId })
    .select('_id exerciseId')
    .lean();

  if (userExercises.length === 0) {
    return null;
  }

  const uniqueExerciseIds = Array.from(
    new Set(
      userExercises
        .map((entry) => entry.exerciseId?.toString())
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  );

  if (uniqueExerciseIds.length === 0) {
    return null;
  }

  const exercises = await ExerciseModel.find({ _id: { $in: uniqueExerciseIds } })
    .select('_id name')
    .lean();

  const exerciseNameById = new Map<string, string>(
    exercises
      .map((entry) => {
        const exerciseId = entry._id?.toString();
        const name = typeof entry.name === 'string' ? entry.name : '';
        return exerciseId && name ? ([exerciseId, name] as const) : null;
      })
      .filter((entry): entry is readonly [string, string] => entry !== null)
  );

  let bestMatch: {
    userExerciseId: string;
    exerciseId: string;
    matchedExerciseName: string;
    score: number;
  } | null = null;

  for (const card of userExercises) {
    const exerciseId = card.exerciseId?.toString();
    const userExerciseId = card._id?.toString();

    if (!exerciseId || !userExerciseId) {
      continue;
    }

    const mappedName = exerciseNameById.get(exerciseId);
    if (!mappedName) {
      continue;
    }

    const score = scoreNameMatch(exerciseName, mappedName);
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        userExerciseId,
        exerciseId,
        matchedExerciseName: mappedName,
        score,
      };
    }
  }

  return bestMatch && bestMatch.score >= 0.6 ? bestMatch : null;
}

export function registerUpdateUserExercisePreferredWeightTool(server: McpServer) {
  const logToInspector = async (level: 'debug' | 'info' | 'warning' | 'error', data: unknown) => {
    try {
      await server.sendLoggingMessage({
        level,
        logger: updateUserExercisePreferredWeightToolDefinition.name,
        data,
      });
    } catch {
      // Best-effort logging only.
    }
  };

  server.registerTool(
    updateUserExercisePreferredWeightToolDefinition.name,
    {
      description: updateUserExercisePreferredWeightToolDefinition.description,
      inputSchema: updateUserExercisePreferredWeightToolDefinition.inputSchema,
    },
    async (args): Promise<ToolResponse> => {
      try {
        const parsed = UpdateUserExercisePreferredWeightInputSchema.parse(args);
        await logToInspector('debug', { event: 'input', payload: parsed });

        const exerciseName = parsed.exerciseName.trim();
        const matchedUserExercise = await resolveUserExerciseByName(parsed.userId, exerciseName);

        if (matchedUserExercise) {
          const cardBeforeUpdate = await UserExerciseModel.findById(matchedUserExercise.userExerciseId)
            .select('_id exerciseId currentTarget.weight')
            .lean();

          const updatedByUserCard = await UserExerciseModel.findByIdAndUpdate(
            matchedUserExercise.userExerciseId,
            {
              $set: {
                'currentTarget.weight': parsed.preferredWeightKg,
              },
            },
            { new: true }
          ).lean();

          if (updatedByUserCard) {
            const updatedWeight =
              typeof updatedByUserCard.currentTarget?.weight === 'number'
                ? updatedByUserCard.currentTarget.weight
                : null;

            if (updatedWeight === null || Math.abs(updatedWeight - parsed.preferredWeightKg) > 0.0001) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      code: 'WEIGHT_UPDATE_NOT_APPLIED',
                      message:
                        'User exercise card was found but preferred weight update was not applied correctly.',
                      data: {
                        userExerciseId: updatedByUserCard._id?.toString() ?? null,
                        requestedWeightKg: parsed.preferredWeightKg,
                        observedWeightKg: updatedWeight,
                      },
                    }),
                  },
                ],
                isError: true,
              };
            }

            await logToInspector('info', {
              event: 'result',
              resolution: 'user_exercise_name_match',
              matchedExerciseName: matchedUserExercise.matchedExerciseName,
              score: matchedUserExercise.score,
              previousWeightKg:
                typeof cardBeforeUpdate?.currentTarget?.weight === 'number'
                  ? cardBeforeUpdate.currentTarget.weight
                  : null,
              requestedWeightKg: parsed.preferredWeightKg,
              updatedWeightKg: updatedWeight,
              userExerciseId: updatedByUserCard._id?.toString(),
              exerciseId: matchedUserExercise.exerciseId,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    data: {
                      exerciseId: matchedUserExercise.exerciseId,
                      matchedExerciseName: matchedUserExercise.matchedExerciseName,
                      userExercise: updatedByUserCard,
                    },
                  }),
                },
              ],
            };
          }
        }

        const exactRegex = new RegExp(`^${escapeRegex(exerciseName)}$`, 'i');

        const exercise = await ExerciseModel.findOne({ name: exactRegex }).lean();

        if (!exercise?._id) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  code: 'EXERCISE_NOT_FOUND',
                  message: `No exercise found with name "${exerciseName}"`,
                }),
              },
            ],
            isError: true,
          };
        }

        const updatedUserExercise = await UserExerciseModel.findOneAndUpdate(
          {
            userId: parsed.userId,
            exerciseId: exercise._id,
          },
          {
            $set: {
              'currentTarget.weight': parsed.preferredWeightKg,
            },
          },
          { new: true }
        ).lean();

        if (!updatedUserExercise) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  code: 'USER_EXERCISE_NOT_FOUND',
                  message:
                    'No user exercise found for this user and exercise. Create it first before updating the preferred weight.',
                  data: {
                    userId: parsed.userId,
                    exerciseId: exercise._id.toString(),
                  },
                }),
              },
            ],
            isError: true,
          };
        }

        await logToInspector('info', {
          event: 'result',
          userExerciseId: updatedUserExercise._id?.toString(),
          exerciseId: exercise._id.toString(),
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                data: {
                  exerciseId: exercise._id.toString(),
                  userExercise: updatedUserExercise,
                },
              }),
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
              text: JSON.stringify({ code: 'UPDATE_USER_EXERCISE_PREFERRED_WEIGHT_FAILED', message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}