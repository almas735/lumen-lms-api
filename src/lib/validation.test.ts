import { describe, it, expect } from "vitest";
import { isValidUuid } from "./validation";

describe("isValidUuid", () => {
  it("accepts a normal UUID", () => {
    expect(isValidUuid("2cdc4dba-58ee-4930-8e8b-1e5989fcbc74")).toBe(true);
  });

  it("accepts upper case", () => {
    expect(isValidUuid("2CDC4DBA-58EE-4930-8E8B-1E5989FCBC74")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidUuid("")).toBe(false);
  });

  it("rejects text that is not a UUID", () => {
    expect(isValidUuid("not-a-uuid")).toBe(false);
  });

  it("rejects a UUID with extra characters", () => {
    expect(isValidUuid("2cdc4dba-58ee-4930-8e8b-1e5989fcbc74x")).toBe(false);
  });

  it("rejects an injection attempt", () => {
    expect(isValidUuid("'; DROP TABLE users;--")).toBe(false);
  });
});
