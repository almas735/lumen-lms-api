import { describe, it, expect } from "vitest";
import { isSameSet } from "./ordering";

describe("isSameSet", () => {
  it("accepts the same ids in a different order", () => {
    expect(isSameSet(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("accepts two empty lists", () => {
    expect(isSameSet([], [])).toBe(true);
  });

  it("rejects a list with a missing id", () => {
    expect(isSameSet(["a", "b"], ["a"])).toBe(false);
  });

  it("rejects a list with an extra id", () => {
    expect(isSameSet(["a"], ["a", "b"])).toBe(false);
  });

  it("rejects an id that is not expected", () => {
    expect(isSameSet(["a", "b"], ["a", "x"])).toBe(false);
  });

  it("rejects a repeated id", () => {
    expect(isSameSet(["a", "b"], ["a", "a"])).toBe(false);
  });
});
