import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { ExerciseModel } from '../database/models/ExerciseSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Exercises matching this pattern should have `targetMuscle: 'lats'`.
 *
 * Matches: "Lat Pulldown", "Wide Grip Lat Pulldown", "Cable Lat Pulldown",
 *          "Close Grip Pulldown", "Pulldown (Machine)", "Pull Down", etc.
 *
 * Intentionally excludes "Triceps Pushdown" / "Triceps Pressdown" because
 * those words don't contain "lat pull" and the negative lookahead covers the
 * remaining edge-cases ("Cable Pressdown", etc.).
 */
const PULLDOWN_PATTERN = /\b(lat\s*pull|pull[\s-]?down)\b/i;

/**
 * Exercises whose name contains "triceps" or "pressdown" should NOT be
 * retagged even if somehow they matched the pattern above.
 */
const TRICEPS_EXCLUSION_PATTERN = /triceps|pressdown/i;

/**
 * We only retag exercises that are NOT already correctly tagged as 'lats'.
 * This avoids touching already-correct documents.
 */
const INCORRECT_TARGET_MUSCLES = [
  'middle-back',
  'upper-chest',
  'mid-chest',
  'lower-chest',
  'pecs',
  'traps',
  'romboids',
  'rear-delts',
  'front-delts',
  'lateral-delts',
];

async function run(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  await mongoose.connect(mongoUri);

  try {
    // Find candidates: name matches pulldown pattern, not a triceps movement,
    // and currently tagged with a non-lats muscle.
    const candidates = await ExerciseModel.find({
      targetMuscle: { $in: INCORRECT_TARGET_MUSCLES },
      name: { $regex: PULLDOWN_PATTERN.source, $options: 'i' },
    })
      .select('_id name targetMuscle secondaryMuscles')
      .lean();

    // Double-check the exclusion pattern in JS (regex source alone doesn't encode
    // the full negative semantics we want).
    const toRetag = candidates.filter(
      (doc) => !TRICEPS_EXCLUSION_PATTERN.test(doc.name),
    );

    if (toRetag.length === 0) {
      console.error('No pulldown exercises found that need retagging. Either all are already tagged as lats, or none exist in the database.');
      return;
    }

    console.error(`Found ${toRetag.length} exercise(s) to retag → lats:`);
    for (const doc of toRetag) {
      console.error(`  [${String(doc._id)}] "${doc.name}" (was: ${doc.targetMuscle})`);
    }

    // Retag: set targetMuscle to 'lats', move old targetMuscle into secondaryMuscles
    // (preserving it for scoring purposes), remove 'lats' from secondaryMuscles if
    // it was already there.
    const ids = toRetag.map((doc) => doc._id);

    const result = await ExerciseModel.collection.updateMany(
      { _id: { $in: ids } },
      [
        {
          $set: {
            targetMuscle: 'lats',
            secondaryMuscles: {
              $setDifference: [
                {
                  $setUnion: [
                    { $ifNull: ['$secondaryMuscles', []] },
                    ['$targetMuscle'],
                  ],
                },
                ['lats'],
              ],
            },
          },
        },
      ],
    );

    console.error('Retag complete:', {
      found: toRetag.length,
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
