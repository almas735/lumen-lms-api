import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../lib/prisma";
import { makeUser, makeCourse, loginAs } from "../testing/helpers";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

function quizBody(passing?: number) {
  return Object.assign(
    {
      title: "Checkpoint",
      questions: [
        { text: "Q1", options: [{ text: "right 1", isCorrect: true, explanation: "because 1" }, { text: "wrong 1", isCorrect: false }] },
        { text: "Q2", options: [{ text: "right 2", isCorrect: true, explanation: "because 2" }, { text: "wrong 2", isCorrect: false }] },
      ],
    },
    passing === undefined ? {} : { passingScorePercent: passing }
  );
}

async function loadQuiz(lessonId: string) {
  return prisma.quiz.findUniqueOrThrow({
    where: { lessonId: lessonId },
    include: { questions: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } },
  });
}

type LoadedQuiz = Awaited<ReturnType<typeof loadQuiz>>;

function answersFor(quiz: LoadedQuiz, picks: ("right" | "wrong")[]) {
  return picks.map(function (pick, i) {
    const question = quiz.questions[i];
    const option = question.options.find(function (o) { return o.isCorrect === (pick === "right"); });
    return { questionId: question.id, selectedOptionId: option!.id };
  });
}

// An instructor, an enrolled student, and a published course (the student is enrolled directly in the database).
async function setup(lessonCount: number = 2) {
  const instructor = await makeUser("INSTRUCTOR");
  const student = await makeUser("STUDENT");
  const { course, lessons } = await makeCourse(instructor.id, { lessons: lessonCount });
  const ownerApi = await loginAs(instructor);
  const studentApi = await loginAs(student);
  const enrollment = await prisma.enrollment.create({ data: { courseId: course.id, studentId: student.id, status: "ACTIVE" } });
  return { instructor: instructor, student: student, course: course, lessons: lessons, ownerApi: ownerApi, studentApi: studentApi, enrollment: enrollment };
}

// The same setup, plus a quiz on the first lesson.
async function setupWithQuiz(lessonCount: number = 2, passing?: number) {
  const s = await setup(lessonCount);
  const res = await s.ownerApi.put("/api/lessons/" + s.lessons[0].id + "/quiz").send(quizBody(passing));
  expect(res.status).toBe(201);
  const quiz = await loadQuiz(s.lessons[0].id);
  return Object.assign({}, s, { quiz: quiz });
}

describe("PUT /api/lessons/:lessonId/quiz", () => {
  it("creates a quiz with a default pass mark of 70", async () => {
    const { lessons, ownerApi } = await setup();
    const res = await ownerApi.put("/api/lessons/" + lessons[0].id + "/quiz").send(quizBody());
    expect(res.status).toBe(201);
    expect(res.body.quiz.passingScorePercent).toBe(70);
    const stored = await loadQuiz(lessons[0].id);
    expect(stored.questions).toHaveLength(2);
  });

  it("replaces an existing quiz instead of adding a second one", async () => {
    const { lessons, ownerApi } = await setup();
    await ownerApi.put("/api/lessons/" + lessons[0].id + "/quiz").send(quizBody());
    const second = Object.assign(quizBody(80), { title: "Second version" });
    const res = await ownerApi.put("/api/lessons/" + lessons[0].id + "/quiz").send(second);
    expect(res.status).toBe(201);
    expect(await prisma.quiz.count({ where: { lessonId: lessons[0].id } })).toBe(1);
    expect((await loadQuiz(lessons[0].id)).title).toBe("Second version");
  });

  it("rejects quizzes that are incomplete or out of range", async () => {
    const { lessons, ownerApi } = await setup();
    const url = "/api/lessons/" + lessons[0].id + "/quiz";
    expect((await ownerApi.put(url).send({ title: "T", questions: [] })).status).toBe(400);
    const oneOption = { title: "T", questions: [{ text: "Q", options: [{ text: "only", isCorrect: true }] }] };
    expect((await ownerApi.put(url).send(oneOption)).status).toBe(400);
    const noneCorrect = { title: "T", questions: [{ text: "Q", options: [{ text: "a", isCorrect: false }, { text: "b", isCorrect: false }] }] };
    const noCorrect = await ownerApi.put(url).send(noneCorrect);
    expect(noCorrect.status).toBe(400);
    expect(noCorrect.body.error.code).toBe("VALIDATION_ERROR");
    expect((await ownerApi.put(url).send(quizBody(101))).status).toBe(400);
  });

  it("is closed to students, other instructors and anonymous visitors, but open to an admin", async () => {
    const { lessons, studentApi } = await setup();
    const other = await loginAs(await makeUser("INSTRUCTOR"));
    const admin = await loginAs(await makeUser("ADMIN"));
    const url = "/api/lessons/" + lessons[0].id + "/quiz";
    expect((await studentApi.put(url).send(quizBody())).status).toBe(403);
    expect((await other.put(url).send(quizBody())).status).toBe(403);
    expect((await request(app).put(url).send(quizBody())).status).toBe(401);
    expect((await admin.put(url).send(quizBody())).status).toBe(201);
  });

  it("returns 400 for a malformed lesson id and 404 for an unknown one", async () => {
    const { ownerApi } = await setup();
    expect((await ownerApi.put("/api/lessons/not-a-uuid/quiz").send(quizBody())).status).toBe(400);
    expect((await ownerApi.put("/api/lessons/" + MISSING_ID + "/quiz").send(quizBody())).status).toBe(404);
  });
});

describe("GET /api/lessons/:lessonId/quiz", () => {
  it("shows the owner the correct answers", async () => {
    const { lessons, ownerApi } = await setupWithQuiz();
    const res = await ownerApi.get("/api/lessons/" + lessons[0].id + "/quiz");
    expect(res.status).toBe(200);
    expect(res.body.quiz.questions[0].options[0].isCorrect).toBe(true);
  });

  it("gives an enrolled student the quiz without any answers", async () => {
    const { lessons, studentApi } = await setupWithQuiz();
    const res = await studentApi.get("/api/lessons/" + lessons[0].id + "/quiz");
    expect(res.status).toBe(200);
    expect(res.body.quiz.passingScorePercent).toBe(70);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("isCorrect");
    expect(text).not.toContain("explanation");
  });

  it("blocks students who are not enrolled and anonymous visitors", async () => {
    const { lessons } = await setupWithQuiz();
    const stranger = await loginAs(await makeUser("STUDENT"));
    expect((await stranger.get("/api/lessons/" + lessons[0].id + "/quiz")).status).toBe(403);
    expect((await request(app).get("/api/lessons/" + lessons[0].id + "/quiz")).status).toBe(401);
  });

  it("returns 404 when the lesson has no quiz, and handles bad ids", async () => {
    const { lessons, ownerApi } = await setupWithQuiz();
    expect((await ownerApi.get("/api/lessons/" + lessons[1].id + "/quiz")).status).toBe(404);
    expect((await ownerApi.get("/api/lessons/not-a-uuid/quiz")).status).toBe(400);
    expect((await ownerApi.get("/api/lessons/" + MISSING_ID + "/quiz")).status).toBe(404);
  });
});

describe("POST /api/quizzes/:quizId/attempts", () => {
  it("passes a perfect attempt, reveals the answers and completes the lesson", async () => {
    const { quiz, lessons, enrollment, studentApi } = await setupWithQuiz();
    const res = await studentApi.post("/api/quizzes/" + quiz.id + "/attempts").send({ answers: answersFor(quiz, ["right", "right"]) });
    expect(res.status).toBe(201);
    expect(res.body.attempt).toMatchObject({ scorePercent: 100, passed: true, passingScorePercent: 70 });
    expect(res.body.questions[0].options.some(function (o: { isCorrect: boolean }) { return o.isCorrect; })).toBe(true);
    expect(res.body.courseCompleted).toBe(false);
    const progress = await prisma.lessonProgress.findFirst({ where: { enrollmentId: enrollment.id, lessonId: lessons[0].id } });
    expect(progress!.status).toBe("COMPLETED");
  });

  it("fails wrong answers, shows the explanations and leaves the lesson unfinished", async () => {
    const { quiz, lessons, enrollment, studentApi } = await setupWithQuiz();
    const res = await studentApi.post("/api/quizzes/" + quiz.id + "/attempts").send({ answers: answersFor(quiz, ["wrong", "wrong"]) });
    expect(res.status).toBe(201);
    expect(res.body.attempt).toMatchObject({ scorePercent: 0, passed: false });
    const explanations = res.body.questions[0].options.map(function (o: { explanation: string | null }) { return o.explanation; });
    expect(explanations).toContain("because 1");
    const done = await prisma.lessonProgress.count({ where: { enrollmentId: enrollment.id, lessonId: lessons[0].id, status: "COMPLETED" } });
    expect(done).toBe(0);
  });

  it("fails a 100 percent pass mark when only half the answers are right", async () => {
    const { quiz, studentApi } = await setupWithQuiz(2, 100);
    const res = await studentApi.post("/api/quizzes/" + quiz.id + "/attempts").send({ answers: answersFor(quiz, ["right", "wrong"]) });
    expect(res.body.attempt).toMatchObject({ scorePercent: 50, passed: false, passingScorePercent: 100 });
  });

  it("allows a retake and lists the attempts newest first", async () => {
    const { quiz, studentApi } = await setupWithQuiz();
    const url = "/api/quizzes/" + quiz.id + "/attempts";
    await studentApi.post(url).send({ answers: answersFor(quiz, ["wrong", "wrong"]) });
    await studentApi.post(url).send({ answers: answersFor(quiz, ["right", "right"]) });
    const res = await studentApi.get(url);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].passed).toBe(true);
    expect(res.body.data[1].passed).toBe(false);
  });

  it("completes the course and notifies the student when the quiz is the last lesson", async () => {
    const { quiz, student, enrollment, studentApi } = await setupWithQuiz(1);
    const res = await studentApi.post("/api/quizzes/" + quiz.id + "/attempts").send({ answers: answersFor(quiz, ["right", "right"]) });
    expect(res.body.courseCompleted).toBe(true);
    const stored = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
    expect(stored!.status).toBe("COMPLETED");
    const notices = await prisma.notification.findMany({ where: { userId: student.id } });
    const types = notices.map(function (n) { return n.type; });
    expect(types).toContain("QUIZ_PASSED");
    expect(types).toContain("COURSE_COMPLETED");
  });

  it("counts only the first answer per question and ignores unknown questions", async () => {
    const { quiz, studentApi } = await setupWithQuiz();
    const right = answersFor(quiz, ["right", "wrong"]);
    const wrongFirst = answersFor(quiz, ["wrong"])[0];
    const answers = [right[0], wrongFirst, { questionId: MISSING_ID, selectedOptionId: MISSING_ID }, right[1]];
    const res = await studentApi.post("/api/quizzes/" + quiz.id + "/attempts").send({ answers: answers });
    expect(res.status).toBe(201);
    expect(res.body.attempt.scorePercent).toBe(50);
  });

  it("treats an unanswered question as wrong", async () => {
    const { quiz, studentApi } = await setupWithQuiz();
    const res = await studentApi.post("/api/quizzes/" + quiz.id + "/attempts").send({ answers: answersFor(quiz, ["right"]) });
    expect(res.body.attempt.scorePercent).toBe(50);
    expect(res.body.questions[1].selectedOptionId).toBeNull();
  });

  it("blocks students who are not enrolled, instructors and anonymous visitors", async () => {
    const { quiz, ownerApi } = await setupWithQuiz();
    const stranger = await loginAs(await makeUser("STUDENT"));
    const url = "/api/quizzes/" + quiz.id + "/attempts";
    const body = { answers: answersFor(quiz, ["right", "right"]) };
    expect((await stranger.post(url).send(body)).status).toBe(403);
    expect((await ownerApi.post(url).send(body)).status).toBe(403);
    expect((await request(app).post(url).send(body)).status).toBe(401);
  });

  it("rejects a missing answers list and malformed or unknown quiz ids", async () => {
    const { quiz, studentApi } = await setupWithQuiz();
    expect((await studentApi.post("/api/quizzes/" + quiz.id + "/attempts").send({})).status).toBe(400);
    expect((await studentApi.post("/api/quizzes/not-a-uuid/attempts").send({ answers: [] })).status).toBe(400);
    expect((await studentApi.post("/api/quizzes/" + MISSING_ID + "/attempts").send({ answers: [] })).status).toBe(404);
  });
});

describe("GET /api/quizzes/:quizId/attempts", () => {
  it("shows a student only their own attempts", async () => {
    const { quiz, course, studentApi } = await setupWithQuiz();
    const other = await makeUser("STUDENT");
    await prisma.enrollment.create({ data: { courseId: course.id, studentId: other.id, status: "ACTIVE" } });
    const otherApi = await loginAs(other);
    const url = "/api/quizzes/" + quiz.id + "/attempts";
    await studentApi.post(url).send({ answers: answersFor(quiz, ["right", "right"]) });
    expect((await studentApi.get(url)).body.data).toHaveLength(1);
    expect((await otherApi.get(url)).body.data).toHaveLength(0);
  });

  it("blocks students who are not enrolled, instructors and anonymous visitors, and handles bad ids", async () => {
    const { quiz, ownerApi } = await setupWithQuiz();
    const stranger = await loginAs(await makeUser("STUDENT"));
    const url = "/api/quizzes/" + quiz.id + "/attempts";
    expect((await stranger.get(url)).status).toBe(403);
    expect((await ownerApi.get(url)).status).toBe(403);
    expect((await request(app).get(url)).status).toBe(401);
    const student = await loginAs(await makeUser("STUDENT"));
    expect((await student.get("/api/quizzes/not-a-uuid/attempts")).status).toBe(400);
    expect((await student.get("/api/quizzes/" + MISSING_ID + "/attempts")).status).toBe(404);
  });
});
