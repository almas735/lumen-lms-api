import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../app";
import { prisma } from "../lib/prisma";
import { PASSWORD, makeUser, makeCourse, loginAs } from "../testing/helpers";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("GET /api/admin/users", () => {
  it("requires login and the admin role", async () => {
    const student = await makeUser("STUDENT");
    const instructor = await makeUser("INSTRUCTOR");
    expect((await request(app).get("/api/admin/users")).status).toBe(401);
    expect((await (await loginAs(student)).get("/api/admin/users")).status).toBe(403);
    expect((await (await loginAs(instructor)).get("/api/admin/users")).status).toBe(403);
  });

  it("finds users by name without exposing password data", async () => {
    const admin = await makeUser("ADMIN");
    const t = randomUUID().slice(0, 8);
    const target = await makeUser("STUDENT", "Zed " + t);
    const res = await (await loginAs(admin)).get("/api/admin/users?search=" + t);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(target.id);
    expect(res.body.data[0]).not.toHaveProperty("passwordHash");
  });

  it("leaves out users who have been deleted", async () => {
    const admin = await makeUser("ADMIN");
    const t = randomUUID().slice(0, 8);
    const target = await makeUser("STUDENT", "Gone " + t);
    await prisma.user.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
    const res = await (await loginAs(admin)).get("/api/admin/users?search=" + t);
    expect(res.body.data).toHaveLength(0);
  });
});

describe("PATCH /api/admin/users/:id/role", () => {
  it("changes another user's role", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser("STUDENT");
    const res = await (await loginAs(admin)).patch("/api/admin/users/" + target.id + "/role").send({ role: "INSTRUCTOR" });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("INSTRUCTOR");
    const stored = await prisma.user.findUnique({ where: { id: target.id } });
    expect(stored!.role).toBe("INSTRUCTOR");
  });

  it("will not let an admin change their own role", async () => {
    const admin = await makeUser("ADMIN");
    const res = await (await loginAs(admin)).patch("/api/admin/users/" + admin.id + "/role").send({ role: "STUDENT" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CANNOT_CHANGE_OWN_ROLE");
  });

  it("rejects a role that does not exist", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser("STUDENT");
    const res = await (await loginAs(admin)).patch("/api/admin/users/" + target.id + "/role").send({ role: "SUPERUSER" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for an unknown user and 400 for a malformed id", async () => {
    const admin = await makeUser("ADMIN");
    const api = await loginAs(admin);
    expect((await api.patch("/api/admin/users/" + MISSING_ID + "/role").send({ role: "STUDENT" })).status).toBe(404);
    const bad = await api.patch("/api/admin/users/not-a-uuid/role").send({ role: "STUDENT" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_ID");
  });

  it("is closed to non-admins", async () => {
    const instructor = await makeUser("INSTRUCTOR");
    const target = await makeUser("STUDENT");
    const res = await (await loginAs(instructor)).patch("/api/admin/users/" + target.id + "/role").send({ role: "ADMIN" });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/users/:id", () => {
  it("deletes a user so they can no longer log in", async () => {
    const admin = await makeUser("ADMIN");
    const target = await makeUser("STUDENT");
    const res = await (await loginAs(admin)).delete("/api/admin/users/" + target.id);
    expect(res.status).toBe(204);
    const login = await request(app).post("/api/auth/login").send({ email: target.email, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it("allows deleting an instructor whose courses are only drafts", async () => {
    const admin = await makeUser("ADMIN");
    const instructor = await makeUser("INSTRUCTOR");
    await makeCourse(instructor.id, { status: "DRAFT" });
    const res = await (await loginAs(admin)).delete("/api/admin/users/" + instructor.id);
    expect(res.status).toBe(204);
  });

  it("refuses to delete an instructor who has a published course (409)", async () => {
    const admin = await makeUser("ADMIN");
    const instructor = await makeUser("INSTRUCTOR");
    await makeCourse(instructor.id);
    const res = await (await loginAs(admin)).delete("/api/admin/users/" + instructor.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("HAS_PUBLISHED_COURSES");
  });

  it("returns 404 for an unknown user and 400 for a malformed id", async () => {
    const admin = await makeUser("ADMIN");
    const api = await loginAs(admin);
    expect((await api.delete("/api/admin/users/" + MISSING_ID)).status).toBe(404);
    expect((await api.delete("/api/admin/users/not-a-uuid")).status).toBe(400);
  });

  it("is closed to non-admins", async () => {
    const student = await makeUser("STUDENT");
    const target = await makeUser("STUDENT");
    expect((await (await loginAs(student)).delete("/api/admin/users/" + target.id)).status).toBe(403);
  });
});
