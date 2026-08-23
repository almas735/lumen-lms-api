import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { verifyAccessToken } from "../lib/tokens";
import { AppError } from "./errorHandler";

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; fullName: string; role: string; avatarUrl: string | null };
}

export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const token = req.cookies?.access_token;
  if (!token) return next(new AppError(401, "UNAUTHENTICATED", "Not logged in"));

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(new AppError(401, "UNAUTHENTICATED", "Session expired"));
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.deletedAt) {
    return next(new AppError(401, "UNAUTHENTICATED", "Account no longer active"));
  }

  req.user = { id: user.id, email: user.email, fullName: user.fullName, role: user.role, avatarUrl: user.avatarUrl };
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(401, "UNAUTHENTICATED", "Not logged in"));
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, "FORBIDDEN", "You do not have permission to do this"));
    }
    next();
  };
}