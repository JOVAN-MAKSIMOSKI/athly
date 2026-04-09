import { getDatabase } from '../connection.js';
import type { Exercise } from '../../domain/exercises/types.js';
import type { SearchExercisesCriteria } from '../../domain/exercises/searchExercises.js';

export interface SearchExercisesResult {
  items: Exercise[];
  total: number;
  limit: number;
  offset: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mapExerciseDocument(doc: Record<string, unknown>): Exercise {
  return {
    id: String(doc._id ?? doc.id ?? ''),
    name: String(doc.name ?? ''),
    targetMuscle: doc.targetMuscle as Exercise['targetMuscle'],
    secondaryMuscles: (doc.secondaryMuscles as Exercise['secondaryMuscles']) || [],
    equipment: doc.equipment as Exercise['equipment'],
    compound: Boolean(doc.compound),
    force: doc.force as Exercise['force'],
    category: (doc.category as Exercise['category']) || [],
    possibleInjuries: (doc.possibleInjuries as Exercise['possibleInjuries']) || [],
    formTips: (doc.formTips as Exercise['formTips']) || [],
    createdAt: doc.createdAt as Exercise['createdAt'],
    updatedAt: doc.updatedAt as Exercise['updatedAt'],
  };
}

export async function searchExercisesInDb(criteria: SearchExercisesCriteria): Promise<SearchExercisesResult> {
  const db = await getDatabase();
  const collection = db.collection('exercises');

  const filter: Record<string, unknown> = {};

  if (criteria.queryText) {
    filter.name = { $regex: escapeRegex(criteria.queryText), $options: 'i' };
  }

  if (criteria.equipment?.length) {
    filter.equipment = { $in: criteria.equipment };
  }

  if (criteria.muscleGroups.length) {
    filter.$or = [
      { targetMuscle: { $in: criteria.muscleGroups } },
      { secondaryMuscles: { $in: criteria.muscleGroups } },
    ];
  }

  const total = await collection.countDocuments(filter);
  const docs = await collection
    .find(filter)
    .skip(criteria.offset)
    .limit(criteria.limit)
    .toArray();

  return {
    items: docs.map((doc) => mapExerciseDocument(doc as Record<string, unknown>)),
    total,
    limit: criteria.limit,
    offset: criteria.offset,
  };
}
