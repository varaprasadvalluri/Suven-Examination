import { describe, it, expect } from 'vitest';
import { seededShuffle, getAttemptSeed, orderQuestionsForAttempt } from './examQuestionOrder';

interface Q { id: string }

describe('seededShuffle', () => {
  it('is deterministic for the same seed and input', () => {
    const arr = [1, 2, 3, 4, 5];
    const a = seededShuffle(arr, 12345);
    const b = seededShuffle(arr, 12345);
    expect(a).toEqual(b);
  });

  it('does not mutate the input array', () => {
    const arr = [1, 2, 3];
    const copy = [...arr];
    seededShuffle(arr, 42);
    expect(arr).toEqual(copy);
  });
});

describe('orderQuestionsForAttempt', () => {
  const questions: Q[] = [
    { id: 'q3' }, { id: 'q1' }, { id: 'q5' }, { id: 'q2' }, { id: 'q4' }
  ];

  it('produces the same order for the same attemptId regardless of the input array order', () => {
    // Simulates Firestore returning the same doc set in two different raw orders across
    // two separate loads of the same attempt (no orderBy guarantee) — this is the exact
    // scenario that caused answers to be scored against the wrong question.
    const orderA = [...questions];
    const orderB = [questions[4], questions[1], questions[3], questions[0], questions[2]];

    const resultA = orderQuestionsForAttempt(orderA, 'att_exam1_student1');
    const resultB = orderQuestionsForAttempt(orderB, 'att_exam1_student1');

    expect(resultA.map(q => q.id)).toEqual(resultB.map(q => q.id));
  });

  it('gives different students a different (but each internally stable) order', () => {
    const orderForA = orderQuestionsForAttempt(questions, 'att_exam1_studentA').map(q => q.id);
    const orderForB = orderQuestionsForAttempt(questions, 'att_exam1_studentB').map(q => q.id);

    // Not a hard guarantee for every possible id/seed combination, but true for this fixture
    // and demonstrates the shuffle is actually seeded per-attempt, not a no-op.
    expect(orderForA).not.toEqual(orderForB);

    // Re-running for the same attempt must still be stable.
    expect(orderQuestionsForAttempt(questions, 'att_exam1_studentA').map(q => q.id)).toEqual(orderForA);
  });

  it('getAttemptSeed is a pure function of the attemptId string', () => {
    expect(getAttemptSeed('abc')).toBe(getAttemptSeed('abc'));
    expect(getAttemptSeed('abc')).not.toBe(getAttemptSeed('abd'));
  });
});
