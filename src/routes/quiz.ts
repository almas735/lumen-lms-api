import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { isValidUuid } from "../lib/validation";

const router = Router();

const optionSchema = z.object({
  text: z.string().min(1),
  isCorrect: z.boolean(),
  explanation: z.string().optional(),
});
const questionSchema = z.object({
  text: z.string().min(1),
  options: z.array(optionSchema).min(2),
});
const quizSchema = z.object({
  title: z.string().min(1),
  passingScorePercent: z.number().int().min(0).max(100).optional(),
  questions: z.array(questionSchema).min(1),
});

async function getOwnedLessonForQuiz(lessonId: string, user: { id: string; role: string }) {
  if (!isValidUuid(lessonId)) throw new AppError(400, "INVALID_ID", "That lesson ID is not valid");
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { module: { include: { course: true } } } });
  if (!lesson) throw new AppError(404, "NOT_FOUND", "Lesson not found");
  if (lesson.module.course.instructorId !== user.id && user.role !== "ADMIN") {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to do this");
  }
  return lesson;
}

router.put("/lessons/:lessonId/quiz", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lesson = await getOwnedLessonForQuiz(String(req.params.lessonId), req.user!);
    const parsed = quizSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map(function (i) { return { field: i.path.join("."), message: i.message }; });
      throw new AppError(400, "VALIDATION_ERROR", "Check the highlighted fields", details);
    }
    for (const q of parsed.data.questions) {
      if (!q.options.some(function (o) { return o.isCorrect; })) {
        throw new AppError(400, "VALIDATION_ERROR", "Every question needs at least one correct option");
      }
    }

    const quiz = await prisma.$transaction(async function (tx) {
      const existing = await tx.quiz.findUnique({ where: { lessonId: lesson.id } });
      if (existing) {
        await tx.quiz.delete({ where: { id: existing.id } });
      }
      const created = await tx.quiz.create({
        data: {
          lessonId: lesson.id,
          title: parsed.data.title,
          passingScorePercent: parsed.data.passingScorePercent === undefined ? 70 : parsed.data.passingScorePercent,
        },
      });
      for (let qi = 0; qi < parsed.data.questions.length; qi++) {
        const q = parsed.data.questions[qi];
        const question = await tx.question.create({
          data: { quizId: created.id, text: q.text, position: qi + 1 },
        });
        for (let oi = 0; oi < q.options.length; oi++) {
          const o = q.options[oi];
          await tx.answerOption.create({
            data: { questionId: question.id, text: o.text, isCorrect: o.isCorrect, explanation: o.explanation || null, position: oi + 1 },
          });
        }
      }
      return created;
    });

    res.status(201).json({ quiz: quiz });
  } catch (err) {
    next(err);
  }
});

router.get("/lessons/:lessonId/quiz", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const lessonId = String(req.params.lessonId);
    if (!isValidUuid(lessonId)) throw new AppError(400, "INVALID_ID", "That lesson ID is not valid");
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { module: { include: { course: true } } } });
    if (!lesson) throw new AppError(404, "NOT_FOUND", "Lesson not found");
    const course = lesson.module.course;
    const isOwner = course.instructorId === req.user!.id || req.user!.role === "ADMIN";

    const quiz = await prisma.quiz.findUnique({
      where: { lessonId: lesson.id },
      include: { questions: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } },
    });
    if (!quiz) throw new AppError(404, "NOT_FOUND", "This lesson has no quiz");

    if (isOwner) {
      res.json({ quiz: quiz });
      return;
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId: course.id, studentId: req.user!.id, status: { in: ["ACTIVE", "COMPLETED"] } },
    });
    if (!enrollment) throw new AppError(403, "FORBIDDEN", "You must be enrolled to take this quiz");

    const safeQuiz = {
      id: quiz.id,
      title: quiz.title,
      passingScorePercent: quiz.passingScorePercent,
      questions: quiz.questions.map(function (q) {
        return {
          id: q.id,
          text: q.text,
          options: q.options.map(function (o) { return { id: o.id, text: o.text }; }),
        };
      }),
    };
    res.json({ quiz: safeQuiz });
  } catch (err) {
    next(err);
  }
});

const attemptSchema = z.object({
  answers: z.array(z.object({ questionId: z.string(), selectedOptionId: z.string() })),
});

router.post("/quizzes/:quizId/attempts", requireAuth, requireRole("STUDENT"), async (req: AuthedRequest, res, next) => {
  try {
    const quizId = String(req.params.quizId);
    if (!isValidUuid(quizId)) throw new AppError(400, "INVALID_ID", "That quiz ID is not valid");
    const parsed = attemptSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "VALIDATION_ERROR", "answers array is required");

    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: { lesson: { include: { module: true } }, questions: { include: { options: true } } },
    });
    if (!quiz) throw new AppError(404, "NOT_FOUND", "Quiz not found");

    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId: quiz.lesson.module.courseId, studentId: req.user!.id, status: { in: ["ACTIVE", "COMPLETED"] } },
    });
    if (!enrollment) throw new AppError(403, "FORBIDDEN", "You must be enrolled to take this quiz");

    let correctCount = 0;
    const uniqueAnswers = parsed.data.answers.filter(function (a, i, arr) { return arr.findIndex(function (b) { return b.questionId === a.questionId; }) === i; });
    const gradedAnswers = uniqueAnswers.map(function (a) {
      const question = quiz.questions.find(function (q) { return q.id === a.questionId; });
      const option = question ? question.options.find(function (o) { return o.id === a.selectedOptionId; }) : undefined;
      const isCorrect = option ? option.isCorrect : false;
      if (isCorrect) correctCount++;
      return { questionId: a.questionId, selectedOptionId: a.selectedOptionId, isCorrect: isCorrect };
    });

    const totalQuestions = quiz.questions.length;
    const scorePercent = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const passed = scorePercent >= quiz.passingScorePercent;

    const attempt = await prisma.$transaction(async function (tx) {
      const created = await tx.quizAttempt.create({
        data: { quizId: quiz.id, enrollmentId: enrollment.id, scorePercent: scorePercent, passed: passed },
      });
      for (const ga of gradedAnswers) {
        await tx.attemptAnswer.create({
          data: { attemptId: created.id, questionId: ga.questionId, selectedOptionId: ga.selectedOptionId, isCorrect: ga.isCorrect },
        });
      }
      if (passed) {
        await tx.lessonProgress.upsert({
          where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: quiz.lessonId } },
          create: { enrollmentId: enrollment.id, lessonId: quiz.lessonId, status: "COMPLETED", completedAt: new Date(), lastViewedAt: new Date() },
          update: { status: "COMPLETED", completedAt: new Date() },
        });
      }
      return created;
    });

    let courseCompleted = false;
    if (passed) {
      const totalLessons = await prisma.lesson.count({ where: { module: { courseId: quiz.lesson.module.courseId } } });
      const completedCount = await prisma.lessonProgress.count({ where: { enrollmentId: enrollment.id, status: "COMPLETED" } });
      if (totalLessons > 0 && completedCount === totalLessons) {
        await prisma.enrollment.update({ where: { id: enrollment.id }, data: { status: "COMPLETED", completedAt: new Date() } });
        courseCompleted = true;
      }
    }

    const resultQuestions = quiz.questions.map(function (q) {
      const given = gradedAnswers.find(function (g) { return g.questionId === q.id; });
      return {
        id: q.id,
        text: q.text,
        options: q.options.map(function (o) {
          return { id: o.id, text: o.text, isCorrect: o.isCorrect, explanation: o.explanation };
        }),
        selectedOptionId: given ? given.selectedOptionId : null,
        isCorrect: given ? given.isCorrect : false,
      };
    });

    res.status(201).json({
      attempt: { id: attempt.id, scorePercent: scorePercent, passed: passed, passingScorePercent: quiz.passingScorePercent },
      questions: resultQuestions,
      courseCompleted: courseCompleted,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/quizzes/:quizId/attempts", requireAuth, requireRole("STUDENT"), async (req: AuthedRequest, res, next) => {
  try {
    const quizId = String(req.params.quizId);
    if (!isValidUuid(quizId)) throw new AppError(400, "INVALID_ID", "That quiz ID is not valid");
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, include: { lesson: { include: { module: true } } } });
    if (!quiz) throw new AppError(404, "NOT_FOUND", "Quiz not found");
    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId: quiz.lesson.module.courseId, studentId: req.user!.id },
    });
    if (!enrollment) throw new AppError(403, "FORBIDDEN", "You are not enrolled in this course");
    const attempts = await prisma.quizAttempt.findMany({
      where: { quizId: quiz.id, enrollmentId: enrollment.id },
      orderBy: { submittedAt: "desc" },
    });
    res.json({ data: attempts });
  } catch (err) {
    next(err);
  }
});

export default router;
