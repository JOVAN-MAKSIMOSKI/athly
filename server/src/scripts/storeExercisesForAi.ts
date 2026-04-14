import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { storeExercisesSnapshot, exerciseStoragePath } from '../services/ai/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function run() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  await mongoose.connect(mongoUri);

  try {
    const snapshot = await storeExercisesSnapshot();
    console.log(
      `Stored ${snapshot.total} exercises for AI at ${exerciseStoragePath} (${snapshot.generatedAt})`
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error('Failed to store AI exercise snapshot:', error);
  process.exitCode = 1;
});
