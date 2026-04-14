import express, { type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { WorkoutModel } from '../database/models/WorkoutSchema.js';
import { UserExerciseModel } from '../database/models/UserExerciseSchema.js';
import { ExerciseModel } from '../database/models/ExerciseSchema.js';
import { embedTexts } from '../services/ai/embeddings.js';
import { searchExerciseVectors, type ExerciseSearchFilters, type ExerciseVectorHit } from '../services/ai/qdrant.js';

type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
  };
};

type ProgressionMethod = 'rpe' | 'rep_range' | 'two_x_to_failure';

type ExistingCurrentTarget = {
  progressionMethod?: ProgressionMethod;
  weight?: unknown;
  sets?: unknown;
  reps?: unknown;
  rpe?: unknown;
};

type ExistingSettings = {
  isFavorite?: unknown;
  notes?: unknown;
};

const router = express.Router();

function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toExerciseSearchFilters(value: unknown): ExerciseSearchFilters | undefined {
  if (!isRecord(value)) return undefined;

  const targetMuscle = toOptionalString(value.targetMuscle);
  const equipment = toOptionalString(value.equipment);
  const force = toOptionalString(value.force);
  const compound = typeof value.compound === 'boolean' ? value.compound : undefined;

  if (!targetMuscle && !equipment && !force && typeof compound !== 'boolean') {
    return undefined;
  }

  return {
    targetMuscle,
    equipment,
    force,
    compound,
  };
}

function tokenizeExerciseName(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

async function searchExerciseFallbackInDb(input: {
  currentExerciseId: string;
  currentExerciseName?: string;
  currentTargetMuscle?: string;
  filters?: ExerciseSearchFilters;
  limit: number;
}): Promise<ExerciseVectorHit[]> {
  const query: Record<string, unknown> = {
    _id: { $ne: new mongoose.Types.ObjectId(input.currentExerciseId) },
  };

  const targetMuscle = input.filters?.targetMuscle ?? input.currentTargetMuscle;
  if (targetMuscle) {
    query.targetMuscle = targetMuscle;
  }

  if (input.filters?.equipment) {
    query.equipment = input.filters.equipment;
  }

  if (input.filters?.force) {
    query.force = input.filters.force;
  }

  if (typeof input.filters?.compound === 'boolean') {
    query.compound = input.filters.compound;
  }

  const candidates = await ExerciseModel.find(query)
    .select('_id name equipment formTips targetMuscle secondaryMuscles compound force category possibleInjuries')
    .limit(Math.max(input.limit * 4, 12))
    .lean();

  const nameTokens = new Set(tokenizeExerciseName(input.currentExerciseName));

  const ranked = candidates
    .map((candidate) => {
      const candidateTokens = tokenizeExerciseName(candidate.name);
      const sharedTokenCount = candidateTokens.reduce(
        (count, token) => (nameTokens.has(token) ? count + 1 : count),
        0
      );

      const score = [
        candidate.equipment === input.filters?.equipment ? 3 : 0,
        candidate.targetMuscle === targetMuscle ? 2 : 0,
        sharedTokenCount > 0 ? 1 / (1 + sharedTokenCount) : 1,
      ].reduce((sum, value) => sum + value, 0);

      return {
        id: String(candidate._id),
        score,
        payload: {
          text: candidate.name,
          metadata: {
            id: String(candidate._id),
            name: candidate.name,
            targetMuscle: candidate.targetMuscle,
            secondaryMuscles: Array.isArray(candidate.secondaryMuscles) ? candidate.secondaryMuscles : [],
            equipment: candidate.equipment,
            compound: candidate.compound,
            force: candidate.force,
            category: Array.isArray(candidate.category) ? candidate.category : [],
            possibleInjuries: Array.isArray(candidate.possibleInjuries) ? candidate.possibleInjuries : [],
            formTips: Array.isArray(candidate.formTips) ? candidate.formTips.filter((entry): entry is string => typeof entry === 'string') : [],
          },
        },
      } satisfies ExerciseVectorHit;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit);

  return ranked;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeNumberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const compact = value.replace(',', '.').trim();
    const parsed = Number(compact);
    if (Number.isFinite(parsed)) {
      return parsed;
    }

    // Defensive fallback for legacy values like "20 kg".
    const numericToken = compact.match(/-?\d+(?:\.\d+)?/);
    if (numericToken) {
      const extracted = Number(numericToken[0]);
      if (Number.isFinite(extracted)) {
        return extracted;
      }
    }
  }

  if (isRecord(value)) {
    const decimal128 = value.$numberDecimal;
    const int32 = value.$numberInt;
    const int64 = value.$numberLong;
    const candidate = typeof decimal128 === 'string' ? decimal128 : typeof int32 === 'string' ? int32 : typeof int64 === 'string' ? int64 : null;
    if (candidate) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return fallback;
}

function normalizeRepsValue(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
 
    // Preserve rep ranges like "8-10", "8–10", "8 to 10" before any numeric parsing.
    const rangeMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)$/i);
    if (rangeMatch) {
      const lo = Number(rangeMatch[1]);
      const hi = Number(rangeMatch[2]);
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        return `${Math.min(lo, hi)}-${Math.max(lo, hi)}`;
      }
    }

    if (trimmed === 'FAILURE') {
      return trimmed;
    }

    const asNumber = normalizeNumberValue(trimmed, Number.NaN);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }

    return trimmed;
  }

  if (isRecord(value)) {
    // Handle BSON wrappers like { $numberInt: "8" } and { $numberDecimal: "8.0" }.
    const directNumeric = normalizeNumberValue(value, Number.NaN);
    if (Number.isFinite(directNumeric)) {
      return directNumeric;
    }

    const min = normalizeNumberValue(value.min, Number.NaN);
    const max = normalizeNumberValue(value.max, Number.NaN);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return `${min}-${max}`;
    }

    const candidate = value.value;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return undefined;
}

router.get('/', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.auth?.userId;

  if (!userId) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Missing authenticated user' });
    return;
  }

  const workouts = await WorkoutModel.find({ userId })
    .sort({ createdAt: -1 })
    .populate('exercises.exerciseId', 'name formTips equipment')
    .populate('exercises.userExerciseId', 'currentTarget.weight')
    .lean();

  const normalized = workouts.map((workout) => ({
    id: String(workout._id),
    name: typeof workout.name === 'string' && workout.name.trim().length > 0 ? workout.name : 'Workout',
    status: workout.status,
    createdAt: workout.createdAt,
    estimatedWorkoutTimeToFinish: Math.max(1, Math.floor(normalizeNumberValue(workout.estimatedWorkoutTimeToFinish, 1))),
    exercises: Array.isArray(workout.exercises)
      ? workout.exercises.map((exercise) => {
          const exerciseDoc =
            exercise.exerciseId && typeof exercise.exerciseId === 'object' ? exercise.exerciseId : null;
          const userExerciseDoc =
            exercise.userExerciseId && typeof exercise.userExerciseId === 'object' ? exercise.userExerciseId : null;

          const currentTargetWeight =
            userExerciseDoc && 'currentTarget' in userExerciseDoc && isRecord((userExerciseDoc as { currentTarget?: unknown }).currentTarget)
              ? normalizeNumberValue(((userExerciseDoc as { currentTarget: { weight?: unknown } }).currentTarget).weight, Number.NaN)
              : Number.NaN;

          const shouldUseCurrentTargetWeight =
            (workout.status === 'planned' || workout.status === 'in_progress') && Number.isFinite(currentTargetWeight);

          const rawName =
            exerciseDoc && 'name' in exerciseDoc && typeof exerciseDoc.name === 'string'
              ? exerciseDoc.name
              : 'Unknown exercise';

          const rawEquipment =
            exerciseDoc && 'equipment' in exerciseDoc && typeof exerciseDoc.equipment === 'string'
              ? exerciseDoc.equipment
              : undefined;

          const rawFormTips =
            exerciseDoc && 'formTips' in exerciseDoc && Array.isArray((exerciseDoc as { formTips?: unknown }).formTips)
              ? ((exerciseDoc as { formTips: unknown[] }).formTips).filter((t): t is string => typeof t === 'string')
              : [];

          return {
            exerciseId:
              exerciseDoc && '_id' in exerciseDoc
                ? String(exerciseDoc._id)
                : String(exercise.exerciseId),
            userExerciseId:
              userExerciseDoc && '_id' in userExerciseDoc
                ? String(userExerciseDoc._id)
                : String(exercise.userExerciseId),
            exerciseName: rawName,
            equipment: rawEquipment,
            formTips: rawFormTips,
            notes: exercise.notes,
            sets: Array.isArray(exercise.sets)
              ? exercise.sets.map((set) => ({
                  weight: shouldUseCurrentTargetWeight
                    ? (currentTargetWeight as number)
                    : normalizeNumberValue(set.weight, 0),
                  reps: normalizeRepsValue(set.reps),
                  rest: Math.max(0, Math.floor(normalizeNumberValue(set.rest, 0))),
                  rpe: (() => {
                    const normalizedRpe = normalizeNumberValue(set.rpe, Number.NaN);
                    return Number.isFinite(normalizedRpe) ? normalizedRpe : undefined;
                  })(),
                  completed: Boolean(set.completed),
                }))
              : [],
          };
        })
      : [],
  }));

  res.status(200).json({
    status: 'success',
    data: {
      workouts: normalized,
    },
  });
});

router.post('/replace-exercise', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.auth?.userId;

  if (!userId) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Missing authenticated user' });
    return;
  }

  const payload = isRecord(req.body) ? req.body : null;
  const workoutId = payload && isObjectId(payload.workoutId) ? payload.workoutId : null;
  const userExerciseId = payload && isObjectId(payload.userExerciseId) ? payload.userExerciseId : null;
  const query = payload ? toOptionalString(payload.query) : undefined;
  const limitRaw = payload ? normalizeNumberValue(payload.limit, 5) : 5;
  const limit = Math.max(1, Math.min(10, Math.floor(limitRaw)));
  const filters = payload ? toExerciseSearchFilters(payload.filters) : undefined;

  if (!workoutId || !userExerciseId) {
    res.status(400).json({
      code: 'WORKOUT_REPLACE_VALIDATION_FAILED',
      message: 'workoutId and userExerciseId are required ObjectId strings',
    });
    return;
  }

  const workout = await WorkoutModel.findOne({ _id: workoutId, userId }).lean();
  if (!workout) {
    res.status(404).json({ code: 'WORKOUT_NOT_FOUND', message: 'Workout not found' });
    return;
  }

  const exerciseIndex = Array.isArray(workout.exercises)
    ? workout.exercises.findIndex((exercise) => String(exercise.userExerciseId) === userExerciseId)
    : -1;

  if (exerciseIndex < 0) {
    res.status(404).json({
      code: 'WORKOUT_EXERCISE_NOT_FOUND',
      message: 'Workout exercise entry not found for the provided userExerciseId',
    });
    return;
  }

  const currentRow = workout.exercises[exerciseIndex]!;
  const currentExerciseId = String(currentRow.exerciseId);

  const [currentExercise, existingUserExercise] = await Promise.all([
    ExerciseModel.findById(currentExerciseId).select('name targetMuscle equipment').lean(),
    UserExerciseModel.findById(userExerciseId).select('currentTarget settings').lean(),
  ]);

  if (!existingUserExercise) {
    res.status(404).json({
      code: 'USER_EXERCISE_NOT_FOUND',
      message: 'UserExercise not found for the provided userExerciseId',
    });
    return;
  }

  const resolvedQuery =
    query ??
    [
      'Find a replacement exercise for',
      currentExercise?.name ?? 'this exercise',
      currentExercise?.targetMuscle ? `targeting ${currentExercise.targetMuscle}` : null,
      currentExercise?.equipment ? `with ${currentExercise.equipment} equipment` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' ');

  let queryVector: number[];
  try {
    const vectors = await embedTexts([resolvedQuery]);
    queryVector = vectors[0]!;
  } catch (error) {
    console.error('[replace-exercise] embedding failed', {
      userId,
      workoutId,
      userExerciseId,
      query: resolvedQuery,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(502).json({
      code: 'WORKOUT_REPLACE_EMBEDDING_FAILED',
      message: error instanceof Error ? error.message : 'Failed to generate embedding for replacement search',
    });
    return;
  }

  let hits: Awaited<ReturnType<typeof searchExerciseVectors>>;
  try {
    hits = await searchExerciseVectors(queryVector, limit, filters);
  } catch (error) {
    console.error('[replace-exercise] vector search failed', {
      userId,
      workoutId,
      userExerciseId,
      limit,
      filters,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    hits = await searchExerciseFallbackInDb({
      currentExerciseId,
      currentExerciseName: currentExercise?.name,
      currentTargetMuscle: currentExercise?.targetMuscle,
      filters,
      limit,
    });

    console.warn('[replace-exercise] using db fallback search', {
      userId,
      workoutId,
      userExerciseId,
      fallbackHits: hits.length,
    });
  }

  const candidateHit = hits.find((hit) => {
    const hitId = hit.payload?.metadata?.id;
    return typeof hitId === 'string' && hitId !== currentExerciseId;
  });

  if (!candidateHit || !candidateHit.payload?.metadata?.id) {
    res.status(404).json({
      code: 'REPLACEMENT_NOT_FOUND',
      message: 'No suitable replacement exercise found',
    });
    return;
  }

  const replacementExerciseId = String(candidateHit.payload.metadata.id);
  const replacementExercise = await ExerciseModel.findById(replacementExerciseId)
    .select('name equipment formTips')
    .lean();

  if (!replacementExercise) {
    res.status(404).json({
      code: 'REPLACEMENT_EXERCISE_MISSING',
      message: 'Replacement exercise was not found in the exercise library',
    });
    return;
  }

  const existingTarget: ExistingCurrentTarget = isRecord(existingUserExercise.currentTarget)
    ? (existingUserExercise.currentTarget as ExistingCurrentTarget)
    : {};
  const progressionMethod =
    existingTarget.progressionMethod === 'rpe' ||
    existingTarget.progressionMethod === 'rep_range' ||
    existingTarget.progressionMethod === 'two_x_to_failure'
      ? existingTarget.progressionMethod
      : 'rep_range';

  const fallbackWeight = normalizeNumberValue(existingTarget.weight, 10);
  const baselineWeight = Number.isFinite(fallbackWeight) ? Math.max(0, fallbackWeight) : 10;
  const baselineSets = Math.max(1, Math.floor(normalizeNumberValue(existingTarget.sets, 3)));
  const existingReps = normalizeRepsValue(existingTarget.reps);
  const baselineReps =
    progressionMethod === 'two_x_to_failure'
      ? 'FAILURE'
      : progressionMethod === 'rep_range'
        ? typeof existingReps === 'string' && /^\d+-\d+$/.test(existingReps)
          ? existingReps
          : '8-12'
        : existingReps;
  const baselineRpe = progressionMethod === 'rpe'
    ? (() => {
        const candidate = normalizeNumberValue(existingTarget.rpe, 8);
        return Number.isFinite(candidate) ? candidate : 8;
      })()
    : undefined;

  const baselineSettings: ExistingSettings = isRecord(existingUserExercise.settings)
    ? (existingUserExercise.settings as ExistingSettings)
    : {};

  const session = await mongoose.startSession();
  let newUserExerciseId = '';

  try {
    await session.withTransaction(async () => {
      // Reuse existing user+exercise card or create it atomically on first use.
      const userExerciseToUse = await UserExerciseModel.findOneAndUpdate(
        {
          userId,
          exerciseId: replacementExerciseId,
        },
        {
          $setOnInsert: {
            currentTarget: {
              weight: baselineWeight,
              progressionMethod,
              reps: baselineReps,
              sets: progressionMethod === 'two_x_to_failure' ? 2 : baselineSets,
              rpe: baselineRpe,
            },
            settings: {
              isFavorite: Boolean(baselineSettings.isFavorite),
              notes: typeof baselineSettings.notes === 'string' ? baselineSettings.notes : '',
            },
          },
        },
        {
          upsert: true,
          new: true,
          session,
        }
      );

      if (!userExerciseToUse) {
        throw new Error('Failed to resolve replacement UserExercise');
      }

      newUserExerciseId = String(userExerciseToUse!._id);

      const updateResult = await WorkoutModel.updateOne(
        {
          _id: workoutId,
          userId,
          'exercises.userExerciseId': userExerciseId,
        },
        {
          $set: {
            'exercises.$.exerciseId': replacementExerciseId,
            'exercises.$.userExerciseId': userExerciseToUse!._id,
          },
        },
        { session }
      );

      if (!updateResult.matchedCount) {
        throw new Error('Workout exercise replacement update failed');
      }
    });
  } catch (error) {
    res.status(500).json({
      code: 'WORKOUT_REPLACE_FAILED',
      message: error instanceof Error ? error.message : 'Failed to replace workout exercise',
    });
    return;
  } finally {
    await session.endSession();
  }

  const normalizedSets = Array.isArray(currentRow.sets)
    ? currentRow.sets.map((set) => ({
        weight: normalizeNumberValue(set.weight, 0),
        reps: normalizeRepsValue(set.reps),
        rest: Math.max(0, Math.floor(normalizeNumberValue(set.rest, 0))),
        rpe: (() => {
          const normalizedRpe = normalizeNumberValue(set.rpe, Number.NaN);
          return Number.isFinite(normalizedRpe) ? normalizedRpe : undefined;
        })(),
        completed: Boolean(set.completed),
      }))
    : [];

  res.status(200).json({
    status: 'success',
    data: {
      oldExerciseId: currentExerciseId,
      newExerciseId: replacementExerciseId,
      newUserExerciseId,
      score: candidateHit.score,
      updatedExercise: {
        exerciseId: replacementExerciseId,
        userExerciseId: newUserExerciseId,
        exerciseName: replacementExercise.name,
        equipment: replacementExercise.equipment,
        formTips: Array.isArray(replacementExercise.formTips)
          ? replacementExercise.formTips.filter((entry): entry is string => typeof entry === 'string')
          : [],
        notes: currentRow.notes,
        sets: normalizedSets,
      },
    },
  });
});

export default router;