import { Schema, model, Types, Document } from 'mongoose';
import type { Repetitions } from '../../domain/exercises/types.js';

// 1. SUB-SCHEMAS (Embedded Data)
// These are small and specific to THIS workout instance.

interface ISet {
  weight: number;
  reps?: Repetitions;
  rest: number;
  rpe?: number; // Rate of Perceived Exertion (1-10)
  completed: boolean;
}

const SetSchema = new Schema<ISet>({
  weight: { type: Number, required: true },
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
  rest: { type: Number, min: 0, required: true },
  rpe: { type: Number, min: 1, max: 10 },
  completed: { type: Boolean, default: false }
}, { _id: false }); // No ID needed for individual sets

export interface IWorkoutExercise {
  exerciseId: Types.ObjectId;      // Reference to Global Library (for name/image)
  userExerciseId: Types.ObjectId;  // Reference to the Bridge (for PR context)
  sets: ISet[];
  notes?: string;
}

const WorkoutExerciseSchema = new Schema<IWorkoutExercise>({
  exerciseId: { type: Schema.Types.ObjectId, ref: 'Exercise', required: true },
  userExerciseId: { type: Schema.Types.ObjectId, ref: 'UserExercise', required: true },
  sets: [SetSchema],
  notes: { type: String }
}, { _id: false });


// 2. MAIN WORKOUT SCHEMA
// This is the "Timeline" entry.

export interface IWorkout extends Document {
  userId: Types.ObjectId;
  name: string;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  startTime?: Date;
  endTime?: Date;
  estimatedWorkoutTimeToFinish: number;
  exercises: IWorkoutExercise[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WorkoutSchema = new Schema<IWorkout>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, default: 'New Workout' },
  
  status: { 
    type: String, 
    enum: ['planned', 'in_progress', 'completed', 'cancelled'], 
    default: 'planned' 
  },
  
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },
  estimatedWorkoutTimeToFinish: { type: Number, min: 1, required: true },
  
  // The list of exercises performed in THIS session
  exercises: [WorkoutExerciseSchema],
  
  notes: { type: String }
}, { 
  timestamps: true 
});

// 3. INDEXES
// Fast lookup for AI Context: "Show me the last 5 workouts for this user"
WorkoutSchema.index({ userId: 1, createdAt: -1 });

// Auto-delete old workouts after 3 months to prevent unbounded growth
WorkoutSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const WorkoutModel = model<IWorkout>('Workout', WorkoutSchema);