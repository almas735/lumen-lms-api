import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../lib/prisma";
import { makeUser, makeCourse, loginAs } from "../testing/helpers";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

// A draft course with one module and two lessons, plus a logged-in owner.
async function setup() {
  const owner = await makeUser("INSTRUCTOR");
  const { course, lessons } = await makeCourse(owner.id, { status: "DRAFT", lessons: 2 });
  const api = await loginAs(owner);
  return { owner: owner, course: course, lessons: lessons, moduleId: lessons[0].moduleId, api: api };
}

describe("modules", () => {
  it("adds modules at the end of the course", async () => {
    const { course, api } = await setup();
    const first = await api.post("/api/courses/" + course.id + "/modules").send({ title: "Second" });
    const second = await api.post("/api/courses/" + course.id + "/modules").send({ title: "Third" });
    expect(first.status).toBe(201);
    expect(first.body.module.position).toBe(2);
    expect(second.body.module.position).toBe(3);
  });

  it("rejects an empty module title, naming the field", async () => {
    const { course, api } = await setup();
    const res = await api.post("/api/courses/" + course.id + "/modules").send({ title: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some(function (d: { field: string }) { return d.field === "title"; })).toBe(true);
  });

  it("blocks other instructors, students and anonymous visitors from adding modules", async () => {
    const { course } = await setup();
    const other = await makeUser("INSTRUCTOR");
    const student = await makeUser("STUDENT");
    const body = { title: "Nope" };
    expect((await (await loginAs(other)).post("/api/courses/" + course.id + "/modules").send(body)).status).toBe(403);
    expect((await (await loginAs(student)).post("/api/courses/" + course.id + "/modules").send(body)).status).toBe(403);
    expect((await request(app).post("/api/courses/" + course.id + "/modules").send(body)).status).toBe(401);
  });

  it("returns 400 for a malformed course id and 404 for an unknown one", async () => {
    const { api } = await setup();
    expect((await api.post("/api/courses/not-a-uuid/modules").send({ title: "x" })).status).toBe(400);
    expect((await api.post("/api/courses/" + MISSING_ID + "/modules").send({ title: "x" })).status).toBe(404);
  });

  it("renames a module and validates the new title", async () => {
    const { moduleId, api } = await setup();
    const ok = await api.patch("/api/modules/" + moduleId).send({ title: "Renamed" });
    expect(ok.status).toBe(200);
    expect(ok.body.module.title).toBe("Renamed");
    expect((await api.patch("/api/modules/" + moduleId).send({ title: "" })).status).toBe(400);
  });

  it("blocks other instructors from renaming, and handles unknown and malformed ids", async () => {
    const { moduleId, api } = await setup();
    const other = await makeUser("INSTRUCTOR");
    expect((await (await loginAs(other)).patch("/api/modules/" + moduleId).send({ title: "Hacked" })).status).toBe(403);
    expect((await api.patch("/api/modules/" + MISSING_ID).send({ title: "x" })).status).toBe(404);
    expect((await api.patch("/api/modules/not-a-uuid").send({ title: "x" })).status).toBe(400);
  });

  it("deletes a module together with its lessons", async () => {
    const { moduleId, api } = await setup();
    const res = await api.delete("/api/modules/" + moduleId);
    expect(res.status).toBe(204);
    expect(await prisma.lesson.count({ where: { moduleId: moduleId } })).toBe(0);
  });

  it("blocks other instructors from deleting a module", async () => {
    const { moduleId } = await setup();
    const other = await makeUser("INSTRUCTOR");
    expect((await (await loginAs(other)).delete("/api/modules/" + moduleId)).status).toBe(403);
    expect(await prisma.module.count({ where: { id: moduleId } })).toBe(1);
  });

  it("reorders modules in one request", async () => {
    const { course, moduleId, api } = await setup();
    const second = await prisma.module.create({ data: { courseId: course.id, title: "Two", position: 2 } });
    const res = await api.put("/api/courses/" + course.id + "/modules/order").send({ orderedIds: [second.id, moduleId] });
    expect(res.status).toBe(200);
    expect(res.body.data.map(function (m: { id: string }) { return m.id; })).toEqual([second.id, moduleId]);
  });

  it("rejects an order that includes another course's module or leaves one out", async () => {
    const { course, moduleId, api } = await setup();
    await prisma.module.create({ data: { courseId: course.id, title: "Two", position: 2 } });
    const foreign = await setup();

    const withForeign = await api.put("/api/courses/" + course.id + "/modules/order").send({ orderedIds: [moduleId, foreign.moduleId] });
    expect(withForeign.status).toBe(400);
    expect(withForeign.body.error.code).toBe("INVALID_ORDER");

    const missingOne = await api.put("/api/courses/" + course.id + "/modules/order").send({ orderedIds: [moduleId] });
    expect(missingOne.status).toBe(400);
    expect(await prisma.module.findUnique({ where: { id: foreign.moduleId } }).then(function (m) { return m!.position; })).toBe(1);
  });

  it("rejects an order request without orderedIds and blocks other instructors", async () => {
    const { course, moduleId, api } = await setup();
    const other = await makeUser("INSTRUCTOR");
    expect((await api.put("/api/courses/" + course.id + "/modules/order").send({})).status).toBe(400);
    expect((await (await loginAs(other)).put("/api/courses/" + course.id + "/modules/order").send({ orderedIds: [moduleId] })).status).toBe(403);
  });
});

describe("creating, editing and deleting lessons", () => {
  it("creates a lesson with sensible defaults at the next position", async () => {
    const { moduleId, api } = await setup();
    const res = await api.post("/api/modules/" + moduleId + "/lessons").send({ title: "New lesson" });
    expect(res.status).toBe(201);
    expect(res.body.lesson).toMatchObject({ position: 3, contentMd: "", durationMinutes: 0, videoUrl: null });
  });

  it("rejects an empty title and a video link that is not a URL", async () => {
    const { moduleId, api } = await setup();
    const res = await api.post("/api/modules/" + moduleId + "/lessons").send({ title: "", videoUrl: "not a url" });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map(function (d: { field: string }) { return d.field; });
    expect(fields).toContain("title");
    expect(fields).toContain("videoUrl");
  });

  it("blocks other instructors and handles unknown and malformed module ids", async () => {
    const { moduleId, api } = await setup();
    const other = await makeUser("INSTRUCTOR");
    expect((await (await loginAs(other)).post("/api/modules/" + moduleId + "/lessons").send({ title: "x" })).status).toBe(403);
    expect((await api.post("/api/modules/" + MISSING_ID + "/lessons").send({ title: "x" })).status).toBe(404);
    expect((await api.post("/api/modules/not-a-uuid/lessons").send({ title: "x" })).status).toBe(400);
  });

  it("notifies enrolled students when a lesson is added", async () => {
    const { course, moduleId, api } = await setup();
    const student = await makeUser("STUDENT");
    await prisma.enrollment.create({ data: { courseId: course.id, studentId: student.id, status: "ACTIVE" } });
    const res = await api.post("/api/modules/" + moduleId + "/lessons").send({ title: "Fresh content" });
    expect(res.status).toBe(201);
    const notices = await prisma.notification.findMany({ where: { userId: student.id, type: "NEW_LESSON" } });
    expect(notices).toHaveLength(1);
  });

  it("updates a lesson and validates the changes", async () => {
    const { lessons, api } = await setup();
    const ok = await api.patch("/api/lessons/" + lessons[0].id).send({ title: "Better title", contentMd: "# Hello", durationMinutes: 12 });
    expect(ok.status).toBe(200);
    expect(ok.body.lesson).toMatchObject({ title: "Better title", contentMd: "# Hello", durationMinutes: 12 });
    expect((await api.patch("/api/lessons/" + lessons[0].id).send({ videoUrl: "nope" })).status).toBe(400);
    expect((await api.patch("/api/lessons/" + lessons[0].id).send({ durationMinutes: -1 })).status).toBe(400);
  });

  it("blocks other instructors from editing, and handles unknown and malformed ids", async () => {
    const { lessons, api } = await setup();
    const other = await makeUser("INSTRUCTOR");
    expect((await (await loginAs(other)).patch("/api/lessons/" + lessons[0].id).send({ title: "Hacked" })).status).toBe(403);
    expect((await api.patch("/api/lessons/" + MISSING_ID).send({ title: "x" })).status).toBe(404);
    expect((await api.patch("/api/lessons/not-a-uuid").send({ title: "x" })).status).toBe(400);
  });

  it("deletes a lesson, and blocks other instructors", async () => {
    const { lessons, api } = await setup();
    const other = await makeUser("INSTRUCTOR");
    expect((await (await loginAs(other)).delete("/api/lessons/" + lessons[0].id)).status).toBe(403);
    expect((await api.delete("/api/lessons/" + lessons[0].id)).status).toBe(204);
    expect(await prisma.lesson.count({ where: { id: lessons[0].id } })).toBe(0);
    expect((await api.delete("/api/lessons/" + MISSING_ID)).status).toBe(404);
    expect((await api.delete("/api/lessons/not-a-uuid")).status).toBe(400);
  });

  it("reorders lessons and rejects ids from another module", async () => {
    const { lessons, moduleId, api } = await setup();
    const foreign = await setup();
    const swapped = await api.put("/api/modules/" + moduleId + "/lessons/order").send({ orderedIds: [lessons[1].id, lessons[0].id] });
    expect(swapped.status).toBe(200);
    expect(swapped.body.data.map(function (l: { id: string }) { return l.id; })).toEqual([lessons[1].id, lessons[0].id]);

    const bad = await api.put("/api/modules/" + moduleId + "/lessons/order").send({ orderedIds: [lessons[0].id, foreign.lessons[0].id] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_ORDER");
  });

  it("blocks other instructors from reordering lessons", async () => {
    const { lessons, moduleId } = await setup();
    const other = await makeUser("INSTRUCTOR");
    const res = await (await loginAs(other)).put("/api/modules/" + moduleId + "/lessons/order").send({ orderedIds: [lessons[0].id, lessons[1].id] });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/lessons/:id", () => {
  it("shows a lesson to its owner and to an admin", async () => {
    const { lessons, api } = await setup();
    const admin = await makeUser("ADMIN");
    expect((await api.get("/api/lessons/" + lessons[0].id)).status).toBe(200);
    expect((await (await loginAs(admin)).get("/api/lessons/" + lessons[0].id)).status).toBe(200);
  });

  it("lets an enrolled student read it and marks it in progress", async () => {
    const { course, lessons } = await setup();
    const student = await makeUser("STUDENT");
    await prisma.enrollment.create({ data: { courseId: course.id, studentId: student.id, status: "ACTIVE" } });
    const studentApi = await loginAs(student);
    const first = await studentApi.get("/api/lessons/" + lessons[0].id);
    expect(first.status).toBe(200);
    expect(first.body.progress.status).toBe("IN_PROGRESS");
    const again = await studentApi.get("/api/lessons/" + lessons[0].id);
    expect(again.body.progress.status).toBe("IN_PROGRESS");
  });

  it("never moves a completed lesson back to in progress", async () => {
    const { course, lessons } = await setup();
    const student = await makeUser("STUDENT");
    const enrollment = await prisma.enrollment.create({ data: { courseId: course.id, studentId: student.id, status: "ACTIVE" } });
    await prisma.lessonProgress.create({
      data: { enrollmentId: enrollment.id, lessonId: lessons[0].id, status: "COMPLETED", completedAt: new Date(), lastViewedAt: new Date() },
    });
    const res = await (await loginAs(student)).get("/api/lessons/" + lessons[0].id);
    expect(res.body.progress.status).toBe("COMPLETED");
  });

  it("blocks students who are not enrolled, who dropped the course, and anonymous visitors", async () => {
    const { course, lessons } = await setup();
    const stranger = await makeUser("STUDENT");
    const dropped = await makeUser("STUDENT");
    await prisma.enrollment.create({ data: { courseId: course.id, studentId: dropped.id, status: "DROPPED" } });
    expect((await (await loginAs(stranger)).get("/api/lessons/" + lessons[0].id)).status).toBe(403);
    expect((await (await loginAs(dropped)).get("/api/lessons/" + lessons[0].id)).status).toBe(403);
    expect((await request(app).get("/api/lessons/" + lessons[0].id)).status).toBe(401);
  });

  it("returns 400 for a malformed id and 404 for an unknown one", async () => {
    const { api } = await setup();
    expect((await api.get("/api/lessons/not-a-uuid")).status).toBe(400);
    expect((await api.get("/api/lessons/" + MISSING_ID)).status).toBe(404);
  });
});
