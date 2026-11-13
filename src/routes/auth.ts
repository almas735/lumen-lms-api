import { Router, Response } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { signAccessToken, generateRefreshToken, hashRefreshToken } from "../lib/tokens";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie("access_token", accessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
  res.cookie("refresh_token", refreshToken, { ...cookieOpts, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

async function issueSession(userId: string, role: string) {
  const accessToken = signAccessToken({ userId, role });
  const { raw, hash, expiresAt } = generateRefreshToken();
  await prisma.refreshToken.create({ data: { userId, tokenHash: hash, expiresAt } });
  return { accessToken, refreshToken: raw };
}

function safeUser(u: { id: string; email: string; fullName: string; role: string; avatarUrl: string | null }) {
  return { id: u.id, email: u.email, fullName: u.fullName, role: u.role, avatarUrl: u.avatarUrl };
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;

function checkLoginRateLimit(email: string) {
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (!entry || entry.resetAt < now) return;
  if (entry.count >= 6) throw new AppError(429, "TOO_MANY_ATTEMPTS", "Too many login attempts. Try again later.");
}
function recordFailedLogin(email: string) {
  const now = Date.now();
  const entry = loginAttempts.get(email) ?? { count: 0, resetAt: now + WINDOW_MS };
  entry.count += 1;
  loginAttempts.set(email, entry);
}
function clearLoginAttempts(email: string) {
  loginAttempts.delete(email);
}

const registerSchema = z.object({
  fullName: z.string().min(1, { error: "Full name is required" }),
  email: z.email({ error: "Enter a valid email" }),
  password: z.string()
    .min(8, { error: "Password must be at least 8 characters" })
    .regex(/[a-zA-Z]/, { error: "Password must include a letter" })
    .regex(/[0-9]/, { error: "Password must include a number" }),
  role: z.enum(["STUDENT", "INSTRUCTOR"]),
});

router.post("/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Check the highlighted fields",
        parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    }
    const email = parsed.data.email.trim().toLowerCase();

    if (await prisma.user.findUnique({ where: { email } })) {
      throw new AppError(409, "EMAIL_TAKEN", "An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, fullName: parsed.data.fullName, role: parsed.data.role },
    });

    const { accessToken, refreshToken } = await issueSession(user.id, user.role);
    setAuthCookies(res, accessToken, refreshToken);
    res.status(201).json({ user: safeUser(user) });
  } catch (err) { next(err); }
});

const loginSchema = z.object({
  email: z.email({ error: "Enter a valid email" }),
  password: z.string().min(1, { error: "Password is required" }),
});

router.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Check the highlighted fields",
        parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
    }
    const email = parsed.data.email.trim().toLowerCase();
    checkLoginRateLimit(email);

    const user = await prisma.user.findUnique({ where: { email } });
    const invalid = () => new AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password");

    if (!user || user.deletedAt) { recordFailedLogin(email); throw invalid(); }
    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!valid) { recordFailedLogin(email); throw invalid(); }

    clearLoginAttempts(email);
    const { accessToken, refreshToken } = await issueSession(user.id, user.role);
    setAuthCookies(res, accessToken, refreshToken);
    res.json({ user: safeUser(user) });
  } catch (err) { next(err); }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) throw new AppError(401, "UNAUTHENTICATED", "Not logged in");

    const hash = hashRefreshToken(rawToken);
    const tokenRow = await prisma.refreshToken.findFirst({
      where: { tokenHash: hash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!tokenRow) {
      res.clearCookie("access_token", cookieOpts);
      res.clearCookie("refresh_token", cookieOpts);
      throw new AppError(401, "UNAUTHENTICATED", "Session expired, please log in again");
    }

    const user = await prisma.user.findUnique({ where: { id: tokenRow.userId } });
    if (!user || user.deletedAt) throw new AppError(401, "UNAUTHENTICATED", "Account no longer active");

    await prisma.refreshToken.update({ where: { id: tokenRow.id }, data: { revokedAt: new Date() } });
    const { accessToken, refreshToken } = await issueSession(user.id, user.role);
    setAuthCookies(res, accessToken, refreshToken);
    res.json({ user: safeUser(user) });
  } catch (err) { next(err); }
});

router.post("/logout", async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (rawToken) {
      const hash = hashRefreshToken(rawToken);
      await prisma.refreshToken.updateMany({ where: { tokenHash: hash, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    res.clearCookie("access_token", cookieOpts);
    res.clearCookie("refresh_token", cookieOpts);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.get("/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

export default router;