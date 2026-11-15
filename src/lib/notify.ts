import { prisma } from "./prisma";
import type { NotificationType } from "@prisma/client";

// Creating a notification must never break the action that caused it, so every error is swallowed and logged.
async function create(userId: string, type: NotificationType, message: string, link: string) {
  try {
    await prisma.notification.create({ data: { userId: userId, type: type, message: message, link: link } });
  } catch (err) {
    console.error("Notification failed:", err);
  }
}

export async function notifyEnrollment(course: { id: string; title: string; slug: string; instructorId: string }, studentId: string) {
  await create(studentId, "ENROLLMENT_CONFIRMED", 'You are enrolled in "' + course.title + '".', "/courses/" + course.slug);
  await create(course.instructorId, "NEW_STUDENT", 'A new student enrolled in "' + course.title + '".', "/instructor/courses/" + course.id + "/roster");
}

export async function notifyQuizPassed(studentId: string, quizTitle: string, courseId: string, lessonId: string) {
  try {
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { slug: true } });
    if (!course) return;
    await create(studentId, "QUIZ_PASSED", 'You passed the quiz "' + quizTitle + '".', "/learn/" + course.slug + "/" + lessonId);
  } catch (err) {
    console.error("Notification failed:", err);
  }
}

export async function notifyCourseCompleted(studentId: string, courseId: string) {
  try {
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true, slug: true } });
    if (!course) return;
    await create(studentId, "COURSE_COMPLETED", 'You completed "' + course.title + '". Well done!', "/courses/" + course.slug);
  } catch (err) {
    console.error("Notification failed:", err);
  }
}

export async function notifyNewLesson(courseId: string, lessonId: string, lessonTitle: string) {
  try {
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true, slug: true } });
    if (!course) return;
    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: courseId, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { studentId: true },
    });
    if (enrollments.length === 0) return;
    await prisma.notification.createMany({
      data: enrollments.map(function (e) {
        return {
          userId: e.studentId,
          type: "NEW_LESSON" as const,
          message: 'New lesson "' + lessonTitle + '" was added to "' + course.title + '".',
          link: "/learn/" + course.slug + "/" + lessonId,
        };
      }),
    });
  } catch (err) {
    console.error("Notification failed:", err);
  }
}
