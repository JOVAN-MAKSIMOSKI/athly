import { QdrantClient } from '@qdrant/js-client-rest';
import { createHash } from 'crypto';
import type { AiExerciseRecord } from './listExercises.js';

const DEFAULT_COLLECTION = process.env.QDRANT_COLLECTION || 'athly_exercises';

function toDeterministicPointId(value: string): string {
  const hex = createHash('sha1').update(value).digest('hex');
  // Force UUID layout/version bits so Qdrant accepts it as a UUID string.
  const part1 = hex.slice(0, 8);
  const part2 = hex.slice(8, 12);
  const part3 = `4${hex.slice(13, 16)}`;
  const variantNibble = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  const part4 = `${variantNibble}${hex.slice(17, 20)}`;
  const part5 = hex.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

function getQdrantUrl(): string {
  const url = process.env.QDRANT_URL;
  if (!url) {
    throw new Error('Missing QDRANT_URL environment variable');
  }
  return url;
}

function getQdrantClient(): QdrantClient {
  const checkCompatibility = process.env.QDRANT_CHECK_COMPATIBILITY === 'true';
  return new QdrantClient({
    url: getQdrantUrl(),
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility,
  });
}

export interface ExerciseSearchFilters {
  targetMuscle?: string;
  equipment?: string;
  force?: string;
  compound?: boolean;
}

export interface ExerciseVectorHit {
  id: string | number;
  score: number;
  payload: {
    text: string;
    metadata: AiExerciseRecord['metadata'];
  } | null;
}

export async function ensureExerciseCollection(vectorSize: number): Promise<void> {
  const client = getQdrantClient();
  const collectionName = DEFAULT_COLLECTION;

  try {
    await client.getCollection(collectionName);
    return;
  } catch {
    await client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine',
      },
    });
  }
}

export async function upsertExerciseVectors(items: AiExerciseRecord[], vectors: number[][]): Promise<number> {
  if (items.length !== vectors.length) {
    throw new Error(`Mismatched inputs: items=${items.length}, vectors=${vectors.length}`);
  }

  if (items.length === 0) return 0;

  const client = getQdrantClient();
  const points = items.map((item, index) => ({
    id: toDeterministicPointId(item.metadata.id),
    vector: vectors[index]!,
    payload: {
      text: item.text,
      metadata: item.metadata,
    },
  }));

  await client.upsert(DEFAULT_COLLECTION, {
    wait: true,
    points,
  });

  return points.length;
}

function buildFilter(filters?: ExerciseSearchFilters): Record<string, unknown> | undefined {
  if (!filters) return undefined;

  const must: Array<Record<string, unknown>> = [];

  if (filters.targetMuscle) {
    must.push({ key: 'metadata.targetMuscle', match: { value: filters.targetMuscle } });
  }

  if (filters.equipment) {
    must.push({ key: 'metadata.equipment', match: { value: filters.equipment } });
  }

  if (filters.force) {
    must.push({ key: 'metadata.force', match: { value: filters.force } });
  }

  if (typeof filters.compound === 'boolean') {
    must.push({ key: 'metadata.compound', match: { value: filters.compound } });
  }

  if (must.length === 0) return undefined;
  return { must };
}

export async function getIndexedExerciseIds(): Promise<Set<string>> {
  const client = getQdrantClient();

  // Quick pre-check: see if collection has any points at all
  try {
    const firstPage = await client.scroll(DEFAULT_COLLECTION, {
      limit: 1,
      offset: 0,
      with_payload: true,
      with_vector: false,
    });

    if (firstPage.points.length === 0) {
      return new Set(); // Collection is empty
    }
  } catch {
    return new Set(); // Collection doesn't exist or error
  }

  // If resume check is disabled, just skip the full scan and rely on upsert deduplication
  if (process.env.SKIP_RESUME_CHECK === 'true') {
    console.log('Resume check disabled (SKIP_RESUME_CHECK=true), relying on upsert deduplication.');
    return new Set();
  }

  // Full scan with timeout
  const indexed = new Set<string>();
  const timeoutMs = 30000; // 30 second timeout
  let offset = 0;
  const pageSize = 100;
  let hasMore = true;

  const timeoutPromise = new Promise<Set<string>>((_, reject) =>
    setTimeout(
      () => reject(new Error('Resume check timeout after 30s, proceeding with partial index')),
      timeoutMs
    )
  );

  try {
    const scanPromise = (async () => {
      while (hasMore) {
        const response = await client.scroll(DEFAULT_COLLECTION, {
          limit: pageSize,
          offset,
          with_payload: true,
          with_vector: false,
        });

        for (const point of response.points) {
          const metadata = (point.payload as { metadata?: { id?: string } } | null)?.metadata;
          if (metadata?.id) {
            indexed.add(metadata.id);
          }
        }

        hasMore = response.points.length === pageSize;
        offset += pageSize;
      }
      return indexed;
    })();

    return await Promise.race([scanPromise, timeoutPromise]);
  } catch (error) {
    console.warn(`Resume check failed: ${error instanceof Error ? error.message : String(error)}`);
    console.warn('Proceeding with full re-indexing (new + existing exercises may be re-upserted).');
    return new Set();
  }
}

export async function searchExerciseVectors(
  queryVector: number[],
  limit = 5,
  filters?: ExerciseSearchFilters
): Promise<ExerciseVectorHit[]> {
  const client = getQdrantClient();

  const results = await client.search(DEFAULT_COLLECTION, {
    vector: queryVector,
    limit,
    filter: buildFilter(filters),
    with_payload: true,
    with_vector: false,
  });

  return results.map((result) => ({
    id: result.id,
    score: result.score,
    payload: (result.payload as ExerciseVectorHit['payload']) ?? null,
  }));
}
