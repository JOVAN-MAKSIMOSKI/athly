import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { QdrantClient } from '@qdrant/js-client-rest';
import { exerciseStoragePath, type StoredExerciseSnapshot } from '../services/ai/storeExercises.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function getQdrantClient(): QdrantClient {
  const url = process.env.QDRANT_URL;
  if (!url) {
    throw new Error('Missing QDRANT_URL environment variable');
  }
  return new QdrantClient({
    url,
    apiKey: process.env.QDRANT_API_KEY,
  });
}

async function run() {
  const collectionName = process.env.QDRANT_COLLECTION || 'athly_exercises';
  const client = getQdrantClient();

  console.log(`\n📊 Verifying Qdrant indexing for collection: ${collectionName}\n`);

  // Get collection stats
  try {
    const collection = await client.getCollection(collectionName);
    const pointCount = collection.points_count ?? 0;
    console.log(`✓ Collection exists with ${pointCount} points`);
  } catch (error) {
    console.error(`✗ Collection does not exist or error: ${error}`);
    process.exitCode = 1;
    return;
  }

  // Get snapshot stats
  const raw = await fs.readFile(exerciseStoragePath, 'utf-8');
  const snapshot = JSON.parse(raw) as StoredExerciseSnapshot;
  const snapshotCount = snapshot.items.length;
  console.log(`✓ Snapshot contains ${snapshotCount} exercises`);

  // Compare counts
  const client2 = getQdrantClient();
  const collection2 = await client2.getCollection(collectionName);
  const qdrantCount = collection2.points_count ?? 0;

  console.log(`\n📈 Count Summary:`);
  console.log(`  Snapshot:  ${snapshotCount}`);
  console.log(`  Qdrant:    ${qdrantCount}`);
  console.log(`  Difference: ${snapshotCount - qdrantCount}`);

  if (snapshotCount === qdrantCount) {
    console.log(`\n✅ All exercises are indexed!`);
  } else if (qdrantCount > snapshotCount) {
    console.log(`\n⚠️  Qdrant has MORE points than snapshot (possible duplicates)`);
  } else {
    console.log(`\n❌ Missing ${snapshotCount - qdrantCount} exercises. Run indexing again.`);
  }

  // Sample a few random searches to verify quality
  console.log(`\n🔍 Testing vector search quality...\n`);
  const testQueries = [
    'chest press dumbbell',
    'leg squat',
    'row back',
  ];

  for (const query of testQueries) {
    try {
      const hash = require('crypto').createHash('sha1').update(query).digest('hex');
      const vector = Array.from({ length: 384 }, (_, i) => 
        (parseInt(hash.slice(i * 2, i * 2 + 2), 16) - 128) / 128
      );

      const results = await client.search(collectionName, {
        vector,
        limit: 2,
        with_payload: true,
        with_vector: false,
      });

      if (results.length > 0) {
        console.log(`✓ "${query}": Found ${results.length} result(s)`);
        console.log(`  Top match: "${results[0]!.payload?.text}" (score: ${results[0]!.score.toFixed(3)})`);
      } else {
        console.log(`✗ "${query}": No results found`);
      }
    } catch (error) {
      console.log(`✗ "${query}": Search failed - ${error}`);
    }
  }

  console.log(`\n✅ Verification complete!\n`);
}

run().catch((error) => {
  console.error('Verification failed:', error);
  process.exitCode = 1;
});
