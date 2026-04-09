import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WorkoutModel, type IWorkout, type IWorkoutExercise } from '../../database/models/WorkoutSchema.js';
import { ExerciseModel } from '../../database/models/ExerciseSchema.js';
import { UserExerciseModel } from '../../database/models/UserExerciseSchema.js';
import { RepetitionsSchema } from '../../domain/exercises/types.js';
import { estimateWorkoutDurationMinutes, type TrainingType, type MovementType } from '../../domain/workout/generationTargets.js';

type ToolTextContent = { type: 'text'; text: string };

type ToolResponse = {
  content: ToolTextContent[];
  isError?: true;
};

function coerceObjectId(value: unknown): unknown {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.$oid === 'string') {
    return record.$oid;
  }

  if (typeof record.id === 'string') {
    return record.id;
  }

  if (typeof record._id === 'string') {
    return record._id;
  }

  return value;
}

const ObjectIdSchema = z
  .preprocess(
    coerceObjectId,
    z.string().regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex ObjectId')
  )
  .describe('MongoDB ObjectId string reference');

const DateInputSchema = z
  .string()
  .datetime()
  .transform((value) => new Date(value))
  .describe('ISO 8601 datetime string');

const SetInputSchema = z.object({
  weight: z.number().min(0).optional().describe('Weight used for the set in kg (optional; will use UserExercise.currentTarget.weight when omitted). Do not use RPE values in this field unless explicitly requested by the user.'),
  reps: RepetitionsSchema.optional().describe('Repetitions performed in the set (optional for beginner RPE progression)'),
  rest: z.number().int().min(0).describe('Rest duration after the set in seconds'),
  rpe: z.number().min(1).max(10).optional().describe('RPE for the set'),
  completed: z.boolean().optional().default(false).describe('Whether the set was completed'),
});

const WorkoutExerciseInputSchema = z.object({
  exerciseId: ObjectIdSchema.optional().describe('Reference to the global exercise library (can be inferred from userExerciseId when omitted)'),
  userExerciseId: ObjectIdSchema.describe('Reference to the user exercise settings'),
  sets: z.array(SetInputSchema).min(1).describe('Sets planned for this exercise'),
  notes: z.string().optional().describe('Optional notes for the exercise'),
});

const CreateWorkoutPlanDraftInputSchema = z
  .object({
    userId: ObjectIdSchema.optional().describe('User ObjectId for the workout owner'),
    name: z.string().min(1).optional().describe('Workout name'),
    status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional(),
    startTime: DateInputSchema.optional(),
    endTime: DateInputSchema.optional(),
    estimatedWorkoutTimeToFinish: z.number().int().min(1).optional().describe('Estimated time to finish the workout in minutes'),
    exercises: z.array(WorkoutExerciseInputSchema).optional(),
    notes: z.string().optional(),
  })
  .describe('Inputs for creating a workout plan');

const CreateWorkoutPlanInputSchema = CreateWorkoutPlanDraftInputSchema.extend({
  estimatedWorkoutTimeToFinish: z.number().int().min(1).describe('Estimated time to finish the workout in minutes'),
});

const createWorkoutPlanToolDefinition = {
  name: 'athly.create_workout_plan',
  description: 'Creates a workout plan and saves it in the database. Keep set weight as load in kg and put perceived effort only in set.rpe (never use rpe as weight unless user explicitly requested). RESPONSE FORMAT: Return JSON only in content[0].text with {"success":true,"data":{...}} on success, or {"code":"...","message":"..."} with isError=true on failure. Do not include markdown, emojis, or narrative text.',
  inputSchema: CreateWorkoutPlanInputSchema,
  restricted: false,
};

type WorkoutExerciseInput = z.infer<typeof WorkoutExerciseInputSchema>;
type ResolvedWorkoutExerciseInput = WorkoutExerciseInput & {
  exerciseId: string;
  trainingType?: TrainingType;
  fallbackReps?: string;
  fallbackRestSeconds?: number;
  supersetGroup?: string;
};

async function resolveWorkoutOwnerUserId(input: {
  explicitUserId?: string;
  exercises: WorkoutExerciseInput[];
}): Promise<string> {
  if (input.explicitUserId) {
    return input.explicitUserId;
  }

  const userExerciseIds = [...new Set(input.exercises.map((exercise) => exercise.userExerciseId))];
  if (userExerciseIds.length === 0) {
    throw new Error('userId is required when exercises are missing');
  }

  const bridgeDocs = await UserExerciseModel.find({
    _id: { $in: userExerciseIds },
  })
    .select('_id userId')
    .lean();

  if (bridgeDocs.length !== userExerciseIds.length) {
    throw new Error('Some userExerciseId values could not be resolved');
  }

  const ownerIds = [...new Set(bridgeDocs.map((doc) => String(doc.userId)))];
  if (ownerIds.length !== 1) {
    throw new Error('Workout exercises must belong to exactly one user');
  }

  const [resolvedOwnerId] = ownerIds;
  if (!resolvedOwnerId) {
    throw new Error('Could not resolve workout owner userId');
  }

  return resolvedOwnerId;
}

async function hydrateWorkoutExercises(
  userId: string,
  exercises: WorkoutExerciseInput[]
): Promise<ResolvedWorkoutExerciseInput[]> {
  if (exercises.length === 0) {
    return [];
  }

  // Fetch all UserExercise records referenced in this workout
  const userExerciseIds = exercises.map((exercise) => exercise.userExerciseId);
  const userExerciseDocs = await UserExerciseModel.find({
    _id: { $in: userExerciseIds },
    userId,
  })
    .select('_id exerciseId userId currentTarget.weight currentTarget.trainingType currentTarget.reps currentTarget.restSeconds currentTarget.supersetGroup')
    .lean();

  const userExerciseDataById = new Map(
    userExerciseDocs.map((doc) => [
      String(doc._id),
      {
        exerciseId: String(doc.exerciseId),
        weight: doc.currentTarget?.weight ?? 0,
        trainingType: doc.currentTarget?.trainingType,
        reps: typeof doc.currentTarget?.reps === 'string' ? doc.currentTarget.reps : undefined,
        restSeconds: doc.currentTarget?.restSeconds,
        supersetGroup: doc.currentTarget?.supersetGroup,
      },
    ])
  );

  // Resolve exerciseIds and populate missing set weights from UserExercise
  return exercises.map((exercise) => {
    const exerciseData = userExerciseDataById.get(exercise.userExerciseId);
    if (!exerciseData) {
      throw new Error(
        `UserExercise not found for userExerciseId ${exercise.userExerciseId}`
      );
    }

    if (
      typeof exercise.exerciseId === 'string' &&
      exercise.exerciseId.length > 0 &&
      exercise.exerciseId !== exerciseData.exerciseId
    ) {
      throw new Error(
        `Exercise mismatch for userExerciseId ${exercise.userExerciseId}: provided exerciseId ${exercise.exerciseId} does not match linked exerciseId ${exerciseData.exerciseId}`
      );
    }

    const resolvedExerciseId = exerciseData.exerciseId;
    const userExerciseWeight = exerciseData.weight;

    // Fill in missing weights from UserExercise.currentTarget.weight
    const hydratedSets = exercise.sets.map((set) => ({
      ...set,
      weight: typeof set.weight === 'number' ? set.weight : userExerciseWeight,
    }));

    return {
      ...exercise,
      exerciseId: resolvedExerciseId,
      trainingType: exerciseData.trainingType,
      fallbackReps: exerciseData.reps,
      fallbackRestSeconds: exerciseData.restSeconds,
      supersetGroup: exerciseData.supersetGroup,
      sets: hydratedSets,
    };
  });
}

async function resolveEstimatedWorkoutTimeToFinishMinutes(input: {
  explicitEstimatedWorkoutTimeToFinish?: number;
  exercises: ResolvedWorkoutExerciseInput[];
}): Promise<number> {
  if (
    typeof input.explicitEstimatedWorkoutTimeToFinish === 'number' &&
    Number.isFinite(input.explicitEstimatedWorkoutTimeToFinish) &&
    input.explicitEstimatedWorkoutTimeToFinish >= 1
  ) {
    return Math.ceil(input.explicitEstimatedWorkoutTimeToFinish);
  }

  if (input.exercises.length === 0) {
    throw new Error('estimatedWorkoutTimeToFinish is required when exercises are missing');
  }

  const exerciseIds = [...new Set(input.exercises.map((exercise) => exercise.exerciseId))];
  const exerciseDocs = await ExerciseModel.find({ _id: { $in: exerciseIds } })
    .select('_id name force compound')
    .lean();

  const exerciseMetaById = new Map(
    exerciseDocs.map((doc) => [
      String(doc._id),
      {
        name: typeof doc.name === 'string' ? doc.name : undefined,
        force: doc.force,
        movementType: doc.compound ? 'compound' : 'isolation',
      },
    ]),
  );

  const trainingTypeCounts = new Map<TrainingType, number>();
  for (const exercise of input.exercises) {
    if (!exercise.trainingType) {
      continue;
    }

    trainingTypeCounts.set(exercise.trainingType, (trainingTypeCounts.get(exercise.trainingType) ?? 0) + 1);
  }

  const inferredTrainingType =
    [...trainingTypeCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'hypertrophy';

  const estimateInputs = input.exercises.map((exercise, index) => {
    const firstSet = exercise.sets[0];
    const meta = exerciseMetaById.get(exercise.exerciseId);

    if (!meta) {
      throw new Error(`Could not resolve exercise metadata to estimate workout duration for ${exercise.exerciseId}`);
    }

    return {
      sets: exercise.sets.length,
      reps:
        typeof firstSet?.reps === 'string'
          ? firstSet.reps
          : typeof exercise.fallbackReps === 'string'
            ? exercise.fallbackReps
            : undefined,
      restSeconds:
        typeof firstSet?.rest === 'number'
          ? firstSet.rest
          : typeof exercise.fallbackRestSeconds === 'number'
            ? exercise.fallbackRestSeconds
            : undefined,
      movementType: meta.movementType as MovementType,
      force: meta.force,
      name: meta.name,
      supersetGroup: exercise.supersetGroup ?? `WG${index + 1}`,
    };
  });

  return estimateWorkoutDurationMinutes({
    trainingType: inferredTrainingType,
    exercises: estimateInputs,
  });
}

async function prioritizeInclineChestForPushDay(
  exercises: ResolvedWorkoutExerciseInput[]
): Promise<{ exercises: ResolvedWorkoutExerciseInput[]; reordered: boolean }> {
  if (exercises.length < 2) {
    return { exercises, reordered: false };
  }

  const exerciseIds = [...new Set(exercises.map((exercise) => exercise.exerciseId))];
  const exerciseDocs = await ExerciseModel.find({ _id: { $in: exerciseIds } })
    .select('_id name force targetMuscle')
    .lean();

  const metaById = new Map(
    exerciseDocs.map((doc) => [
      String(doc._id),
      {
        name: String(doc.name ?? ''),
        force: String(doc.force ?? ''),
        targetMuscle: String(doc.targetMuscle ?? ''),
      },
    ])
  );

  let pushCount = 0;
  let pullCount = 0;
  let legsCount = 0;

  for (const exercise of exercises) {
    const meta = metaById.get(exercise.exerciseId);
    if (!meta) {
      continue;
    }

    if (meta.force === 'push') pushCount += 1;
    if (meta.force === 'pull') pullCount += 1;
    if (meta.force === 'legs') legsCount += 1;
  }

  const isPushDay = pushCount > 0 && pushCount >= pullCount && pushCount >= legsCount;
  if (!isPushDay) {
    return { exercises, reordered: false };
  }

  const inclineChestIndex = exercises.findIndex((exercise) => {
    const meta = metaById.get(exercise.exerciseId);
    if (!meta) return false;

    const nameLower = meta.name.toLowerCase();
    const targetMuscleLower = meta.targetMuscle.toLowerCase();
    return meta.force === 'push' && targetMuscleLower.includes('chest') && nameLower.includes('incline');
  });

  if (inclineChestIndex <= 0) {
    return { exercises, reordered: false };
  }

  const reorderedExercises = [...exercises];
  const [inclineChest] = reorderedExercises.splice(inclineChestIndex, 1);
  if (!inclineChest) {
    return { exercises, reordered: false };
  }

  reorderedExercises.unshift(inclineChest);
  return { exercises: reorderedExercises, reordered: true };
}

export function registerCreateWorkoutPlanTool(server: McpServer) {
  const logToInspector = async (level: 'debug' | 'info' | 'warning' | 'error', data: unknown) => {
    try {
      await server.sendLoggingMessage({
        level,
        logger: createWorkoutPlanToolDefinition.name,
        data,
      });
    } catch {
      // Best-effort logging only.
    }
  };

  server.registerTool(
    createWorkoutPlanToolDefinition.name,
    {
      description: createWorkoutPlanToolDefinition.description,
      inputSchema: createWorkoutPlanToolDefinition.inputSchema,
    },
    async (args): Promise<ToolResponse> => {
      try {
        console.error('[create_workout_plan] received args', {
          hasExercises: Array.isArray((args as any).exercises),
          exerciseCount: Array.isArray((args as any).exercises) ? (args as any).exercises.length : 0,
          userId: (args as any).userId ?? null,
          name: (args as any).name ?? null,
          estimatedWorkoutTimeToFinish: (args as any).estimatedWorkoutTimeToFinish ?? null,
        });

        let parsed: ReturnType<typeof CreateWorkoutPlanInputSchema.parse>;
        let draftParsed: ReturnType<typeof CreateWorkoutPlanDraftInputSchema.parse>;
        try {
          draftParsed = CreateWorkoutPlanDraftInputSchema.parse(args);
        } catch (parseError) {
          const msg = parseError instanceof Error ? parseError.message : String(parseError);
          console.error('[create_workout_plan] ZOD PARSE FAILED', { message: msg, args: JSON.stringify(args).slice(0, 500) });
          throw parseError;
        }

        console.error('[create_workout_plan] parsed ok', {
          userId: draftParsed.userId ?? null,
          name: draftParsed.name ?? null,
          exerciseCount: draftParsed.exercises?.length ?? 0,
          estimatedWorkoutTimeToFinish: draftParsed.estimatedWorkoutTimeToFinish ?? null,
          exercises: (draftParsed.exercises ?? []).map((e) => ({
            userExerciseId: e.userExerciseId,
            exerciseId: e.exerciseId ?? null,
            setCount: e.sets.length,
            firstSetWeight: e.sets[0]?.weight ?? null,
          })),
        });

        let resolvedUserId: string;
        try {
          resolvedUserId = await resolveWorkoutOwnerUserId({
            explicitUserId: draftParsed.userId,
            exercises: draftParsed.exercises ?? [],
          });
        } catch (resolveError) {
          const msg = resolveError instanceof Error ? resolveError.message : String(resolveError);
          console.error('[create_workout_plan] USER RESOLVE FAILED', { message: msg });
          throw resolveError;
        }
        console.error('[create_workout_plan] resolved userId', { resolvedUserId });
        await logToInspector('debug', { event: 'input', payload: draftParsed });

        let hydratedExercises: ResolvedWorkoutExerciseInput[];
        try {
          hydratedExercises = await hydrateWorkoutExercises(resolvedUserId, draftParsed.exercises ?? []);
        } catch (hydrateError) {
          const msg = hydrateError instanceof Error ? hydrateError.message : String(hydrateError);
          console.error('[create_workout_plan] HYDRATION FAILED', { message: msg });
          throw hydrateError;
        }
        console.error('[create_workout_plan] hydrated', {
          exerciseCount: hydratedExercises.length,
          exercises: hydratedExercises.map((e) => ({
            exerciseId: e.exerciseId,
            userExerciseId: e.userExerciseId,
            setCount: e.sets.length,
            firstSetWeight: e.sets[0]?.weight ?? null,
          })),
        });

        const prioritized = await prioritizeInclineChestForPushDay(hydratedExercises);
        if (prioritized.reordered) {
          await logToInspector('info', {
            event: 'reordered_push_day_incline_first',
            exerciseIds: prioritized.exercises.map((exercise) => exercise.exerciseId),
          });
        }

        const estimatedWorkoutTimeToFinish = await resolveEstimatedWorkoutTimeToFinishMinutes({
          explicitEstimatedWorkoutTimeToFinish: draftParsed.estimatedWorkoutTimeToFinish,
          exercises: prioritized.exercises,
        });

        parsed = CreateWorkoutPlanInputSchema.parse({
          ...draftParsed,
          estimatedWorkoutTimeToFinish,
        });

        // Enforce: each set must have a valid weight
        for (const exercise of prioritized.exercises) {
          if (!Array.isArray(exercise.sets)) {
            throw new Error(`Exercise ${exercise.userExerciseId}: sets array is missing or invalid`);
          }
          for (let i = 0; i < exercise.sets.length; i++) {
            const set = exercise.sets[i];
            if (!set) {
              throw new Error(`Set ${i + 1} for exercise ${exercise.userExerciseId}: set is missing or invalid`);
            }
            if (typeof set.weight !== 'number' || !Number.isFinite(set.weight) || set.weight < 0) {
              console.error('[create_workout_plan] WEIGHT VALIDATION FAILED', {
                userExerciseId: exercise.userExerciseId,
                exerciseId: exercise.exerciseId,
                setIndex: i,
                weight: set.weight,
              });
              throw new Error(
                `Set ${i + 1} for exercise ${exercise.userExerciseId}: weight is invalid (${set.weight}). Weight must be fetched from UserExercise or provided explicitly.`
              );
            }
          }
        }

        // CRITICAL: Strip hydration-only fields before saving to Workout schema
        // The schema expects only: exerciseId, userExerciseId, sets, notes
        // Extra fields like trainingType, fallbackReps, etc. are for calculation only and must not be persisted
        const cleanExercisesForWorkout = prioritized.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          userExerciseId: exercise.userExerciseId,
          sets: exercise.sets,
          notes: exercise.notes,
        }));

        let workout: IWorkout;
        try {
          workout = (await WorkoutModel.create({
            userId: resolvedUserId,
            name: parsed.name ?? 'New Workout',
            status: parsed.status ?? 'planned',
            startTime: parsed.startTime,
            endTime: parsed.endTime,
            estimatedWorkoutTimeToFinish,
            exercises: cleanExercisesForWorkout,
            notes: parsed.notes,
          })) as unknown as IWorkout;
        } catch (dbError) {
          const msg = dbError instanceof Error ? dbError.message : String(dbError);
          console.error('[create_workout_plan] DB CREATE FAILED', { message: msg, stack: dbError instanceof Error ? dbError.stack : undefined });
          throw dbError;
        }

        // VERIFICATION: Re-fetch from database to confirm exercises were persisted
        const verifyWorkout = await WorkoutModel.findById(workout._id).lean();
        if (!verifyWorkout) {
          console.error('[create_workout_plan] VERIFICATION FAILED: Workout not found after create', {
            workoutId: workout._id.toString(),
          });
          throw new Error('Workout was created but could not be retrieved for verification');
        }

        const exercisesToVerify = verifyWorkout.exercises as unknown as IWorkoutExercise[];
        if (!Array.isArray(exercisesToVerify) || exercisesToVerify.length === 0) {
          console.error('[create_workout_plan] VERIFICATION FAILED: No exercises persisted', {
            workoutId: workout._id.toString(),
            expectedExerciseCount: cleanExercisesForWorkout.length,
            actualExerciseCount: Array.isArray(exercisesToVerify) ? exercisesToVerify.length : 0,
          });
          throw new Error(
            `Workout created but exercises failed to persist. Expected ${cleanExercisesForWorkout.length} exercises, got ${Array.isArray(exercisesToVerify) ? exercisesToVerify.length : 0}`
          );
        }

        console.error('[create_workout_plan] SAVED OK (verified)', {
          workoutId: workout._id.toString(),
          userId: resolvedUserId,
          exerciseCount: exercisesToVerify.length,
          estimatedWorkoutTimeToFinish,
          firstExerciseId: exercisesToVerify[0]?.exerciseId?.toString() ?? 'missing',
          firstExerciseSetCount: exercisesToVerify[0]?.sets?.length ?? 0,
        });
        await logToInspector('info', { event: 'result', workoutId: workout._id.toString(), exerciseCount: exercisesToVerify.length });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, data: workout }),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[create_workout_plan] ERROR (returned to LLM)', { message, stack: error instanceof Error ? error.stack : undefined });
        await logToInspector('error', { event: 'error', message });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ code: 'CREATE_WORKOUT_PLAN_FAILED', message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
