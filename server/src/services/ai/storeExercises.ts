import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { listExercisesForAi, type AiExerciseRecord } from './listExercises.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.resolve(__dirname, '../../../storage');
const EXERCISES_FILE = path.resolve(STORAGE_DIR, 'exercises.snapshot.json');

export interface StoredExerciseSnapshot {
  generatedAt: string;
  total: number;
  items: AiExerciseRecord[];
}

export async function storeExercisesSnapshot(): Promise<StoredExerciseSnapshot> {
  const items = await listExercisesForAi();

  const snapshot: StoredExerciseSnapshot = {
    generatedAt: new Date().toISOString(),
    total: items.length,
    items,
  };

  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(EXERCISES_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');

  return snapshot;
}

export const exerciseStoragePath = EXERCISES_FILE;
