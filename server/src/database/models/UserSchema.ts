import { Schema, model, Document } from 'mongoose';
import argon2 from 'argon2';
import { WORKOUT_SPLIT_VALUES, type WorkoutSplit } from '../../domain/users/workoutSplits.js';

// 1. ENUMS (Strict types for AI Logic)
// These constrain the AI to specific "Modes" of coaching.

export enum ExperienceLevel {
  BEGINNER = 'BEGINNER',       // Linear progression
  INTERMEDIATE = 'INTERMEDIATE', // Periodization
  ADVANCED = 'ADVANCED'        // Wave loading / specialization
}

export enum FitnessGoal {
  STRENGTH = 'STRENGTH',       // Low reps, high weight
  HYPERTROPHY = 'HYPERTROPHY', // Moderate reps, volume focus
  ENDURANCE = 'ENDURANCE',     // High reps, cardio focus
  WEIGHT_LOSS = 'WEIGHT_LOSS'  // Caloric burn focus
}

export enum UnitSystem {
  METRIC = 'METRIC', // kg, cm
  IMPERIAL = 'IMPERIAL' // lbs, inches
}

// 2. INTERFACE
export interface IUser extends Document {
  email: string;
  name: string;
  password: string;
  authId?: string; // For external auth (e.g., Firebase/Auth0) if needed later
  refreshTokenHash?: string;
  refreshTokenExpiresAt?: Date;
  
  // The "Physical Context" - AI reads this to calculate Baselines
  profile: {
    age: number;
    weight: number; // Stored in kg
    height: number; // Stored in cm
    experienceLevel: ExperienceLevel;
    goal: FitnessGoal;
    isMedicallyCleared: boolean; // Safety Guardrail
    comfortableWithHeavierWeights: boolean;
    workoutDurationMinutes: number;
    workoutFrequencyPerWeek: number;
    availableEquipment?: string[];
    WorkoutSplit?: WorkoutSplit;
    pendingSplitSuggestion?: boolean;
  };

  // User Preferences
  settings: {
    units: UnitSystem;
    theme: 'light' | 'dark';
  };

  createdAt: Date;
  updatedAt: Date;

  correctPassword(candidatePassword: string): Promise<boolean>;
}

// 3. SCHEMA
const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true },
  password: { type: String, required: true, select: false },
  authId: { type: String }, // Optional placeholder for future Auth integration
  refreshTokenHash: { type: String, select: false },
  refreshTokenExpiresAt: { type: Date, select: false },

  profile: {
    age: { type: Number },
    weight: { type: Number, required: true },
    height: { type: Number, required: true },
    
    experienceLevel: { 
      type: String, 
      enum: Object.values(ExperienceLevel), 
      default: ExperienceLevel.BEGINNER 
    },
    
    goal: { 
      type: String, 
      enum: Object.values(FitnessGoal), 
      default: FitnessGoal.HYPERTROPHY 
    },
    comfortableWithHeavierWeights: { type: Boolean, required: true },
    workoutDurationMinutes: { type: Number, min: 5, max: 240, required: true },
    workoutFrequencyPerWeek: { type: Number, min: 1, max: 7, required: true, default: 3 },
    availableEquipment: { type: [String], default: [] },
    WorkoutSplit: { type: String, enum: WORKOUT_SPLIT_VALUES, trim: true },
    pendingSplitSuggestion: { type: Boolean, default: false },
    
    // Safety Check: AI should refuse to generate high-intensity workouts if false
    isMedicallyCleared: { type: Boolean, default: false, required: true },
  },

  settings: {
    units: { 
      type: String, 
      enum: Object.values(UnitSystem), 
      default: UnitSystem.METRIC 
    },
    theme: { type: String, default: 'dark' },
    // Workout preference inputs for plan generation
    
    // Approximate number of workouts per week the user prefers
    
  }
}, { 
  timestamps: true 
});

UserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;

  if (typeof this.password !== 'string') {
    throw new Error('Password must be a string');
  }

  this.password = await argon2.hash(this.password, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16,
    timeCost: 3,
    parallelism: 1,
  });
});

UserSchema.methods.correctPassword = async function (candidatePassword: string): Promise<boolean> {
  return argon2.verify(this.password, candidatePassword);
};

export const UserModel = model<IUser>('User', UserSchema);