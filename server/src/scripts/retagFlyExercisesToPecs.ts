import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ExerciseModel } from '../database/models/ExerciseSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const CHEST_SUBDIVISIONS = ['upper-chest', 'mid-chest', 'lower-chest'] as const;
const FLY_OR_CROSSOVER_PATTERN = /\b(fly|flies|crossover|cross[ -]?over|pec\s*deck|butterfly)\b/i;

async function run(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  await mongoose.connect(mongoUri);

  try {
    const filter = {
      targetMuscle: { $in: CHEST_SUBDIVISIONS },
      name: { $regex: FLY_OR_CROSSOVER_PATTERN.source, $options: 'i' },
    };

    const scanned = await ExerciseModel.collection.countDocuments(filter);

    if (scanned === 0) {
      console.error('No chest fly/crossover exercises found to retag.');
      return;
    }

    const result = await ExerciseModel.collection.updateMany(filter, [
      {
        $set: {
          targetMuscle: 'pecs',
          secondaryMuscles: {
            $setDifference: [
              {
                $setUnion: [
                  { $ifNull: ['$secondaryMuscles', []] },
                  ['$targetMuscle'],
                ],
              },
              ['pecs'],
            ],
          },
        },
      },
    ]);

    console.error('Retag complete:', {
      scanned,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error('Retag migration failed:', error);
  process.exit(1);
});
