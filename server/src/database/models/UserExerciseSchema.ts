import { Schema, model, Types, Document } from 'mongoose';
import type { Repetitions } from '../../domain/exercises/types.js';
import { ExperienceLevel, UserModel } from './UserSchema.js';

// THE BRIDGE INTERFACE
// This document represents the "State" of a specific exercise for a specific user.
// It is NOT a log of past history (that's in Workouts).
// It IS the settings card for "Next Time".

export interface IUserExercise extends Document {
  userId: Types.ObjectId;
  exerciseId: Types.ObjectId; // Link to the Global Library (~800 exercises)
  
  // 1. THE "NOW" (AI Target)
  // The AI reads this to know what to suggest today.
  // The AI updates this after a workout based on difficulty.
  currentTarget: {
    weight: number;
    progressionMethod: 'rpe' | 'rep_range' | 'two_x_to_failure';
    reps?: Repetitions;
    sets: number;
    beginnerLastBumpAt?: Date;
    rpe?: number; // Rate of Perceived Exertion (Target Intensity 1-10)
    restSeconds?: number;
    rirMin?: number;
    rirMax?: number;
    trainingType?: 'hypertrophy' | 'strength' | 'endurance' | 'mobility';
    supersetGroup?: string;
  };
  
  // 2. THE "BEST" (Gamification)
  // Updated only when a specific threshold is crossed in a Workout Log.
  personalBest?: {
    weight: number;
    reps: Repetitions;
    sets: number;
    date: Date;
  };
  
  // 3. SETTINGS
  settings: {
    isFavorite: boolean;
    notes?: string; // e.g., "Use the wider bar"
  };

  createdAt: Date;
  updatedAt: Date;
}

const UserExerciseSchema = new Schema<IUserExercise>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  exerciseId: { type: Schema.Types.ObjectId, ref: 'Exercise', required: true },

  // The "Living" Data - This changes most frequently
  currentTarget: {
    weight: { type: Number, default: 0, min: 0, required: true },
    progressionMethod: {
      type: String,
      enum: ['rpe', 'rep_range', 'two_x_to_failure'],
      required: true,
    },
    reps: { 
      type: Schema.Types.Mixed, 
      // Optional to support beginner RPE-only progression.
      required: false,
      validate: {
        validator: (v: any) => {
          if (v === undefined || v === null) return true;
          if (typeof v === 'number') return v >= 1;
          if (v === 'FAILURE') return true;
          if (typeof v === 'string') return /^\d+-\d+$/.test(v);
          return false;
        },
        message: (props: any) => `${props.value} is not a valid repetition count, range, or "FAILURE"`
      }
    },
    sets: { type: Number, default: 3, min: 1, required: true },
    beginnerLastBumpAt: { type: Date, required: false },
    // Optional so non-beginners can use rep-range progression without RPE.
    rpe: { type: Number, min: 1, max: 10, required: false },
    restSeconds: { type: Number, min: 0, required: false },
    rirMin: { type: Number, min: 0, max: 6, required: false },
    rirMax: { type: Number, min: 0, max: 6, required: false },
    trainingType: {
      type: String,
      enum: ['hypertrophy', 'strength', 'endurance', 'mobility'],
      required: false,
    },
    supersetGroup: { type: String, required: false }
  },

  personalBest: {
    weight: { type: Number, default: 0, min: 0 },
    reps: {
      type: Schema.Types.Mixed,
      required: false,
      validate: {
        validator: (v: any) => {
          if (v === undefined || v === null) return true;
          if (typeof v === 'number') return v >= 1;
          if (v === 'FAILURE') return true;
          if (typeof v === 'string') return /^\d+-\d+$/.test(v);
          return false;
        },
        message: (props: any) => `${props.value} is not a valid repetition count, range, or "FAILURE"`,
      },
    },
    sets: { type: Number, min: 1 },
    date: { type: Date }
  },

  settings: {
    isFavorite: { type: Boolean, default: false, required: true },
    notes: { type: String, default: "" }
  }
}, { 
  timestamps: true 
});

const AUTO_BUMP_INCREMENT_KG = 2.5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasPathInUpdate(update: unknown, path: string): boolean {
  if (!isRecord(update)) return false;

  if (path in update) return true;

  const directUpdateOperators = ['$set', '$setOnInsert'];
  for (const operator of directUpdateOperators) {
    const operatorValue = update[operator];
    if (isRecord(operatorValue) && path in operatorValue) {
      return true;
    }
  }

  return false;
}

async function applyAutoWeightBumpIfEligible(input: {
  userExerciseId: Types.ObjectId;
  userId: Types.ObjectId;
  currentTargetWeight: number;
}): Promise<void> {
  const user = await UserModel.findById(input.userId)
    .select('profile.experienceLevel')
    .lean();

  if (!user || user.profile?.experienceLevel === ExperienceLevel.BEGINNER) {
    return;
  }

  const nextWeight = Number((input.currentTargetWeight + AUTO_BUMP_INCREMENT_KG).toFixed(2));

  await UserExerciseModel.updateOne(
    { _id: input.userExerciseId },
    { $set: { 'currentTarget.weight': nextWeight } }
  );
}

UserExerciseSchema.pre('validate', function () {
  const progressionMethod = this.currentTarget?.progressionMethod;
  const reps = this.currentTarget?.reps;
  const rpe = this.currentTarget?.rpe;
  const weight = this.currentTarget?.weight;

  if (progressionMethod === 'rpe' && (rpe === undefined || rpe === null)) {
    this.invalidate('currentTarget.rpe', 'rpe is required when progressionMethod is "rpe"');
  }

  if (progressionMethod === 'rep_range') {
    const isValidRepRange = typeof reps === 'string' && /^\d+-\d+$/.test(reps);
    if (!isValidRepRange) {
      this.invalidate('currentTarget.reps', 'reps must be a rep range like "8-12" when progressionMethod is "rep_range"');
    }
  }

  if (progressionMethod === 'two_x_to_failure') {
    if (reps !== 'FAILURE') {
      this.invalidate('currentTarget.reps', 'reps must be "FAILURE" when progressionMethod is "two_x_to_failure"');
    }

    const sets = this.currentTarget?.sets;
    if (sets !== 2) {
      this.invalidate('currentTarget.sets', 'sets must be 2 when progressionMethod is "two_x_to_failure"');
    }
  }

  // ENFORCE: weight must always be set (never undefined or NaN)
  if (weight === undefined || weight === null || !Number.isFinite(weight)) {
    this.invalidate('currentTarget.weight', 'weight must be a valid number');
  }
});

UserExerciseSchema.post('save', async function () {
  if (this.isNew) return;
  if (!this.isModified('personalBest')) return;
  if (this.isModified('currentTarget.weight')) return;

  const currentTargetWeight = this.currentTarget?.weight;
  if (!Number.isFinite(currentTargetWeight)) return;

  await applyAutoWeightBumpIfEligible({
    userExerciseId: this._id,
    userId: this.userId,
    currentTargetWeight,
  });
});

UserExerciseSchema.post('updateOne', async function () {
  const update = this.getUpdate();
  const personalBestChanged =
    hasPathInUpdate(update, 'personalBest') ||
    hasPathInUpdate(update, 'personalBest.weight') ||
    hasPathInUpdate(update, 'personalBest.reps') ||
    hasPathInUpdate(update, 'personalBest.sets') ||
    hasPathInUpdate(update, 'personalBest.date');

  if (!personalBestChanged) return;
  if (hasPathInUpdate(update, 'currentTarget.weight')) return;

  const queryFilter = toUserExerciseFilter(this.getFilter());

  const updatedDoc = await UserExerciseModel.findOne(queryFilter)
    .select('_id userId personalBest currentTarget.weight')
    .lean();

  if (!updatedDoc) {
    return;
  }

  const currentTargetWeight = updatedDoc.currentTarget?.weight;
  if (!Number.isFinite(currentTargetWeight)) return;

  await applyAutoWeightBumpIfEligible({
    userExerciseId: updatedDoc._id,
    userId: updatedDoc.userId,
    currentTargetWeight,
  });
});

UserExerciseSchema.post('findOneAndUpdate', async function (doc: IUserExercise | null) {
  const update = this.getUpdate();
  const personalBestChanged =
    hasPathInUpdate(update, 'personalBest') ||
    hasPathInUpdate(update, 'personalBest.weight') ||
    hasPathInUpdate(update, 'personalBest.reps') ||
    hasPathInUpdate(update, 'personalBest.sets') ||
    hasPathInUpdate(update, 'personalBest.date');

  if (!personalBestChanged) return;
  if (hasPathInUpdate(update, 'currentTarget.weight')) return;
  if (!doc) return;

  const currentTargetWeight = doc.currentTarget?.weight;
  if (!Number.isFinite(currentTargetWeight)) return;

  await applyAutoWeightBumpIfEligible({
    userExerciseId: doc._id,
    userId: doc.userId,
    currentTargetWeight,
  });
});

type UserExerciseFindFilter = Parameters<typeof UserExerciseModel.findOne>[0];

const toUserExerciseFilter = (value: unknown): UserExerciseFindFilter => {
  return (value ?? {}) as UserExerciseFindFilter;
};

// CRITICAL INDEXES
// 1. The 1:1 Enforcer: A user cannot have two "Bench Press" cards.
UserExerciseSchema.index({ userId: 1, exerciseId: 1 }, { unique: true });

// 2. The Dashboard Fetch: Quickly get all exercises for a user (e.g., for the "Add Exercise" screen)
UserExerciseSchema.index({ userId: 1 });

// Auto-delete old user-exercise entries after 3 months to prevent unbounded growth
UserExerciseSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const UserExerciseModel = model<IUserExercise>('UserExercise', UserExerciseSchema);