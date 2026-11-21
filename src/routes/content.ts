import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { isValidUuid } from "../lib/validation";
import { canManage } from "../lib/permissions";
import { notifyNewLesson } from "../lib/notify";

const router = Router();

async function getOwnedCourseForContent(courseId: string, user: { id: string; role: string }) {
  if (!isValidUuid(courseId)) {
    throw new AppError(400, "INVALID_ID", "That course ID is not valid");
  }
  const course = await prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
  if (!course) {
    throw new AppError(404, "NOT_FOUND", "Course not found");
  }
  if (!canManage(user, course.instructorId)) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
  }
  return course;
}

async function getOwnedModule(moduleId: string, user: { id: string; role: string }) {
  if (!isValidUuid(moduleId)) {
    throw new AppError(400, "INVALID_ID", "That module ID is not valid");
  }
  const mod = await prisma.module.findUnique({ where: { id: moduleId }, include: { course: true } });
  if (!mod) {
    throw new AppError(404, "NOT_FOUND", "Module not found");
  }
  if (!canManage(user, mod.course.instructorId)) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
  }
  return mod;
}

router.post("/courses/:courseId/modules", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const course = await getOwnedCourseForContent(String(req.params.courseId), req.user!);
    const parsed = z.object({ title: z.string().min(1, { error: "Title is required" }) }).safeParse(req.body);
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
    const parsed = z.object({ title: z.string().min(1, { error: "Title is required" }) }).safeParse(req.body);
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
      return prisma.module.update({ where: { id: id, courseId: course.id }, data: { position: index + 1 } });
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
    await notifyNewLesson(mod.courseId, lesson.id, lesson.title);
    res.status(201).json({ lesson: lesson });
  } catch (err) {
    next(err);
  }
});

router.get("/lessons/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lessonId = String(req.params.id);
    if (!isValidUuid(lessonId)) {
      throw new AppError(400, "INVALID_ID", "That lesson ID is not valid");
    }
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { include: { course: true } } },
    });
    if (!lesson) {
      throw new AppError(404, "NOT_FOUND", "Lesson not found");
    }

    const course = lesson.module.course;
    const isOwner = canManage(req.user!, course.instructorId);

    if (isOwner) {
      res.json({ lesson: lesson });
      return;
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId: course.id, studentId: req.user!.id, status: { in: ["ACTIVE", "COMPLETED"] } },
    });
    if (!enrollment) {
      throw new AppError(403, "FORBIDDEN", "You must be enrolled to view this lesson");
    }

    let progress = await prisma.lessonProgress.findUnique({
      where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: lesson.id } },
    });
    if (!progress) {
      progress = await prisma.lessonProgress.create({
        data: { enrollmentId: enrollment.id, lessonId: lesson.id, status: "IN_PROGRESS", lastViewedAt: new Date() },
      });
    } else {
      const newStatus = progress.status === "NOT_STARTED" ? "IN_PROGRESS" : progress.status;
      progress = await prisma.lessonProgress.update({
        where: { id: progress.id },
        data: { lastViewedAt: new Date(), status: newStatus },
      });
    }

    res.json({ lesson: lesson, progress: { status: progress.status } });
  } catch (err) {
    next(err);
  }
});

const lessonUpdateSchema = lessonCreateSchema.partial();

router.patch("/lessons/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lessonId = String(req.params.id);
    if (!isValidUuid(lessonId)) {
      throw new AppError(400, "INVALID_ID", "That lesson ID is not valid");
    }
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { module: { include: { course: true } } } });
    if (!lesson) {
      throw new AppError(404, "NOT_FOUND", "Lesson not found");
    }
    if (!canManage(req.user!, lesson.module.course.instructorId)) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
    }
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
    const lessonId = String(req.params.id);
    if (!isValidUuid(lessonId)) {
      throw new AppError(400, "INVALID_ID", "That lesson ID is not valid");
    }
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { module: { include: { course: true } } } });
    if (!lesson) {
      throw new AppError(404, "NOT_FOUND", "Lesson not found");
    }
    if (!canManage(req.user!, lesson.module.course.instructorId)) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
    }
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
      return prisma.lesson.update({ where: { id: id, moduleId: mod.id }, data: { position: index + 1 } });
    });
    await prisma.$transaction(updates);
    const lessons = await prisma.lesson.findMany({ where: { moduleId: mod.id }, orderBy: { position: "asc" } });
    res.json({ data: lessons });
  } catch (err) {
    next(err);
  }
});

export default router;
