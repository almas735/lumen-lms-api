import request from "supertest";
import bcrypt from "bcrypt";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import app from "../app";
import { prisma } from "../lib/prisma";
import { notifyEnrollment } from "../lib/notify";

const stamp = Date.now();
const studentEmail = "notif.student." + stamp + "@example.com";
const otherEmail = "notif.other." + stamp + "@example.com";
const instructorEmail = "notif.instructor." + stamp + "@example.com";
const password = "Password123";

let courseId = "";

async function makeUser(email: string, role: "STUDENT" | "INSTRUCTOR") {
  return prisma.user.create({
    data: { email: email, fullName: "Notif " + role, passwordHash: await bcrypt.hash(password, 4), role: role },
  });
}

async function login(email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email: email, password: password });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  const instructor = await makeUser(instructorEmail, "INSTRUCTOR");
  await makeUser(studentEmail, "STUDENT");
  await makeUser(otherEmail, "STUDENT");
  const course = await prisma.course.create({
    data: {
      title: "Notification Course",
      slug: "notif-course-" + stamp,
      summary: "s",
      description: "d",
      level: "BEGINNER",
      status: "PUBLISHED",
      publishedAt: new Date(),
      instructorId: instructor.id,
    },
  });
  courseId = course.id;
});

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { courseId: courseId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.user.deleteMany({ where: { email: { in: [studentEmail, otherEmail, instructorEmail] } } });
});

describe("notifications", () => {
  it("rejects anonymous requests with 401", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
  });

  it("notifies the student and the instructor when a student enrolls", async () => {
    const student = await login(studentEmail);
    const enroll = await student.post("/api/courses/" + courseId + "/enroll");
    expect(enroll.status).toBe(201);

    const list = await student.get("/api/notifications");
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBe(1);
    expect(list.body.data[0].type).toBe("ENROLLMENT_CONFIRMED");

    const instructor = await login(instructorEmail);
    const count = await instructor.get("/api/notifications/unread-count");
    expect(count.body.unreadCount).toBe(1);
    const instructorList = await instructor.get("/api/notifications");
    expect(instructorList.body.data[0].type).toBe("NEW_STUDENT");
  });

  it("marks one notification as read, and hides it from other users", async () => {
    const student = await login(studentEmail);
    const list = await student.get("/api/notifications");
    const id = list.body.data[0].id;

    const other = await login(otherEmail);
    const forbidden = await other.post("/api/notifications/" + id + "/read");
    expect(forbidden.status).toBe(404);

    const ok = await student.post("/api/notifications/" + id + "/read");
    expect(ok.status).toBe(200);
    expect(ok.body.notification.readAt).not.toBeNull();

    const count = await student.get("/api/notifications/unread-count");
    expect(count.body.unreadCount).toBe(0);
  });

  it("returns 400 for a malformed notification id", async () => {
    const student = await login(studentEmail);
    const res = await student.post("/api/notifications/not-a-uuid/read");
    expect(res.status).toBe(400);
  });

  it("marks every notification as read", async () => {
    const instructor = await login(instructorEmail);
    const res = await instructor.post("/api/notifications/read-all");
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);

    const count = await instructor.get("/api/notifications/unread-count");
    expect(count.body.unreadCount).toBe(0);
  });

  it("never throws when a notification cannot be created", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(
      notifyEnrollment({ id: missing, title: "X", slug: "x", instructorId: missing }, missing)
    ).resolves.toBeUndefined();
  });
});
