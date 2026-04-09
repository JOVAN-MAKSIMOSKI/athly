import { ExperienceLevel, UserModel } from '../../database/models/UserSchema.js';

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const BEGINNER_PROMOTION_MONTHS = parsePositiveNumber(
  process.env.BEGINNER_PROMOTION_MONTHS,
  2
);

export function getPromotionEligibilityDate(createdAt: Date, promotionMonths = BEGINNER_PROMOTION_MONTHS): Date {
  const eligibilityDate = new Date(createdAt);
  eligibilityDate.setMonth(eligibilityDate.getMonth() + promotionMonths);
  return eligibilityDate;
}

export function shouldPromoteBeginner(createdAt: Date, now = new Date()): boolean {
  return now >= getPromotionEligibilityDate(createdAt);
}

type UserProfileLike = {
  experienceLevel?: ExperienceLevel;
};

type UserLike = {
  _id: unknown;
  createdAt?: Date;
  profile?: UserProfileLike;
};

export async function ensureUserExperienceLevel(user: UserLike): Promise<{ promoted: boolean; experienceLevel?: ExperienceLevel }> {
  const currentLevel = user.profile?.experienceLevel;

  if (currentLevel !== ExperienceLevel.BEGINNER || !user.createdAt) {
    return { promoted: false, experienceLevel: currentLevel };
  }

  if (!shouldPromoteBeginner(user.createdAt)) {
    return { promoted: false, experienceLevel: currentLevel };
  }

  await UserModel.updateOne(
    { _id: user._id as any, 'profile.experienceLevel': ExperienceLevel.BEGINNER },
    { $set: { 'profile.experienceLevel': ExperienceLevel.INTERMEDIATE } }
  );

  return { promoted: true, experienceLevel: ExperienceLevel.INTERMEDIATE };
}
