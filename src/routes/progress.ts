import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { isValidUuid } from "../lib/validation";
import { canManage } from "../lib/permissions";
import { notifyEnrollment, notifyCourseCompleted } from "../lib/notify";
import { percentComplete } from "../lib/progress";

const router = Router();

router.post("/courses/:id/enroll", requireAuth, requireRole("STUDENT"), async (req: AuthedRequest, res, next) => {
  try {
    const courseId = String(req.params.id);
    if (!isValidUuid(courseId)) {
      throw new AppError(400, "INVALID_ID", "That course ID is not valid");
    }
    const course = await prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course || course.status !== "PUBLISHED") {
      throw new AppError(404, "NOT_FOUND", "Course not found");
    }
    if (course.instructorId === req.user!.id) {
      throw new AppError(400, "CANNOT_ENROLL_OWN_COURSE", "You cannot enroll in your own course");
    }

    const existing = await prisma.enrollment.findUnique({
      where: { courseId_studentId: { courseId: course.id, studentId: req.user!.id } },
    });

    if (existing) {
      if (existing.status === "ACTIVE") {
        throw new AppError(409, "ALREADY_ENROLLED", "You are already enrolled in this course");
      }
      const reactivated = await prisma.enrollment.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", droppedAt: null, completedAt: null },
      });
      await notifyEnrollment(course, req.user!.id);
      res.status(200).json({ enrollment: reactivated });
      return;
    }

    const enrollment = await prisma.enrollment.create({
      data: { courseId: course.id, studentId: req.user!.id, status: "ACTIVE" },
    });

    const lessons = await prisma.lesson.findMany({ where: { module: { courseId: course.id } } });
    if (lessons.length) {
      await prisma.lessonProgress.createMany({
        data: lessons.map(function (l) {
          return { enrollmentId: enrollment.id, lessonId: l.id, status: "NOT_STARTED" as const };
        }),
      });
    }

    await notifyEnrollment(course, req.user!.id);
    res.status(201).json({ enrollment: enrollment });
  } catch (err) {
    next(err);
  }
});

router.post("/enrollments/:id/drop", requireAuth, requireRole("STUDENT"), async (req: AuthedRequest, res, next) => {
  try {
    const enrollmentId = String(req.params.id);
    if (!isValidUuid(enrollmentId)) {
      throw new AppError(400, "INVALID_ID", "That enrollment ID is not valid");
    }
    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment || enrollment.studentId !== req.user!.id) {
      throw new AppError(404, "NOT_FOUND", "Enrollment not found");
    }
    const updated = await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { status: "DROPPED", droppedAt: new Date() },
    });
    res.json({ enrollment: updated });
  } catch (err) {
    next(err);
  }
});

router.get("/student/enrollments", requireAuth, requireRole("STUDENT"), async (req: AuthedRequest, res, next) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: req.user!.id, status: { in: ["ACTIVE", "COMPLETED"] } },
      orderBy: { enrolledAt: "desc" },
      include: { course: { select: { id: true, title: true, slug: true, thumbnailUrl: true } } },
    });

    const data = [];
    for (const e of enrollments) {
      const totalLessons = await prisma.lesson.count({ where: { module: { courseId: e.courseId } } });
      const completedLessons = await prisma.lessonProgress.count({
        where: { enrollmentId: e.id, status: "COMPLETED" },
      });
      data.push({
        enrollmentId: e.id,
        status: e.status,
        course: e.course,
        totalLessons: totalLessons,
        completedLessons: completedLessons,
        completedAt: e.completedAt,
      });
    }
    res.json({ data: data });
  } catch (err) {
    next(err);
  }
});

router.get("/courses/:idOrSlug/outline", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const idOrSlug = String(req.params.idOrSlug);
    const course = isValidUuid(idOrSlug)
      ? await prisma.course.findFirst({ where: { id: idOrSlug, deletedAt: null } })
      : await prisma.course.findFirst({ where: { slug: idOrSlug, deletedAt: null } });
    if (!course) {
      throw new AppError(404, "NOT_FOUND", "Course not found");
    }

    const isOwner = canManage(req.user!, course.instructorId);

    const modules = await prisma.module.findMany({
      where: { courseId: course.id },
      orderBy: { position: "asc" },
      include: { lessons: { orderBy: { position: "asc" } } },
    });

    if (isOwner) {
      res.json({ course: course, modules: modules, enrollment: null });
      return;
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId: course.id, studentId: req.user!.id, status: { in: ["ACTIVE", "COMPLETED"] } },
    });
    if (!enrollment) {
      throw new AppError(403, "FORBIDDEN", "You must be enrolled to view this course outline");
    }

    const progressRows = await prisma.lessonProgress.findMany({ where: { enrollmentId: enrollment.id } });
    const progressMap: Record<string, string> = {};
    for (const p of progressRows) {
      progressMap[p.lessonId] = p.status;
    }

    const modulesWithProgress = modules.map(function (m) {
      return {
        id: m.id,
        title: m.title,
        position: m.position,
        lessons: m.lessons.map(function (l) {
          return {
            id: l.id,
            title: l.title,
            position: l.position,
            durationMinutes: l.durationMinutes,
            progress: progressMap[l.id] || "NOT_STARTED",
          };
        }),
      };
    });

    res.json({ course: course, modules: modulesWithProgress, enrollment: enrollment });
  } catch (err) {
    next(err);
  }
});

const progressUpdateSchema = z.object({ completed: z.boolean() });

router.post("/lessons/:id/progress", requireAuth, requireRole("STUDENT"), async (req: AuthedRequest, res, next) => {
  try {
    const lessonId = String(req.params.id);
    if (!isValidUuid(lessonId)) {
      throw new AppError(400, "INVALID_ID", "That lesson ID is not valid");
    }
    const parsed = progressUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "A boolean 'completed' field is required");
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { module: true },
    });
    if (!lesson) {
      throw new AppError(404, "NOT_FOUND", "Lesson not found");
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId: lesson.module.courseId, studentId: req.user!.id, status: { in: ["ACTIVE", "COMPLETED"] } },
    });
    if (!enrollment) {
      throw new AppError(403, "FORBIDDEN", "You must be enrolled to update progress on this lesson");
    }

    const existingQuiz = await prisma.quiz.findUnique({ where: { lessonId: lesson.id } });
    if (existingQuiz) {
      throw new AppError(400, "QUIZ_REQUIRED", "This lesson is completed automatically by passing its quiz, not marked manually");
    }

    const newStatus = parsed.data.completed ? "COMPLETED" : "IN_PROGRESS";
    const progress = await prisma.lessonProgress.upsert({
      where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: lesson.id } },
      create: {
        enrollmentId: enrollment.id,
        lessonId: lesson.id,
        status: newStatus,
        completedAt: parsed.data.completed ? new Date() : null,
        lastViewedAt: new Date(),
      },
      update: {
        status: newStatus,
        completedAt: parsed.data.completed ? new Date() : null,
        lastViewedAt: new Date(),
      },
    });

    const totalLessons = await prisma.lesson.count({ where: { module: { courseId: lesson.module.courseId } } });
    const completedCount = await prisma.lessonProgress.count({
      where: { enrollmentId: enrollment.id, status: "COMPLETED" },
    });

    let courseCompleted = false;
    if (parsed.data.completed && totalLessons > 0 && completedCount === totalLessons) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      courseCompleted = true;
      await notifyCourseCompleted(req.user!.id, lesson.module.courseId);
    } else if (!parsed.data.completed && enrollment.status === "COMPLETED") {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "ACTIVE", completedAt: null },
      });
    }

    res.json({ progress: progress, courseCompleted: courseCompleted });
  } catch (err) {
    next(err);
  }
});

router.get("/courses/:id/roster", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const courseId = String(req.params.id);
    if (!isValidUuid(courseId)) {
      throw new AppError(400, "INVALID_ID", "That course ID is not valid");
    }
    const course = await prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) {
      throw new AppError(404, "NOT_FOUND", "Course not found");
    }
    if (!canManage(req.user!, course.instructorId)) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
    }

    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: course.id, status: { in: ["ACTIVE", "COMPLETED"] } },
      include: { student: { select: { id: true, fullName: true, email: true } } },
      orderBy: { enrolledAt: "desc" },
    });

    const totalLessons = await prisma.lesson.count({ where: { module: { courseId: course.id } } });

    const data = [];
    for (const e of enrollments) {
      const completedCount = await prisma.lessonProgress.count({ where: { enrollmentId: e.id, status: "COMPLETED" } });
      const lastActivity = await prisma.lessonProgress.findFirst({
        where: { enrollmentId: e.id, lastViewedAt: { not: null } },
        orderBy: { lastViewedAt: "desc" },
      });
      data.push({
        studentId: e.student.id,
        studentName: e.student.fullName,
        studentEmail: e.student.email,
        status: e.status,
        progressPercent: percentComplete(completedCount, totalLessons),
        lastActiveAt: lastActivity ? lastActivity.lastViewedAt : null,
        enrolledAt: e.enrolledAt,
      });
    }
    res.json({ data: data });
  } catch (err) {
    next(err);
  }
});

export default router;
