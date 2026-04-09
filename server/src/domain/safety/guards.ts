import type { User } from '../users/types.js';

// ============================================================================
// CUSTOM ERROR TYPES
// ============================================================================

export class SafetyCheckFailedError extends Error {
  readonly code = 'SAFETY_CHECK_FAILED';
  readonly userFriendlyMessage = 'Please update your safety settings before generating a workout plan. You must confirm that you have been medically cleared to exercise.';

  constructor(message: string = 'User safety check failed') {
    super(message);
    this.name = 'SafetyCheckFailedError';
  }
}

// ============================================================================
// SAFETY GUARDS
// ============================================================================

/**
 * Asserts that a user has been medically cleared to exercise.
 * This guard MUST be called before any workout generation or exercise recommendations.
 *
 * @param user - The user object to validate
 * @throws {SafetyCheckFailedError} If user is not medically cleared
 *
 * @example
 * try {
 *   assertUserIsSafe(user);
 *   // Safe to generate workout
 *   generateWorkout(user);
 * } catch (error) {
 *   if (error instanceof SafetyCheckFailedError) {
 *     return { error: error.userFriendlyMessage };
 *   }
 * }
 */
//Use this in back-end logic to ensure user safety before proceeding
export function assertUserIsSafe(user: User): void {
  if (!user.safety.isMedicalCleared) {
    throw new SafetyCheckFailedError(
      `User ${user.id} has not been medically cleared to exercise`,
    );
  }
}

/**
 * Checks if a user is safe to exercise without throwing. Use this for UX/UI flows.
 * Useful for conditional logic that doesn't require error handling.
 *
 * @param user - The user object to check
 * @returns true if user is medically cleared, false otherwise
 */
export function isUserSafe(user: User): boolean {
  return user.safety.isMedicalCleared === true;
}
