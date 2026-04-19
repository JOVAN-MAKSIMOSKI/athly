import { mapRawToExercise } from '../utils/exerciseMapper.js';

describe('mapRawToExercise', () => {
  it('should map a valid raw exercise to structured format', () => {
    const raw = {
      name: 'Barbell Squat',
      primary_muscles: ['quadriceps femoris'],
      equipment: ['barbell'],
      possible_injuries: ['knee pain'],
      form_tips: ['Keep your back straight.'],
      compound: 'true',
    };
    const result = mapRawToExercise(raw);
    expect(result).toMatchObject({
      name: 'Barbell Squat',
      targetMuscle: 'quads',
      secondaryMuscles: [],
      equipment: 'barbell',
      compound: true,
      force: 'legs',
      category: ['strength'],
      possibleInjuries: ['knee pain'],
      formTips: ['Keep your back straight.'],
    });
  });

  it('should return null if name is missing', () => {
    const raw = { primary_muscles: ['quadriceps femoris'] };
    expect(mapRawToExercise(raw)).toBeNull();
  });

  it('should return null if target muscle is not mapped', () => {
    const raw = { name: 'Unknown', primary_muscles: ['unknown muscle'] };
    expect(mapRawToExercise(raw)).toBeNull();
  });

  it('should default formTips if missing', () => {
    const raw = {
      name: 'Barbell Squat',
      primary_muscles: ['quadriceps femoris'],
      equipment: ['barbell'],
      compound: true,
    };
    const result = mapRawToExercise(raw);
    expect(result?.formTips).toEqual(['No tips available.']);
  });
});
