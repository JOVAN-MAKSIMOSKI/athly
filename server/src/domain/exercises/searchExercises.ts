import { MuscleGroupEnum, type MuscleGroup } from './types.js';

export interface SearchExercisesInput {
  target?: string;
  query?: string;
  equipment?: string[];
  limit: number;
  offset: number;
}

export interface SearchExercisesCriteria {
  muscleGroups: MuscleGroup[];
  queryText?: string;
  equipment?: string[];
  limit: number;
  offset: number;
}

const VALID_MUSCLE_GROUPS = new Set(MuscleGroupEnum.options);

const MUSCLE_GROUP_ALIASES: Record<string, MuscleGroup[]> = {
  chest: ['upper-chest', 'mid-chest', 'lower-chest', 'pecs'],
  pectorals: ['upper-chest', 'mid-chest', 'lower-chest', 'pecs'],
  pecs: ['upper-chest', 'mid-chest', 'lower-chest', 'pecs'],
  'upper chest': ['upper-chest'],
  'mid chest': ['mid-chest'],
  'lower chest': ['lower-chest'],
  shoulders: ['front-delts', 'lateral-delts', 'rear-delts'],
  delts: ['front-delts', 'lateral-delts', 'rear-delts'],
  'front delts': ['front-delts'],
  'side delts': ['lateral-delts'],
  'lateral delts': ['lateral-delts'],
  'rear delts': ['rear-delts'],
  back: ['lats', 'middle-back', 'lower-back', 'traps', 'romboids'],
  lats: ['lats'],
  traps: ['traps'],
  biceps: ['bicep-long-head', 'bicep-short-head', 'brachialis', 'brachioradialis'],
  triceps: ['triceps-long-head', 'triceps-lateral-head', 'triceps-medial-head'],
  forearms: ['forearms'],
  quads: ['quads'],
  hamstrings: ['hamstrings'],
  glutes: ['glutes'],
  calves: ['calves'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves', 'inner-thigh', 'hips'],
  abs: ['upper-abs', 'mid-abs', 'lower-abs', 'obliques'],
  core: ['upper-abs', 'mid-abs', 'lower-abs', 'obliques'],
  obliques: ['obliques'],
  hips: ['hips'],
  'inner thigh': ['inner-thigh'],
};

const DAY_SPLIT_ALIAS_RULES: Array<{ pattern: RegExp; groups: MuscleGroup[] }> = [
  {
    pattern: /\bleg(s)?(\s+day|\s+workout|\s+session)?\b/,
    groups: ['quads', 'hamstrings', 'glutes', 'calves', 'inner-thigh', 'hips'],
  },
  {
    pattern: /\bpush(\s+day|\s+workout|\s+session)?\b/,
    groups: [
      'upper-chest',
      'mid-chest',
      'lower-chest',
      'pecs',
      'front-delts',
      'lateral-delts',
      'triceps-long-head',
      'triceps-lateral-head',
      'triceps-medial-head',
    ],
  },
  {
    pattern: /\bpull(\s+day|\s+workout|\s+session)?\b/,
    groups: [
      'lats',
      'middle-back',
      'lower-back',
      'traps',
      'romboids',
      'rear-delts',
      'bicep-long-head',
      'bicep-short-head',
      'brachialis',
      'brachioradialis',
    ],
  },
];

function normalizeTarget(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function fromDirectMatch(normalized: string, hyphenated: string): MuscleGroup[] {
  if (VALID_MUSCLE_GROUPS.has(hyphenated as MuscleGroup)) {
    return [hyphenated as MuscleGroup];
  }

  if (VALID_MUSCLE_GROUPS.has(normalized as MuscleGroup)) {
    return [normalized as MuscleGroup];
  }

  if (MUSCLE_GROUP_ALIASES[normalized]) {
    return MUSCLE_GROUP_ALIASES[normalized];
  }

  if (MUSCLE_GROUP_ALIASES[hyphenated]) {
    return MUSCLE_GROUP_ALIASES[hyphenated];
  }

  return [];
}

function fromSplitDayAliases(normalized: string): MuscleGroup[] {
  const matches = DAY_SPLIT_ALIAS_RULES.flatMap((rule) => (rule.pattern.test(normalized) ? rule.groups : []));
  return matches;
}

function toMuscleGroups(target?: string): MuscleGroup[] {
  if (!target) return [];

  const normalized = normalizeTarget(target);
  const hyphenated = normalized.replace(/\s+/g, '-');

  const directMatch = fromDirectMatch(normalized, hyphenated);
  if (directMatch.length > 0) {
    return directMatch;
  }

  const splitDayMatch = fromSplitDayAliases(normalized);
  if (splitDayMatch.length > 0) {
    return splitDayMatch;
  }

  const segmented = normalized
    .split(/[,/]|\band\b|\bwith\b/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .flatMap((segment) => {
      const segmentHyphenated = segment.replace(/\s+/g, '-');
      const segmentDirectMatch = fromDirectMatch(segment, segmentHyphenated);
      if (segmentDirectMatch.length > 0) {
        return segmentDirectMatch;
      }

      return fromSplitDayAliases(segment);
    });

  return segmented;
}

function uniqueMuscleGroups(groups: MuscleGroup[]): MuscleGroup[] {
  return Array.from(new Set(groups));
}

function cleanQueryText(value?: string): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

export function buildSearchExercisesCriteria(input: SearchExercisesInput): SearchExercisesCriteria {
  const muscleGroups = uniqueMuscleGroups(toMuscleGroups(input.target));
  const queryText = cleanQueryText(input.query) || (muscleGroups.length === 0 ? cleanQueryText(input.target) : undefined);

  return {
    muscleGroups,
    queryText,
    equipment: input.equipment?.length ? input.equipment : undefined,
    limit: input.limit,
    offset: input.offset,
  };
}
