import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { prisma } from "../lib/prisma";

const TEST_EMAIL = "testsuite.register@example.com";
const TEST_LOGIN_EMAIL = "testsuite.login@example.com";
const TEST_PASSWORD = "TestPass123";
const WEAK_EMAIL = "testsuite.weakpass@example.com";
const BAD_EMAIL_ADDR = "testsuite.notanemail";
const SNEAKY_EMAIL = "testsuite.sneakyadmin@example.com";

beforeAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { in: [TEST_EMAIL, TEST_LOGIN_EMAIL, WEAK_EMAIL, SNEAKY_EMAIL] } },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { in: [TEST_EMAIL, TEST_LOGIN_EMAIL, WEAK_EMAIL, SNEAKY_EMAIL] } },
  });
  await prisma.$disconnect();
});

describe("POST /api/auth/register", () => {
  it("creates a new user and returns 201 with no password hash in the response", async () => {
    const res = await request(app).post("/api/auth/register").send({
      fullName: "Test Suite User",
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      role: "STUDENT",
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(TEST_EMAIL);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("returns 409 for a duplicate email", async () => {
    const res = await request(app).post("/api/auth/register").send({
      fullName: "Test Suite User",
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      role: "STUDENT",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("returns 400 with a field-level detail when the password has no number", async () => {
    const res = await request(app).post("/api/auth/register").send({
      fullName: "Weak Pass",
      email: WEAK_EMAIL,
      password: "onlyletters",
      role: "STUDENT",
    });
    expect(res.status).toBe(400);
    const hasPasswordDetail = res.body.error.details.some(function (d: any) {
      return d.field === "password";
    });
    expect(hasPasswordDetail).toBe(true);
  });

  it("returns 400 for an invalid email address", async () => {
    const res = await request(app).post("/api/auth/register").send({
      fullName: "Bad Email",
      email: BAD_EMAIL_ADDR,
      password: TEST_PASSWORD,
      role: "STUDENT",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an attempt to register with role ADMIN", async () => {
    const res = await request(app).post("/api/auth/register").send({
      fullName: "Sneaky Admin",
      email: SNEAKY_EMAIL,
      password: TEST_PASSWORD,
      role: "ADMIN",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeAll(async () => {
    await request(app).post("/api/auth/register").send({
      fullName: "Login Test User",
      email: TEST_LOGIN_EMAIL,
      password: TEST_PASSWORD,
      role: "STUDENT",
    });
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: TEST_LOGIN_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(TEST_LOGIN_EMAIL);
  });

  it("returns the exact same message for a wrong password and an unknown email", async () => {
    const wrongPass = await request(app).post("/api/auth/login").send({
      email: TEST_LOGIN_EMAIL,
      password: "WrongPassword1",
    });
    const unknownEmail = await request(app).post("/api/auth/login").send({
      email: "doesnotexist@example.com",
      password: "WrongPassword1",
    });
    expect(wrongPass.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPass.body.error.message).toBe(unknownEmail.body.error.message);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 when not logged in", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the current user when logged in", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: TEST_LOGIN_EMAIL, password: TEST_PASSWORD });
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(TEST_LOGIN_EMAIL);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session so /me returns 401 afterward", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: TEST_LOGIN_EMAIL, password: TEST_PASSWORD });

    const meBefore = await agent.get("/api/auth/me");
    expect(meBefore.status).toBe(200);

    const logoutRes = await agent.post("/api/auth/logout");
    expect(logoutRes.status).toBe(204);

    const meAfter = await agent.get("/api/auth/me");
    expect(meAfter.status).toBe(401);
  });
});

describe("POST /api/auth/refresh", () => {
  it("returns 401 with no refresh cookie present", async () => {
    const res = await request(app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("issues a new session when a valid refresh cookie is present", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: TEST_LOGIN_EMAIL, password: TEST_PASSWORD });
    const res = await agent.post("/api/auth/refresh");
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(TEST_LOGIN_EMAIL);
  });
});
