import express, { type Request, type Response } from 'express';
import { WorkoutModel } from '../database/models/WorkoutSchema.js';

type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
  };
};

const router = express.Router();

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
            userExerciseId: String(exercise.userExerciseId),
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

export default router;