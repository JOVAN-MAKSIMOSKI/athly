import express, { type Request, type Response } from "express";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ExperienceLevel,
  FitnessGoal,
  type IUser,
  UnitSystem,
  UserModel,
} from "../database/models/UserSchema.js";
import { requireAuth } from "../middleware/auth.js";
import { WORKOUT_SPLIT_VALUES } from "../domain/users/workoutSplits.js";

const JWT_SIGNTOKEN_SECRET = process.env.JWT_SIGNTOKEN_SECRET || "";
const JWT_SIGNTOKEN_EXPIRESIN = process.env.JWT_SIGNTOKEN_EXPIRESIN || "15m";
const JWT_SIGNCOOKIE_EXPIRESIN = Number(process.env.JWT_SIGNCOOKIE_EXPIRESIN || "15");
const JWT_REFRESHTOKEN_SECRET = process.env.JWT_REFRESHTOKEN_SECRET || "";
const JWT_REFRESHTOKEN_EXPIRESIN = process.env.JWT_REFRESHTOKEN_EXPIRESIN || "90d";
const JWT_REFRESH_COOKIE_EXPIRESIN = Number(process.env.JWT_REFRESH_COOKIE_EXPIRESIN || "90");

if (
  !JWT_SIGNTOKEN_SECRET ||
  !JWT_SIGNTOKEN_EXPIRESIN ||
  !JWT_SIGNCOOKIE_EXPIRESIN ||
  !JWT_REFRESHTOKEN_SECRET ||
  !JWT_REFRESHTOKEN_EXPIRESIN ||
  !JWT_REFRESH_COOKIE_EXPIRESIN
) {
  throw new Error("JWT auth configuration is incomplete. Authentication will not work.");
}

const ACCESS_COOKIE_NAME = "sign_token";
const REFRESH_COOKIE_NAME = "refresh_token";
const SignupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(6),
  authId: z.string().optional(),
  profile: z.object({
    age: z.number().int().min(1).max(150).optional(),
    weight: z.number().positive(),
    height: z.number().positive(),
    experienceLevel: z.nativeEnum(ExperienceLevel).optional(),
    goal: z.nativeEnum(FitnessGoal).optional(),
    isMedicallyCleared: z.boolean().optional(),
    comfortableWithHeavierWeights: z.boolean(),
    workoutDurationMinutes: z.number().int().min(5).max(240),
    workoutFrequencyPerWeek: z.number().int().min(1).max(7).default(3),
    availableEquipment: z.array(z.string()).optional().default([]),
    WorkoutSplit: z.enum(WORKOUT_SPLIT_VALUES).optional(),
  }),
  settings: z
    .object({
      units: z.nativeEnum(UnitSystem).optional(),
      theme: z.enum(["light", "dark"]).optional(),
    })
    .optional(),
});

type SignupInput = z.infer<typeof SignupSchema>;

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

type LoginInput = z.infer<typeof LoginSchema>;

const UpdateWorkoutSplitSchema = z.object({
  WorkoutSplit: z.enum(WORKOUT_SPLIT_VALUES),
});

const router = express.Router();

type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
    tokenType?: string;
  };
};

type AvailableEquipmentValue = NonNullable<IUser['profile']['availableEquipment']>[number];

const EQUIPMENT_ALIASES: Record<string, AvailableEquipmentValue> = {
  dumbbells: 'dumbbell',
  dumbbell: 'dumbbell',
  barbell: 'barbell',
  'bench + barbell': 'barbell + bench',
  'barbell + bench': 'barbell + bench',
  bench: 'barbell + bench',
  'bench + dumbbell': 'dumbbell + bench',
  'dumbbell + bench': 'dumbbell + bench',
  'pull-up bar': 'pull-up-bar',
  'pull up bar': 'pull-up-bar',
  'pull-up-bar': 'pull-up-bar',
  'cable machine': 'cable',
  cable: 'cable',
  'resistance bands': 'resistance-band',
  'resistance band': 'resistance-band',
  'resistance-band': 'resistance-band',
  kettlebells: 'kettlebell',
  kettlebell: 'kettlebell',
  'smith machine': 'smith-machine',
  'smith-machine': 'smith-machine',
  'bodyweight only': 'bodyweight',
  bodyweight: 'bodyweight',
};

function normalizeAvailableEquipment(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = values
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .map((entry) => EQUIPMENT_ALIASES[entry] ?? entry)
    .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index);

  return normalized;
}

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};

  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function getCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeMs,
  };
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE_NAME, getCookieOptions(0));
  res.clearCookie(REFRESH_COOKIE_NAME, getCookieOptions(0));
}

function signAccessToken(userId: string): string {
  return jwt.sign({ id: userId, type: "sign" }, JWT_SIGNTOKEN_SECRET, {
    expiresIn: JWT_SIGNTOKEN_EXPIRESIN,
  } as jwt.SignOptions);
}

function signRefreshToken(userId: string): string {
  return jwt.sign({ id: userId, type: "refresh", jti: randomUUID() }, JWT_REFRESHTOKEN_SECRET, {
    expiresIn: JWT_REFRESHTOKEN_EXPIRESIN,
  } as jwt.SignOptions);
}

function sanitizeUser(user: IUser | (IUser & { toObject: () => any })) {
  const userObj = user.toObject() as {
    password?: string;
    refreshTokenHash?: string;
    refreshTokenExpiresAt?: Date;
    profile?: { availableEquipment?: unknown };
  };

  delete userObj.password;
  delete userObj.refreshTokenHash;
  delete userObj.refreshTokenExpiresAt;

  if (typeof userObj.profile === "object" && userObj.profile !== null) {
    const profile = userObj.profile as { availableEquipment?: unknown };
    profile.availableEquipment = normalizeAvailableEquipment(profile.availableEquipment);
  }

  return userObj;
}

async function issueSession(res: Response, userId: string): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);

  const refreshTokenHash = await argon2.hash(refreshToken, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16,
    timeCost: 3,
    parallelism: 1,
  });

  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        refreshTokenHash,
        refreshTokenExpiresAt: new Date(Date.now() + JWT_REFRESH_COOKIE_EXPIRESIN * 24 * 60 * 60 * 1000),
      },
    }
  );

  res.cookie(
    ACCESS_COOKIE_NAME,
    accessToken,
    getCookieOptions(JWT_SIGNCOOKIE_EXPIRESIN * 60 * 1000)
  );
  res.cookie(
    REFRESH_COOKIE_NAME,
    refreshToken,
    getCookieOptions(JWT_REFRESH_COOKIE_EXPIRESIN * 24 * 60 * 60 * 1000)
  );

  return { accessToken, refreshToken };
}

router.post("/signup", express.json(), async (req: Request, res: Response) => {
  if (!JWT_SIGNTOKEN_SECRET) {
    res.status(500).json({
      code: "AUTH_CONFIG_MISSING",
      message: "JWT_SIGNTOKEN_SECRET is not configured",
    });
    return;
  }

  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: "INVALID_INPUT",
      message: "Signup payload is invalid",
      details: parsed.error.flatten(),
    });
    return;
  }

  const payload: SignupInput = parsed.data;
  const normalizedAvailableEquipment = normalizeAvailableEquipment(payload.profile.availableEquipment);

  const existing = await UserModel.findOne({ email: payload.email }).lean();
  if (existing) {
    res.status(409).json({
      code: "EMAIL_IN_USE",
      message: "Email is already registered",
    });
    return;
  }

  const user = await UserModel.create({
    email: payload.email,
    name: payload.name,
    password: payload.password,
    authId: payload.authId,
    profile: {
      age: payload.profile.age,
      weight: payload.profile.weight,
      height: payload.profile.height,
      experienceLevel: payload.profile.experienceLevel,
      goal: payload.profile.goal,
      isMedicallyCleared: payload.profile.isMedicallyCleared,
      comfortableWithHeavierWeights: payload.profile.comfortableWithHeavierWeights,
      workoutDurationMinutes: payload.profile.workoutDurationMinutes,
      workoutFrequencyPerWeek: payload.profile.workoutFrequencyPerWeek ?? 3,
      availableEquipment: normalizedAvailableEquipment,
      WorkoutSplit: payload.profile.WorkoutSplit,
      pendingSplitSuggestion: true,
    },
    settings: {
      units: payload.settings?.units,
      theme: payload.settings?.theme,
    },
  });

  const { accessToken } = await issueSession(res, user._id.toString());
  const userObj = sanitizeUser(user);

  res.status(201).json({
    status: "success",
    token: accessToken,
    data: {
      user: userObj,
    },
  });
});

router.post("/login", express.json(), async (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: "INVALID_INPUT",
      message: "Login payload is invalid",
      details: parsed.error.flatten(),
    });
    return;
  }

  const payload: LoginInput = parsed.data;

  const user = await UserModel.findOne({ email: payload.email }).select("+password");
  if (!user) {
    res.status(401).json({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    return;
  }

  const isValid = await user.correctPassword(payload.password);
  if (!isValid) {
    res.status(401).json({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    return;
  }

  const { accessToken } = await issueSession(res, user._id.toString());
  const userObj = sanitizeUser(user);

  res.status(200).json({
    status: "success",
    token: accessToken,
    data: {
      user: userObj,
    },
  });
});

router.post("/refresh", async (req: Request, res: Response) => {
  const cookies = parseCookies(req.headers.cookie);
  const refreshToken = cookies[REFRESH_COOKIE_NAME];

  if (!refreshToken) {
    res.status(401).json({ code: "REFRESH_TOKEN_MISSING", message: "Missing refresh token" });
    return;
  }

  let decoded: jwt.JwtPayload & { id?: string; sub?: string; type?: string };
  try {
    decoded = jwt.verify(refreshToken, JWT_REFRESHTOKEN_SECRET) as jwt.JwtPayload & {
      id?: string;
      sub?: string;
      type?: string;
    };
  } catch {
    clearAuthCookies(res);
    res.status(401).json({ code: "REFRESH_TOKEN_INVALID", message: "Invalid or expired refresh token" });
    return;
  }

  if (decoded.type !== "refresh") {
    clearAuthCookies(res);
    res.status(401).json({ code: "REFRESH_TOKEN_INVALID", message: "Invalid refresh token type" });
    return;
  }

  const userId =
    typeof decoded.id === "string"
      ? decoded.id
      : typeof decoded.sub === "string"
        ? decoded.sub
        : "";

  if (!userId) {
    clearAuthCookies(res);
    res.status(401).json({ code: "REFRESH_TOKEN_INVALID", message: "Invalid refresh token payload" });
    return;
  }

  const user = await UserModel.findById(userId).select("+refreshTokenHash +refreshTokenExpiresAt");
  if (!user) {
    clearAuthCookies(res);
    res.status(401).json({ code: "REFRESH_TOKEN_INVALID", message: "User not found" });
    return;
  }

  const refreshTokenHash = (user as unknown as { refreshTokenHash?: string }).refreshTokenHash;
  const refreshTokenExpiresAt = (user as unknown as { refreshTokenExpiresAt?: Date }).refreshTokenExpiresAt;

  if (!refreshTokenHash || (refreshTokenExpiresAt && refreshTokenExpiresAt.getTime() <= Date.now())) {
    clearAuthCookies(res);
    await UserModel.updateOne(
      { _id: userId },
      { $unset: { refreshTokenHash: 1, refreshTokenExpiresAt: 1 } }
    );
    res.status(401).json({ code: "REFRESH_TOKEN_EXPIRED", message: "Refresh token expired" });
    return;
  }

  const matches = await argon2.verify(refreshTokenHash, refreshToken);
  if (!matches) {
    clearAuthCookies(res);
    await UserModel.updateOne(
      { _id: userId },
      { $unset: { refreshTokenHash: 1, refreshTokenExpiresAt: 1 } }
    );
    res.status(401).json({ code: "REFRESH_TOKEN_REVOKED", message: "Refresh token revoked" });
    return;
  }

  const { accessToken } = await issueSession(res, userId);
  const userObj = sanitizeUser(user as IUser);

  res.status(200).json({
    status: "success",
    token: accessToken,
    data: {
      user: userObj,
    },
  });
});

router.post("/logout", async (req: Request, res: Response) => {
  const cookies = parseCookies(req.headers.cookie);
  const refreshToken = cookies[REFRESH_COOKIE_NAME];

  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, JWT_REFRESHTOKEN_SECRET) as jwt.JwtPayload & {
        id?: string;
        sub?: string;
      };

      const userId =
        typeof decoded.id === "string"
          ? decoded.id
          : typeof decoded.sub === "string"
            ? decoded.sub
            : "";

      if (userId) {
        await UserModel.updateOne(
          { _id: userId },
          { $unset: { refreshTokenHash: 1, refreshTokenExpiresAt: 1 } }
        );
      }
    } catch {
      // Best effort logout.
    }
  }

  clearAuthCookies(res);

  res.status(200).json({
    status: "success",
    message: "Logged out",
  });
});

router.patch("/profile", requireAuth, express.json(), async (req: Request, res: Response) => {
  const parsed = UpdateWorkoutSplitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: "INVALID_INPUT",
      message: "Profile payload is invalid",
      details: parsed.error.flatten(),
    });
    return;
  }

  const authReq = req as AuthenticatedRequest;
  const userId = authReq.auth?.userId;
  if (!userId) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Missing authenticated user" });
    return;
  }

  const user = await UserModel.findByIdAndUpdate(
    userId,
    {
      $set: {
        'profile.WorkoutSplit': parsed.data.WorkoutSplit,
      },
    },
    { new: true }
  );

  if (!user) {
    res.status(404).json({ code: "USER_NOT_FOUND", message: "User not found" });
    return;
  }

  const userObj = sanitizeUser(user);
  res.status(200).json({
    status: "success",
    data: {
      user: userObj,
    },
  });
});

export default router;
