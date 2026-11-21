import { describe, it, expect } from "vitest";
import { canManage } from "./permissions";

describe("canManage", () => {
  it("lets the owner manage their own resource", () => {
    expect(canManage({ id: "u1", role: "INSTRUCTOR" }, "u1")).toBe(true);
  });

  it("lets an admin manage someone else's resource", () => {
    expect(canManage({ id: "admin", role: "ADMIN" }, "u1")).toBe(true);
  });

  it("blocks another instructor", () => {
    expect(canManage({ id: "u2", role: "INSTRUCTOR" }, "u1")).toBe(false);
  });

  it("blocks a student", () => {
    expect(canManage({ id: "s1", role: "STUDENT" }, "u1")).toBe(false);
  });
});
