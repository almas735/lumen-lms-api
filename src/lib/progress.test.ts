import { describe, it, expect } from "vitest";
import { percentComplete } from "./progress";

describe("percentComplete", () => {
  it("is 0 when the course has no lessons", () => {
    expect(percentComplete(0, 0)).toBe(0);
  });

  it("is 0 when nothing is completed", () => {
    expect(percentComplete(0, 5)).toBe(0);
  });

  it("is 50 when half the lessons are completed", () => {
    expect(percentComplete(1, 2)).toBe(50);
  });

  it("is 100 when every lesson is completed", () => {
    expect(percentComplete(4, 4)).toBe(100);
  });

  it("rounds to a whole number", () => {
    expect(percentComplete(1, 3)).toBe(33);
    expect(percentComplete(2, 3)).toBe(67);
  });
});
