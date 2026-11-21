// Whole-number percentage of lessons completed; 0 when the course has no lessons.
export function percentComplete(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}
