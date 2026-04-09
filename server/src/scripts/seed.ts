import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import csv from 'csvtojson';
// NOTE: Switched from Gemini Developer API to Vertex AI SDK (ADC auth).
import { VertexAI } from '@google-cloud/vertexai';
import { ExerciseModel } from '../database/models/ExerciseSchema.js';
import {
  CreateExerciseSchema,
  MuscleGroupEnum,
  type MuscleGroup,
  type Exercise,
} from '../domain/exercises/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// NOTE: Log Vertex AI configuration at script start.
console.error('🔧 Vertex AI config:', {
  project: process.env.VERTEX_AI_PROJECT || '(missing)',
  location: process.env.VERTEX_AI_LOCATION || 'europe-west4',
  model: process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash',
});
// NOTE: Added startup telemetry to verify environment inputs.
console.error('🔎 Env check:', {
  hasMongoUri: Boolean(process.env.MONGODB_URI),
  hasVertexProject: Boolean(process.env.VERTEX_AI_PROJECT),
  vertexLocation: process.env.VERTEX_AI_LOCATION || '(default)',
  vertexModel: process.env.VERTEX_AI_MODEL || '(default)',
});

const POSSIBLE_INJURY_MAP: Record<MuscleGroup, string[]> = {
  'upper-chest': ['shoulder'],
  'mid-chest': ['shoulder'],
  'lower-chest': ['shoulder'],
  'pecs': ['shoulder'],
  'front-delts': ['shoulder'],
  'lateral-delts': ['shoulder'],
  'rear-delts': ['shoulder'],
  'neck': ['neck'],
  'romboids': ['upper-back', 'shoulder'],
  'traps': ['neck', 'upper-back'],
  'middle-back': ['upper-back'],
  'lats': ['shoulder', 'upper-back'],
  'lower-back': ['lower-back'],
  'bicep-long-head': ['elbow', 'shoulder'],
  'bicep-short-head': ['elbow', 'shoulder'],
  'brachialis': ['elbow'],
  'brachioradialis': ['elbow', 'wrist'],
  'triceps-long-head': ['elbow', 'shoulder'],
  'triceps-lateral-head': ['elbow'],
  'triceps-medial-head': ['elbow'],
  'forearms': ['wrist', 'elbow'],
  'quads': ['knee'],
  'hamstrings': ['knee'],
  'glutes': ['hip', 'lower-back'],
  'calves': ['ankle', 'knee'],
  'upper-abs': ['core'],
  'mid-abs': ['core'],
  'lower-abs': ['core', 'hip'],
  'obliques': ['core'],
  'hips': ['hip'],
  'inner-thigh': ['hip', 'knee'],
};

const inferPossibleInjuries = (targetMuscle: MuscleGroup): string[] => {
  return POSSIBLE_INJURY_MAP[targetMuscle] ?? ['general'];
};

const getCsvPath = (): string => {
  const directPath = path.resolve(process.cwd(), 'gym_exercise_dataset.csv');
  if (fs.existsSync(directPath)) return directPath;
  const parentPath = path.resolve(process.cwd(), '..', 'gym_exercise_dataset.csv');
  if (fs.existsSync(parentPath)) return parentPath;
  throw new Error('Could not find gym_exercise_dataset.csv in project root or parent directory');
};

const normalize = (value: string): string =>
  value.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();

const PEC_ISOLATION_PATTERN = /\b(fly|flies|crossover|cross[ -]?over|pec\s*deck|butterfly)\b/i;

const promoteChestIsolationToPecs = (targetMuscle: MuscleGroup, exerciseName: string): MuscleGroup => {
  if (!PEC_ISOLATION_PATTERN.test(exerciseName)) {
    return targetMuscle;
  }

  if (targetMuscle === 'upper-chest' || targetMuscle === 'mid-chest' || targetMuscle === 'lower-chest') {
    return 'pecs';
  }

  return targetMuscle;
};

const AMBIGUOUS_MUSCLE_TOKENS = new Set([
  'none',
  'no significant stabilizers',
  'see comments',
  'anterior',
  'posterior',
  'lateral',
  'upper',
  'lower',
  'middle',
  'long head',
  'short head',
  'clavicular',
  'sternal',
  'major',
  'minor',
  'upper (part 1)',
  'lower fibers',
  'posterior fibers',
  'anterior fibers',
]);

const isAmbiguousMuscleToken = (value: string): boolean => AMBIGUOUS_MUSCLE_TOKENS.has(value);

const parseCsvList = (value?: string): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
};

const mapEquipment = (value: string, name: string): Exercise['equipment'] => {
  const normalized = normalize(value);
  if (normalized.includes('assisted (partner)') || normalized.includes('self-assisted')) return 'bodyweight';
  if (normalized.includes('barbell')) {
    if (/bench|incline|decline/.test(normalize(name))) return 'barbell + bench';
    return 'barbell';
  }
  if (normalized.includes('dumbbell')) {
    if (/bench|incline|decline/.test(normalize(name))) return 'dumbbell + bench';
    return 'dumbbell';
  }
  if (normalized.includes('smith')) return 'smith-machine';
  if (normalized.includes('kettlebell')) return 'kettlebell';
  if (normalized.includes('cable')) return 'cable';
  if (normalized.includes('band') || normalized.includes('resistive')) return 'resistance-band';
  if (normalized.includes('pull-up')) return 'pull-up-bar';
  if (normalized.includes('body weight') || normalized.includes('bodyweight') || normalized.includes('suspended') || normalized.includes('suspension')) return 'bodyweight';
  if (normalized.includes('isometric') || normalized.includes('plyometric')) return 'bodyweight';
  if (normalized.includes('assisted')) return 'machine';
  if (normalized.includes('weighted')) return 'bodyweight';
  if (normalized.includes('lever') || normalized.includes('machine') || normalized.includes('sled')) return 'machine';
  return 'machine';
};

const mapMuscleToGroup = (raw: string): MuscleGroup | null => {
  const value = normalize(raw);
  if (!value) return null;

  if (isAmbiguousMuscleToken(value)) {
    return null;
  }

  if (value.includes('sternocleidomastoid') || value.includes('neck')) return 'neck';
  if (
    value.includes('splenius') ||
    value.includes('longus colli') ||
    value.includes('longus capitis') ||
    value.includes('cervicis') ||
    value.includes('rectus capitus')
  ) {
    return 'neck';
  }
  if (value.includes('rhomboid')) return 'romboids';
  if (value.includes('trapezius') || value.includes('levator scapulae')) return 'traps';
  if (value.includes('latissimus') || value.includes('lats')) return 'lats';
  if (
    value.includes('erector spinae') ||
    value.includes('lower back') ||
    value.includes('quadratus lumborum') ||
    value.includes('iliocastalis lumborum') ||
    value.includes('iliocastalis thoracis')
  ) {
    return 'lower-back';
  }
  if (value.includes('middle back') || value.includes('thoracic')) return 'middle-back';

  if (value.includes('pectoralis')) {
    if (value.includes('clavicular') || value.includes('upper')) return 'upper-chest';
    if (value.includes('lower')) return 'lower-chest';
    return 'mid-chest';
  }
  if (value.includes('serratus anterior') || value.includes('inferior digitations')) return 'mid-chest';

  if (value.includes('deltoid')) {
    if (value.includes('anterior') || value.includes('front')) return 'front-delts';
    if (value.includes('posterior') || value.includes('rear')) return 'rear-delts';
    return 'lateral-delts';
  }
  if (value.includes('supraspinatus')) return 'lateral-delts';
  if (value.includes('infraspinatus') || value.includes('teres minor') || value.includes('posterior deltoid') || value.includes('subscapularis')) return 'rear-delts';
  if (value.includes('coracobrachialis') || value.includes('anterior deltoid')) return 'front-delts';
  if (value.includes('teres major')) return 'lats';

  if (value.includes('biceps')) {
    if (value.includes('long head')) return 'bicep-long-head';
    if (value.includes('short head')) return 'bicep-short-head';
    return 'bicep-long-head';
  }
  if (value.includes('brachialis')) return 'brachialis';
  if (value.includes('brachioradialis')) return 'brachioradialis';

  if (value.includes('triceps')) {
    if (value.includes('long head')) return 'triceps-long-head';
    if (value.includes('lateral head')) return 'triceps-lateral-head';
    if (value.includes('medial head')) return 'triceps-medial-head';
    return 'triceps-lateral-head';
  }

  if (
    value.includes('forearm') ||
    value.includes('wrist') ||
    value.includes('pronator') ||
    value.includes('supinator') ||
    value.includes('extensor carpi') ||
    value.includes('flexor carpi')
  ) {
    return 'forearms';
  }
  if (value.includes('triceps brachii') || value.includes('triceps (supporting arm)')) return 'triceps-lateral-head';
  if (value.includes('biceps brachii')) return 'bicep-long-head';
  if (value.includes('quadriceps') || value.includes('quad')) return 'quads';
  if (value.includes('rectus femoris')) return 'quads';
  if (value.includes('hamstring') || value.includes('gastrings') || value.includes('popliteus')) return 'hamstrings';
  if (value.includes('glute')) return 'glutes';
  if (value.includes('gastrocnemius') || value.includes('soleus') || value.includes('calf') || value.includes('tibialis anterior')) return 'calves';

  if (value.includes('oblique')) return 'obliques';
  if (value.includes('rectus abdominis') || value.includes('abdominis')) return 'mid-abs';
  if (
    value.includes('hip') ||
    value.includes('iliopsoas') ||
    value.includes('psoas') ||
    value.includes('tensor fasciae latae') ||
    value.includes('piriformis')
  ) {
    return 'hips';
  }
  if (value.includes('hip abductors')) return 'hips';
  if (value.includes('hip adductors') || value.includes('adductor') || value.includes('gracilis') || value.includes('pectineus') || value.includes('adductors')) return 'inner-thigh';
  if (value.includes('sartorius')) return 'inner-thigh';
  if (value.includes('obturator externus')) return 'hips';

  return null;
};

const mapMainMuscleFallback = (value: string): MuscleGroup => {
  const normalized = normalize(value);
  if (normalized.includes('chest')) return 'mid-chest';
  if (normalized.includes('shoulder')) return 'lateral-delts';
  if (normalized.includes('upper back')) return 'traps';
  if (normalized.includes('back')) return 'middle-back';
  if (normalized.includes('upper arms') || normalized.includes('upper arm')) return 'triceps-long-head';
  if (normalized.includes('forearm')) return 'forearms';
  if (normalized.includes('neck')) return 'neck';
  if (normalized.includes('waist') || normalized.includes('abs')) return 'mid-abs';
  if (normalized.includes('thigh')) return 'quads';
  if (normalized.includes('hips')) return 'hips';
  if (normalized.includes('lower legs')) return 'calves';
  return 'middle-back';
};

const inferTargetMuscle = async (
  targetMuscles: string[],
  mainMuscle: string,
  context: MuscleResolveContext
): Promise<MuscleGroup> => {
  for (const muscle of targetMuscles) {
    const resolved = await resolveMuscleGroup(muscle, context);
    if (resolved) return promoteChestIsolationToPecs(resolved, context.exerciseName);
  }

  return promoteChestIsolationToPecs(mapMainMuscleFallback(mainMuscle), context.exerciseName);
};

const inferSecondaryMuscles = async (
  secondarySources: string[],
  targetMuscle: MuscleGroup,
  context: MuscleResolveContext
): Promise<MuscleGroup[]> => {
  const resolved = await Promise.all(secondarySources.map((muscle) => resolveMuscleGroup(muscle, context)));
  const mapped = resolved.filter((value): value is MuscleGroup => Boolean(value));

  const unique = Array.from(new Set(mapped)).filter((muscle) => muscle !== targetMuscle);
  return unique;
};

const inferForce = (forceValue: string, targetMuscle: MuscleGroup): Exercise['force'] => {
  const normalized = normalize(forceValue);
  if (normalized.includes('legs')) return 'legs';
  if (normalized.includes('push') && normalized.includes('pull')) {
    if (['quads', 'hamstrings', 'glutes', 'calves', 'hips', 'inner-thigh'].includes(targetMuscle)) return 'legs';
    if (['lats', 'middle-back', 'lower-back', 'romboids', 'traps', 'bicep-long-head', 'bicep-short-head', 'brachialis', 'brachioradialis'].includes(targetMuscle)) return 'pull';
    return 'push';
  }
  if (normalized.includes('pull')) return 'pull';
  if (normalized.includes('push')) return 'push';
  if (['quads', 'hamstrings', 'glutes', 'calves', 'hips', 'inner-thigh'].includes(targetMuscle)) return 'legs';
  if (['lats', 'middle-back', 'lower-back', 'romboids', 'traps', 'bicep-long-head', 'bicep-short-head', 'brachialis', 'brachioradialis'].includes(targetMuscle)) return 'pull';
  return 'push';
};

const inferCategory = (name: string, utility: string, mechanics: string): Exercise['category'] => {
  const normalizedName = normalize(name);
  const normalizedUtility = normalize(utility);
  const normalizedMechanics = normalize(mechanics);

  let primary: Exercise['category'][number] = 'strength';

  if (normalizedName.includes('stretch') || normalizedName.includes('mobility')) {
    primary = 'mobility';
  } else if (normalizedMechanics.includes('isolated')) {
    primary = 'hypertrophy';
  } else if (normalizedUtility.includes('auxiliary')) {
    primary = 'hypertrophy';
  } else if (normalizedMechanics.includes('compound') || normalizedUtility.includes('basic')) {
    primary = 'strength';
  }

  const secondary: Exercise['category'][number] | null = (() => {
    if (primary === 'strength' && normalizedMechanics.includes('isolated')) return 'hypertrophy';
    if (primary === 'hypertrophy' && normalizedUtility.includes('basic')) return 'strength';
    return null;
  })();

  return secondary ? [primary, secondary] : [primary];
};

const KNOWN_COMPOUND_MECHANICS = new Set(['compound']);
const KNOWN_ISOLATION_MECHANICS = new Set(['isolation', 'isolated']);
const unknownMechanicsWarnings = new Set<string>();

const inferCompound = (mechanics: string): boolean => {
  const normalizedMechanics = normalize(mechanics);

  if (KNOWN_COMPOUND_MECHANICS.has(normalizedMechanics)) {
    return true;
  }

  if (KNOWN_ISOLATION_MECHANICS.has(normalizedMechanics)) {
    return false;
  }

  if (normalizedMechanics && !unknownMechanicsWarnings.has(normalizedMechanics)) {
    unknownMechanicsWarnings.add(normalizedMechanics);
    console.warn('⚠️ Unknown mechanics value encountered. Defaulting compound=false.', {
      mechanics: normalizedMechanics,
    });
  }

  return false;
};

const buildFormTips = (preparation: string, execution: string): string[] => {
  const tips = [preparation, execution]
    .map((tip) => tip?.trim())
    .filter(Boolean) as string[];
  return tips.length > 0 ? tips : ['No tips available.'];
};

const getFormTipsFromLLM = async (exercise: Omit<Exercise, 'id'>): Promise<string[]> => {
  if (!vertexModel) return ['No tips available.'];
  const prompt = `You are generating concise form tips for a fitness exercise.

Exercise name: ${exercise.name}
Target muscle: ${exercise.targetMuscle}
Secondary muscles: ${exercise.secondaryMuscles.join(', ') || 'none'}
Equipment: ${exercise.equipment}
Force: ${exercise.force}
Category: ${exercise.category.join(', ')}

Return only a JSON array of short tips (1-3 items). If unsure, return [] only.`;

  try {
    // NOTE: Added trace log for form tips generation.
    console.error('📝 LLM form tips', { exerciseName: exercise.name });
    const responseText = await generateTextWithVertex(prompt);
    if (!responseText) return ['No tips available.'];
    // NOTE: Strip code fences in case the model returns ```json blocks.
    const parsed = JSON.parse(stripJsonCodeFences(responseText));
    if (!Array.isArray(parsed)) return ['No tips available.'];
    const tips = parsed.filter((item) => typeof item === 'string' && item.trim().length > 0);
    console.error('📝 LLM form tips result', { exerciseName: exercise.name, count: tips.length });
    return tips.length > 0 ? tips : ['No tips available.'];
  } catch {
    return ['No tips available.'];
  }
};

const mergeUnique = (base: string[], extras: string[]): string[] => {
  const merged = [...base];
  extras.forEach((item) => {
    const normalized = normalize(item);
    if (!normalized) return;
    if (!merged.some((existing) => normalize(existing) === normalized)) {
      merged.push(item.trim());
    }
  });
  return merged;
};

// Vertex AI setup (ADC): project + location + model (no API key required).
const vertexProjectId = process.env.VERTEX_AI_PROJECT || '';
const vertexLocation = process.env.VERTEX_AI_LOCATION || 'europe-west4';
const vertexModelId = process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash';
const vertexAi = vertexProjectId ? new VertexAI({ project: vertexProjectId, location: vertexLocation }) : null;
const vertexModel = vertexAi ? vertexAi.getGenerativeModel({ model: vertexModelId }) : null;
// NOTE: Added initialization log to confirm Vertex AI client/model availability.
console.error('🤖 Vertex AI init:', {
  hasClient: Boolean(vertexAi),
  hasModel: Boolean(vertexModel),
  project: vertexProjectId || '(missing)',
  location: vertexLocation,
  model: vertexModelId,
});

// NOTE: Added JSON cache for LLM responses to avoid repeated calls across runs.
type LlmCacheEntry = {
  text: string;
  createdAt: string;
};

const llmCacheDir = path.resolve(__dirname, '../../.cache');
const llmCacheFile = path.join(llmCacheDir, 'llm.json');
let llmCache: Record<string, LlmCacheEntry> = {};
let cacheWritePromise: Promise<void> = Promise.resolve();

const loadLlmCache = (): void => {
  try {
    if (!fs.existsSync(llmCacheFile)) return;
    const raw = fs.readFileSync(llmCacheFile, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, LlmCacheEntry>;
    llmCache = parsed ?? {};
    console.error('🗂️ LLM cache loaded', { entries: Object.keys(llmCache).length });
  } catch (error) {
    console.warn('⚠️ Failed to load LLM cache, starting fresh.');
    llmCache = {};
  }
};

const persistLlmCache = async (): Promise<void> => {
  cacheWritePromise = cacheWritePromise.then(async () => {
    try {
      if (!fs.existsSync(llmCacheDir)) {
        fs.mkdirSync(llmCacheDir, { recursive: true });
      }
      await fs.promises.writeFile(llmCacheFile, JSON.stringify(llmCache, null, 2), 'utf-8');
    } catch (error) {
      console.warn('⚠️ Failed to persist LLM cache.');
    }
  });

  return cacheWritePromise;
};

const buildLlmCacheKey = (prompt: string): string => {
  const fingerprint = `${vertexModelId}|${vertexLocation}|${prompt}`;
  return crypto.createHash('sha256').update(fingerprint).digest('hex');
};

loadLlmCache();

// Helper to send a prompt and return plain text from Vertex AI.
const generateTextWithVertex = async (prompt: string): Promise<string | null> => {
  if (!vertexModel) return null;

  // NOTE: Check cache before calling Vertex AI.
  const cacheKey = buildLlmCacheKey(prompt);
  const cached = llmCache[cacheKey];
  if (cached?.text) {
    console.error('🗂️ LLM cache hit', { cacheKey });
    return cached.text;
  }

  console.error('🗂️ LLM cache miss', { cacheKey });

  try {
    // NOTE: Added timing to monitor LLM request latency.
    const start = Date.now();
    const result = await vertexModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    const text =
      result.response?.candidates?.[0]?.content?.parts
        ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
        .join('') ??
      '';

    const trimmed = text.trim();
    const elapsedMs = Date.now() - start;
    console.error('🧠 LLM response received', { elapsedMs, hasText: trimmed.length > 0 });
    if (trimmed.length === 0) return null;

    // NOTE: Persist successful LLM responses to cache.
    llmCache[cacheKey] = {
      text: trimmed,
      createdAt: new Date().toISOString(),
    };
    await persistLlmCache();
    return trimmed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: unknown })?.code;
    const status = (error as { status?: unknown })?.status;
    const details = (error as { details?: unknown })?.details;
    console.warn('⚠️ LLM request failed', { message, code, status, details });
    return null;
  }
};

type MuscleResolveContext = {
  exerciseName: string;
  mainMuscle: string;
  targetMuscles: string[];
  secondaryMuscles: string[];
  force: string;
  mechanics: string;
  utility: string;
};

const muscleGroupCache = new Map<string, MuscleGroup | null>();

const parseMuscleGroupResponse = (text: string): MuscleGroup | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let candidate: unknown = trimmed;
  try {
    if (trimmed.startsWith('[') || trimmed.startsWith('{') || trimmed.startsWith('"')) {
      candidate = JSON.parse(trimmed);
    }
  } catch {
    candidate = trimmed;
  }

  if (Array.isArray(candidate)) {
    candidate = candidate[0];
  }

  if (typeof candidate !== 'string') return null;

  const cleaned = candidate.replace(/^["']|["']$/g, '').trim();
  const parsed = MuscleGroupEnum.safeParse(cleaned);
  return parsed.success ? parsed.data : null;
};

// NOTE: Added helper to strip Markdown code fences from LLM JSON responses.
const stripJsonCodeFences = (value: string): string => {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? (match[1] ?? trimmed).trim() : trimmed;
};

const getMuscleGroupFromLLM = async (token: string, context: MuscleResolveContext): Promise<MuscleGroup | null> => {
  if (!vertexModel) return null;

  const cacheKey = `${normalize(token)}|${normalize(context.mainMuscle)}|${normalize(context.exerciseName)}`;
  if (muscleGroupCache.has(cacheKey)) return muscleGroupCache.get(cacheKey) ?? null;

  const prompt = `You are mapping ambiguous muscle tokens to one muscle group for a fitness database.

Ambiguous token: ${token}
Exercise name: ${context.exerciseName}
Main muscle: ${context.mainMuscle}
Target muscles: ${context.targetMuscles.join(', ') || 'none'}
Secondary muscles: ${context.secondaryMuscles.join(', ') || 'none'}
Force: ${context.force}
Mechanics: ${context.mechanics}
Utility: ${context.utility}

Choose exactly ONE value from this list and return ONLY that value as plain text (no JSON):
${MuscleGroupEnum.options.join(', ')}
`;

  try {
    // NOTE: Added trace log for ambiguous muscle resolution.
    console.error('🧭 LLM resolve muscle', {
      token,
      exerciseName: context.exerciseName,
      mainMuscle: context.mainMuscle,
    });
    const responseText = await generateTextWithVertex(prompt);
    if (!responseText) {
      muscleGroupCache.set(cacheKey, null);
      return null;
    }
    const resolved = parseMuscleGroupResponse(responseText);
    console.error('🧭 LLM muscle resolved', {
      token,
      resolved: resolved ?? '(null)',
    });
    muscleGroupCache.set(cacheKey, resolved);
    return resolved;
  } catch {
    muscleGroupCache.set(cacheKey, null);
    return null;
  }
};

const resolveMuscleGroup = async (raw: string, context: MuscleResolveContext): Promise<MuscleGroup | null> => {
  const normalized = normalize(raw);
  if (!normalized) return null;
  if (!isAmbiguousMuscleToken(normalized)) return mapMuscleToGroup(raw);
  return await getMuscleGroupFromLLM(raw, context);
};

const getAdditionalInjuries = async (exercise: Omit<Exercise, 'id'>): Promise<string[]> => {
  if (!vertexModel) return [];
  const prompt = `You are assisting with tagging possible injury areas for an exercise.\n\nExercise name: ${exercise.name}\nTarget muscle: ${exercise.targetMuscle}\nSecondary muscles: ${exercise.secondaryMuscles.join(', ') || 'none'}\nEquipment: ${exercise.equipment}\nForce: ${exercise.force}\nCategory: ${exercise.category.join(', ')}\nCurrent possible injuries: ${exercise.possibleInjuries.join(', ')}\nForm tips: ${exercise.formTips.join(' | ')}\n\nReturn only a JSON array of additional injury area strings (lowercase, short phrases). Do NOT include any injuries already in the current list. If none, return [] only.`;

  try {
    // NOTE: Added trace log for injury enrichment.
    console.error('🩹 LLM enrich injuries', { exerciseName: exercise.name });
    const responseText = await generateTextWithVertex(prompt);
    if (!responseText) return [];
    // NOTE: Strip code fences in case the model returns ```json blocks.
    const parsed = JSON.parse(stripJsonCodeFences(responseText));
    if (!Array.isArray(parsed)) return [];
    const extras = parsed.filter((item) => typeof item === 'string' && item.trim().length > 0);
    console.error('🩹 LLM injury extras', { exerciseName: exercise.name, count: extras.length });
    return extras;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: unknown })?.code;
    const status = (error as { status?: unknown })?.status;
    const details = (error as { details?: unknown })?.details;
    console.warn('⚠️ Vertex AI enrichment failed, continuing without extra injuries.', {
      exerciseName: exercise.name,
      message,
      code,
      status,
      details,
    });
    return [];
  }
};

const withConcurrency = async <T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let index = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= items.length) return;
      const current = items[currentIndex]!;
      const result = await worker(current);
      results[currentIndex] = result;
    }
  });

  await Promise.all(runners);
  return results;
};

const seed = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not set in .env');
    }

    await mongoose.connect(mongoUri);

    const csvPath = getCsvPath();
    console.error(`📖 Reading CSV data from ${csvPath}...`);
    const rawData = await csv().fromFile(csvPath);
    console.error(`   Found ${rawData.length} raw entries.`);

    console.error('⚙️  Transforming data...');
    // NOTE: Added progress counter to monitor LLM processing throughput.
    let processed = 0;
    const mappedExercises = (await withConcurrency(rawData, vertexModel ? 3 : 8, async (row: Record<string, string>) => {
      const name = row['Exercise Name']?.trim();
      if (!name) return null;

      // NOTE: Added periodic progress log to avoid noisy output.
      processed += 1;
      if (processed % 200 === 0) {
        console.error('📊 Progress', { processed, total: rawData.length });
      }

      const targetMuscles = parseCsvList(row['Target_Muscles']);
      const secondaryMusclesRaw = [
        ...parseCsvList(row['Secondary Muscles']),
        ...parseCsvList(row['Synergist_Muscles']),
        ...parseCsvList(row['Stabilizer_Muscles']),
        ...parseCsvList(row['Dynamic_Stabilizer_Muscles']),
      ];

      const context: MuscleResolveContext = {
        exerciseName: name,
        mainMuscle: row['Main_muscle'] || '',
        targetMuscles,
        secondaryMuscles: secondaryMusclesRaw,
        force: row['Force'] || '',
        mechanics: row['Mechanics'] || '',
        utility: row['Utility'] || '',
      };

      // NOTE: Added log to trace muscle resolution entry point.
      console.error('🏷️  Resolving muscles', { exerciseName: name });
      const targetMuscle = await inferTargetMuscle(targetMuscles, row['Main_muscle'] || '', context);
      const secondaryMuscles = await inferSecondaryMuscles(secondaryMusclesRaw, targetMuscle, context);

      let formTips = buildFormTips(row['Preparation'] || '', row['Execution'] || '');
      const exerciseBase: Omit<Exercise, 'id'> = {
        name,
        targetMuscle,
        secondaryMuscles,
        equipment: mapEquipment(row['Equipment'] || '', name),
        compound: inferCompound(row['Mechanics'] || ''),
        force: inferForce(row['Force'] || '', targetMuscle),
        category: inferCategory(name, row['Utility'] || '', row['Mechanics'] || ''),
        possibleInjuries: inferPossibleInjuries(targetMuscle),
        formTips,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      if (vertexModel && formTips.length === 1 && formTips[0] === 'No tips available.') {
        formTips = await getFormTipsFromLLM(exerciseBase);
      }

      const exercise: Omit<Exercise, 'id'> = {
        ...exerciseBase,
        formTips,
      };

      const parsed = CreateExerciseSchema.safeParse(exercise);
      if (!parsed.success) {
        console.warn(`⚠️ Skipping invalid exercise: ${name}`);
        return null;
      }

      return parsed.data;
    })).filter((exercise): exercise is Omit<Exercise, 'id'> => Boolean(exercise));

    console.error(`   Mapped ${mappedExercises.length} valid exercises.`);

    if (vertexModel) {
      console.error('🤖 Enriching possible injuries with Vertex AI...');
      const enriched = await withConcurrency(mappedExercises, 3, async (exercise) => {
        const extras = await getAdditionalInjuries(exercise);
        return {
          ...exercise,
          possibleInjuries: mergeUnique(exercise.possibleInjuries, extras),
        };
      });
      mappedExercises.length = 0;
      mappedExercises.push(...enriched);
    } else {
      console.error('ℹ️ Vertex AI configuration not found. Skipping LLM enrichment.');
    }

    console.error('🧹 Clearing old database...');
    await ExerciseModel.deleteMany({});

    console.error('🌱 Inserting new data...');
    await ExerciseModel.insertMany(mappedExercises, { ordered: false });

    console.error('✅ Database seeded successfully!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

seed();