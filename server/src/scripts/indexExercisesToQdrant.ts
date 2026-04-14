import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { embedTexts } from '../services/ai/embeddings.js';
import { ensureExerciseCollection, upsertExerciseVectors } from '../services/ai/qdrant.js';
import { exerciseStoragePath, type StoredExerciseSnapshot } from '../services/ai/storeExercises.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const BATCH_SIZE = 24;
const SKIP_OFFSET = parseInt(process.env.SKIP_OFFSET || '0', 10); // Skip first N exercises

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

async function run() {
  const raw = await fs.readFile(exerciseStoragePath, 'utf-8');
  const snapshot = JSON.parse(raw) as StoredExerciseSnapshot;

  if (snapshot.items.length === 0) {
    console.log('No exercises found in snapshot, skipping Qdrant indexing.');
    return;
  }

  const firstEmbedding = await embedTexts([snapshot.items[0]!.text]);
  const vectorSize = firstEmbedding[0]!.length;
  await ensureExerciseCollection(vectorSize);

  // Skip exercises up to SKIP_OFFSET (1-indexed from CLI, 0-indexed internally)
  const toIndex = snapshot.items.slice(SKIP_OFFSET);

  if (SKIP_OFFSET > 0) {
    console.log(
      `Skipping first ${SKIP_OFFSET} exercises. Starting from exercise ${SKIP_OFFSET + 1}/${snapshot.items.length}.`
    );
  }

  if (toIndex.length === 0) {
    console.log('All exercises already indexed. Nothing to do.');
    return;
  }

  let indexed = 0;
  const batches = chunkArray(toIndex, BATCH_SIZE);

  for (const batch of batches) {
    const vectors = await embedTexts(batch.map((item) => item.text));
    const written = await upsertExerciseVectors(batch, vectors);
    indexed += written;
    const totalIndexedNow = SKIP_OFFSET + indexed;
    console.log(`Indexed ${indexed} in this batch (${totalIndexedNow}/${snapshot.items.length} total)...`);
  }

  const totalIndexed = SKIP_OFFSET + indexed;
  console.log(
    `Qdrant indexing complete: ${totalIndexed}/${snapshot.items.length} exercises total ` +
      `(${indexed} new, snapshot generatedAt=${snapshot.generatedAt}).`
  );
}

run().catch((error) => {
  console.error('Failed to index exercises into Qdrant:', error);
  process.exitCode = 1;
});
