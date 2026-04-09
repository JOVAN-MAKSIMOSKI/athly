import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

const JWT_SIGNTOKEN_SECRET = process.env.JWT_SIGNTOKEN_SECRET || "";

type AuthenticatedRequest = Request & {
  auth?: {
    userId: string;
    tokenType?: string;
  };
};

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function getAccessToken(req: Request): string | undefined {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.sign_token) {
    return cookies.sign_token;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  return undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  if (!JWT_SIGNTOKEN_SECRET) {
    res.status(500).json({
      code: "AUTH_CONFIG_MISSING",
      message: "JWT_SIGNTOKEN_SECRET is not configured",
    });
    return;
  }

  const token = getAccessToken(req);
  if (!token) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Missing access token" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SIGNTOKEN_SECRET) as JwtPayload & { type?: string };
    if (decoded?.type && decoded.type !== "sign") {
      res.status(401).json({ code: "UNAUTHORIZED", message: "Invalid token type" });
      return;
    }

    const userId =
      typeof decoded.id === "string"
        ? decoded.id
        : typeof decoded.sub === "string"
          ? decoded.sub
          : "";

    if (!userId) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "Invalid token payload" });
      return;
    }

    (req as AuthenticatedRequest).auth = {
      userId,
      tokenType: decoded.type,
    };

    next();
  } catch (error) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Invalid or expired token" });
  }
}
