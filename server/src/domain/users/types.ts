import { z } from 'zod';

// ============================================================================
// ENUMS & LITERALS
// ============================================================================

export const GoalEnum = z.enum(['strength', 'hypertrophy', 'endurance']);
export type Goal = z.infer<typeof GoalEnum>;

export const ExperienceLevelEnum = z.enum(['beginner', 'intermediate', 'advanced']);
export type ExperienceLevel = z.infer<typeof ExperienceLevelEnum>;

export const GenderEnum = z.enum(['male', 'female']);
export type Gender = z.infer<typeof GenderEnum>;

export const EquipmentAccessEnum = z.enum(['gym', 'home with dumbells', 'bodyweight']);
export type EquipmentAccess = z.infer<typeof EquipmentAccessEnum>;

export const UnitSystemEnum = z.enum(['METRIC', 'IMPERIAL']);
export type UnitSystem = z.infer<typeof UnitSystemEnum>;

export const ThemeEnum = z.enum(['light', 'dark']);
export type Theme = z.infer<typeof ThemeEnum>;

export const AvailableEquipmentEnum = z.enum([
  'dumbbell',
  'bench',
  'barbell',
  'resistance-band',
]);
export type AvailableEquipment = z.infer<typeof AvailableEquipmentEnum>;

// ============================================================================
// SAFETY SCHEMA & TYPE
// ============================================================================

export const SafetyProfileSchema = z.object({
  injuries: z.array(z.string()).describe('List of current injuries or limitations'),
  isMedicalCleared: z.boolean().refine(val => val === true, {
    message: 'User must be medically cleared to exercise',
  }).describe('Has the user been cleared by a medical professional to exercise'),
});

export const SafetySchema = SafetyProfileSchema;

export type SafetyProfile = z.infer<typeof SafetyProfileSchema>;
export type Safety = z.infer<typeof SafetySchema>;

// ============================================================================
// USER INFO SCHEMA & TYPE
// ============================================================================

export const UserInfoSchema = z.object({
  age: z.number().int().min(1).max(150).describe('User age in years'),
  weight: z.number().positive().describe('User weight in kg'),
  height: z.number().positive().describe('User height in cm'),
  gender: GenderEnum,
});

export type UserInfo = z.infer<typeof UserInfoSchema>;

// ============================================================================
// USER PREFERENCES SCHEMA & TYPE
// ============================================================================

export const UserPreferencesSchema = z.object({
  goal: GoalEnum,
  experienceLevel: ExperienceLevelEnum,
  daysPerWeek: z.number().int().min(1).max(7).describe('Number of workout days per week (1-7)'),
  equipmentAccess: z.array(EquipmentAccessEnum).min(1).describe('Available equipment access types'),
  // Workout generation inputs (aligned with mongoose settings)
  comfortableWithHeavierWeights: z.boolean().describe('Whether the user is comfortable working with heavier weights'),
  workoutDurationMinutes: z.number().int().min(5).max(240).describe('Typical workout duration in minutes (used for plan generation)'),
  availableEquipment: z.array(AvailableEquipmentEnum).optional(),
}).superRefine((data, ctx) => {
  if (!data.equipmentAccess.includes('home with dumbells')) return;
  if (data.availableEquipment?.includes('dumbbell')) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['availableEquipment'],
    message: 'Home users must include dumbbell in available equipment',
  });
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// ============================================================================
// FULL USER SCHEMA & TYPE
// ============================================================================

export const UserSchema = z.object({
  email: z.string().email().describe('Primary user email'),
  name: z.string().min(1).describe('Display name'),
  authId: z.string().optional().describe('External auth provider id'),
  id: z.string().describe('Unique user identifier'),
  userInfo: UserInfoSchema,
  preferences: UserPreferencesSchema,
  safety: SafetySchema,
  // Mongoose-aligned fields (profile/settings)
  profile: z.object({
    age: z.number().int().min(1).max(150).describe('User age in years'),
    weight: z.number().positive().describe('User weight in kg'),
    height: z.number().positive().describe('User height in cm'),
    experienceLevel: ExperienceLevelEnum,
    goal: GoalEnum,
    isMedicallyCleared: z.boolean().describe('Has medical clearance to exercise'),
  }).optional(),
  settings: z.object({
    units: UnitSystemEnum,
    theme: ThemeEnum,
    comfortableWithHeavierWeights: z.boolean().optional(),
    workoutDurationMinutes: z.number().int().min(5).max(240).optional(),
    workoutFrequencyPerWeek: z.number().int().min(1).max(7).describe('Approximate workouts per week the user plans to do'),
    availableEquipment: z.array(AvailableEquipmentEnum).optional(),
  }).optional(),
  currentProgramId: z.string().nullable().optional().describe('ID of the active workout program'),
  createdAt: z.date().describe('Account creation timestamp'),
  updatedAt: z.date().describe('Last profile update timestamp'),
});

export type User = z.infer<typeof UserSchema>;

// ============================================================================
// USER CREATION SCHEMA (for onboarding)
// ============================================================================

export const CreateUserSchema = UserSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  currentProgramId: z.string().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// ============================================================================
// USER UPDATE SCHEMA (for profile updates)
// ============================================================================

export const UpdateUserSchema = CreateUserSchema.partial();

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
