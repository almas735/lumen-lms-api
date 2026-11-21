import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { percentComplete } from "../lib/progress";

const router = Router();

const DAY = 24 * 60 * 60 * 1000;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The last n UTC days, oldest first, ending today.
function lastDays(n: number): string[] {
  const now = new Date();
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    days.push(dayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))));
  }
  return days;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce(function (s, v) { return s + v; }, 0) / values.length);
}

async function studentDashboard(userId: string) {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * DAY);

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: userId, status: { in: ["ACTIVE", "COMPLETED"] } },
    include: { course: { select: { id: true, title: true, slug: true } } },
  });
  const enrollmentIds = enrollments.map(function (e) { return e.id; });

  const progress = await prisma.lessonProgress.findMany({
    where: { enrollmentId: { in: enrollmentIds } },
    select: { enrollmentId: true, lessonId: true, status: true, completedAt: true, lastViewedAt: true },
  });
  const attempts = await prisma.quizAttempt.findMany({
    where: { enrollmentId: { in: enrollmentIds } },
    select: { quizId: true, passed: true, submittedAt: true },
  });

  const lessonsLast7Days = progress.filter(function (p) {
    return p.status === "COMPLETED" && p.completedAt !== null && p.completedAt >= sevenDaysAgo;
  }).length;

  const passedQuizIds = new Set<string>();
  attempts.forEach(function (a) { if (a.passed) passedQuizIds.add(a.quizId); });

  const studiedDays = new Set<string>();
  progress.forEach(function (p) {
    if (p.lastViewedAt && p.lastViewedAt >= sevenDaysAgo) studiedDays.add(dayKey(p.lastViewedAt));
    if (p.completedAt && p.completedAt >= sevenDaysAgo) studiedDays.add(dayKey(p.completedAt));
  });
  attempts.forEach(function (a) { if (a.submittedAt >= sevenDaysAgo) studiedDays.add(dayKey(a.submittedAt)); });
  const activity = lastDays(7).map(function (d) { return { date: d, studied: studiedDays.has(d) }; });

  // Most recently active ACTIVE course, resumed at its first unfinished lesson.
  const lastActivity: Record<string, number> = {};
  enrollments.forEach(function (e) { lastActivity[e.id] = e.enrolledAt.getTime(); });
  progress.forEach(function (p) {
    if (p.lastViewedAt && p.lastViewedAt.getTime() > (lastActivity[p.enrollmentId] || 0)) {
      lastActivity[p.enrollmentId] = p.lastViewedAt.getTime();
    }
  });
  const active = enrollments
    .filter(function (e) { return e.status === "ACTIVE"; })
    .sort(function (a, b) { return lastActivity[b.id] - lastActivity[a.id]; });

  let continueLearning: {
    courseTitle: string; courseSlug: string; lessonId: string; lessonTitle: string; completedLessons: number; totalLessons: number;
  } | null = null;
  for (const e of active) {
    const modules = await prisma.module.findMany({
      where: { courseId: e.courseId },
      orderBy: { position: "asc" },
      include: { lessons: { orderBy: { position: "asc" }, select: { id: true, title: true } } },
    });
    const flat: { id: string; title: string }[] = [];
    modules.forEach(function (m) { m.lessons.forEach(function (l) { flat.push(l); }); });
    const status: Record<string, string> = {};
    progress.forEach(function (p) { if (p.enrollmentId === e.id) status[p.lessonId] = p.status; });
    const next = flat.find(function (l) { return status[l.id] !== "COMPLETED"; });
    if (next) {
      const done = flat.filter(function (l) { return status[l.id] === "COMPLETED"; }).length;
      continueLearning = {
        courseTitle: e.course.title, courseSlug: e.course.slug, lessonId: next.id, lessonTitle: next.title,
        completedLessons: done, totalLessons: flat.length,
      };
      break;
    }
  }

  const enrolledCourseIds = enrollments.map(function (e) { return e.courseId; });
  const recommendations = await prisma.course.findMany({
    where: { status: "PUBLISHED", deletedAt: null, id: { notIn: enrolledCourseIds }, instructorId: { not: userId } },
    orderBy: { publishedAt: "desc" },
    take: 3,
    select: { id: true, title: true, slug: true, summary: true, level: true },
  });

  const notifications = await prisma.notification.findMany({ where: { userId: userId }, orderBy: { createdAt: "desc" }, take: 5 });
  const unreadCount = await prisma.notification.count({ where: { userId: userId, readAt: null } });

  return {
    role: "STUDENT",
    hasEnrollments: enrollments.length > 0,
    stats: {
      coursesInProgress: enrollments.filter(function (e) { return e.status === "ACTIVE"; }).length,
      coursesCompleted: enrollments.filter(function (e) { return e.status === "COMPLETED"; }).length,
      lessonsLast7Days: lessonsLast7Days,
      quizzesPassed: passedQuizIds.size,
    },
    continueLearning: continueLearning,
    activity: activity,
    recommendations: recommendations,
    notifications: notifications,
    unreadCount: unreadCount,
  };
}

async function instructorDashboard(userId: string) {
  const now = Date.now();
  const courses = await prisma.course.findMany({
    where: { instructorId: userId, deletedAt: null },
    select: { id: true, title: true, status: true },
  });
  const courseIds = courses.map(function (c) { return c.id; });

  const lessons = await prisma.lesson.findMany({
    where: { module: { courseId: { in: courseIds } } },
    select: { module: { select: { courseId: true } } },
  });
  const lessonCount: Record<string, number> = {};
  lessons.forEach(function (l) { lessonCount[l.module.courseId] = (lessonCount[l.module.courseId] || 0) + 1; });

  const enrollments = await prisma.enrollment.findMany({
    where: { courseId: { in: courseIds }, status: { in: ["ACTIVE", "COMPLETED"] } },
    select: { id: true, courseId: true, studentId: true, status: true, enrolledAt: true, student: { select: { fullName: true } } },
  });
  const enrollmentIds = enrollments.map(function (e) { return e.id; });

  const progress = await prisma.lessonProgress.findMany({
    where: { enrollmentId: { in: enrollmentIds } },
    select: { enrollmentId: true, status: true, lastViewedAt: true },
  });
  const completedBy: Record<string, number> = {};
  const lastActiveBy: Record<string, number> = {};
  progress.forEach(function (p) {
    if (p.status === "COMPLETED") completedBy[p.enrollmentId] = (completedBy[p.enrollmentId] || 0) + 1;
    if (p.lastViewedAt && p.lastViewedAt.getTime() > (lastActiveBy[p.enrollmentId] || 0)) lastActiveBy[p.enrollmentId] = p.lastViewedAt.getTime();
  });

  const percentOf: Record<string, number> = {};
  enrollments.forEach(function (e) {
    const total = lessonCount[e.courseId] || 0;
    percentOf[e.id] = percentComplete(completedBy[e.id] || 0, total);
  });

  const attempts = await prisma.quizAttempt.findMany({ where: { enrollmentId: { in: enrollmentIds } }, select: { passed: true } });
  const quizPassRate = attempts.length > 0
    ? Math.round((attempts.filter(function (a) { return a.passed; }).length / attempts.length) * 100)
    : null;

  const perCourse = courses.map(function (c) {
    const rows = enrollments.filter(function (e) { return e.courseId === c.id; });
    return {
      id: c.id,
      title: c.title,
      status: c.status,
      enrolledCount: rows.length,
      averageProgress: average(rows.map(function (e) { return percentOf[e.id]; })),
      completionCount: rows.filter(function (e) { return e.status === "COMPLETED"; }).length,
    };
  });

  const days = lastDays(30);
  const perDay: Record<string, number> = {};
  enrollments.forEach(function (e) { const k = dayKey(e.enrolledAt); perDay[k] = (perDay[k] || 0) + 1; });
  const enrollmentsLast30Days = days.map(function (d) { return { date: d, count: perDay[d] || 0 }; });

  const courseTitle: Record<string, string> = {};
  courses.forEach(function (c) { courseTitle[c.id] = c.title; });
  const inactiveStudents = enrollments
    .filter(function (e) { return e.status === "ACTIVE"; })
    .map(function (e) {
      const last = lastActiveBy[e.id] || e.enrolledAt.getTime();
      return { studentName: e.student.fullName, courseId: e.courseId, courseTitle: courseTitle[e.courseId], lastActiveAt: new Date(last).toISOString(), last: last };
    })
    .filter(function (r) { return now - r.last >= 14 * DAY; })
    .sort(function (a, b) { return a.last - b.last; })
    .slice(0, 20)
    .map(function (r) { return { studentName: r.studentName, courseId: r.courseId, courseTitle: r.courseTitle, lastActiveAt: r.lastActiveAt }; });

  const needsAttention = courses
    .filter(function (c) { return c.status === "DRAFT" && !(lessonCount[c.id] > 0); })
    .map(function (c) { return { id: c.id, title: c.title }; });

  const students = new Set<string>();
  enrollments.forEach(function (e) { students.add(e.studentId); });

  return {
    role: "INSTRUCTOR",
    stats: {
      coursesPublished: courses.filter(function (c) { return c.status === "PUBLISHED"; }).length,
      totalStudents: students.size,
      averageCompletion: average(enrollments.map(function (e) { return percentOf[e.id]; })),
      quizPassRate: quizPassRate,
    },
    perCourse: perCourse,
    enrollmentsLast30Days: enrollmentsLast30Days,
    inactiveStudents: inactiveStudents,
    needsAttention: needsAttention,
  };
}

router.get("/dashboard", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const user = req.user!;
    if (user.role === "STUDENT") {
      res.json(await studentDashboard(user.id));
      return;
    }
    if (user.role === "INSTRUCTOR") {
      res.json(await instructorDashboard(user.id));
      return;
    }
    const userCount = await prisma.user.count({ where: { deletedAt: null } });
    res.json({ role: "ADMIN", userCount: userCount });
  } catch (err) {
    next(err);
  }
});

export default router;
