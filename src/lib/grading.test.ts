import { describe, it, expect } from "vitest";
import { gradeAnswers } from "./grading";

const questions = [
  { id: "q1", options: [{ id: "q1a", isCorrect: true }, { id: "q1b", isCorrect: false }] },
  { id: "q2", options: [{ id: "q2a", isCorrect: false }, { id: "q2b", isCorrect: true }] },
];

describe("gradeAnswers", () => {
  it("scores 100 and passes when every answer is correct", () => {
    const result = gradeAnswers(questions, [
      { questionId: "q1", selectedOptionId: "q1a" },
      { questionId: "q2", selectedOptionId: "q2b" },
    ], 70);
    expect(result.scorePercent).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.graded.every(function (g) { return g.isCorrect; })).toBe(true);
  });

  it("fails a 70 percent pass mark when half the answers are correct", () => {
    const result = gradeAnswers(questions, [
      { questionId: "q1", selectedOptionId: "q1a" },
      { questionId: "q2", selectedOptionId: "q2a" },
    ], 70);
    expect(result.scorePercent).toBe(50);
    expect(result.passed).toBe(false);
  });

  it("passes when the score equals the passing score exactly", () => {
    const result = gradeAnswers(questions, [
      { questionId: "q1", selectedOptionId: "q1a" },
      { questionId: "q2", selectedOptionId: "q2a" },
    ], 50);
    expect(result.passed).toBe(true);
  });

  it("counts an unanswered question as wrong", () => {
    const result = gradeAnswers(questions, [{ questionId: "q1", selectedOptionId: "q1a" }], 70);
    expect(result.scorePercent).toBe(50);
    expect(result.graded).toHaveLength(1);
  });

  it("counts only the first answer given for a question", () => {
    const result = gradeAnswers(questions, [
      { questionId: "q1", selectedOptionId: "q1a" },
      { questionId: "q1", selectedOptionId: "q1a" },
    ], 70);
    expect(result.correct).toBe(1);
    expect(result.scorePercent).toBe(50);
    expect(result.graded).toHaveLength(1);
  });

  it("ignores answers for questions that are not in the quiz", () => {
    const result = gradeAnswers(questions, [{ questionId: "other", selectedOptionId: "x" }], 70);
    expect(result.graded).toHaveLength(0);
    expect(result.scorePercent).toBe(0);
  });

  it("treats an option that belongs to a different question as wrong and does not record it", () => {
    const result = gradeAnswers(questions, [{ questionId: "q1", selectedOptionId: "q2b" }], 70);
    expect(result.correct).toBe(0);
    expect(result.graded).toHaveLength(0);
  });

  it("scores 0 and fails for a quiz with no questions", () => {
    const result = gradeAnswers([], [], 70);
    expect(result.scorePercent).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("rounds the score to a whole number", () => {
    const three = [
      { id: "a", options: [{ id: "a1", isCorrect: true }] },
      { id: "b", options: [{ id: "b1", isCorrect: true }] },
      { id: "c", options: [{ id: "c1", isCorrect: true }] },
    ];
    const one = gradeAnswers(three, [{ questionId: "a", selectedOptionId: "a1" }], 0);
    const two = gradeAnswers(three, [
      { questionId: "a", selectedOptionId: "a1" },
      { questionId: "b", selectedOptionId: "b1" },
    ], 0);
    expect(one.scorePercent).toBe(33);
    expect(two.scorePercent).toBe(67);
  });
});
