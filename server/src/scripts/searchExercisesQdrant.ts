import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedTexts } from '../services/ai/embeddings.js';
import { searchExerciseVectors, type ExerciseSearchFilters } from '../services/ai/qdrant.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

type ParsedArgs = {
  query: string;
  limit: number;
  filters: ExerciseSearchFilters;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  let limit = 5;
  const filters: ExerciseSearchFilters = {};
  const queryParts: string[] = [];

  while (args.length > 0) {
    const current = args.shift()!;

    if (current.startsWith('--limit=')) {
      limit = Number(current.slice('--limit='.length)) || 5;
      continue;
    }

    if (current.startsWith('--target=')) {
      filters.targetMuscle = current.slice('--target='.length);
      continue;
    }

    if (current.startsWith('--equipment=')) {
      filters.equipment = current.slice('--equipment='.length);
      continue;
    }

    if (current.startsWith('--force=')) {
      filters.force = current.slice('--force='.length);
      continue;
    }

    if (current.startsWith('--compound=')) {
      const value = current.slice('--compound='.length).toLowerCase();
      if (value === 'true' || value === 'false') {
        filters.compound = value === 'true';
      }
      continue;
    }

    queryParts.push(current);
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    throw new Error(
      'Missing query text. Example: npm run ai:search:qdrant --workspace=server -- "best chest dumbbell movement" --limit=5 --target=pecs'
    );
  }

  return {
    query,
    limit,
    filters,
  };
}

async function run() {
  const parsed = parseArgs(process.argv.slice(2));
  const vectors = await embedTexts([parsed.query]);
  const queryVector = vectors[0]!;

  const hits = await searchExerciseVectors(queryVector, parsed.limit, parsed.filters);

  console.log(
    JSON.stringify(
      {
        query: parsed.query,
        limit: parsed.limit,
        filters: parsed.filters,
        results: hits,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error('Qdrant search failed:', error);
  process.exitCode = 1;
});
