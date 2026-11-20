import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../lib/prisma";
import { makeUser, makeCourse, loginAs } from "../testing/helpers";

// Every test runs at this frozen moment, so nothing depends on today's date.
const NOW = new Date("2030-01-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/dashboard", () => {
  it("rejects anonymous requests with 401", async () => {
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(401);
  });

  it("shows the first-time state for a student with no enrollments", async () => {
    const student = await makeUser("STUDENT");
    const res = await (await loginAs(student)).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("STUDENT");
    expect(res.body.hasEnrollments).toBe(false);
    expect(res.body.stats.coursesInProgress).toBe(0);
    expect(res.body.continueLearning).toBeNull();
    expect(res.body.activity).toHaveLength(7);
    expect(res.body.recommendations.length).toBeLessThanOrEqual(3);
  });

  it("resumes at the first unfinished lesson and marks today as studied", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const student = await makeUser("STUDENT");
    const { course, lessons } = await makeCourse(instructor.id, { lessons: 2, publishedAt: NOW });
    const enrollment = await prisma.enrollment.create({
      data: { courseId: course.id, studentId: student.id, status: "ACTIVE", enrolledAt: new Date(NOW.getTime() - DAY) },
    });
    await prisma.lessonProgress.create({
      data: { enrollmentId: enrollment.id, lessonId: lessons[0].id, status: "COMPLETED", completedAt: NOW, lastViewedAt: NOW },
    });

    const res = await (await loginAs(student)).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.stats.coursesInProgress).toBe(1);
    expect(res.body.stats.lessonsLast7Days).toBe(1);
    expect(res.body.continueLearning.lessonId).toBe(lessons[1].id);
    expect(res.body.continueLearning.completedLessons).toBe(1);
    expect(res.body.continueLearning.totalLessons).toBe(2);
    expect(res.body.activity[6]).toEqual({ date: "2030-01-15", studied: true });
    expect(res.body.activity[5].studied).toBe(false);
    const recommended = res.body.recommendations.map(function (c: { id: string }) { return c.id; });
    expect(recommended).not.toContain(course.id);
  });

  it("ignores activity older than seven days", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const student = await makeUser("STUDENT");
    const { course, lessons } = await makeCourse(instructor.id, { lessons: 1, publishedAt: NOW });
    const enrollment = await prisma.enrollment.create({
      data: { courseId: course.id, studentId: student.id, status: "ACTIVE", enrolledAt: new Date(NOW.getTime() - 30 * DAY) },
    });
    await prisma.lessonProgress.create({
      data: { enrollmentId: enrollment.id, lessonId: lessons[0].id, status: "IN_PROGRESS", lastViewedAt: new Date(NOW.getTime() - 10 * DAY) },
    });

    const res = await (await loginAs(student)).get("/api/dashboard");
    expect(res.body.stats.lessonsLast7Days).toBe(0);
    expect(res.body.activity.every(function (a: { studied: boolean }) { return a.studied === false; })).toBe(true);
  });

  it("shows no continue-learning card once every course is completed", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const student = await makeUser("STUDENT");
    const { course, lessons } = await makeCourse(instructor.id, { lessons: 1, publishedAt: NOW });
    const enrollment = await prisma.enrollment.create({
      data: { courseId: course.id, studentId: student.id, status: "COMPLETED", enrolledAt: new Date(NOW.getTime() - 3 * DAY), completedAt: NOW },
    });
    await prisma.lessonProgress.create({
      data: { enrollmentId: enrollment.id, lessonId: lessons[0].id, status: "COMPLETED", completedAt: NOW, lastViewedAt: NOW },
    });

    const res = await (await loginAs(student)).get("/api/dashboard");
    expect(res.body.stats.coursesCompleted).toBe(1);
    expect(res.body.stats.coursesInProgress).toBe(0);
    expect(res.body.continueLearning).toBeNull();
  });

  it("gives the instructor stats, a per-course table and a 30-day series", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const student = await makeUser("STUDENT");
    const { course, lessons } = await makeCourse(instructor.id, { lessons: 2, publishedAt: NOW });
    const draft = await makeCourse(instructor.id, { status: "DRAFT" });
    const enrollment = await prisma.enrollment.create({
      data: { courseId: course.id, studentId: student.id, status: "ACTIVE", enrolledAt: NOW },
    });
    await prisma.lessonProgress.create({
      data: { enrollmentId: enrollment.id, lessonId: lessons[0].id, status: "COMPLETED", completedAt: NOW, lastViewedAt: NOW },
    });

    const res = await (await loginAs(instructor)).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("INSTRUCTOR");
    expect(res.body.stats).toEqual({ coursesPublished: 1, totalStudents: 1, averageCompletion: 50, quizPassRate: null });
    expect(res.body.perCourse).toHaveLength(2);
    expect(res.body.enrollmentsLast30Days).toHaveLength(30);
    expect(res.body.enrollmentsLast30Days[29]).toEqual({ date: "2030-01-15", count: 1 });
    expect(res.body.needsAttention.map(function (c: { id: string }) { return c.id; })).toEqual([draft.course.id]);
  });

  it("lists only students who have been inactive for 14 or more days", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const idle = await makeUser("STUDENT", "Idle Student");
    const recent = await makeUser("STUDENT", "Recent Student");
    const { course } = await makeCourse(instructor.id, { lessons: 1, publishedAt: NOW });
    await prisma.enrollment.create({
      data: { courseId: course.id, studentId: idle.id, status: "ACTIVE", enrolledAt: new Date(NOW.getTime() - 20 * DAY) },
    });
    await prisma.enrollment.create({
      data: { courseId: course.id, studentId: recent.id, status: "ACTIVE", enrolledAt: new Date(NOW.getTime() - DAY) },
    });

    const res = await (await loginAs(instructor)).get("/api/dashboard");
    expect(res.body.inactiveStudents).toHaveLength(1);
    expect(res.body.inactiveStudents[0].studentName).toBe("Idle Student");
  });

  it("gives the admin a user count", async () => {
    const admin = await makeUser("ADMIN");
    const res = await (await loginAs(admin)).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("ADMIN");
    expect(res.body.userCount).toBeGreaterThanOrEqual(1);
  });
});
