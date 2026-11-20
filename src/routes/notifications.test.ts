import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { notifyEnrollment } from "../lib/notify";
import { makeUser, makeCourse, loginAs } from "../testing/helpers";

describe("notifications", () => {
  it("rejects anonymous requests with 401", async () => {
    const res = await request(app).get("/api/notifications");
    expect(res.status).toBe(401);
  });

  it("notifies the student and the instructor when a student enrolls", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const student = await makeUser("STUDENT");
    const { course } = await makeCourse(instructor.id);

    const studentApi = await loginAs(student);
    const enroll = await studentApi.post("/api/courses/" + course.id + "/enroll");
    expect(enroll.status).toBe(201);

    const list = await studentApi.get("/api/notifications");
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBe(1);
    expect(list.body.data[0].type).toBe("ENROLLMENT_CONFIRMED");

    const instructorApi = await loginAs(instructor);
    const theirs = await instructorApi.get("/api/notifications");
    expect(theirs.body.unreadCount).toBe(1);
    expect(theirs.body.data[0].type).toBe("NEW_STUDENT");
  });

  it("marks one notification as read, and hides it from other users", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const student = await makeUser("STUDENT");
    const stranger = await makeUser("STUDENT");
    const { course } = await makeCourse(instructor.id);

    const studentApi = await loginAs(student);
    await studentApi.post("/api/courses/" + course.id + "/enroll");
    const list = await studentApi.get("/api/notifications");
    const id = list.body.data[0].id;

    const strangerApi = await loginAs(stranger);
    const forbidden = await strangerApi.post("/api/notifications/" + id + "/read");
    expect(forbidden.status).toBe(404);

    const ok = await studentApi.post("/api/notifications/" + id + "/read");
    expect(ok.status).toBe(200);
    expect(ok.body.notification.readAt).not.toBeNull();

    const count = await studentApi.get("/api/notifications/unread-count");
    expect(count.body.unreadCount).toBe(0);
  });

  it("returns 400 for a malformed notification id", async () => {
    const student = await makeUser("STUDENT");
    const studentApi = await loginAs(student);
    const res = await studentApi.post("/api/notifications/not-a-uuid/read");
    expect(res.status).toBe(400);
  });

  it("marks every notification as read", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const first = await makeUser("STUDENT");
    const second = await makeUser("STUDENT");
    const { course } = await makeCourse(instructor.id);

    await (await loginAs(first)).post("/api/courses/" + course.id + "/enroll");
    await (await loginAs(second)).post("/api/courses/" + course.id + "/enroll");

    const instructorApi = await loginAs(instructor);
    const before = await instructorApi.get("/api/notifications/unread-count");
    expect(before.body.unreadCount).toBe(2);

    const res = await instructorApi.post("/api/notifications/read-all");
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);

    const after = await instructorApi.get("/api/notifications/unread-count");
    expect(after.body.unreadCount).toBe(0);
  });

  it("never throws when a notification cannot be created", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(
      notifyEnrollment({ id: missing, title: "X", slug: "x", instructorId: missing }, missing)
    ).resolves.toBeUndefined();
  });
});
