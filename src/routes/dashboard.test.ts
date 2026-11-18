import request from "supertest";
import bcrypt from "bcrypt";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import app from "../app";
import { prisma } from "../lib/prisma";

const stamp = Date.now();
const emails = {
  instructor: "dash.instructor." + stamp + "@example.com",
  studentA: "dash.a." + stamp + "@example.com",
  studentB: "dash.b." + stamp + "@example.com",
  studentC: "dash.c." + stamp + "@example.com",
  admin: "dash.admin." + stamp + "@example.com",
};
const password = "Password123";

let courseId = "";
let draftId = "";
let lesson2Id = "";
let studentCName = "";

async function makeUser(email: string, role: "STUDENT" | "INSTRUCTOR" | "ADMIN", fullName: string) {
  return prisma.user.create({
    data: { email: email, fullName: fullName, passwordHash: await bcrypt.hash(password, 4), role: role },
  });
}

async function login(email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email: email, password: password });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  const instructor = await makeUser(emails.instructor, "INSTRUCTOR", "Dash Instructor");
  const a = await makeUser(emails.studentA, "STUDENT", "Dash Student A");
  await makeUser(emails.studentB, "STUDENT", "Dash Student B");
  await makeUser(emails.studentC, "STUDENT", "Dash Student C");
  studentCName = "Dash Student C";
  await makeUser(emails.admin, "ADMIN", "Dash Admin");

  const course = await prisma.course.create({
    data: {
      title: "Dashboard Course", slug: "dash-course-" + stamp, summary: "s", description: "d",
      level: "BEGINNER", status: "PUBLISHED", publishedAt: new Date(), instructorId: instructor.id,
    },
  });
  courseId = course.id;
  const draft = await prisma.course.create({
    data: {
      title: "Empty Draft", slug: "dash-draft-" + stamp, summary: "s", description: "d",
      level: "BEGINNER", status: "DRAFT", instructorId: instructor.id,
    },
  });
  draftId = draft.id;

  const mod = await prisma.module.create({ data: { courseId: courseId, title: "M1", position: 1 } });
  const lesson1 = await prisma.lesson.create({ data: { moduleId: mod.id, title: "L1", contentMd: "x", durationMinutes: 1, position: 1 } });
  const lesson2 = await prisma.lesson.create({ data: { moduleId: mod.id, title: "L2", contentMd: "x", durationMinutes: 1, position: 2 } });
  lesson2Id = lesson2.id;

  const enrollment = await prisma.enrollment.create({ data: { courseId: courseId, studentId: a.id, status: "ACTIVE" } });
  await prisma.lessonProgress.create({
    data: { enrollmentId: enrollment.id, lessonId: lesson1.id, status: "COMPLETED", completedAt: new Date(), lastViewedAt: new Date() },
  });
});

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { courseId: courseId } });
  await prisma.course.deleteMany({ where: { id: { in: [courseId, draftId] } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
});

describe("GET /api/dashboard", () => {
  it("rejects anonymous requests with 401", async () => {
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(401);
  });

  it("shows the first-time state for a student with no enrollments", async () => {
    const student = await login(emails.studentB);
    const res = await student.get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("STUDENT");
    expect(res.body.hasEnrollments).toBe(false);
    expect(res.body.stats.coursesInProgress).toBe(0);
    expect(res.body.continueLearning).toBeNull();
    expect(res.body.activity).toHaveLength(7);
    expect(res.body.recommendations.some(function (c: { id: string }) { return c.id === courseId; })).toBe(true);
  });

  it("resumes at the first unfinished lesson and counts this week's activity", async () => {
    const student = await login(emails.studentA);
    const res = await student.get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.hasEnrollments).toBe(true);
    expect(res.body.stats.coursesInProgress).toBe(1);
    expect(res.body.stats.lessonsLast7Days).toBe(1);
    expect(res.body.continueLearning.lessonId).toBe(lesson2Id);
    expect(res.body.continueLearning.completedLessons).toBe(1);
    expect(res.body.continueLearning.totalLessons).toBe(2);
    const today = new Date().toISOString().slice(0, 10);
    expect(res.body.activity[6].date).toBe(today);
    expect(res.body.activity[6].studied).toBe(true);
    expect(res.body.recommendations.some(function (c: { id: string }) { return c.id === courseId; })).toBe(false);
  });

  it("gives the instructor stats, a per-course table and a 30-day series", async () => {
    const instructor = await login(emails.instructor);
    const res = await instructor.get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("INSTRUCTOR");
    expect(res.body.stats.coursesPublished).toBe(1);
    expect(res.body.stats.totalStudents).toBe(1);
    expect(res.body.stats.averageCompletion).toBe(50);
    expect(res.body.stats.quizPassRate).toBeNull();
    expect(res.body.perCourse).toHaveLength(2);
    expect(res.body.enrollmentsLast30Days).toHaveLength(30);
    expect(res.body.enrollmentsLast30Days[29].count).toBe(1);
    expect(res.body.needsAttention.map(function (c: { id: string }) { return c.id; })).toEqual([draftId]);
  });

  it("lists students who have been inactive for 14 or more days", async () => {
    const c = await prisma.user.findUnique({ where: { email: emails.studentC } });
    await prisma.enrollment.create({
      data: { courseId: courseId, studentId: c!.id, status: "ACTIVE", enrolledAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
    });
    const instructor = await login(emails.instructor);
    const res = await instructor.get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.inactiveStudents).toHaveLength(1);
    expect(res.body.inactiveStudents[0].studentName).toBe(studentCName);
  });

  it("gives the admin a user count", async () => {
    const admin = await login(emails.admin);
    const res = await admin.get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("ADMIN");
    expect(res.body.userCount).toBeGreaterThanOrEqual(5);
  });
});
