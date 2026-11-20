import request from "supertest";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import app from "../app";
import { prisma } from "../lib/prisma";

export const PASSWORD = "Password123";

type Role = "STUDENT" | "INSTRUCTOR" | "ADMIN";

// Every helper builds brand-new data with unique values, so no test depends on another test's data.
export async function makeUser(role: Role, fullName?: string) {
  const id = randomUUID().slice(0, 8);
  return prisma.user.create({
    data: {
      email: "t." + id + "@example.com",
      fullName: fullName || "Test " + role + " " + id,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: role,
    },
  });
}

export async function loginAs(user: { email: string }) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

interface CourseOptions {
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  lessons?: number;
  publishedAt?: Date;
}

export async function makeCourse(instructorId: string, options: CourseOptions = {}) {
  const id = randomUUID().slice(0, 8);
  const status = options.status || "PUBLISHED";
  const course = await prisma.course.create({
    data: {
      title: "Course " + id,
      slug: "course-" + id,
      summary: "summary",
      description: "description",
      level: "BEGINNER",
      status: status,
      publishedAt: status === "PUBLISHED" ? options.publishedAt || new Date() : null,
      instructorId: instructorId,
    },
  });
  const lessons: Awaited<ReturnType<typeof prisma.lesson.create>>[] = [];
  const count = options.lessons === undefined ? 0 : options.lessons;
  if (count > 0) {
    const mod = await prisma.module.create({ data: { courseId: course.id, title: "Module 1", position: 1 } });
    for (let i = 1; i <= count; i++) {
      lessons.push(
        await prisma.lesson.create({
          data: { moduleId: mod.id, title: "Lesson " + i, contentMd: "content", durationMinutes: 1, position: i },
        })
      );
    }
  }
  return { course: course, lessons: lessons };
}
