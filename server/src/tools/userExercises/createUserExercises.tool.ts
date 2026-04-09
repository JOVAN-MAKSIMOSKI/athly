import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UserExerciseModel } from '../../database/models/UserExerciseSchema.js';
import { ExerciseModel } from '../../database/models/ExerciseSchema.js';
import { UserModel } from '../../database/models/UserSchema.js';
import { RepRangeSchema, RepetitionsSchema } from '../../domain/exercises/types.js';
import { ProgressionMethodEnum } from '../../domain/userExercise/userExerciseTypes.js';
import { buildWorkoutTargets, type TrainingType, type MovementType } from '../../domain/workout/generationTargets.js';

type ToolTextContent = { type: 'text'; text: string };

type ToolResponse = {
  content: ToolTextContent[];
  isError?: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatZodIssues(error: z.ZodError): Array<{ path: string; message: string; code: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
    code: issue.code,
  }));
}

function extractMongoErrorDetails(error: unknown): {
  code?: number;
  codeName?: string;
  keyPattern?: Record<string, unknown>;
  keyValue?: Record<string, unknown>;
} {
  if (!isRecord(error)) {
    return {};
  }

  return {
    code: typeof error.code === 'number' ? error.code : undefined,
    codeName: typeof error.codeName === 'string' ? error.codeName : undefined,
    keyPattern: isRecord(error.keyPattern) ? error.keyPattern : undefined,
    keyValue: isRecord(error.keyValue) ? error.keyValue : undefined,
  };
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return extractMongoErrorDetails(error).code === 11000;
}

function buildToolErrorResponse(input: {
  error: unknown;
  fallbackCode: string;
}): ToolResponse {
  const { error, fallbackCode } = input;

  if (error instanceof z.ZodError) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'CREATE_USER_EXERCISES_VALIDATION_FAILED',
            message: 'Input validation failed for create_user_exercises.',
            details: formatZodIssues(error),
          }),
        },
      ],
      isError: true,
    };
  }

  const mongo = extractMongoErrorDetails(error);
  if (mongo.code === 11000) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'CREATE_USER_EXERCISES_DUPLICATE_KEY',
            message: 'A user exercise already exists for one of the requested exercises. The operation can be safely retried.',
            details: {
              mongoCode: mongo.code,
              mongoCodeName: mongo.codeName,
              keyPattern: mongo.keyPattern,
              keyValue: mongo.keyValue,
            },
          }),
        },
      ],
      isError: true,
    };
  }

  if (isRecord(error) && error.name === 'ValidationError') {
    const validationErrors = isRecord(error.errors)
      ? Object.entries(error.errors).map(([path, value]) => ({
          path,
          message: isRecord(value) && typeof value.message === 'string' ? value.message : getErrorMessage(value),
        }))
      : undefined;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'CREATE_USER_EXERCISES_MODEL_VALIDATION_FAILED',
            message: getErrorMessage(error),
            details: validationErrors,
          }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          code: fallbackCode,
          message: getErrorMessage(error),
          details: mongo.code
            ? {
                mongoCode: mongo.code,
                mongoCodeName: mongo.codeName,
                keyPattern: mongo.keyPattern,
                keyValue: mongo.keyValue,
              }
            : undefined,
        }),
      },
    ],
    isError: true,
  };
}

const ObjectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex ObjectId')
  .describe('MongoDB ObjectId string reference');

const CurrentTargetSchema = z
  .object({
    weight: z.number().min(0).optional().describe('Target working weight in kg (optional; server estimates baseline when omitted)'),
    progressionMethod: ProgressionMethodEnum.optional().describe('Progression method for this exercise target (rpe, rep_range, or two_x_to_failure); defaults to two_x_to_failure'),
    reps: RepetitionsSchema.optional().describe('Target repetitions or rep range (optional for beginner RPE progression)'),
    sets: z.number().int().min(1).optional().describe('Target set count (optional; server calculates based on training type when omitted)'),
    rpe: z.number().min(1).max(10).optional().describe('Target RPE intensity (optional for rep-range progression)'),
    restSeconds: z.number().int().min(0).optional().describe('Rest time between sets in seconds'),
    rirMin: z.number().min(0).max(6).optional().describe('Minimum target reps-in-reserve'),
    rirMax: z.number().min(0).max(6).optional().describe('Maximum target reps-in-reserve'),
    trainingType: z.enum(['hypertrophy', 'strength', 'endurance', 'mobility']).optional().describe('Workout style used to derive baseline targets'),
    supersetGroup: z.string().optional().describe('Superset grouping label for paired antagonistic exercises'),
  })
  .superRefine((data, ctx) => {
    // Only validate reps/rpe if progressionMethod is EXPLICITLY provided
    // If progressionMethod is omitted, server will calculate sensible defaults
    if (data.progressionMethod === undefined) {
      // No validation needed; server will provide defaults
      return;
    }

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

    if (data.progressionMethod === 'two_x_to_failure' && data.reps !== 'FAILURE') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reps'],
        message: 'reps must be "FAILURE" when progressionMethod is "two_x_to_failure"',
      });
    }
  });

const UserExerciseInputSchema = z.object({
  exerciseId: ObjectIdSchema.describe('Exercise reference'),
  movementType: z.enum(['compound', 'isolation']).optional().describe('Optional movement classifier to assist time-crunch accessory culling'),
  currentTarget: CurrentTargetSchema.optional(),
  settings: z
    .object({
      isFavorite: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .optional(),
});

const WorkoutConfigSchema = z
  .object({
    trainingType: z.enum(['hypertrophy', 'strength', 'endurance', 'mobility']).optional().describe('Workout style to apply baseline sets/reps/rest/RIR targets.'),
  })
  .optional();

const CreateUserExercisesInputSchema = z
  .object({
    userId: ObjectIdSchema.describe('User ObjectId to own the exercise cards'),
    workoutConfig: WorkoutConfigSchema,
    exercises: z.array(UserExerciseInputSchema).min(1),
  })
  .describe('Inputs for creating user exercise cards');

const createUserExercisesToolDefinition = {
  name: 'athly.create_user_exercises',
  description: 'Creates or updates user exercise cards for a workout plan. RESPONSE FORMAT: Return JSON only in content[0].text with {"success":true,"data":[...],"generationMeta":{...}} on success, or {"code":"...","message":"..."} with isError=true on failure. Do not include markdown, emojis, or narrative text.',
  inputSchema: CreateUserExercisesInputSchema,
  restricted: false,
};

const DEFAULT_UNCONSTRAINED_WORKOUT_DURATION_MINUTES = 10_000;

function roundToNearestTwoPointFive(value: number): number {
  return Math.round(value / 2.5) * 2.5;
}

function resolveBaselineWeightKg(input: {
  providedWeight?: number;
  existingTargetWeight?: number;
  personalBestWeight?: number;
  userBodyWeightKg?: number;
  isCompound: boolean;
  force?: 'push' | 'pull' | 'legs';
  exerciseName?: string;
  equipment?: string;
  experienceLevel?: string;
  comfortableWithHeavierWeights?: boolean;
}): number {
  const isValidPositive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

  if (isValidPositive(input.providedWeight)) {
    return input.providedWeight;
  }

  if (isValidPositive(input.existingTargetWeight)) {
    return input.existingTargetWeight;
  }

  if (isValidPositive(input.personalBestWeight)) {
    return input.personalBestWeight;
  }

  if (input.equipment === 'bodyweight') {
    return 0;
  }

  const bodyWeight =
    typeof input.userBodyWeightKg === 'number' && Number.isFinite(input.userBodyWeightKg) && input.userBodyWeightKg > 0
      ? input.userBodyWeightKg
      : 70;

  // Movement-pattern baseline scaling (compound movements are not all equal)
  let baseMultiplier = 0.3;
  if (input.isCompound) {
    if (input.force === 'legs') {
      baseMultiplier = 0.5;
    } else if (input.force === 'pull') {
      baseMultiplier = 0.4;
    } else if (input.force === 'push') {
      baseMultiplier = 0.35;
    }
  } else if (input.force === 'legs') {
    baseMultiplier = 0.2;
  } else if (input.force === 'pull') {
    baseMultiplier = 0.175;
  } else {
    baseMultiplier = 0.15;
  }

  const normalizedName = (input.exerciseName ?? '').toLowerCase();
  const lowerLoadKeywords = ['lateral raise', 'rear delt', 'curl', 'triceps extension', 'fly', 'face pull'];
  const unilateralKeywords = ['single-arm', 'single leg', 'single-leg', 'split squat', 'lunge', 'step-up'];

  if (lowerLoadKeywords.some((keyword) => normalizedName.includes(keyword))) {
    baseMultiplier *= 0.75;
  }

  if (unilateralKeywords.some((keyword) => normalizedName.includes(keyword))) {
    baseMultiplier *= 0.85;
  }

  // Experience-based multiplier scaling: beginners start lighter, advanced start heavier
  if (input.experienceLevel === 'BEGINNER') {
    baseMultiplier *= 0.7; // Beginners: 70% of standard weight
  } else if (input.experienceLevel === 'ADVANCED') {
    baseMultiplier *= 1.2; // Advanced: 120% of standard weight
  }
  // INTERMEDIATE uses 100% (1.0x)

  // User preference override: if user flags this as true, bias toward safer entry loads.
  if (input.comfortableWithHeavierWeights === true) {
    baseMultiplier *= 0.85;
  }

  const minimum = input.isCompound ? 20 : 10;
  const estimated = Math.max(minimum, bodyWeight * baseMultiplier);
  return roundToNearestTwoPointFive(estimated);
}

export function registerCreateUserExercisesTool(server: McpServer) {
  const logToInspector = async (level: 'debug' | 'info' | 'warning' | 'error', data: unknown) => {
    try {
      await server.sendLoggingMessage({
        level,
        logger: createUserExercisesToolDefinition.name,
        data,
      });
    } catch {
      // Best-effort logging only.
    }
  };

  server.registerTool(
    createUserExercisesToolDefinition.name,
    {
      description: createUserExercisesToolDefinition.description,
      inputSchema: createUserExercisesToolDefinition.inputSchema,
    },
    async (args): Promise<ToolResponse> => {
      try {
        console.error('[create_user_exercises] received', {
          exerciseCount: Array.isArray((args as any).exercises) ? (args as any).exercises.length : 0,
          userId: (args as any).userId ?? null,
          trainingType: (args as any).workoutConfig?.trainingType ?? null,
        });

        let parsed: ReturnType<typeof CreateUserExercisesInputSchema.parse>;
        try {
          parsed = CreateUserExercisesInputSchema.parse(args);
        } catch (parseError) {
          const msg = getErrorMessage(parseError);
          console.error('[create_user_exercises] ZOD PARSE FAILED', {
            message: msg,
            details: parseError instanceof z.ZodError ? formatZodIssues(parseError) : undefined,
          });
          return buildToolErrorResponse({
            error: parseError,
            fallbackCode: 'CREATE_USER_EXERCISES_FAILED',
          });
        }
        await logToInspector('debug', { event: 'input', payload: parsed });

        const user = await UserModel.findById(parsed.userId)
          .select('profile.experienceLevel profile.goal profile.workoutDurationMinutes profile.weight profile.comfortableWithHeavierWeights')
          .lean();

        if (!user) {
          console.error('[create_user_exercises] USER NOT FOUND', { userId: parsed.userId });
          throw new Error('User not found');
        }

        console.error('[create_user_exercises] user profile', {
          experienceLevel: user.profile?.experienceLevel,
          goal: user.profile?.goal,
          weight: user.profile?.weight,
          workoutDurationMinutes: user.profile?.workoutDurationMinutes,
          comfortableWithHeavierWeights: user.profile?.comfortableWithHeavierWeights,
        });

        const fallbackTrainingTypeFromGoal = (goal?: string): TrainingType => {
          if (goal === 'STRENGTH') return 'strength';
          if (goal === 'ENDURANCE' || goal === 'WEIGHT_LOSS') return 'endurance';
          return 'hypertrophy';
        };

        const trainingType: TrainingType =
          parsed.workoutConfig?.trainingType ?? fallbackTrainingTypeFromGoal(user?.profile?.goal);

        const availableTimeMinutes = user.profile?.workoutDurationMinutes;
        const hasWorkoutDuration = typeof availableTimeMinutes === 'number';
        const generationDurationMinutes = hasWorkoutDuration
          ? availableTimeMinutes
          : DEFAULT_UNCONSTRAINED_WORKOUT_DURATION_MINUTES;
        const isBeginner = user?.profile?.experienceLevel === 'BEGINNER';
        const isEligibleForTwoXToFailure =
          !isBeginner &&
          hasWorkoutDuration &&
          typeof availableTimeMinutes === 'number' &&
          availableTimeMinutes >= 30 &&
          availableTimeMinutes <= 45;

        const defaultProgressionMethod = isEligibleForTwoXToFailure
          ? 'two_x_to_failure'
          : isBeginner
            ? 'rpe'
            : 'rep_range';

        const requestedExerciseIds = parsed.exercises.map((exercise) => exercise.exerciseId);
        const requestedExerciseIdSet = new Set(requestedExerciseIds);

        const exerciseDocs = await ExerciseModel.find({ _id: { $in: requestedExerciseIds } })
          .select('_id name force targetMuscle secondaryMuscles equipment compound')
          .lean();

        const foundExerciseIdSet = new Set(exerciseDocs.map((doc) => String(doc._id)));
        const unresolvedRequestedIds = Array.from(requestedExerciseIdSet).filter(
          (exerciseId) => !foundExerciseIdSet.has(exerciseId)
        );

        // Recovery path: if the model accidentally sends userExercise IDs, map them back to exercise IDs.
        const remappedRequestedIdToExerciseId = new Map<string, string>();
        if (unresolvedRequestedIds.length > 0) {
          const userExerciseRefs = await UserExerciseModel.find({
            userId: parsed.userId,
            _id: { $in: unresolvedRequestedIds },
          })
            .select('_id exerciseId')
            .lean();

          for (const doc of userExerciseRefs) {
            remappedRequestedIdToExerciseId.set(String(doc._id), String(doc.exerciseId));
          }

          const remappedExerciseIds = Array.from(new Set(userExerciseRefs.map((doc) => String(doc.exerciseId))));
          const remappedIdsToFetch = remappedExerciseIds.filter((exerciseId) => !foundExerciseIdSet.has(exerciseId));

          if (remappedIdsToFetch.length > 0) {
            const remappedExerciseDocs = await ExerciseModel.find({ _id: { $in: remappedIdsToFetch } })
              .select('_id name force targetMuscle secondaryMuscles equipment compound')
              .lean();
            exerciseDocs.push(...remappedExerciseDocs);
          }
        }

        const exerciseMetaById = new Map(
          exerciseDocs.map((doc) => [
            String(doc._id),
            {
              name: doc.name,
              force: doc.force,
              targetMuscle: doc.targetMuscle,
              secondaryMuscles: doc.secondaryMuscles ?? [],
              equipment: doc.equipment,
              compound: Boolean(doc.compound),
            },
          ])
        );

        const resolvedExercises = parsed.exercises.map((exercise) => {
          const resolvedExerciseId = exerciseMetaById.has(exercise.exerciseId)
            ? exercise.exerciseId
            : remappedRequestedIdToExerciseId.get(exercise.exerciseId);

          return {
            ...exercise,
            resolvedExerciseId,
          };
        });

        const resolvedExerciseIds = Array.from(
          new Set(
            resolvedExercises
              .map((exercise) => exercise.resolvedExerciseId)
              .filter((exerciseId): exerciseId is string => typeof exerciseId === 'string')
          )
        );

        const existingUserExercises = await UserExerciseModel.find({
          userId: parsed.userId,
          exerciseId: { $in: resolvedExerciseIds },
        })
          .select('exerciseId currentTarget.weight personalBest.weight')
          .lean();

        const existingByExerciseId = new Map(
          existingUserExercises.map((doc) => [
            String(doc.exerciseId),
            {
              currentTargetWeight:
                typeof doc.currentTarget?.weight === 'number' && Number.isFinite(doc.currentTarget.weight)
                  ? doc.currentTarget.weight
                  : undefined,
              personalBestWeight:
                typeof doc.personalBest?.weight === 'number' && Number.isFinite(doc.personalBest.weight)
                  ? doc.personalBest.weight
                  : undefined,
            },
          ])
        );

        const rawExerciseById = new Map<string, (typeof resolvedExercises)[number]>();
        for (const exercise of resolvedExercises) {
          if (exercise.resolvedExerciseId && !rawExerciseById.has(exercise.resolvedExerciseId)) {
            rawExerciseById.set(exercise.resolvedExerciseId, exercise);
          }
        }

        const validTargetExercises = resolvedExercises.flatMap((exercise) => {
          if (!exercise.resolvedExerciseId) {
            return [];
          }

          const meta = exerciseMetaById.get(exercise.resolvedExerciseId);
          if (!meta) {
            return [];
          }

          return [
            {
              exerciseId: exercise.resolvedExerciseId,
              name: meta.name,
              force: meta.force,
              targetMuscle: meta.targetMuscle,
              secondaryMuscles: meta.secondaryMuscles,
              movementType:
                (exercise.movementType as MovementType | undefined) ??
                (meta.compound ? 'compound' : 'isolation'),
            },
          ];
        });

        const skippedMissingMetadataExerciseIds = resolvedExercises
          .map((exercise) => exercise.exerciseId)
          .filter((exerciseId) => {
            const resolvedExerciseId = remappedRequestedIdToExerciseId.get(exerciseId) ?? exerciseId;
            return !exerciseMetaById.has(resolvedExerciseId);
          });

        await logToInspector('debug', {
          event: 'exercise_resolution_summary',
          requestedCount: requestedExerciseIds.length,
          foundByDirectId: foundExerciseIdSet.size,
          remappedFromUserExercise: remappedRequestedIdToExerciseId.size,
          unresolvedIds: unresolvedRequestedIds,
          skippedMissingMetadata: skippedMissingMetadataExerciseIds,
        });

        if (validTargetExercises.length === 0) {
          const unresolvableIds = resolvedExercises
            .map((ex) => ({
              provided: ex.exerciseId,
              remapped: remappedRequestedIdToExerciseId.get(ex.exerciseId),
              inMetadata: exerciseMetaById.has(remappedRequestedIdToExerciseId.get(ex.exerciseId) ?? ex.exerciseId),
            }))
            .filter((ex) => !ex.inMetadata);

          const errorDetail =
            unresolvableIds.length > 0
              ? `Unresolvable exerciseIds (check they were found via search_exercises): ${unresolvableIds.map((ex) => ex.remapped ?? ex.provided).join(', ')}`
              : 'No exercises provided in the request';

          console.error('[create_user_exercises] NO VALID EXERCISES', {
            requestedCount: requestedExerciseIds.length,
            foundByDirectId: foundExerciseIdSet.size,
            remappedCount: remappedRequestedIdToExerciseId.size,
            unresolvableIds,
          });

          throw new Error(`No valid exercises were found in the exercise library for this request. ${errorDetail}`);
        }

        console.error('[create_user_exercises] valid exercises resolved', {
          trainingType,
          validCount: validTargetExercises.length,
          skippedMissingMetadata: skippedMissingMetadataExerciseIds,
          exercises: validTargetExercises.map((e) => ({ exerciseId: e.exerciseId, name: e.name })),
        });

        const targetBuildResult = buildWorkoutTargets({
          trainingType,
          availableTimeMinutes: generationDurationMinutes,
          exercises: validTargetExercises,
        });

        const targetByExerciseId = new Map(
          targetBuildResult.exercises.map((target) => [target.exerciseId, target])
        );

        const results = await Promise.all(
          validTargetExercises.map(async (targetExercise) => {
            const exercise = rawExerciseById.get(targetExercise.exerciseId);
            if (!exercise) {
              await logToInspector('warning', {
                event: 'exercise_not_in_raw_map',
                exerciseId: targetExercise.exerciseId,
              });
              return null;
            }

            const calculatedTarget = targetByExerciseId.get(exercise.exerciseId);
            if (!calculatedTarget) {
              await logToInspector('warning', {
                event: 'calculated_target_not_found',
                exerciseId: exercise.exerciseId,
              });
              return null;
            }

            // GUARANTEE: Always use provided currentTarget or create minimal defaults
            const currentTarget: Partial<{ weight?: number; progressionMethod?: string; reps?: unknown; rpe?: number }> = exercise.currentTarget || {};
            const progressionMethod =
              currentTarget.progressionMethod === 'two_x_to_failure' && !isEligibleForTwoXToFailure
                ? defaultProgressionMethod
                : currentTarget.progressionMethod ?? defaultProgressionMethod;

            const existing = existingByExerciseId.get(exercise.exerciseId);
            
            // GUARANTEE: Formula is ALWAYS applied to calculate weight
            const resolvedWeight = resolveBaselineWeightKg({
              providedWeight: currentTarget.weight, // If provided in input
              existingTargetWeight: existing?.currentTargetWeight, // If saved before
              personalBestWeight: existing?.personalBestWeight, // If user has a PR
              userBodyWeightKg: user.profile?.weight, // User's body weight
              isCompound: calculatedTarget.movementType === 'compound' || Boolean(exerciseMetaById.get(exercise.exerciseId)?.compound),
              force: targetExercise.force,
              exerciseName: exerciseMetaById.get(exercise.exerciseId)?.name,
              equipment: exerciseMetaById.get(exercise.exerciseId)?.equipment,
              experienceLevel: user?.profile?.experienceLevel, // Experience multiplier
              comfortableWithHeavierWeights: user?.profile?.comfortableWithHeavierWeights,
            });

            await logToInspector('debug', {
              event: 'weight_formula_applied',
              exerciseId: exercise.exerciseId,
              exerciseName: exerciseMetaById.get(exercise.exerciseId)?.name,
              resolvedWeight,
              formulaInputs: {
                providedWeight: currentTarget.weight,
                existingTargetWeight: existing?.currentTargetWeight,
                personalBestWeight: existing?.personalBestWeight,
                userBodyWeight: user.profile?.weight,
                isCompound: calculatedTarget.movementType === 'compound' || Boolean(exerciseMetaById.get(exercise.exerciseId)?.compound),
                equipment: exerciseMetaById.get(exercise.exerciseId)?.equipment,
                experienceLevel: user?.profile?.experienceLevel,
              },
              progressionMethod,
            });

            // GUARANTEE: reps and rpe are always set from calculated targets if not provided
            const sets = progressionMethod === 'two_x_to_failure'
              ? 2
              : calculatedTarget.sets;

            const reps = progressionMethod === 'rep_range'
              ? (typeof currentTarget?.reps === 'string' && RepRangeSchema.safeParse(currentTarget.reps).success
                  ? currentTarget.reps
                  : user.profile?.comfortableWithHeavierWeights
                    ? '10-12'
                    : calculatedTarget.reps)
              : progressionMethod === 'two_x_to_failure'
                ? 'FAILURE'
              : currentTarget?.reps; // For RPE method, reps is optional

            const rpe = progressionMethod === 'rpe'
              ? (currentTarget?.rpe ?? calculatedTarget.rpe)
              : undefined;

            const restCoachBlock = [
              `Type: ${targetBuildResult.trainingType}`,
              `Rest: ${calculatedTarget.restSeconds}s`,
              `RIR: ${calculatedTarget.rirMin}-${calculatedTarget.rirMax}`,
              `Coach Note: ${calculatedTarget.coachNote}`,
              ...(calculatedTarget.supersetGroup ? [`Superset: ${calculatedTarget.supersetGroup}`] : []),
            ].join(' | ');

            const notes = exercise.settings?.notes
              ? `${exercise.settings.notes} | ${restCoachBlock}`
              : restCoachBlock;

            const settings = {
              isFavorite: exercise.settings?.isFavorite ?? false,
              notes,
            };

            // Enforce: weight must ALWAYS be resolved and valid before persistence
            if (!Number.isFinite(resolvedWeight) || resolvedWeight < 0) {
              throw new Error(
                `Weight formula failed for exercise ${exercise.exerciseId}: could not resolve a valid weight (got ${resolvedWeight}). Formula inputs: provided=${currentTarget?.weight}, userBodyWeight=${user.profile?.weight}, experienceLevel=${user?.profile?.experienceLevel}`
              );
            }

            // Enforce: weight cannot be 0 unless it's a bodyweight exercise
            const exerciseMeta = exerciseMetaById.get(exercise.exerciseId);
            if (resolvedWeight === 0 && exerciseMeta?.equipment !== 'bodyweight') {
              throw new Error(
                `Weight formula produced 0 for non-bodyweight exercise ${exerciseMeta?.name || exercise.exerciseId}. Formula must ensure minimum thresholds (20kg compound, 10kg isolation).`
              );
            }

            await logToInspector('debug', {
              event: 'formula_validated_ready_to_save',
              exerciseId: exercise.exerciseId,
              exerciseName: exerciseMeta?.name,
              finalWeight: resolvedWeight,
              finalProgressionMethod: progressionMethod,
              finalReps: reps,
              finalRpe: rpe,
              finalSets: sets,
            });

            const filter = { userId: parsed.userId, exerciseId: exercise.exerciseId };
            const update = {
              $set: {
                currentTarget: {
                  weight: resolvedWeight,
                  progressionMethod,
                  reps,
                  sets,
                  rpe,
                  restSeconds: calculatedTarget.restSeconds,
                  rirMin: calculatedTarget.rirMin,
                  rirMax: calculatedTarget.rirMax,
                  trainingType: targetBuildResult.trainingType,
                  supersetGroup: calculatedTarget.supersetGroup,
                },
                settings,
              },
            };

            try {
              return await UserExerciseModel.findOneAndUpdate(filter, update, {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true,
                runValidators: true,
              }).lean();
            } catch (dbError) {
              const mongo = extractMongoErrorDetails(dbError);
              await logToInspector('error', {
                event: 'database_save_failed',
                exerciseId: exercise.exerciseId,
                userId: parsed.userId,
                weight: resolvedWeight,
                progressionMethod,
                errorMessage: getErrorMessage(dbError),
                errorStack: dbError instanceof Error ? dbError.stack : undefined,
                mongoCode: mongo.code,
                mongoCodeName: mongo.codeName,
                keyPattern: mongo.keyPattern,
                keyValue: mongo.keyValue,
              });

              if (isMongoDuplicateKeyError(dbError)) {
                await logToInspector('warning', {
                  event: 'duplicate_key_retry_as_update',
                  exerciseId: exercise.exerciseId,
                  userId: parsed.userId,
                  mongoCode: mongo.code,
                  keyPattern: mongo.keyPattern,
                  keyValue: mongo.keyValue,
                });

                return UserExerciseModel.findOneAndUpdate(filter, update, {
                  new: true,
                  upsert: false,
                  runValidators: true,
                }).lean();
              }

              throw dbError;
            }
          })
        );

        const persistedResults = results.filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        if (persistedResults.length === 0) {
          await logToInspector('error', {
            event: 'no_exercises_persisted',
            validTargetExercisesCount: validTargetExercises.length,
            resultsCount: results.length,
            nullResults: results.filter((r) => r === null).length,
          });
          console.error('[create_user_exercises] NO EXERCISES PERSISTED', {
            validCount: validTargetExercises.length,
            resultsCount: results.length,
          });
          throw new Error('Could not generate any user exercise records from the provided exercise list');
        }

        console.error('[create_user_exercises] SAVED OK', {
          persistedCount: persistedResults.length,
          trainingType,
          estimatedDurationMinutes: Math.ceil(targetBuildResult.estimatedDurationSeconds / 60),
        });
        await logToInspector('info', {
          event: 'exercises_saved_successfully',
          persistedCount: persistedResults.length,
          skippedMissingMetadataCount: skippedMissingMetadataExerciseIds.length,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                data: persistedResults,
                generationMeta: {
                  trainingType: targetBuildResult.trainingType,
                  availableTimeMinutes: hasWorkoutDuration ? availableTimeMinutes : null,
                  usedDefaultDurationFallback: !hasWorkoutDuration,
                  estimatedDurationMinutes: Math.ceil(targetBuildResult.estimatedDurationSeconds / 60),
                  rulesApplied: targetBuildResult.rulesApplied,
                  removedExerciseIds: targetBuildResult.removedExerciseIds,
                  skippedMissingMetadataExerciseIds,
                },
              }),
            },
          ],
        };
      } catch (error) {
        const mongo = extractMongoErrorDetails(error);
        const message = getErrorMessage(error);
        console.error('[create_user_exercises] ERROR (returned to LLM)', {
          message,
          stack: error instanceof Error ? error.stack : undefined,
          mongoCode: mongo.code,
          mongoCodeName: mongo.codeName,
          keyPattern: mongo.keyPattern,
          keyValue: mongo.keyValue,
          validationDetails: error instanceof z.ZodError ? formatZodIssues(error) : undefined,
        });
        await logToInspector('error', {
          event: 'error',
          message,
          mongoCode: mongo.code,
          mongoCodeName: mongo.codeName,
          keyPattern: mongo.keyPattern,
          keyValue: mongo.keyValue,
          validationDetails: error instanceof z.ZodError ? formatZodIssues(error) : undefined,
        });

        return buildToolErrorResponse({
          error,
          fallbackCode: 'CREATE_USER_EXERCISES_FAILED',
        });
      }
    }
  );
}
