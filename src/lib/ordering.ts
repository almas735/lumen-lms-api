// True when `given` lists exactly the ids in `expected`, each once, in any order.
export function isSameSet(expected: string[], given: string[]): boolean {
  if (expected.length !== given.length) return false;
  const wanted = new Set(expected);
  const seen = new Set<string>();
  for (const id of given) {
    if (!wanted.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}
