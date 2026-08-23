import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { verifyAccessToken } from "../lib/tokens";

const router = Router();

function slugify(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function generateUniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || "course";
  let slug = base;
  let i = 2;
  while (await prisma.course.findUnique({ where: { slug } })) {
    slug = base + "-" + i;
    i++;
  }
  return slug;
}

async function getOwnedCourse(courseId: string, user: { id: string; role: string }) {
  const course = await prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
  if (!course) {
    throw new AppError(404, "NOT_FOUND", "Course not found");
  }
  if (course.instructorId !== user.id && user.role !== "ADMIN") {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
  }
  return course;
}

const courseCreateSchema = z.object({
  title: z.string().min(3, { error: "Title must be at least 3 characters" }).max(120, { error: "Title must be under 120 characters" }),
  summary: z.string().max(300, { error: "Summary must be under 300 characters" }),
  description: z.string().optional(),
  level: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]),
  thumbnailUrl: z.string().url({ error: "Enter a valid URL" }).optional().nullable(),
});

const courseUpdateSchema = courseCreateSchema.partial();

router.get("/courses", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = 12;
    const search = String(req.query.search ?? "").trim();
    const level = req.query.level as string | undefined;

    const where: any = { status: "PUBLISHED", deletedAt: null };
    if (level && ["BEGINNER", "INTERMEDIATE", "ADVANCED"].includes(level)) {
      where.level = level;
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { summary: { contains: search, mode: "insensitive" } },
      ];
    }

    const courses = await prisma.course.findMany({
      where: where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { publishedAt: "desc" },
      include: { instructor: { select: { fullName: true } } },
    });
    const total = await prisma.course.count({ where: where });

    res.json({ data: courses, meta: { page: page, pageSize: pageSize, total: total, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) {
    next(err);
  }
});

router.get("/instructor/courses", requireAuth, requireRole("INSTRUCTOR"), async (req: AuthedRequest, res, next) => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const where: any = { instructorId: req.user!.id, deletedAt: null };
    if (statusFilter && ["DRAFT", "PUBLISHED", "ARCHIVED"].includes(statusFilter)) {
      where.status = statusFilter;
    }
    const courses = await prisma.course.findMany({ where: where, orderBy: { updatedAt: "desc" } });
    res.json({ data: courses });
  } catch (err) {
    next(err);
  }
});

router.post("/courses", requireAuth, requireRole("INSTRUCTOR"), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = courseCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map(function (i) {
        return { field: i.path.join("."), message: i.message };
      });
      throw new AppError(400, "VALIDATION_ERROR", "Check the highlighted fields", details);
    }
    const slug = await generateUniqueSlug(parsed.data.title);
    const course = await prisma.course.create({
      data: {
        title: parsed.data.title,
        slug: slug,
        summary: parsed.data.summary,
        description: parsed.data.description || "",
        level: parsed.data.level,
        thumbnailUrl: parsed.data.thumbnailUrl || null,
        instructorId: req.user!.id,
        status: "DRAFT",
      },
    });
    res.status(201).json({ course: course });
  } catch (err) {
    next(err);
  }
});

router.get("/courses/:slug", async (req, res, next) => {
  try {
    const course = await prisma.course.findFirst({
      where: { slug: req.params.slug, deletedAt: null },
      include: { instructor: { select: { id: true, fullName: true, avatarUrl: true } } },
    });
    if (!course) {
      throw new AppError(404, "NOT_FOUND", "Course not found");
    }

    if (course.status !== "PUBLISHED") {
      let allowed = false;
      const token = req.cookies?.access_token;
      if (token) {
        try {
          const payload = verifyAccessToken(token);
          if (payload.userId === course.instructorId || payload.role === "ADMIN") {
            allowed = true;
          }
        } catch (e) {
          allowed = false;
        }
      }
      if (!allowed) {
        throw new AppError(404, "NOT_FOUND", "Course not found");
      }
    }
    res.json({ course: course });
  } catch (err) {
    next(err);
  }
});

router.patch("/courses/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const course = await getOwnedCourse(String(req.params.id), req.user!);
    const parsed = courseUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map(function (i) {
        return { field: i.path.join("."), message: i.message };
      });
      throw new AppError(400, "VALIDATION_ERROR", "Check the highlighted fields", details);
    }
    const data: any = Object.assign({}, parsed.data);
    if (parsed.data.title && parsed.data.title !== course.title && course.status === "DRAFT") {
      data.slug = await generateUniqueSlug(parsed.data.title);
    }
    const updated = await prisma.course.update({ where: { id: course.id }, data: data });
    res.json({ course: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/courses/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const course = await getOwnedCourse(String(req.params.id), req.user!);
    await prisma.course.update({ where: { id: course.id }, data: { deletedAt: new Date() } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post("/courses/:id/publish", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const course = await getOwnedCourse(String(req.params.id), req.user!);
    if (course.status === "ARCHIVED") {
      throw new AppError(409, "MUST_UNARCHIVE_FIRST", "Move the course back to draft before publishing");
    }
    const missing: { field: string; message: string }[] = [];
    if (!course.title || !course.title.trim()) {
      missing.push({ field: "title", message: "Title is required" });
    }
    if (!course.summary || !course.summary.trim()) {
      missing.push({ field: "summary", message: "Summary is required" });
    }
    if (!course.description || !course.description.trim()) {
      missing.push({ field: "description", message: "Description is required" });
    }


    if (missing.length) {
      throw new AppError(400, "INCOMPLETE_COURSE", "Course is missing required fields before it can publish", missing);
    }

    const updated = await prisma.course.update({
      where: { id: course.id },
      data: { status: "PUBLISHED", publishedAt: course.publishedAt || new Date() },
    });
    res.json({ course: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/courses/:id/unpublish", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const course = await getOwnedCourse(String(req.params.id), req.user!);
    const updated = await prisma.course.update({ where: { id: course.id }, data: { status: "DRAFT" } });
    res.json({ course: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/courses/:id/archive", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const course = await getOwnedCourse(String(req.params.id), req.user!);
    const updated = await prisma.course.update({ where: { id: course.id }, data: { status: "ARCHIVED" } });
    res.json({ course: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
