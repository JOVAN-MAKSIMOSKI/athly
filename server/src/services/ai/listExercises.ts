import { ExerciseModel } from '../../database/models/ExerciseSchema.js';

export interface AiExerciseRecord {
  text: string;        // → becomes the vector
  metadata: {
    id: string;
    name: string;
    targetMuscle: string;
    secondaryMuscles: string[];   // flattened: "hamstrings, glutes"
    equipment: string;
    compound: boolean;
    force: string;
    category: string[];           // flattened: "hypertrophy, strength"
    possibleInjuries: string[];   // flattened: "ankle, knee"
    formTips: string[];         // kept as array, not used for filtering
  };
}

interface LeanExerciseDoc {
  _id: unknown;
  name: string;
  targetMuscle: string;
  secondaryMuscles?: string[];
  equipment: string;
  compound: boolean;
  force: string;
  category?: string[];
  possibleInjuries?: string[];
  formTips?: string[];
}

export async function listExercisesForAi(): Promise<AiExerciseRecord[]> {
  const docs = (await ExerciseModel.find({}).sort({ name: 1 }).lean()) as LeanExerciseDoc[];

  return docs.map((doc) => {
    const secondaryMuscles = (doc.secondaryMuscles || []).join(', ') || 'none';
    const category = (doc.category || []).join(', ') || 'none';
    const compound = doc.compound ? 'compound' : 'isolation';

    return {
      // Clean focused text → this becomes the vector
      text: [
        `${doc.name}.`,
        `Target muscle: ${doc.targetMuscle}.`,
        `Secondary muscles: ${secondaryMuscles}.`,
        `Equipment: ${doc.equipment}.`,
        `Force: ${doc.force}.`,
        `Type: ${compound}.`,
        `Category: ${category}.`,
      ].join(' '),

      metadata: {
        id: String(doc._id),
        name: doc.name,
        targetMuscle: doc.targetMuscle,
        secondaryMuscles: doc.secondaryMuscles || [],            // array for filtering
        equipment: doc.equipment,
        compound: doc.compound,
        force: doc.force,
        category: doc.category || [],                    // array for filtering
        possibleInjuries: doc.possibleInjuries || [],
        formTips: doc.formTips || [],  // array is fine, not filtered
      },
    };
  });
}