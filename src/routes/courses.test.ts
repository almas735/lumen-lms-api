import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../app";
import { makeUser, makeCourse, loginAs } from "../testing/helpers";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

function token() {
  return randomUUID().slice(0, 8);
}

describe("GET /api/courses (public catalog)", () => {
  it("lists published courses only and reports paging details", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const t = token();
    const published = await makeCourse(instructor.id, { title: "Findable " + t });
    await makeCourse(instructor.id, { title: "Findable " + t, status: "DRAFT" });

    const res = await request(app).get("/api/courses?search=" + t);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(published.course.id);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 12, total: 1, totalPages: 1 });
  });

  it("filters by level", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const t = token();
    await makeCourse(instructor.id, { title: "Level " + t, level: "BEGINNER" });
    const advanced = await makeCourse(instructor.id, { title: "Level " + t, level: "ADVANCED" });

    const res = await request(app).get("/api/courses?search=" + t + "&level=ADVANCED");
    expect(res.body.data.map(function (c: { id: string }) { return c.id; })).toEqual([advanced.course.id]);
  });
});

describe("GET /api/courses/:slug", () => {
  it("shows a published course to anyone", async () => {
    const instructor = await makeUser("INSTRUCTOR", "Pat Teacher");
    const { course } = await makeCourse(instructor.id);
    const res = await request(app).get("/api/courses/" + course.slug);
    expect(res.status).toBe(200);
    expect(res.body.course.instructor.fullName).toBe("Pat Teacher");
  });

  it("hides a draft from anonymous visitors and from other instructors", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const other = await makeUser("INSTRUCTOR");
    const { course } = await makeCourse(owner.id, { status: "DRAFT" });

    expect((await request(app).get("/api/courses/" + course.slug)).status).toBe(404);
    expect((await (await loginAs(other)).get("/api/courses/" + course.slug)).status).toBe(404);
  });

  it("shows a draft to its owner and to an admin", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const admin = await makeUser("ADMIN");
    const { course } = await makeCourse(owner.id, { status: "DRAFT" });

    expect((await (await loginAs(owner)).get("/api/courses/" + course.slug)).status).toBe(200);
    expect((await (await loginAs(admin)).get("/api/courses/" + course.slug)).status).toBe(200);
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await request(app).get("/api/courses/" + "no-such-course-" + token());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("GET /api/instructor/courses", () => {
  it("requires login", async () => {
    expect((await request(app).get("/api/instructor/courses")).status).toBe(401);
  });

  it("is closed to students", async () => {
    const student = await makeUser("STUDENT");
    expect((await (await loginAs(student)).get("/api/instructor/courses")).status).toBe(403);
  });

  it("lists the instructor's own courses with module and lesson counts, and filters by status", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const stranger = await makeUser("INSTRUCTOR");
    const full = await makeCourse(instructor.id, { lessons: 2 });
    await makeCourse(instructor.id, { status: "DRAFT" });
    await makeCourse(stranger.id);

    const api = await loginAs(instructor);
    const all = await api.get("/api/instructor/courses");
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    const row = all.body.data.find(function (c: { id: string }) { return c.id === full.course.id; });
    expect(row).toMatchObject({ moduleCount: 1, lessonCount: 2, status: "PUBLISHED" });

    const drafts = await api.get("/api/instructor/courses?status=DRAFT");
    expect(drafts.body.data).toHaveLength(1);
    expect(drafts.body.data[0].status).toBe("DRAFT");
  });
});

describe("POST /api/courses", () => {
  const valid = { summary: "A short summary", description: "A description", level: "BEGINNER" };

  it("requires login", async () => {
    const res = await request(app).post("/api/courses").send(Object.assign({ title: "Some title" }, valid));
    expect(res.status).toBe(401);
  });

  it("is closed to students", async () => {
    const student = await makeUser("STUDENT");
    const res = await (await loginAs(student)).post("/api/courses").send(Object.assign({ title: "Some title" }, valid));
    expect(res.status).toBe(403);
  });

  it("rejects a title that is too short, naming the field", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const res = await (await loginAs(instructor)).post("/api/courses").send(Object.assign({ title: "ab" }, valid));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.some(function (d: { field: string }) { return d.field === "title"; })).toBe(true);
  });

  it("creates a draft with a slug, and numbers the slug when the title is reused", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const api = await loginAs(instructor);
    const t = token();
    const first = await api.post("/api/courses").send(Object.assign({ title: "Slug Test " + t }, valid));
    const second = await api.post("/api/courses").send(Object.assign({ title: "Slug Test " + t }, valid));
    expect(first.status).toBe(201);
    expect(first.body.course.status).toBe("DRAFT");
    expect(first.body.course.slug).toBe("slug-test-" + t);
    expect(second.body.course.slug).toBe("slug-test-" + t + "-2");
  });
});

describe("PATCH /api/courses/:id", () => {
  it("lets the owner edit a course", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const { course } = await makeCourse(owner.id);
    const res = await (await loginAs(owner)).patch("/api/courses/" + course.id).send({ summary: "New summary" });
    expect(res.status).toBe(200);
    expect(res.body.course.summary).toBe("New summary");
  });

  it("blocks another instructor with 403", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const other = await makeUser("INSTRUCTOR");
    const { course } = await makeCourse(owner.id);
    const res = await (await loginAs(other)).patch("/api/courses/" + course.id).send({ summary: "Hacked" });
    expect(res.status).toBe(403);
  });

  it("returns 400 for a malformed id and 404 for an unknown id", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const api = await loginAs(owner);
    const bad = await api.patch("/api/courses/not-a-uuid").send({ summary: "x" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_ID");
    expect((await api.patch("/api/courses/" + MISSING_ID).send({ summary: "x" })).status).toBe(404);
  });

  it("returns 400 when the new title is too short", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const { course } = await makeCourse(owner.id);
    const res = await (await loginAs(owner)).patch("/api/courses/" + course.id).send({ title: "ab" });
    expect(res.status).toBe(400);
  });

  it("renames the slug of a draft but keeps the slug of a published course", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const api = await loginAs(owner);
    const t = token();
    const draft = await makeCourse(owner.id, { status: "DRAFT" });
    const published = await makeCourse(owner.id);

    const renamedDraft = await api.patch("/api/courses/" + draft.course.id).send({ title: "Renamed " + t });
    expect(renamedDraft.body.course.slug).toBe("renamed-" + t);

    const renamedPublished = await api.patch("/api/courses/" + published.course.id).send({ title: "Renamed Live " + t });
    expect(renamedPublished.body.course.slug).toBe(published.course.slug);
  });
});

describe("DELETE /api/courses/:id", () => {
  it("soft-deletes the course so it can no longer be found", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const { course } = await makeCourse(owner.id);
    const res = await (await loginAs(owner)).delete("/api/courses/" + course.id);
    expect(res.status).toBe(204);
    expect((await request(app).get("/api/courses/" + course.slug)).status).toBe(404);
  });

  it("blocks another instructor but allows an admin", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const other = await makeUser("INSTRUCTOR");
    const admin = await makeUser("ADMIN");
    const { course } = await makeCourse(owner.id);

    expect((await (await loginAs(other)).delete("/api/courses/" + course.id)).status).toBe(403);
    expect((await (await loginAs(admin)).delete("/api/courses/" + course.id)).status).toBe(204);
  });
});

describe("publishing, unpublishing and archiving", () => {
  it("refuses to publish a course with no lessons and says why", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const { course } = await makeCourse(owner.id, { status: "DRAFT" });
    const res = await (await loginAs(owner)).post("/api/courses/" + course.id + "/publish");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INCOMPLETE_COURSE");
    expect(res.body.error.details.some(function (d: { field: string }) { return d.field === "modules"; })).toBe(true);
  });

  it("publishes a complete course and stamps the publish date", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const { course } = await makeCourse(owner.id, { status: "DRAFT", lessons: 1 });
    const res = await (await loginAs(owner)).post("/api/courses/" + course.id + "/publish");
    expect(res.status).toBe(200);
    expect(res.body.course.status).toBe("PUBLISHED");
    expect(res.body.course.publishedAt).not.toBeNull();
  });

  it("will not publish an archived course (409)", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const { course } = await makeCourse(owner.id, { status: "ARCHIVED", lessons: 1 });
    const res = await (await loginAs(owner)).post("/api/courses/" + course.id + "/publish");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("MUST_UNARCHIVE_FIRST");
  });

  it("unpublishes to draft and archives", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const { course } = await makeCourse(owner.id, { lessons: 1 });
    const api = await loginAs(owner);

    const unpublished = await api.post("/api/courses/" + course.id + "/unpublish");
    expect(unpublished.status).toBe(200);
    expect(unpublished.body.course.status).toBe("DRAFT");

    const archived = await api.post("/api/courses/" + course.id + "/archive");
    expect(archived.status).toBe(200);
    expect(archived.body.course.status).toBe("ARCHIVED");
  });

  it("blocks students and other instructors from changing status", async () => {
    const owner = await makeUser("INSTRUCTOR");
    const other = await makeUser("INSTRUCTOR");
    const student = await makeUser("STUDENT");
    const { course } = await makeCourse(owner.id, { status: "DRAFT", lessons: 1 });

    expect((await (await loginAs(other)).post("/api/courses/" + course.id + "/publish")).status).toBe(403);
    expect((await (await loginAs(student)).post("/api/courses/" + course.id + "/archive")).status).toBe(403);
    expect((await request(app).post("/api/courses/" + course.id + "/publish")).status).toBe(401);
  });
});
