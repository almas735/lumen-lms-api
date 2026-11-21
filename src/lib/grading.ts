export interface GradeOption { id: string; isCorrect: boolean }
export interface GradeQuestion { id: string; options: GradeOption[] }
export interface GivenAnswer { questionId: string; selectedOptionId: string }
export interface GradedAnswer extends GivenAnswer { isCorrect: boolean }

// Grades a quiz submission on the server. Only the first answer for each question counts,
// answers for unknown questions or options are ignored, and a missing answer counts as wrong.
export function gradeAnswers(questions: GradeQuestion[], answers: GivenAnswer[], passingScorePercent: number) {
  const seen = new Set<string>();
  const graded: GradedAnswer[] = [];
  let correct = 0;
  for (const answer of answers) {
    if (seen.has(answer.questionId)) continue;
    const question = questions.find(function (q) { return q.id === answer.questionId; });
    if (!question) continue;
    seen.add(answer.questionId);
    const option = question.options.find(function (o) { return o.id === answer.selectedOptionId; });
    if (!option) continue;
    if (option.isCorrect) correct++;
    graded.push({ questionId: answer.questionId, selectedOptionId: answer.selectedOptionId, isCorrect: option.isCorrect });
  }
  const scorePercent = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
  return { graded: graded, correct: correct, scorePercent: scorePercent, passed: scorePercent >= passingScorePercent };
}
