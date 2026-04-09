import type { CreateExerciseInput, Equipment, MuscleGroup } from '../domain/exercises/types.js';

const MUSCLE_MAP: Record<string, MuscleGroup> = {
  'anterior deltoid': 'front-delts',
  'deltoids': 'lateral-delts',
  'posterior deltoid': 'rear-delts',
  'pectoralis major': 'mid-chest',
  'serratus anterior': 'upper-chest',
  'latissimus dorsi': 'lats',
  'trapezius': 'traps',
  'teres major': 'middle-back',
  'rhomboids': 'romboids',
  'biceps brachii': 'bicep-short-head',
  'brachialis': 'brachialis',
  'brachioradialis': 'brachioradialis',
  'triceps brachii': 'triceps-lateral-head',
  'quadriceps femoris': 'quads',
  'gluteus maximus': 'glutes',
  'biceps femoris': 'hamstrings',
  'gastrocnemius': 'calves',
  'soleus': 'calves',
  'rectus abdominis': 'mid-abs',
  'obliquus externus abdominis': 'obliques',
};

const EQUIPMENT_MAP: Record<string, Equipment> = {
  'barbell': 'barbell',
  'dumbbell': 'dumbbell',
  'sz-bar': 'barbell',
  'gym mat': 'bodyweight',
  'none (bodyweight exercise)': 'bodyweight',
  'pull-up bar': 'pull-up-bar',
  'kettlebell': 'kettlebell',
  'bench': 'bodyweight',
  'barbell + bench': 'barbell + bench',
  'dumbbell + bench': 'dumbbell + bench',
  'machine': 'machine',
  'cable': 'cable',
  'smith machine': 'smith-machine',
  'resistance band': 'resistance-band',
};

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

function inferForce(name: string): CreateExerciseInput['force'] {
  const lowerName = name.toLowerCase();

  if (lowerName.includes('squat') || lowerName.includes('lunge') || lowerName.includes('leg')) {
    return 'legs';
  }

  if (lowerName.includes('row') || lowerName.includes('pull') || lowerName.includes('curl') || lowerName.includes('deadlift')) {
    return 'pull';
  }

  return 'push';
}

function parseCompound(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return false;
}

export function mapRawToExercise(raw: Record<string, unknown>): CreateExerciseInput | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) {
    return null;
  }

  const primaryMuscles = toStringArray(raw.primary_muscles);
  const primaryMapped = primaryMuscles
    .map((muscle) => MUSCLE_MAP[muscle.toLowerCase()])
    .filter((muscle): muscle is MuscleGroup => Boolean(muscle));

  const targetMuscle = primaryMapped[0];
  if (!targetMuscle) {
    return null;
  }

  const secondaryMuscles = [...new Set(primaryMapped.slice(1))].filter(
    (muscle) => muscle !== targetMuscle
  );

  const rawEquipList = toStringArray(raw.equipment);
  const rawEquip = (rawEquipList[0] ?? '').toLowerCase();
  const equipment = EQUIPMENT_MAP[rawEquip] ?? 'machine';

  const possibleInjuries = toStringArray(raw.possible_injuries);
  const formTips = toStringArray(raw.form_tips);

  return {
    name,
    targetMuscle,
    secondaryMuscles,
    equipment,
    compound: parseCompound(raw.compound),
    force: inferForce(name),
    category: ['strength'],
    possibleInjuries,
    formTips: formTips.length > 0 ? formTips : ['No tips available.'],
  };
}