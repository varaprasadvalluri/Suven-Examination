// Single source of truth for "what order did this student see the questions in".
// ExamInterface.tsx shuffles questions per-attempt (seed derived from attemptId) so each
// student gets a different question order, and stores their answers/timePerQuestion as
// plain arrays/objects indexed by POSITION in that shuffled order — not by question id.
// Any screen that reads attempt.answers[idx] or attempt.timePerQuestion[idx] against a
// `questions` list MUST reproduce the exact same order, or it pairs each answer with the
// wrong question. Firestore does not guarantee doc order for a query without orderBy, so
// the input to the shuffle must be sorted to a stable order first — that's what broke
// scoring before, and why every caller here goes through this same function.

export interface OrderableQuestion {
  id?: string;
}

export function getAttemptSeed(attemptId: string): number {
  return attemptId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

export function seededShuffle<T>(array: T[], seed: number): T[] {
  const arr = [...array];
  let currentSeed = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    const rnd = currentSeed / 233280;
    const j = Math.floor(rnd * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function orderQuestionsForAttempt<T extends OrderableQuestion>(questions: T[], attemptId: string): T[] {
  const sorted = [...questions].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
  return seededShuffle(sorted, getAttemptSeed(attemptId));
}
