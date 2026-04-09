import mongoose, { Schema, Document } from 'mongoose';
import {
  type Exercise,
  MuscleGroupEnum,
  EquipmentEnum,
} from '../../domain/exercises/types.js';

const FORCE_ENUM = ['push', 'pull', 'legs'] as const;
const CATEGORY_ENUM = ['strength', 'hypertrophy', 'endurance', 'mobility'] as const;
const TYPICAL_WEIGHT_ENUM = ['bodyweight', 'light', 'moderate', 'heavy'] as const;

// 🔧 TYPE FIX:
// Mongoose uses '_id' automatically. Our Domain 'Exercise' type has 'id'.
// We tell Mongoose: "This schema matches 'Exercise', except for the 'id' field."
interface ExerciseDocument extends Omit<Exercise, 'id'>, Document {}

const ExerciseSchema = new mongoose.Schema<ExerciseDocument>({
  name: { 
    type: String, 
    required: true, 
    index: true 
  },

  // Enums must use Object.values() to pass the list of strings to Mongoose
  targetMuscle: {
    type: String,
    required: true,
    enum: MuscleGroupEnum.options,
  },

  secondaryMuscles: [{
    type: String,
    required: true,
    enum: MuscleGroupEnum.options,
  }],

 /* mechanic: { 
    type: String, 
    required: true, 
   
  },
*/
  equipment: {
    type: String,
    required: true,
    enum: EquipmentEnum.options,
  },

  compound: {
    type: Boolean,
    required: true,
    default: false,
  },

  force: {
    type: String,
    required: true,
    enum: FORCE_ENUM,
  },

  category: {
    type: [String],
    required: true,
    enum: CATEGORY_ENUM,
    validate: {
      validator: (value: string[]) => Array.isArray(value) && value.length >= 1 && value.length <= 2,
      message: 'category must have 1 or 2 items (primary at index 0)'
    }
  },
  possibleInjuries: {
    type: [String],
    required: true,
    default: [],
  },
  formTips: {
    type: [String],
    required: true,
    validate: {
      validator: (value: string[]) => Array.isArray(value) && value.length > 0,
      message: 'formTips must have at least one item',
    },
  },
}, { 
  timestamps: true,
  toJSON: { virtuals: true }, // Allows you to access .id (virtual)
  toObject: { virtuals: true }
});

// ✅ EXPORT THE VALUE:
// This creates the actual Database Interactor.
export const ExerciseModel = mongoose.model<ExerciseDocument>('Exercise', ExerciseSchema);