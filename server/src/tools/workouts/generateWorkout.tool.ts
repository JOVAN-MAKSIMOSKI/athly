import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ExerciseModel } from '../../database/models/ExerciseSchema.js';
import { UserExerciseModel } from '../../database/models/UserExerciseSchema.js';
import {
  ExperienceLevel,
  FitnessGoal,
  UserModel,
} from '../../database/models/UserSchema.js';
import { WorkoutModel } from '../../database/models/WorkoutSchema.js';
import type { Equipment, MuscleGroup } from '../../domain/exercises/types.js';
import {
  buildWorkoutTargets,
  estimateWorkoutDurationMinutes,
  type WorkoutTargetInputExercise,
  type MovementType,
  type TrainingType,
} from '../../domain/workout/generationTargets.js';
import { isUniversalExerciseName } from '../../domain/workout/universalExercises.js';
import { ensureUserExperienceLevel } from '../../domain/users/experienceProgression.js';
import { detectWorkoutSplitFromText, type WorkoutSplit } from '../../domain/users/workoutSplits.js';

type ToolTextContent = { type: 'text'; text: string };

type ToolResponse = {
  content: ToolTextContent[];
  isError?: true;
};

type FocusType =
  | 'push'
  | 'pull'
  | 'legs'
  | 'arms'
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'upper_body'
  | 'lower_body'
  | 'full_body';

type ForceType = 'push' | 'pull' | 'legs';

type SelectionSlot = {
  key: string;
  targetMuscles: MuscleGroup[];
  primaryTargetOnly?: boolean;
  force?: ForceType;
  movementType?: MovementType;
  preferredKeywords?: string[];
  prohibitedKeywords?: string[];
};

type CandidateExercise = {
  _id: unknown;
  name: string;
  targetMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment;
  compound: boolean;
  force: ForceType;
  category: string[];
  possibleInjuries: string[];
};

type CandidateScoreEntry = {
  candidate: CandidateExercise;
  score: number;
};

type ExistingUserExerciseState = {
  currentTargetWeight?: number;
  personalBestWeight?: number;
  isFavorite: boolean;
  notes?: string;
};

type RecentExerciseUsage = {
  recentUseCountByExerciseId: Map<string, number>;
  lastWorkoutExerciseIds: Set<string>;
  /** The _id of the most recently saved workout, stringified. Null for users with no history. Included in the selection seed so that each new workout produces a different random pick even within the same calendar day. */
  mostRecentWorkoutId: string | null;
};

type ParsedWorkoutRequest = {
  focus: FocusType;
  focusLabel: string;
  trainingType: TrainingType;
  allowedEquipment?: Equipment[];
  excludedNameKeywords: string[];
  respectedConstraints: string[];
  mentionedSpecificSplit: boolean;
};

const ObjectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Expected a 24-character hex ObjectId')
  .describe('MongoDB ObjectId string reference');

const GenerateWorkoutInputSchema = z
  .object({
    userId: ObjectIdSchema.describe('User ObjectId to generate the workout for'),
    request: z.string().min(1).describe('Raw user workout request in natural language'),
  })
  .describe('Inputs for atomic workout generation and persistence');

const generateWorkoutToolDefinition = {
  name: 'athly.generate_workout',
  description:
    'Generates and saves a workout atomically from the user request. Use this as the authoritative workout tool instead of chaining profile/search/user-exercise/workout-save tools manually. RESPONSE FORMAT: Return JSON only in content[0].text with {"success":true,"data":{...}} on success, or {"code":"...","message":"..."} with isError=true on failure. Do not include markdown, emojis, or narrative text.',
  inputSchema: GenerateWorkoutInputSchema,
  restricted: false,
};

const VALID_EQUIPMENT: Equipment[] = [
  'barbell',
  'barbell + bench',
  'dumbbell',
  'dumbbell + bench',
  'kettlebell',
  'bodyweight',
  'machine',
  'cable',
  'smith-machine',
  'pull-up-bar',
  'resistance-band',
];

const EQUIPMENT_TERM_MAP: Array<{ pattern: RegExp; equipment: Equipment[]; label: string }> = [
  { pattern: /dumbbells?|dbs?/i, equipment: ['dumbbell', 'dumbbell + bench'], label: 'dumbbells' },
  { pattern: /barbells?/i, equipment: ['barbell', 'barbell + bench'], label: 'barbell' },
  { pattern: /bench/i, equipment: ['barbell + bench', 'dumbbell + bench'], label: 'bench-based' },
  { pattern: /machines?/i, equipment: ['machine', 'smith-machine'], label: 'machines' },
  { pattern: /smith/i, equipment: ['smith-machine'], label: 'smith machine' },
  { pattern: /cables?/i, equipment: ['cable'], label: 'cable' },
  { pattern: /bands?|resistance\s*bands?/i, equipment: ['resistance-band'], label: 'bands' },
  { pattern: /bodyweight/i, equipment: ['bodyweight'], label: 'bodyweight' },
  { pattern: /pull[ -]?up\s*bar/i, equipment: ['pull-up-bar'], label: 'pull-up bar' },
  { pattern: /kettlebells?/i, equipment: ['kettlebell'], label: 'kettlebell' },
];

const FOCUS_TEMPLATES: Record<FocusType, SelectionSlot[]> = {
  push: [
    { key: 'incline_upper_chest', targetMuscles: ['upper-chest'], primaryTargetOnly: true, force: 'push', movementType: 'compound', preferredKeywords: ['incline', 'press'] },
    { key: 'pec_fly_iso', targetMuscles: ['pecs'], primaryTargetOnly: true, force: 'push', movementType: 'isolation', preferredKeywords: ['fly', 'pec', 'crossover'], prohibitedKeywords: ['dip', 'press', 'decline', 'incline'] },
    { key: 'mid_chest_compound', targetMuscles: ['mid-chest'], primaryTargetOnly: true, force: 'push', movementType: 'compound', preferredKeywords: ['bench', 'press', 'machine'], prohibitedKeywords: ['fly', 'crossover', 'decline', 'incline'] },
    { key: 'lateral_delt_iso', targetMuscles: ['lateral-delts'], primaryTargetOnly: true, movementType: 'isolation', preferredKeywords: ['lateral raise', 'raise','side'], prohibitedKeywords: ['calf','front','rear'] },
    { key: 'triceps_short_head', targetMuscles: ['triceps-lateral-head', 'triceps-medial-head'], primaryTargetOnly: true, force: 'push', movementType: 'isolation', preferredKeywords: ['triceps pushdown', 'tricepspressdown', 'dip'], prohibitedKeywords: ['extension', 'overhead', 'skull'] },
    { key: 'triceps_long_head', targetMuscles: ['triceps-long-head'], primaryTargetOnly: true, force: 'push', movementType: 'isolation', preferredKeywords: ['extension', 'overhead', 'skull'], prohibitedKeywords: ['pushdown', 'pressdown', 'dip','raise'] },
  ],
  pull: [
    { key: 'vertical_pull', targetMuscles: ['lats'], primaryTargetOnly: true, force: 'pull', movementType: 'compound', preferredKeywords: ['pulldown', 'pull-up', 'chin-up'], prohibitedKeywords: ['Archer', 'row']},
    { key: 'horizontal_row', targetMuscles: ['middle-back'], primaryTargetOnly: true, force: 'pull', movementType: 'compound', preferredKeywords: ['machine row', 'cable row', 'seated row', 't-bar row', 'chest-supported row', 'row'] }, 
    { key: 'rear_delt_iso', targetMuscles: ['rear-delts'], primaryTargetOnly: true, force: 'pull', movementType: 'isolation', preferredKeywords: ['rear delt', 'reverse fly', 'face pull'] },
    { key: 'back_secondary', targetMuscles: ['traps', 'romboids'], primaryTargetOnly: true, force: 'pull', movementType: 'compound', preferredKeywords: ['machine row', 'cable row', 'seated row', 't-bar row', 'shrug'] , prohibitedKeywords: ['rear delt', 'reverse fly', 'face pull', 'archer'] },
    { key: 'biceps_lh_iso', targetMuscles: ['bicep-long-head'], primaryTargetOnly: true, force: 'pull', movementType: 'isolation', preferredKeywords: ['curl'] },
    { key: 'biceps_sh_iso', targetMuscles: ['bicep-short-head', 'brachialis', 'brachioradialis'], primaryTargetOnly: true, force: 'pull', movementType: 'isolation', preferredKeywords: ['curl', 'hammer'] },
  ],
  legs: [
    { key: 'quad_compound', targetMuscles: ['quads'], primaryTargetOnly: true, force: 'legs', movementType: 'compound', preferredKeywords: ['squat', 'leg press', 'hack'] },
    { key: 'quad_compound', targetMuscles: ['quads'], primaryTargetOnly: true, force: 'legs', movementType: 'compound', preferredKeywords: ['extension'] },
    { key: 'hinge_compound', targetMuscles: ['hamstrings', 'glutes'], primaryTargetOnly: true, force: 'legs', movementType: 'compound', preferredKeywords: ['deadlift', 'romanian', 'hip thrust'] },
    { key: 'unilateral_compound', targetMuscles: ['quads', 'glutes'], primaryTargetOnly: true, force: 'legs', movementType: 'compound', preferredKeywords: ['split squat', 'lunge', 'step-up'] },
    { key: 'hamstring_iso', targetMuscles: ['hamstrings'], primaryTargetOnly: true, force: 'legs', movementType: 'isolation', preferredKeywords: ['curl'] },
    { key: 'hamstring_iso', targetMuscles: ['hamstrings'], primaryTargetOnly: true, force: 'legs', movementType: 'isolation', preferredKeywords: ['deadlift', 'romanian'] },
    { key: 'calves_iso', targetMuscles: ['calves'], primaryTargetOnly: true, force: 'legs', movementType: 'isolation', preferredKeywords: ['calf'] },
  ],
  arms: [
    { key: 'triceps_pressdown', targetMuscles: ['triceps-lateral-head', 'triceps-medial-head'], primaryTargetOnly: true, force: 'push', movementType: 'isolation', preferredKeywords: ['pushdown', 'pressdown'] },
    { key: 'triceps_extension', targetMuscles: ['triceps-long-head'], primaryTargetOnly: true, force: 'push', movementType: 'isolation', preferredKeywords: ['extension', 'overhead'] },
    { key: 'biceps_curl', targetMuscles: ['bicep-long-head', 'bicep-short-head'], primaryTargetOnly: true, force: 'pull', movementType: 'isolation', preferredKeywords: ['curl'] },
    { key: 'brachialis_curl', targetMuscles: ['brachialis', 'brachioradialis'], primaryTargetOnly: true, force: 'pull', movementType: 'isolation', preferredKeywords: ['hammer', 'reverse curl'] },
    { key: 'lateral_delt_bonus', targetMuscles: ['lateral-delts'], primaryTargetOnly: true, force: 'push', movementType: 'isolation', preferredKeywords: ['lateral raise', 'raise'] },
  ],
  chest: [
    { key: 'incline_chest', targetMuscles: ['upper-chest'], primaryTargetOnly: true, force: 'push', movementType: 'compound', preferredKeywords: ['incline', 'press'] },
    { key: 'flat_chest', targetMuscles: ['mid-chest'], primaryTargetOnly: true, force: 'push', movementType: 'compound', preferredKeywords: ['bench', 'press'] },
    { key: 'lower_chest', targetMuscles: ['lower-chest'], primaryTargetOnly: true, force: 'push', movementType: 'compound', preferredKeywords: ['dip', 'decline'] },
    { key: 'chest_iso', targetMuscles: ['pecs', 'mid-chest', 'upper-chest'], primaryTargetOnly: true, force: 'push', movementType: 'isolation', preferredKeywords: ['fly', 'crossover'] },
    { key: 'triceps_support', targetMuscles: ['triceps-long-head', 'triceps-lateral-head'], primaryTargetOnly: true, force: 'push', movementType: 'isolation', preferredKeywords: ['pushdown', 'extension'] },
  ],
  back: [
    { key: 'vertical_pull', targetMuscles: ['lats'], primaryTargetOnly: true, force: 'pull', movementType: 'compound', preferredKeywords: ['pulldown', 'pull-up', 'chin-up'] },
    { key: 'horizontal_row', targetMuscles: ['middle-back', 'romboids'], primaryTargetOnly: true, force: 'pull', movementType: 'compound', preferredKeywords: ['machine row', 'cable row', 'seated row', 't-bar row', 'chest-supported row', 'row'] },
    { key: 'trap_support', targetMuscles: ['traps'], primaryTargetOnly: true, force: 'pull', movementType: 'compound', preferredKeywords: ['row', 'shrug'] },
    { key: 'rear_delt', targetMuscles: ['rear-delts'], primaryTargetOnly: true, force: 'pull', movementType: 'isolation', preferredKeywords: ['face pull', 'reverse fly'] },
    { key: 'biceps_support', targetMuscles: ['bicep-long-head', 'bicep-short-head'], primaryTargetOnly: true, force: 'pull', movementType: 'isolation', preferredKeywords: ['curl'] },
  ],
  shoulders: [
    { key: 'shoulder_press', targetMuscles: ['front-delts'], primaryTargetOnly: true, force: 'push', movementType: 'compound', preferredKeywords: ['press'] },
    { key: 'lateral_raise', targetMuscles: ['lateral-delts'], primaryTargetOnly: true, force: 'push', movementType: 'isolation', preferredKeywords: ['lateral raise', 'raise'] },
    { key: 'rear_delt', targetMuscles: ['rear-delts'], primaryTargetOnly: true, force: 'pull', movementType: 'isolation', preferredKeywords: ['reverse fly', 'rear delt', 'face pull'] },
    { key: 'front_raise', targetMuscles: ['front-delts'], primaryTargetOnly: true, force: 'push', movementType: 'isolation', preferredKeywords: ['front raise'] },
  ],
  upper_body: [
    { key: 'chest_compound', targetMuscles: ['upper-chest', 'mid-chest'], primaryTargetOnly: true, force: 'push', movementType: 'compound', preferredKeywords: ['press'] },
    { key: 'back_compound', targetMuscles: ['lats', 'middle-back'], primaryTargetOnly: true, force: 'pull', movementType: 'compound', preferredKeywords: ['row', 'pulldown'] },
    { key: 'shoulder_compound', targetMuscles: ['front-delts'], primaryTargetOnly: true, force: 'push', movementType: 'compound', preferredKeywords: ['press'] },
    { key: 'rear_delt', targetMuscles: ['rear-delts'], primaryTargetOnly: true, force: 'pull', movementType: 'isolation', preferredKeywords: ['face pull', 'reverse fly'] },
    { key: 'arms_finish', targetMuscles: ['bicep-long-head', 'triceps-lateral-head'], primaryTargetOnly: true, movementType: 'isolation', preferredKeywords: ['curl', 'pushdown'] },
  ],
  lower_body: [
    { key: 'quad_compound', targetMuscles: ['quads'], force: 'legs', movementType: 'compound', preferredKeywords: ['squat', 'leg press'] },
    { key: 'hinge_compound', targetMuscles: ['hamstrings', 'glutes'], force: 'legs', movementType: 'compound', preferredKeywords: ['deadlift', 'romanian', 'hip thrust'] },
    { key: 'unilateral', targetMuscles: ['quads', 'glutes'], force: 'legs', movementType: 'compound', preferredKeywords: ['split squat', 'lunge', 'step-up'] },
    { key: 'hamstring_iso', targetMuscles: ['hamstrings'], force: 'legs', movementType: 'isolation', preferredKeywords: ['curl'] },
    { key: 'calves', targetMuscles: ['calves'], force: 'legs', movementType: 'isolation', preferredKeywords: ['calf'] },
  ],
  full_body: [
    { key: 'legs_compound', targetMuscles: ['quads'], force: 'legs', movementType: 'compound', preferredKeywords: ['squat', 'leg press'] },
    { key: 'hinge', targetMuscles: ['hamstrings', 'glutes'], force: 'legs', movementType: 'compound', preferredKeywords: ['deadlift', 'romanian', 'hip thrust'] },
    { key: 'chest', targetMuscles: ['upper-chest', 'mid-chest'], force: 'push', movementType: 'compound', preferredKeywords: ['press'] },
    { key: 'back', targetMuscles: ['lats', 'middle-back'], force: 'pull', movementType: 'compound', preferredKeywords: ['row', 'pulldown'] },
    { key: 'shoulders', targetMuscles: ['lateral-delts'], force: 'push', movementType: 'isolation', preferredKeywords: ['lateral raise', 'raise'] },
    { key: 'core_or_arms', targetMuscles: ['triceps-lateral-head', 'bicep-short-head'], movementType: 'isolation', preferredKeywords: ['pushdown', 'curl'] },
  ],
};

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function roundToNearestTwoPointFive(value: number): number {
  return Math.round(value / 2.5) * 2.5;
}

function resolveTrainingType(request: string, goal?: FitnessGoal): TrainingType {
  const normalized = normalizeText(request);

  if (/(mobility|recovery|stretch)/.test(normalized)) {
    return 'mobility';
  }

  if (/(strength|heavy|power)/.test(normalized)) {
    return 'strength';
  }

  if (/(endurance|conditioning|fat loss|weight loss|cardio)/.test(normalized)) {
    return 'endurance';
  }

  if (goal === FitnessGoal.STRENGTH) {
    return 'strength';
  }

  if (goal === FitnessGoal.ENDURANCE || goal === FitnessGoal.WEIGHT_LOSS) {
    return 'endurance';
  }

  return 'hypertrophy';
}

function resolveFocus(request: string): { focus: FocusType; focusLabel: string } {
  const normalized = normalizeText(request);

  if (/(full body|full-body|total body)/.test(normalized)) return { focus: 'full_body', focusLabel: 'Full Body' };
  if (/(upper body|upper-body)/.test(normalized)) return { focus: 'upper_body', focusLabel: 'Upper Body' };
  if (/(lower body|lower-body)/.test(normalized)) return { focus: 'lower_body', focusLabel: 'Lower Body' };
  if (/(arms?\s*day|biceps?|triceps?)/.test(normalized)) return { focus: 'arms', focusLabel: 'Arms Day' };
  if (/(chest\s*day|chest|pecs?)/.test(normalized)) return { focus: 'chest', focusLabel: 'Chest Day' };
  if (/(back\s*day|back|lats?)/.test(normalized)) return { focus: 'back', focusLabel: 'Back Day' };
  if (/(shoulder\s*day|shoulders?|delts?)/.test(normalized)) return { focus: 'shoulders', focusLabel: 'Shoulder Day' };
  if (/(legs?|leg\s*day|quads?|hamstrings?|glutes?|calves?)/.test(normalized)) return { focus: 'legs', focusLabel: 'Leg Day' };
  if (/pull/.test(normalized)) return { focus: 'pull', focusLabel: 'Pull Day' };
  if (/push/.test(normalized)) return { focus: 'push', focusLabel: 'Push Day' };

  return { focus: 'push', focusLabel: 'Push Day' };
}

function coerceEquipmentList(raw: unknown): Equipment[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((entry): entry is Equipment => typeof entry === 'string' && VALID_EQUIPMENT.includes(entry as Equipment));
}

function resolveEquipmentConstraints(request: string, profileEquipment: Equipment[]): { allowedEquipment?: Equipment[]; labels: string[] } {
  const normalized = normalizeText(request);
  const included = new Set<Equipment>();
  const excluded = new Set<Equipment>();
  const labels: string[] = [];

  for (const entry of EQUIPMENT_TERM_MAP) {
    if (!entry.pattern.test(normalized)) {
      continue;
    }

    const source = entry.pattern.source;
    const excludePattern = new RegExp(`(?:no|without|avoid)\\s+(?:any\\s+)?${source}`, 'i');
    const onlyPattern = new RegExp(`(?:only|just)\\s+${source}|${source}\\s+only`, 'i');

    if (excludePattern.test(normalized)) {
      entry.equipment.forEach((equipment) => excluded.add(equipment));
      labels.push(`excluded ${entry.label}`);
      continue;
    }

    if (onlyPattern.test(normalized)) {
      entry.equipment.forEach((equipment) => included.add(equipment));
      labels.push(`${entry.label} only`);
    }
  }

  const baseEquipment = included.size > 0 ? [...included] : profileEquipment;
  const allowedEquipment = baseEquipment.filter((equipment) => !excluded.has(equipment));

  return {
    allowedEquipment: allowedEquipment.length > 0 ? allowedEquipment : undefined,
    labels,
  };
}

function collectExcludedNameKeywords(request: string): string[] {
  const normalized = normalizeText(request);
  const keywords: string[] = [];

  const exclusionMap: Array<{ pattern: RegExp; keywords: string[] }> = [
    { pattern: /(avoid|no|without)\s+overhead/i, keywords: ['overhead', 'shoulder press', 'military press', 'arnold press'] },
    { pattern: /(avoid|no|without)\s+squats?/i, keywords: ['squat', 'hack squat'] },
    { pattern: /(avoid|no|without)\s+deadlifts?/i, keywords: ['deadlift', 'romanian deadlift'] },
    { pattern: /(avoid|no|without)\s+lunges?/i, keywords: ['lunge', 'split squat', 'step-up'] },
    { pattern: /(avoid|no|without)\s+dips?/i, keywords: ['dip'] },
    { pattern: /(avoid|no|without)\s+bench/i, keywords: ['bench press'] },
  ];

  for (const entry of exclusionMap) {
    if (entry.pattern.test(normalized)) {
      keywords.push(...entry.keywords);
    }
  }

  return unique(keywords);
}

function hasSpecificSplitMention(request: string): boolean {
  return detectWorkoutSplitFromText(request) !== null;
}

function suggestSplitsByTrainingDays(trainingDaysPerWeek: number): WorkoutSplit[] {
  if (trainingDaysPerWeek <= 2) {
    return ['U/L'];
  }

  if (trainingDaysPerWeek === 3) {
    return ['PPL'];
  }

  if (trainingDaysPerWeek === 4) {
    return ['UL/UL', 'PPL/Upper body', 'Torso/Limbs'];
  }

  if (trainingDaysPerWeek === 5) {
    return ['PPL/UL', 'PPL/Arnold'];
  }

  return ['PPL/PPL', 'UL/UL/UL'];
}

function parseWorkoutRequest(input: { request: string; goal?: FitnessGoal; profileEquipment: Equipment[] }): ParsedWorkoutRequest {
  const { focus, focusLabel } = resolveFocus(input.request);
  const trainingType = resolveTrainingType(input.request, input.goal);
  const equipmentConstraints = resolveEquipmentConstraints(input.request, input.profileEquipment);
  const excludedNameKeywords = collectExcludedNameKeywords(input.request);
  const mentionedSpecificSplit = hasSpecificSplitMention(input.request);
  const respectedConstraints = unique([...equipmentConstraints.labels]);

  if (excludedNameKeywords.length > 0) {
    respectedConstraints.push(`excluded movements: ${excludedNameKeywords.join(', ')}`);
  }

  return {
    focus,
    focusLabel,
    trainingType,
    allowedEquipment: equipmentConstraints.allowedEquipment,
    excludedNameKeywords,
    respectedConstraints,
    mentionedSpecificSplit,
  };
}

function hasExplicitBodyweightRequest(request: string): boolean {
  const normalized = normalizeText(request);
  return /(bodyweight|calisthenics|no\s+equipment|without\s+equipment)/i.test(normalized);
}

function resolveDesiredExerciseCount(focus: FocusType, availableTimeMinutes: number): number {
  if (availableTimeMinutes <= 30) {
    return focus === 'full_body' ? 4 : 3;
  }

  if (availableTimeMinutes <= 45) {
    return focus === 'full_body' ? 5 : 4;
  }

  if (availableTimeMinutes >= 75) {
    return focus === 'shoulders' ? 5 : 6;
  }

  if (focus === 'push' || focus === 'legs') {
    return 6;
  }

  return focus === 'shoulders' ? 4 : 5;
}

const REQUIRED_SLOT_KEYS_BY_FOCUS: Record<FocusType, string[]> = {
  push: ['incline_upper_chest', 'pec_fly_iso', 'triceps_short_head', 'lateral_delt_iso'],
  pull: ['vertical_pull', 'horizontal_row', 'rear_delt_iso', 'back_secondary', 'biceps_lh_iso'],
  legs: ['quad_compound', 'hinge_compound', 'unilateral_compound', 'hamstring_iso'],
  arms: ['triceps_pressdown', 'biceps_curl'],
  chest: ['incline_chest', 'flat_chest', 'chest_iso'],
  back: ['vertical_pull', 'horizontal_row', 'rear_delt'],
  shoulders: ['shoulder_press', 'lateral_raise'],
  upper_body: ['chest_compound', 'back_compound', 'shoulder_compound'],
  lower_body: ['quad_compound', 'hinge_compound', 'hamstring_iso'],
  full_body: ['legs_compound', 'hinge', 'chest', 'back'],
};

function getSelectionSlots(focus: FocusType, availableTimeMinutes: number): SelectionSlot[] {
  const template = FOCUS_TEMPLATES[focus];
  const desiredCount = resolveDesiredExerciseCount(focus, availableTimeMinutes);
  const requiredKeys = new Set(REQUIRED_SLOT_KEYS_BY_FOCUS[focus]);
  const requiredKeysConsumed = new Set<string>();

  const requiredSlots = template.filter((slot) => {
    if (!requiredKeys.has(slot.key)) {
      return false;
    }

    if (requiredKeysConsumed.has(slot.key)) {
      return false;
    }

    requiredKeysConsumed.add(slot.key);
    return true;
  });

  // Always keep required slots in original template order.
  if (desiredCount <= requiredSlots.length) {
    return requiredSlots.slice(0, desiredCount);
  }

  const optionalSlots = template.filter((slot) => !requiredKeysConsumed.has(slot.key));
  const optionalCount = Math.max(0, desiredCount - requiredSlots.length);

  return [...requiredSlots, ...optionalSlots.slice(0, optionalCount)];
}

function hashStringToUint32(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickCandidateFromRanked(input: {
  ranked: CandidateScoreEntry[];
  randomSeed?: string;
  topK?: number;
}): CandidateExercise | undefined {
  const { ranked, randomSeed, topK = 3 } = input;
  if (ranked.length === 0) {
    return undefined;
  }

  if (!randomSeed || ranked.length === 1) {
    return ranked[0]?.candidate;
  }

  const pool = ranked.slice(0, Math.min(Math.max(1, topK), ranked.length));
  if (pool.length === 1) {
    return pool[0]?.candidate;
  }

  const minScore = Math.min(...pool.map((entry) => entry.score));
  const weights = pool.map((entry) => Math.max(1, entry.score - minScore + 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    return pool[0]?.candidate;
  }

  const random = createMulberry32(hashStringToUint32(randomSeed));
  let ticket = random() * totalWeight;

  for (let index = 0; index < pool.length; index += 1) {
    ticket -= weights[index] ?? 0;
    if (ticket <= 0) {
      return pool[index]?.candidate;
    }
  }

  return pool[pool.length - 1]?.candidate;
}

function shouldRejectCandidate(candidate: CandidateExercise, input: {
  excludedNameKeywords: string[];
  medicallyCleared: boolean;
  disallowBodyweightExercises?: boolean;
}): boolean {
  const normalizedName = candidate.name.toLowerCase();

  if (input.disallowBodyweightExercises && candidate.equipment === 'bodyweight') {
    return true;
  }

  if (input.excludedNameKeywords.some((keyword) => normalizedName.includes(keyword))) {
    return true;
  }

  if (!input.medicallyCleared) {
    const riskyKeywords = ['deadlift', 'snatch', 'clean', 'jerk', 'good morning'];
    if (riskyKeywords.some((keyword) => normalizedName.includes(keyword))) {
      return true;
    }
  }

  return false;
}

function scoreCandidate(input: {
  candidate: CandidateExercise;
  slot: SelectionSlot;
  trainingType: TrainingType;
  preferUniversal: boolean;
  recentExerciseUsage?: RecentExerciseUsage;
}): number {
  const { candidate, slot, trainingType, preferUniversal, recentExerciseUsage } = input;
  const normalizedName = candidate.name.toLowerCase();
  const normalizedExerciseId = String(candidate._id);
  const isUniversalExercise = isUniversalExerciseName(candidate.name);
  let score = 0;

  if (slot.targetMuscles.includes(candidate.targetMuscle)) {
    score += 30;
  }

  if (candidate.secondaryMuscles.some((muscle) => slot.targetMuscles.includes(muscle))) {
    score += 12;
  }

  if (slot.force && slot.force === candidate.force) {
    score += 10;
  }

  if (slot.movementType === 'compound' && candidate.compound) {
    score += 14;
  }

  if (slot.movementType === 'isolation' && !candidate.compound) {
    score += 14;
  }

  if (candidate.category.includes(trainingType)) {
    score += 6;
  }

  for (const keyword of slot.preferredKeywords ?? []) {
    if (normalizedName.includes(keyword.toLowerCase())) {
      score += 8;
    }
  }

  for (const keyword of slot.prohibitedKeywords ?? []) {
    if (normalizedName.includes(keyword.toLowerCase())) {
      score -= 14;
    }
  }

  // Strongly prefer pulldown variants for the vertical pull slot when available.
  if (slot.key === 'vertical_pull' && /(lat\s*pull|pull[\s-]?down)/i.test(normalizedName)) {
    score += 18;
  }

  if (candidate.equipment === 'bodyweight') {
    score -= 2;
  }

  if (slot.key === 'vertical_pull' && /(pull[ -]?up|chin[ -]?up)/i.test(normalizedName)) {
    score -= 6;
  }

  if (slot.key === 'horizontal_row' && /(bent[ -]?over|barbell row|pendlay)/i.test(normalizedName)) {
    score -= 10;
  }

  if (slot.key === 'horizontal_row' && /(machine row|cable row|seated row|chest[ -]?supported|t[ -]?bar row)/i.test(normalizedName)) {
    score += 10;
  }

  if (preferUniversal && isUniversalExercise) {
    score += 14;
  }

  if (recentExerciseUsage) {
    const recentUseCount = recentExerciseUsage.recentUseCountByExerciseId.get(normalizedExerciseId) ?? 0;
    if (recentUseCount > 0) {
      const perUsePenalty = isUniversalExercise ? 14 : 6;
      score -= Math.min(42, perUsePenalty * recentUseCount);
    }

    if (recentExerciseUsage.lastWorkoutExerciseIds.has(normalizedExerciseId)) {
      score -= isUniversalExercise ? 18 : 8;
    }
  }

  return score;
}

async function loadRecentExerciseUsage(userId: string, workoutWindowSize = 12): Promise<RecentExerciseUsage> {
  const recentUseCountByExerciseId = new Map<string, number>();
  const lastWorkoutExerciseIds = new Set<string>();

  const recentWorkouts = await WorkoutModel.find({ userId })
    .sort({ createdAt: -1 })
    .limit(workoutWindowSize)
    .select('exercises.exerciseId')
    .lean();

  recentWorkouts.forEach((workout, workoutIndex) => {
    const exerciseIds = Array.isArray(workout.exercises)
      ? workout.exercises.map((exercise) => String(exercise.exerciseId))
      : [];

    for (const exerciseId of exerciseIds) {
      recentUseCountByExerciseId.set(exerciseId, (recentUseCountByExerciseId.get(exerciseId) ?? 0) + 1);
      if (workoutIndex === 0) {
        lastWorkoutExerciseIds.add(exerciseId);
      }
    }
  });

  return {
    recentUseCountByExerciseId,
    lastWorkoutExerciseIds,
    mostRecentWorkoutId: recentWorkouts.length > 0 ? String((recentWorkouts[0] as { _id: unknown })._id) : null,
  };
}

async function loadCandidatePool(input: {
  slots: SelectionSlot[];
  allowedEquipment?: Equipment[];
  medicallyCleared: boolean;
  excludedNameKeywords: string[];
  disallowBodyweightExercises?: boolean;
}): Promise<CandidateExercise[]> {
  const muscles = unique(input.slots.flatMap((slot) => slot.targetMuscles));

  const filter: Record<string, unknown> = {
    $or: [
      { targetMuscle: { $in: muscles } },
      { secondaryMuscles: { $in: muscles } },
    ],
  };

  if (input.allowedEquipment?.length) {
    filter.equipment = { $in: input.allowedEquipment };
  }

  const docs = await ExerciseModel.find(filter)
    .select('_id name targetMuscle secondaryMuscles equipment compound force category possibleInjuries')
    .lean();

  return docs
    .map((doc) => ({
      _id: doc._id,
      name: String(doc.name ?? ''),
      targetMuscle: doc.targetMuscle as MuscleGroup,
      secondaryMuscles: Array.isArray(doc.secondaryMuscles) ? (doc.secondaryMuscles as MuscleGroup[]) : [],
      equipment: doc.equipment as Equipment,
      compound: Boolean(doc.compound),
      force: doc.force as ForceType,
      category: Array.isArray(doc.category) ? doc.category.map((entry) => String(entry)) : [],
      possibleInjuries: Array.isArray(doc.possibleInjuries) ? doc.possibleInjuries.map((entry) => String(entry)) : [],
    }))
    .filter((candidate) => !shouldRejectCandidate(candidate, {
      excludedNameKeywords: input.excludedNameKeywords,
      medicallyCleared: input.medicallyCleared,
      disallowBodyweightExercises: input.disallowBodyweightExercises,
    }));
}

function selectExercisesFromPool(input: {
  pool: CandidateExercise[];
  slots: SelectionSlot[];
  trainingType: TrainingType;
  focus?: FocusType;
  relaxTargetMuscles?: boolean;
  relaxForce?: boolean;
  preferUniversal?: boolean;
  randomSeed?: string;
  randomTopK?: number;
  recentExerciseUsage?: RecentExerciseUsage;
}): CandidateExercise[] {
  const upperBodyOnlyFocuses: FocusType[] = ['push', 'pull', 'arms', 'chest', 'back', 'shoulders', 'upper_body'];
  const lowerBodyTargetMuscles = new Set<MuscleGroup>(['quads', 'hamstrings', 'glutes', 'calves', 'hips', 'inner-thigh']);
  const normalizeExerciseName = (name: string): string =>
    name
      .toLowerCase()
      .replace(/[()]/g, ' ')
      .replace(/[-_/]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const isRowPattern = (name: string): boolean => /\brow\b/.test(normalizeExerciseName(name));

  const selected: CandidateExercise[] = [];
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();

  for (const slot of input.slots) {
    const hasSelectedRowExercise = selected.some((exercise) => isRowPattern(exercise.name));

    const candidatesForSlot = [...input.pool]
      .filter((entry) => !usedIds.has(String(entry._id)))
      .filter((entry) => !usedNames.has(normalizeExerciseName(entry.name)))
      .filter((entry) => {
        if (slot.key !== 'back_secondary') {
          return true;
        }

        // Prevent horizontal_row and back_secondary from both resolving to row patterns.
        if (hasSelectedRowExercise && isRowPattern(entry.name)) {
          return false;
        }

        return true;
      })
      .filter((entry) => {
        if (input.relaxForce) {
          return true;
        }

        return slot.force ? entry.force === slot.force : true;
      })
      .filter((entry) => {
        if (input.relaxTargetMuscles) {
          return true;
        }

        if (slot.primaryTargetOnly) {
          return slot.targetMuscles.includes(entry.targetMuscle);
        }

        return (
          slot.targetMuscles.includes(entry.targetMuscle) ||
          entry.secondaryMuscles.some((muscle) => slot.targetMuscles.includes(muscle))
        );
      })
      .filter((entry) => {
        if (!input.focus || !upperBodyOnlyFocuses.includes(input.focus)) {
          return true;
        }

        return !lowerBodyTargetMuscles.has(entry.targetMuscle);
      });

    const rankPoolForSlot = (pool: CandidateExercise[]): CandidateScoreEntry[] =>
      pool
        .map((candidate) => ({
          candidate,
          score: scoreCandidate({
            candidate,
            slot,
            trainingType: input.trainingType,
            preferUniversal: input.preferUniversal !== false,
            recentExerciseUsage: input.recentExerciseUsage,
          }),
        }))
        .sort((left, right) => {
          const scoreDiff = right.score - left.score;
          if (scoreDiff !== 0) {
            return scoreDiff;
          }

          return left.candidate.name.localeCompare(right.candidate.name);
        });

    const rankedGeneral = rankPoolForSlot(candidatesForSlot);

    const candidate = pickCandidateFromRanked({
      ranked: rankedGeneral,
      randomSeed: input.randomSeed ? `${input.randomSeed}|${slot.key}|${selected.length}` : undefined,
      topK: input.randomTopK,
    });

    if (!candidate) {
      continue;
    }

    selected.push(candidate);
    usedIds.add(String(candidate._id));
    usedNames.add(normalizeExerciseName(candidate.name));
  }

  return selected;
}

function resolveBaselineWeightKg(input: {
  existingTargetWeight?: number;
  personalBestWeight?: number;
  userBodyWeightKg?: number;
  isCompound: boolean;
  force?: ForceType;
  exerciseName?: string;
  equipment?: Equipment;
  experienceLevel?: ExperienceLevel;
}): number {
  const isValidPositive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

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

  if (input.experienceLevel === ExperienceLevel.BEGINNER) {
    baseMultiplier *= 0.7;
  } else if (input.experienceLevel === ExperienceLevel.ADVANCED) {
    baseMultiplier *= 1.2;
  }

  const minimum = input.isCompound ? 20 : 10;
  const estimated = Math.max(minimum, bodyWeight * baseMultiplier);
  return roundToNearestTwoPointFive(estimated);
}

// ---------------------------------------------------------------------------
// Shared day-generation API — reusable by splitPlanner and other callers
// ---------------------------------------------------------------------------

export interface GenerateWorkoutDayParams {
  userId: string;
  request: string;
  /** Already-loaded lean user document (at minimum name/profile/createdAt). */
  user: {
    profile?: {
      goal?: FitnessGoal;
      availableEquipment?: unknown;
      workoutDurationMinutes?: number;
      isMedicallyCleared?: boolean;
      weight?: number;
    };
  };
  /** Pass the result of ensureUserExperienceLevel so callers can compute it once. */
  experienceLevel?: ExperienceLevel;
  logFn?: (level: 'debug' | 'info' | 'warning' | 'error', data: unknown) => Promise<void>;
}

export interface GenerateWorkoutDayExercise {
  exerciseId: string;
  userExerciseId: string;
  name: string;
  equipment: Equipment;
  targetMuscle: MuscleGroup;
  movementType: MovementType;
  sets: number;
  reps?: string;
  rpe?: number;
  restSeconds: number;
  weight: number;
  note: string;
}

export interface GenerateWorkoutDayResult {
  workoutId: string;
  workoutName: string;
  estimatedWorkoutTimeToFinish: number;
  focusLabel: string;
  trainingType: TrainingType;
  progressionMethod: 'two_x_to_failure' | 'rpe' | 'rep_range';
  exercises: GenerateWorkoutDayExercise[];
  respectedConstraints: string[];
  rulesApplied: string[];
  /** True when the original request text named a specific split (used by the tool handler for split suggestions). */
  mentionedSpecificSplit: boolean;
}

export async function generateWorkoutDayForUser(
  params: GenerateWorkoutDayParams,
): Promise<GenerateWorkoutDayResult> {
  const { userId, request, user, experienceLevel, logFn } = params;
  const log = logFn ?? (async (_l: string, _d: unknown) => { /* noop */ });

  const profileEquipment = coerceEquipmentList(user.profile?.availableEquipment);
  const hasGymEquipmentAvailable = profileEquipment.some((equipment) => equipment !== 'bodyweight');
  const explicitlyRequestedBodyweight = hasExplicitBodyweightRequest(request);
  const disallowBodyweightExercises = hasGymEquipmentAvailable && !explicitlyRequestedBodyweight;
  const parsedRequest = parseWorkoutRequest({
    request,
    goal: user.profile?.goal,
    profileEquipment,
  });

  const availableTimeMinutes =
    typeof user.profile?.workoutDurationMinutes === 'number' && Number.isFinite(user.profile.workoutDurationMinutes)
      ? user.profile.workoutDurationMinutes
      : 60;

  // Load recent usage BEFORE constructing the seed so that mostRecentWorkoutId
  // can be included in the seed. This is the key rotation driver: every time the
  // user saves a new workout the ID changes, causing the next generation to hash
  // to a different position in the candidate pool and pick different exercises —
  // even multiple times within the same calendar day.
  const slots = getSelectionSlots(parsedRequest.focus, availableTimeMinutes);
  const recentExerciseUsage = await loadRecentExerciseUsage(userId);

  const selectionSeed = [
    userId,
    parsedRequest.focus,
    parsedRequest.trainingType,
    String(availableTimeMinutes),
    new Date().toISOString().slice(0, 10),
    recentExerciseUsage.mostRecentWorkoutId ?? 'virgin',
  ].join('|');

  await log('debug', {
    event: 'selection_seed_resolved',
    userId,
    focus: parsedRequest.focus,
    trainingType: parsedRequest.trainingType,
    availableTimeMinutes,
    mostRecentWorkoutId: recentExerciseUsage.mostRecentWorkoutId,
    seedHash: hashStringToUint32(selectionSeed),
  });

  await log('debug', {
    event: 'recent_exercise_usage_loaded',
    userId,
    recentlyUsedUniqueExercises: recentExerciseUsage.recentUseCountByExerciseId.size,
    lastWorkoutExerciseCount: recentExerciseUsage.lastWorkoutExerciseIds.size,
  });

  const pool = await loadCandidatePool({
    slots,
    allowedEquipment: parsedRequest.allowedEquipment,
    medicallyCleared: Boolean(user.profile?.isMedicallyCleared),
    excludedNameKeywords: parsedRequest.excludedNameKeywords,
    disallowBodyweightExercises,
  });

  let selectedExercises = selectExercisesFromPool({
    pool,
    slots,
    trainingType: parsedRequest.trainingType,
    focus: parsedRequest.focus,
    preferUniversal: true,
    randomSeed: selectionSeed,
    randomTopK: 3,
    recentExerciseUsage,
  });

  if (selectedExercises.length < slots.length && (parsedRequest.allowedEquipment?.length ?? 0) > 0) {
    await log('warning', {
      event: 'selection_retry_without_equipment_constraints',
      userId,
      allowedEquipment: parsedRequest.allowedEquipment,
      focus: parsedRequest.focus,
    });

    const relaxedPool = await loadCandidatePool({
      slots,
      medicallyCleared: Boolean(user.profile?.isMedicallyCleared),
      excludedNameKeywords: parsedRequest.excludedNameKeywords,
      disallowBodyweightExercises,
    });

    selectedExercises = selectExercisesFromPool({
      pool: relaxedPool,
      slots,
      trainingType: parsedRequest.trainingType,
      focus: parsedRequest.focus,
      preferUniversal: true,
      randomSeed: `${selectionSeed}|equipment_relaxed`,
      randomTopK: 3,
      recentExerciseUsage,
    });

    if (selectedExercises.length > 0) {
      parsedRequest.respectedConstraints.push('equipment constraints relaxed: no matches under requested equipment');
    }
  }

  if (selectedExercises.length < slots.length && pool.length > 0) {
    selectedExercises = selectExercisesFromPool({
      pool,
      slots,
      trainingType: parsedRequest.trainingType,
      focus: parsedRequest.focus,
      relaxTargetMuscles: true,
      preferUniversal: true,
      randomSeed: `${selectionSeed}|muscle_relaxed`,
      randomTopK: 3,
      recentExerciseUsage,
    });

    if (selectedExercises.length > 0) {
      parsedRequest.respectedConstraints.push('muscle-slot matching relaxed to recover viable plan');
    }
  }

  if (selectedExercises.length < slots.length) {
    const slotForces = unique(slots.map((slot) => slot.force).filter((force): force is ForceType => Boolean(force)));
    const broadFilter: Record<string, unknown> = slotForces.length > 0 ? { force: { $in: slotForces } } : {};

    const broadPoolDocs = await ExerciseModel.find(broadFilter)
      .select('_id name targetMuscle secondaryMuscles equipment compound force category possibleInjuries')
      .lean();

    const broadPool = broadPoolDocs
      .map((doc) => ({
        _id: doc._id,
        name: String(doc.name ?? ''),
        targetMuscle: doc.targetMuscle as MuscleGroup,
        secondaryMuscles: Array.isArray(doc.secondaryMuscles) ? (doc.secondaryMuscles as MuscleGroup[]) : [],
        equipment: doc.equipment as Equipment,
        compound: Boolean(doc.compound),
        force: doc.force as ForceType,
        category: Array.isArray(doc.category) ? doc.category.map((entry) => String(entry)) : [],
        possibleInjuries: Array.isArray(doc.possibleInjuries) ? doc.possibleInjuries.map((entry) => String(entry)) : [],
      }))
      .filter((candidate) => !shouldRejectCandidate(candidate, {
        excludedNameKeywords: parsedRequest.excludedNameKeywords,
        medicallyCleared: Boolean(user.profile?.isMedicallyCleared),
        disallowBodyweightExercises,
      }));

    selectedExercises = selectExercisesFromPool({
      pool: broadPool,
      slots,
      trainingType: parsedRequest.trainingType,
      focus: parsedRequest.focus,
      relaxTargetMuscles: true,
      preferUniversal: true,
      randomSeed: `${selectionSeed}|broad_fallback`,
      randomTopK: 3,
      recentExerciseUsage,
    });

    if (selectedExercises.length > 0) {
      parsedRequest.respectedConstraints.push('broad fallback exercise pool used to avoid empty plan');
      await log('warning', {
        event: 'selection_broad_fallback_used',
        userId,
        focus: parsedRequest.focus,
        trainingType: parsedRequest.trainingType,
        selectedCount: selectedExercises.length,
      });
    }
  }

  if (selectedExercises.length < slots.length) {
    const slotForces = unique(slots.map((slot) => slot.force).filter((force): force is ForceType => Boolean(force)));
    const recoveryFilter: Record<string, unknown> = slotForces.length > 0 ? { force: { $in: slotForces } } : {};

    const recoveryDocs = await ExerciseModel.find(recoveryFilter)
      .select('_id name targetMuscle secondaryMuscles equipment compound force category possibleInjuries')
      .lean();

    const medicallySafePool = recoveryDocs
      .map((doc) => ({
        _id: doc._id,
        name: String(doc.name ?? ''),
        targetMuscle: doc.targetMuscle as MuscleGroup,
        secondaryMuscles: Array.isArray(doc.secondaryMuscles) ? (doc.secondaryMuscles as MuscleGroup[]) : [],
        equipment: doc.equipment as Equipment,
        compound: Boolean(doc.compound),
        force: doc.force as ForceType,
        category: Array.isArray(doc.category) ? doc.category.map((entry) => String(entry)) : [],
        possibleInjuries: Array.isArray(doc.possibleInjuries) ? doc.possibleInjuries.map((entry) => String(entry)) : [],
      }))
      .filter((candidate) =>
        !shouldRejectCandidate(candidate, {
          excludedNameKeywords: [],
          medicallyCleared: Boolean(user.profile?.isMedicallyCleared),
          disallowBodyweightExercises,
        })
      );

    selectedExercises = selectExercisesFromPool({
      pool: medicallySafePool,
      slots,
      trainingType: parsedRequest.trainingType,
      focus: parsedRequest.focus,
      relaxTargetMuscles: true,
      preferUniversal: true,
      randomSeed: `${selectionSeed}|name_exclusions_relaxed`,
      randomTopK: 3,
      recentExerciseUsage,
    });

    if (selectedExercises.length > 0) {
      parsedRequest.respectedConstraints.push('name exclusions relaxed to recover viable exercises');
      await log('warning', {
        event: 'selection_name_exclusions_relaxed',
        userId,
        focus: parsedRequest.focus,
        trainingType: parsedRequest.trainingType,
        selectedCount: selectedExercises.length,
      });
    }
  }

  if (selectedExercises.length < slots.length) {
    const emergencyDocs = await ExerciseModel.find({})
      .select('_id name targetMuscle secondaryMuscles equipment compound force category possibleInjuries')
      .lean();

    const emergencyPool = emergencyDocs
      .map((doc) => ({
        _id: doc._id,
        name: String(doc.name ?? ''),
        targetMuscle: doc.targetMuscle as MuscleGroup,
        secondaryMuscles: Array.isArray(doc.secondaryMuscles) ? (doc.secondaryMuscles as MuscleGroup[]) : [],
        equipment: doc.equipment as Equipment,
        compound: Boolean(doc.compound),
        force: doc.force as ForceType,
        category: Array.isArray(doc.category) ? doc.category.map((entry) => String(entry)) : [],
        possibleInjuries: Array.isArray(doc.possibleInjuries) ? doc.possibleInjuries.map((entry) => String(entry)) : [],
      }))
      .filter((candidate) =>
        !shouldRejectCandidate(candidate, {
          excludedNameKeywords: [],
          medicallyCleared: Boolean(user.profile?.isMedicallyCleared),
          disallowBodyweightExercises,
        })
      );

    selectedExercises = selectExercisesFromPool({
      pool: emergencyPool,
      slots,
      trainingType: parsedRequest.trainingType,
      focus: parsedRequest.focus,
      relaxTargetMuscles: true,
      relaxForce: true,
      preferUniversal: true,
      randomSeed: `${selectionSeed}|emergency_fallback`,
      randomTopK: 3,
      recentExerciseUsage,
    });

    if (selectedExercises.length > 0) {
      parsedRequest.respectedConstraints.push('emergency library fallback used to avoid empty workout');
      await log('warning', {
        event: 'selection_emergency_library_fallback_used',
        userId,
        focus: parsedRequest.focus,
        trainingType: parsedRequest.trainingType,
        selectedCount: selectedExercises.length,
      });
    }
  }

  if (selectedExercises.length === 0) {
    throw new Error('No exercises are available in the library to build this workout right now.');
  }

  const mapToTargetInput = (exerciseList: CandidateExercise[]): WorkoutTargetInputExercise[] =>
    exerciseList.map((exercise) => ({
      exerciseId: String(exercise._id),
      name: exercise.name,
      force: exercise.force,
      targetMuscle: exercise.targetMuscle,
      secondaryMuscles: exercise.secondaryMuscles,
      movementType: exercise.compound ? 'compound' as const : 'isolation' as const,
    }));

  let targetBuildResult = buildWorkoutTargets({
    trainingType: parsedRequest.trainingType,
    availableTimeMinutes,
    preserveExerciseCount: true,
    exercises: mapToTargetInput(selectedExercises),
  });

  const selectedExerciseIds = new Set(selectedExercises.map((exercise) => String(exercise._id)));
  const allFocusSlots = FOCUS_TEMPLATES[parsedRequest.focus];
  const selectedSlotKeys = new Set(slots.map((slot) => slot.key));
  let nextOptionalSlotIndex = 0;
  let appendedOptionalExercises = 0;

  while (nextOptionalSlotIndex < allFocusSlots.length) {
    const estimatedMinutes = Math.ceil(targetBuildResult.estimatedDurationSeconds / 60);
    const remainingMinutes = availableTimeMinutes - estimatedMinutes;
    if (remainingMinutes <= 5) {
      break;
    }

    const slot = allFocusSlots[nextOptionalSlotIndex];
    nextOptionalSlotIndex += 1;
    if (!slot) {
      continue;
    }

    if (selectedSlotKeys.has(slot.key)) {
      continue;
    }

    const availablePool = pool.filter((exercise) => !selectedExerciseIds.has(String(exercise._id)));
    if (availablePool.length === 0) {
      break;
    }

    const selectionAttempts: Array<{ relaxTargetMuscles?: boolean; relaxForce?: boolean }> = [
      {},
      { relaxTargetMuscles: true },
      { relaxTargetMuscles: true, relaxForce: true },
    ];

    let optionalExercise: CandidateExercise | undefined;
    for (const attempt of selectionAttempts) {
      optionalExercise = selectExercisesFromPool({
        pool: availablePool,
        slots: [slot],
        trainingType: parsedRequest.trainingType,
        focus: parsedRequest.focus,
        preferUniversal: true,
        randomSeed: `${selectionSeed}|optional_slots|${slot.key}|${nextOptionalSlotIndex}`,
        randomTopK: 3,
        recentExerciseUsage,
        ...attempt,
      })[0];

      if (optionalExercise) {
        break;
      }
    }

    if (!optionalExercise) {
      continue;
    }

    selectedExercises.push(optionalExercise);
    selectedExerciseIds.add(String(optionalExercise._id));
    selectedSlotKeys.add(slot.key);
    appendedOptionalExercises += 1;

    targetBuildResult = buildWorkoutTargets({
      trainingType: parsedRequest.trainingType,
      availableTimeMinutes,
      preserveExerciseCount: true,
      exercises: mapToTargetInput(selectedExercises),
    });
  }

  if (appendedOptionalExercises > 0) {
    parsedRequest.respectedConstraints.push(`auto-added ${appendedOptionalExercises} optional exercise(s) to use available time`);
  }

  const usesTwoXToFailureForDurationFloor =
    experienceLevel !== ExperienceLevel.BEGINNER &&
    availableTimeMinutes >= 30 &&
    availableTimeMinutes <= 45;

  const estimateProjectedMinutesForCurrentSelection = (): number => {
    const selectedById = new Map(selectedExercises.map((exercise) => [String(exercise._id), exercise]));

    return estimateWorkoutDurationMinutes({
      trainingType: parsedRequest.trainingType,
      exercises: targetBuildResult.exercises
        .filter((target) => selectedById.has(target.exerciseId))
        .map((target) => {
          const selectedExercise = selectedById.get(target.exerciseId)!;
          return {
            sets: usesTwoXToFailureForDurationFloor ? 2 : target.sets,
            reps: usesTwoXToFailureForDurationFloor ? 'FAILURE' : target.reps,
            restSeconds: usesTwoXToFailureForDurationFloor ? 150 : target.restSeconds,
            movementType: target.movementType,
            force: selectedExercise.force,
            name: selectedExercise.name,
            supersetGroup: target.supersetGroup,
          };
        }),
    });
  };

  const shouldEnforceThirtyToFortyFiveWindow =
    availableTimeMinutes >= 30 && availableTimeMinutes <= 45;

  if (shouldEnforceThirtyToFortyFiveWindow) {
    const estimatedMinutes = estimateProjectedMinutesForCurrentSelection();

    if (estimatedMinutes < 30) {
      const remainingSlotCandidates = allFocusSlots.filter((slot) => !selectedSlotKeys.has(slot.key));

      let fallbackPoolForExtraExercise: CandidateExercise[] | undefined;

      for (const slot of remainingSlotCandidates) {
        const availablePool = pool.filter((exercise) => !selectedExerciseIds.has(String(exercise._id)));

        let extraExercise = selectExercisesFromPool({
          pool: availablePool,
          slots: [slot],
          trainingType: parsedRequest.trainingType,
          focus: parsedRequest.focus,
          preferUniversal: true,
          randomSeed: `${selectionSeed}|duration_floor|${slot.key}`,
          randomTopK: 3,
          recentExerciseUsage,
        })[0];

        if (!extraExercise) {
          if (!fallbackPoolForExtraExercise) {
            const broadFilter: Record<string, unknown> = slot.force
              ? { force: slot.force }
              : {};

            const broadPoolDocs = await ExerciseModel.find(broadFilter)
              .select('_id name targetMuscle secondaryMuscles equipment compound force category possibleInjuries')
              .lean();

            fallbackPoolForExtraExercise = broadPoolDocs
              .map((doc) => ({
                _id: doc._id,
                name: String(doc.name ?? ''),
                targetMuscle: doc.targetMuscle as MuscleGroup,
                secondaryMuscles: Array.isArray(doc.secondaryMuscles) ? (doc.secondaryMuscles as MuscleGroup[]) : [],
                equipment: doc.equipment as Equipment,
                compound: Boolean(doc.compound),
                force: doc.force as ForceType,
                category: Array.isArray(doc.category) ? doc.category.map((entry) => String(entry)) : [],
                possibleInjuries: Array.isArray(doc.possibleInjuries) ? doc.possibleInjuries.map((entry) => String(entry)) : [],
              }))
              .filter((candidate) =>
                !shouldRejectCandidate(candidate, {
                  excludedNameKeywords: parsedRequest.excludedNameKeywords,
                  medicallyCleared: Boolean(user.profile?.isMedicallyCleared),
                  disallowBodyweightExercises,
                })
              )
              .filter((candidate) => !selectedExerciseIds.has(String(candidate._id)));
          }

          extraExercise = selectExercisesFromPool({
            pool: fallbackPoolForExtraExercise,
            slots: [slot],
            trainingType: parsedRequest.trainingType,
            focus: parsedRequest.focus,
            relaxTargetMuscles: true,
            preferUniversal: true,
            randomSeed: `${selectionSeed}|duration_floor_broad|${slot.key}`,
            randomTopK: 3,
            recentExerciseUsage,
          })[0];
        }

        if (!extraExercise) {
          continue;
        }

        selectedExercises.push(extraExercise);
        selectedExerciseIds.add(String(extraExercise._id));
        selectedSlotKeys.add(slot.key);

        targetBuildResult = buildWorkoutTargets({
          trainingType: parsedRequest.trainingType,
          availableTimeMinutes,
          preserveExerciseCount: true,
          exercises: mapToTargetInput(selectedExercises),
        });

        parsedRequest.respectedConstraints.push('added 1 split-based exercise to keep workout duration within 30-45 minute target');

        await log('info', {
          event: 'duration_floor_extra_exercise_added',
          userId,
          focus: parsedRequest.focus,
          slotKey: slot.key,
          estimatedMinutesBefore: estimatedMinutes,
          estimatedMinutesAfter: estimateProjectedMinutesForCurrentSelection(),
        });

        break;
      }
    }
  }

  const selectedById = new Map(selectedExercises.map((exercise) => [String(exercise._id), exercise]));
  const selectedExerciseOrder = new Map(selectedExercises.map((exercise, index) => [String(exercise._id), index]));
  const survivingTargets = targetBuildResult.exercises
    .filter((target) => selectedById.has(target.exerciseId))
    .sort((left, right) => {
      const leftOrder = selectedExerciseOrder.get(left.exerciseId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = selectedExerciseOrder.get(right.exerciseId) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
  const survivingExerciseIds = survivingTargets.map((target) => target.exerciseId);

  const existingUserExercises = await UserExerciseModel.find({
    userId,
    exerciseId: { $in: survivingExerciseIds },
  })
    .select('exerciseId currentTarget.weight personalBest.weight settings.isFavorite settings.notes')
    .lean();

  const existingByExerciseId = new Map<string, ExistingUserExerciseState>(
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
        isFavorite: Boolean(doc.settings?.isFavorite),
        notes: typeof doc.settings?.notes === 'string' ? doc.settings.notes : undefined,
      },
    ])
  );

  const isEligibleForTwoXToFailure =
    experienceLevel !== ExperienceLevel.BEGINNER &&
    availableTimeMinutes >= 30 &&
    availableTimeMinutes <= 45;

  const progressionMethod = isEligibleForTwoXToFailure
    ? 'two_x_to_failure' as const
    : experienceLevel === ExperienceLevel.BEGINNER
      ? 'rpe' as const
      : 'rep_range' as const;

  const resolveTargetReps = (targetReps: string): string =>
    progressionMethod === 'two_x_to_failure' ? 'FAILURE' : targetReps;

  const persistedUserExercises = [] as Array<{
    id: string;
    exerciseId: string;
    exerciseName: string;
    equipment: Equipment;
    targetMuscle: MuscleGroup;
    movementType: MovementType;
    weight: number;
    reps?: string;
    rpe?: number;
    sets: number;
    restSeconds: number;
    note: string;
  }>;

  for (const target of survivingTargets) {
    const exercise = selectedById.get(target.exerciseId);
    if (!exercise) {
      continue;
    }

    const existingState = existingByExerciseId.get(target.exerciseId);
    const weight = resolveBaselineWeightKg({
      existingTargetWeight: existingState?.currentTargetWeight,
      personalBestWeight: existingState?.personalBestWeight,
      userBodyWeightKg: user.profile?.weight,
      isCompound: target.movementType === 'compound',
      force: exercise.force,
      exerciseName: exercise.name,
      equipment: exercise.equipment,
      experienceLevel,
    });

    const persisted = await UserExerciseModel.findOneAndUpdate(
      { userId, exerciseId: target.exerciseId },
      {
        $set: {
          currentTarget: {
            weight,
            progressionMethod,
            reps: resolveTargetReps(target.reps),
            sets: progressionMethod === 'two_x_to_failure' ? 2 : target.sets,
            rpe: progressionMethod === 'rpe' ? target.rpe : undefined,
            restSeconds: progressionMethod === 'two_x_to_failure' ? 150 : target.restSeconds,
            rirMin: target.rirMin,
            rirMax: target.rirMax,
            trainingType: parsedRequest.trainingType,
            supersetGroup: target.supersetGroup,
          },
        },
        $setOnInsert: {
          settings: {
            isFavorite: existingState?.isFavorite ?? false,
            notes: existingState?.notes ?? target.coachNote,
          },
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    ).lean();

    if (!persisted?._id) {
      throw new Error(`Failed to persist user exercise for ${exercise.name}`);
    }

    persistedUserExercises.push({
      id: String(persisted._id),
      exerciseId: target.exerciseId,
      exerciseName: exercise.name,
      equipment: exercise.equipment,
      targetMuscle: exercise.targetMuscle,
      movementType: target.movementType,
      weight,
      reps: resolveTargetReps(target.reps),
      rpe: progressionMethod === 'rpe' ? target.rpe : undefined,
      sets: progressionMethod === 'two_x_to_failure' ? 2 : target.sets,
      restSeconds: progressionMethod === 'two_x_to_failure' ? 150 : target.restSeconds,
      note: target.coachNote,
    });
  }

  if (persistedUserExercises.length === 0) {
    throw new Error('Workout generation did not produce any persistable user exercises');
  }

  const estimatedWorkoutTimeToFinish = estimateWorkoutDurationMinutes({
    trainingType: parsedRequest.trainingType,
    exercises: survivingTargets.map((target) => {
      const selectedExercise = selectedById.get(target.exerciseId)!;
      return {
        sets: progressionMethod === 'two_x_to_failure' ? 2 : target.sets,
        reps: resolveTargetReps(target.reps),
        restSeconds: progressionMethod === 'two_x_to_failure' ? 150 : target.restSeconds,
        movementType: target.movementType,
        force: selectedExercise.force,
        name: selectedExercise.name,
        supersetGroup: target.supersetGroup,
      };
    }),
  });

  const workout = await WorkoutModel.create({
    userId,
    name: `${parsedRequest.focusLabel} Plan`,
    status: 'planned',
    estimatedWorkoutTimeToFinish,
    exercises: persistedUserExercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      userExerciseId: exercise.id,
      sets: Array.from({ length: exercise.sets }, () => ({
        weight: exercise.weight,
        reps: exercise.reps,
        rest: exercise.restSeconds,
        rpe: exercise.rpe,
        completed: false,
      })),
      notes: exercise.note,
    })),
  });

  return {
    workoutId: workout._id.toString(),
    workoutName: workout.name,
    estimatedWorkoutTimeToFinish,
    focusLabel: parsedRequest.focusLabel,
    trainingType: parsedRequest.trainingType,
    progressionMethod,
    mentionedSpecificSplit: parsedRequest.mentionedSpecificSplit,
    exercises: persistedUserExercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      userExerciseId: exercise.id,
      name: exercise.exerciseName,
      equipment: exercise.equipment,
      targetMuscle: exercise.targetMuscle,
      movementType: exercise.movementType,
      sets: exercise.sets,
      reps: exercise.reps,
      rpe: exercise.rpe,
      restSeconds: exercise.restSeconds,
      weight: exercise.weight,
      note: exercise.note,
    })),
    respectedConstraints: parsedRequest.respectedConstraints,
    rulesApplied: targetBuildResult.rulesApplied,
  };
}

// ---------------------------------------------------------------------------
// MCP tool registration — thin wrapper around generateWorkoutDayForUser
// ---------------------------------------------------------------------------

export function registerGenerateWorkoutTool(server: McpServer) {
  const logToInspector = async (level: 'debug' | 'info' | 'warning' | 'error', data: unknown) => {
    try {
      await server.sendLoggingMessage({
        level,
        logger: generateWorkoutToolDefinition.name,
        data,
      });
    } catch {
      // Best-effort logging only.
    }
  };

  server.registerTool(
    generateWorkoutToolDefinition.name,
    {
      description: generateWorkoutToolDefinition.description,
      inputSchema: generateWorkoutToolDefinition.inputSchema,
    },
    async (args): Promise<ToolResponse> => {
      try {
        const parsed = GenerateWorkoutInputSchema.parse(args);
        await logToInspector('debug', { event: 'input', payload: parsed });

        const user = await UserModel.findById(parsed.userId)
          .select('name profile createdAt')
          .lean();

        if (!user) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ code: 'USER_NOT_FOUND', message: 'User not found' }) }],
            isError: true,
          };
        }

        const progression = await ensureUserExperienceLevel(user);
        const experienceLevel = progression.experienceLevel ?? user.profile?.experienceLevel;

        const trainingDaysPerWeek =
          typeof user.profile?.workoutFrequencyPerWeek === 'number' && Number.isFinite(user.profile.workoutFrequencyPerWeek)
            ? Math.max(1, Math.min(7, Math.round(user.profile.workoutFrequencyPerWeek)))
            : 3;

        const shouldSuggestSplitFromOnboarding = Boolean(user.profile?.pendingSplitSuggestion);

        if (shouldSuggestSplitFromOnboarding) {
          await UserModel.updateOne(
            { _id: parsed.userId },
            { $set: { 'profile.pendingSplitSuggestion': false } }
          );
        }

        const result = await generateWorkoutDayForUser({
          userId: parsed.userId,
          request: parsed.request,
          user,
          experienceLevel,
          logFn: logToInspector,
        });

        const suggestedSplits =
          shouldSuggestSplitFromOnboarding && !result.mentionedSpecificSplit && trainingDaysPerWeek >= 2 && trainingDaysPerWeek <= 6
            ? suggestSplitsByTrainingDays(trainingDaysPerWeek)
            : [];

        await logToInspector('info', {
          event: 'generated_workout',
          userId: parsed.userId,
          workoutId: result.workoutId,
          focus: result.focusLabel,
          trainingType: result.trainingType,
          exerciseCount: result.exercises.length,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              data: {
                workout: {
                  id: result.workoutId,
                  name: result.workoutName,
                  status: 'planned',
                  estimatedWorkoutTimeToFinish: result.estimatedWorkoutTimeToFinish,
                },
                focus: result.focusLabel,
                trainingType: result.trainingType,
                progressionMethod: result.progressionMethod,
                respectedConstraints: result.respectedConstraints,
                splitSuggestions:
                  suggestedSplits.length > 0
                    ? { basedOnTrainingDaysPerWeek: trainingDaysPerWeek, options: suggestedSplits }
                    : null,
                rulesApplied: result.rulesApplied,
                exercises: result.exercises.map((exercise) => ({
                  exerciseId: exercise.exerciseId,
                  userExerciseId: exercise.userExerciseId,
                  name: exercise.name,
                  equipment: exercise.equipment,
                  targetMuscle: exercise.targetMuscle,
                  movementType: exercise.movementType,
                  sets: exercise.sets,
                  reps: exercise.reps,
                  rpe: exercise.rpe,
                  restSeconds: exercise.restSeconds,
                  weight: exercise.weight,
                  note: exercise.note,
                })),
              },
            }),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await logToInspector('error', { event: 'error', message });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ code: 'GENERATE_WORKOUT_FAILED', message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}