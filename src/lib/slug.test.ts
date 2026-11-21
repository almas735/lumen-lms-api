import { describe, it, expect } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugify("Intro to Web Dev")).toBe("intro-to-web-dev");
  });

  it("removes punctuation and collapses repeated separators", () => {
    expect(slugify("Hello   ---  World!")).toBe("hello-world");
  });

  it("trims spaces and strips leading and trailing hyphens", () => {
    expect(slugify("  --Hi--  ")).toBe("hi");
  });

  it("keeps numbers", () => {
    expect(slugify("Python 3 Basics")).toBe("python-3-basics");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(slugify("!!!")).toBe("");
  });
});
