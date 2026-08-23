import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { requireAuth, AuthedRequest } from "../middleware/auth";

const router = Router();

async function getOwnedCourseForContent(courseId: string, user: { id: string; role: string }) {
  const course = await prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
  if (!course) {
    throw new AppError(404, "NOT_FOUND", "Course not found");
  }
  if (course.instructorId !== user.id && user.role !== "ADMIN") {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
  }
  return course;
}

async function getOwnedModule(moduleId: string, user: { id: string; role: string }) {
  const mod = await prisma.module.findUnique({ where: { id: moduleId }, include: { course: true } });
  if (!mod) {
    throw new AppError(404, "NOT_FOUND", "Module not found");
  }
  if (mod.course.instructorId !== user.id && user.role !== "ADMIN") {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
  }
  return mod;
}

async function getOwnedLesson(lessonId: string, user: { id: string; role: string }) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { module: { include: { course: true } } },
  });
  if (!lesson) {
    throw new AppError(404, "NOT_FOUND", "Lesson not found");
  }
  if (lesson.module.course.instructorId !== user.id && user.role !== "ADMIN") {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
  }
  return lesson;
}

router.get("/courses/:id/outline", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const course = await getOwnedCourseForContent(String(req.params.id), req.user!);
    const modules = await prisma.module.findMany({
      where: { courseId: course.id },
      orderBy: { position: "asc" },
      include: { lessons: { orderBy: { position: "asc" } } },
    });
    res.json({ course: course, modules: modules });
  } catch (err) {
    next(err);
  }
});

const moduleCreateSchema = z.object({
  title: z.string().min(1, { error: "Title is required" }),
});

router.post("/courses/:courseId/modules", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const course = await getOwnedCourseForContent(String(req.params.courseId), req.user!);
    const parsed = moduleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map(function (i) {
        return { field: i.path.join("."), message: i.message };
      });
      throw new AppError(400, "VALIDATION_ERROR", "Check the highlighted fields", details);
    }
    const count = await prisma.module.count({ where: { courseId: course.id } });
    const mod = await prisma.module.create({
      data: { courseId: course.id, title: parsed.data.title, position: count + 1 },
    });
    res.status(201).json({ module: mod });
  } catch (err) {
    next(err);
  }
});

router.patch("/modules/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const mod = await getOwnedModule(String(req.params.id), req.user!);
    const parsed = moduleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map(function (i) {
        return { field: i.path.join("."), message: i.message };
      });
      throw new AppError(400, "VALIDATION_ERROR", "Check the highlighted fields", details);
    }
    const updated = await prisma.module.update({ where: { id: mod.id }, data: { title: parsed.data.title } });
    res.json({ module: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/modules/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const mod = await getOwnedModule(String(req.params.id), req.user!);
    await prisma.module.delete({ where: { id: mod.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const orderSchema = z.object({ orderedIds: z.array(z.string()) });

router.put("/courses/:courseId/modules/order", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const course = await getOwnedCourseForContent(String(req.params.courseId), req.user!);
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "orderedIds is required");
    }
    const updates = parsed.data.orderedIds.map(function (id, index) {
      return prisma.module.update({ where: { id: id }, data: { position: index + 1 } });
    });
    await prisma.$transaction(updates);
    const modules = await prisma.module.findMany({ where: { courseId: course.id }, orderBy: { position: "asc" } });
    res.json({ data: modules });
  } catch (err) {
    next(err);
  }
});

const lessonCreateSchema = z.object({
  title: z.string().min(1, { error: "Title is required" }),
  contentMd: z.string().optional(),
  videoUrl: z.string().url({ error: "Enter a valid URL" }).optional().nullable(),
  durationMinutes: z.number().int().min(0).optional(),
});

router.post("/modules/:moduleId/lessons", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const mod = await getOwnedModule(String(req.params.moduleId), req.user!);
    const parsed = lessonCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map(function (i) {
        return { field: i.path.join("."), message: i.message };
      });
      throw new AppError(400, "VALIDATION_ERROR", "Check the highlighted fields", details);
    }
    const count = await prisma.lesson.count({ where: { moduleId: mod.id } });
    const lesson = await prisma.lesson.create({
      data: {
        moduleId: mod.id,
        title: parsed.data.title,
        contentMd: parsed.data.contentMd || "",
        videoUrl: parsed.data.videoUrl || null,
        durationMinutes: parsed.data.durationMinutes === undefined ? 0 : parsed.data.durationMinutes,
        position: count + 1,
      },
    });
    res.status(201).json({ lesson: lesson });
  } catch (err) {
    next(err);
  }
});

router.get("/lessons/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lesson = await getOwnedLesson(String(req.params.id), req.user!);
    res.json({ lesson: lesson });
  } catch (err) {
    next(err);
  }
});

const lessonUpdateSchema = lessonCreateSchema.partial();

router.patch("/lessons/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lesson = await getOwnedLesson(String(req.params.id), req.user!);
    const parsed = lessonUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map(function (i) {
        return { field: i.path.join("."), message: i.message };
      });
      throw new AppError(400, "VALIDATION_ERROR", "Check the highlighted fields", details);
    }
    const data: any = Object.assign({}, parsed.data);
    const updated = await prisma.lesson.update({ where: { id: lesson.id }, data: data });
    res.json({ lesson: updated });
  } catch (err) {
    next(err);
  }
});

router.delete("/lessons/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lesson = await getOwnedLesson(String(req.params.id), req.user!);
    await prisma.lesson.delete({ where: { id: lesson.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.put("/modules/:moduleId/lessons/order", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const mod = await getOwnedModule(String(req.params.moduleId), req.user!);
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "orderedIds is required");
    }
    const updates = parsed.data.orderedIds.map(function (id, index) {
      return prisma.lesson.update({ where: { id: id }, data: { position: index + 1 } });
    });
    await prisma.$transaction(updates);
    const lessons = await prisma.lesson.findMany({ where: { moduleId: mod.id }, orderBy: { position: "asc" } });
    res.json({ data: lessons });
  } catch (err) {
    next(err);
  }
});

export default router;
