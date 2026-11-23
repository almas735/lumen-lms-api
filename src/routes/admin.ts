import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { isValidUuid } from "../lib/validation";

const router = Router();

router.get("/users", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").trim();
    const where: any = { deletedAt: null };
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }
    const users = await prisma.user.findMany({
      where: where,
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, fullName: true, role: true, createdAt: true },
    });
    res.json({ data: users });
  } catch (err) {
    next(err);
  }
});

const roleUpdateSchema = z.object({ role: z.enum(["STUDENT", "INSTRUCTOR", "ADMIN"]) });

router.patch("/users/:id/role", requireAuth, requireRole("ADMIN"), async (req: AuthedRequest, res, next) => {
  try {
    if (!isValidUuid(String(req.params.id))) {
      throw new AppError(400, "INVALID_ID", "That user ID is not valid");
    }
    if (String(req.params.id) === req.user!.id) {
      throw new AppError(400, "CANNOT_CHANGE_OWN_ROLE", "You cannot change your own role");
    }
    const parsed = roleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
      throw new AppError(400, "VALIDATION_ERROR", "Check the highlighted fields", details);
    }
    const target = await prisma.user.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
    if (!target) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    const updated = await prisma.user.update({ where: { id: target.id }, data: { role: parsed.data.role } });
    res.json({ user: { id: updated.id, email: updated.email, fullName: updated.fullName, role: updated.role } });
  } catch (err) {
    next(err);
  }
});

router.delete("/users/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
  try {
    if (!isValidUuid(String(req.params.id))) {
      throw new AppError(400, "INVALID_ID", "That user ID is not valid");
    }
    const target = await prisma.user.findFirst({ where: { id: String(req.params.id), deletedAt: null } });
    if (!target) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }

    const publishedCount = await prisma.course.count({
      where: { instructorId: target.id, status: "PUBLISHED", deletedAt: null },
    });
    if (publishedCount > 0) {
      throw new AppError(409, "HAS_PUBLISHED_COURSES", "This instructor has " + publishedCount + " published course(s). Unpublish them first.");
    }

    await prisma.user.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
