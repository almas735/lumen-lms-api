import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../lib/prisma";
import { makeUser, makeCourse, loginAs } from "../testing/helpers";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

type Api = Awaited<ReturnType<typeof loginAs>>;

// A published course with two lessons, an instructor, and a logged-in student who has not enrolled yet.
async function setup() {
  const instructor = await makeUser("INSTRUCTOR");
  const student = await makeUser("STUDENT");
  const { course, lessons } = await makeCourse(instructor.id, { lessons: 2 });
  const studentApi = await loginAs(student);
  return { instructor: instructor, student: student, course: course, lessons: lessons, studentApi: studentApi };
}

async function enroll(api: Api, courseId: string) {
  const res = await api.post("/api/courses/" + courseId + "/enroll");
  expect(res.status).toBe(201);
  return res.body.enrollment as { id: string; status: string };
}

async function complete(api: Api, lessonId: string, completed: boolean) {
  return api.post("/api/lessons/" + lessonId + "/progress").send({ completed: completed });
}

describe("POST /api/courses/:id/enroll", () => {
  it("enrolls a student and prepares a progress row for every lesson", async () => {
    const { course, studentApi } = await setup();
    const res = await studentApi.post("/api/courses/" + course.id + "/enroll");
    expect(res.status).toBe(201);
    expect(res.body.enrollment.status).toBe("ACTIVE");
    const rows = await prisma.lessonProgress.findMany({ where: { enrollmentId: res.body.enrollment.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every(function (r) { return r.status === "NOT_STARTED"; })).toBe(true);
  });

  it("refuses a second enrollment with 409", async () => {
    const { course, studentApi } = await setup();
    await enroll(studentApi, course.id);
    const again = await studentApi.post("/api/courses/" + course.id + "/enroll");
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_ENROLLED");
  });

  it("re-activates a dropped enrollment", async () => {
    const { course, studentApi } = await setup();
    const enrollment = await enroll(studentApi, course.id);
    await studentApi.post("/api/enrollments/" + enrollment.id + "/drop");
    const again = await studentApi.post("/api/courses/" + course.id + "/enroll");
    expect(again.status).toBe(200);
    expect(again.body.enrollment.status).toBe("ACTIVE");
  });

  it("does not enroll in an unpublished, unknown or malformed course", async () => {
    const { instructor, studentApi } = await setup();
    const draft = await makeCourse(instructor.id, { status: "DRAFT" });
    expect((await studentApi.post("/api/courses/" + draft.course.id + "/enroll")).status).toBe(404);
    expect((await studentApi.post("/api/courses/" + MISSING_ID + "/enroll")).status).toBe(404);
    expect((await studentApi.post("/api/courses/not-a-uuid/enroll")).status).toBe(400);
  });

  it("is closed to instructors and anonymous visitors", async () => {
    const { instructor, course } = await setup();
    expect((await (await loginAs(instructor)).post("/api/courses/" + course.id + "/enroll")).status).toBe(403);
    expect((await request(app).post("/api/courses/" + course.id + "/enroll")).status).toBe(401);
  });
});

describe("POST /api/enrollments/:id/drop", () => {
  it("drops the student's own enrollment", async () => {
    const { course, studentApi } = await setup();
    const enrollment = await enroll(studentApi, course.id);
    const res = await studentApi.post("/api/enrollments/" + enrollment.id + "/drop");
    expect(res.status).toBe(200);
    expect(res.body.enrollment.status).toBe("DROPPED");
    expect(res.body.enrollment.droppedAt).not.toBeNull();
  });

  it("will not drop someone else's enrollment, or an unknown or malformed one", async () => {
    const { course, studentApi } = await setup();
    const enrollment = await enroll(studentApi, course.id);
    const stranger = await loginAs(await makeUser("STUDENT"));
    expect((await stranger.post("/api/enrollments/" + enrollment.id + "/drop")).status).toBe(404);
    expect((await studentApi.post("/api/enrollments/" + MISSING_ID + "/drop")).status).toBe(404);
    expect((await studentApi.post("/api/enrollments/not-a-uuid/drop")).status).toBe(400);
  });

  it("is closed to instructors", async () => {
    const { instructor } = await setup();
    expect((await (await loginAs(instructor)).post("/api/enrollments/" + MISSING_ID + "/drop")).status).toBe(403);
  });
});

describe("GET /api/student/enrollments", () => {
  it("lists active and completed enrollments with lesson counts, without dropped ones", async () => {
    const { instructor, course, lessons, studentApi } = await setup();
    const other = await makeCourse(instructor.id, { lessons: 1 });
    await enroll(studentApi, course.id);
    await complete(studentApi, lessons[0].id, true);
    const dropped = await enroll(studentApi, other.course.id);
    await studentApi.post("/api/enrollments/" + dropped.id + "/drop");

    const res = await studentApi.get("/api/student/enrollments");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ status: "ACTIVE", totalLessons: 2, completedLessons: 1 });
    expect(res.body.data[0].course.id).toBe(course.id);
  });

  it("requires login and the student role", async () => {
    const { instructor } = await setup();
    expect((await request(app).get("/api/student/enrollments")).status).toBe(401);
    expect((await (await loginAs(instructor)).get("/api/student/enrollments")).status).toBe(403);
  });
});

describe("GET /api/courses/:idOrSlug/outline", () => {
  it("shows the full outline to the owner, found by slug, with no enrollment", async () => {
    const { instructor, course } = await setup();
    const res = await (await loginAs(instructor)).get("/api/courses/" + course.slug + "/outline");
    expect(res.status).toBe(200);
    expect(res.body.modules[0].lessons).toHaveLength(2);
    expect(res.body.enrollment).toBeNull();
  });

  it("shows an enrolled student their progress, without the lesson content", async () => {
    const { course, lessons, studentApi } = await setup();
    await enroll(studentApi, course.id);
    await complete(studentApi, lessons[0].id, true);
    const res = await studentApi.get("/api/courses/" + course.id + "/outline");
    expect(res.status).toBe(200);
    const shown = res.body.modules[0].lessons;
    expect(shown[0].progress).toBe("COMPLETED");
    expect(shown[1].progress).toBe("NOT_STARTED");
    expect(shown[0]).not.toHaveProperty("contentMd");
    expect(res.body.enrollment).not.toBeNull();
  });

  it("blocks students who are not enrolled and anonymous visitors, and returns 404 for unknown courses", async () => {
    const { course, studentApi } = await setup();
    expect((await studentApi.get("/api/courses/" + course.slug + "/outline")).status).toBe(403);
    expect((await request(app).get("/api/courses/" + course.slug + "/outline")).status).toBe(401);
    expect((await studentApi.get("/api/courses/no-such-course/outline")).status).toBe(404);
  });

  it("lets an admin read any outline", async () => {
    const { course } = await setup();
    const admin = await loginAs(await makeUser("ADMIN"));
    expect((await admin.get("/api/courses/" + course.id + "/outline")).status).toBe(200);
  });
});

describe("POST /api/lessons/:id/progress", () => {
  it("marks a lesson complete without finishing the course", async () => {
    const { course, lessons, studentApi } = await setup();
    await enroll(studentApi, course.id);
    const res = await complete(studentApi, lessons[0].id, true);
    expect(res.status).toBe(200);
    expect(res.body.progress.status).toBe("COMPLETED");
    expect(res.body.courseCompleted).toBe(false);
  });

  it("completes the course when the last lesson is completed", async () => {
    const { course, lessons, studentApi } = await setup();
    const enrollment = await enroll(studentApi, course.id);
    await complete(studentApi, lessons[0].id, true);
    const last = await complete(studentApi, lessons[1].id, true);
    expect(last.body.courseCompleted).toBe(true);
    const stored = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(stored!.status).toBe("COMPLETED");
    expect(stored!.completedAt).not.toBeNull();
  });

  it("re-opens a completed course when a lesson is marked not complete again", async () => {
    const { course, lessons, studentApi } = await setup();
    const enrollment = await enroll(studentApi, course.id);
    await complete(studentApi, lessons[0].id, true);
    await complete(studentApi, lessons[1].id, true);
    const undone = await complete(studentApi, lessons[0].id, false);
    expect(undone.body.progress.status).toBe("IN_PROGRESS");
    const stored = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(stored!.status).toBe("ACTIVE");
    expect(stored!.completedAt).toBeNull();
  });

  it("refuses to complete a lesson that has a quiz by hand", async () => {
    const { course, lessons, studentApi } = await setup();
    await enroll(studentApi, course.id);
    await prisma.quiz.create({ data: { lessonId: lessons[0].id, title: "Checkpoint", passingScorePercent: 70 } });
    const res = await complete(studentApi, lessons[0].id, true);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("QUIZ_REQUIRED");
  });

  it("rejects a missing completed flag and malformed or unknown ids", async () => {
    const { course, lessons, studentApi } = await setup();
    await enroll(studentApi, course.id);
    expect((await studentApi.post("/api/lessons/" + lessons[0].id + "/progress").send({})).status).toBe(400);
    expect((await complete(studentApi, "not-a-uuid", true)).status).toBe(400);
    expect((await complete(studentApi, MISSING_ID, true)).status).toBe(404);
  });

  it("blocks students who are not enrolled, instructors and anonymous visitors", async () => {
    const { instructor, lessons, studentApi } = await setup();
    expect((await complete(studentApi, lessons[0].id, true)).status).toBe(403);
    expect((await complete(await loginAs(instructor), lessons[0].id, true)).status).toBe(403);
    expect((await request(app).post("/api/lessons/" + lessons[0].id + "/progress").send({ completed: true })).status).toBe(401);
  });
});

describe("GET /api/courses/:id/roster", () => {
  it("lists enrolled students with their progress and leaves out dropped ones", async () => {
    const { instructor, student, course, lessons, studentApi } = await setup();
    await enroll(studentApi, course.id);
    await complete(studentApi, lessons[0].id, true);
    const dropperApi = await loginAs(await makeUser("STUDENT"));
    const dropper = await enroll(dropperApi, course.id);
    await dropperApi.post("/api/enrollments/" + dropper.id + "/drop");

    const res = await (await loginAs(instructor)).get("/api/courses/" + course.id + "/roster");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ studentName: student.fullName, status: "ACTIVE", progressPercent: 50 });
    expect(res.body.data[0].lastActiveAt).not.toBeNull();
  });

  it("blocks other instructors, students and anonymous visitors, and handles bad ids", async () => {
    const { instructor, course, studentApi } = await setup();
    const other = await loginAs(await makeUser("INSTRUCTOR"));
    const owner = await loginAs(instructor);
    expect((await other.get("/api/courses/" + course.id + "/roster")).status).toBe(403);
    expect((await studentApi.get("/api/courses/" + course.id + "/roster")).status).toBe(403);
    expect((await request(app).get("/api/courses/" + course.id + "/roster")).status).toBe(401);
    expect((await owner.get("/api/courses/not-a-uuid/roster")).status).toBe(400);
    expect((await owner.get("/api/courses/" + MISSING_ID + "/roster")).status).toBe(404);
  });

  it("lets an admin read any roster", async () => {
    const { course } = await setup();
    const admin = await loginAs(await makeUser("ADMIN"));
    expect((await admin.get("/api/courses/" + course.id + "/roster")).status).toBe(200);
  });
});
