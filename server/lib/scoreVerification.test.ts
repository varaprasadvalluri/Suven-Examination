import { describe, it, expect, vi, beforeEach } from 'vitest';

// This tests the orchestration (fetch attempt -> fetch its questions -> call scoreExam with
// the right args -> return its result / throw if the attempt doesn't exist), not scoring
// correctness itself — scoreExam's actual grading logic already has thorough coverage in
// src/lib/examScoring.test.ts, so it's mocked here rather than re-tested. Same Firestore-
// client mocking approach as server/authorization.test.ts.
vi.mock('../firestoreClient', () => ({
  clientDb: { type: 'db' },
  clientCollection: (_db: any, name: string) => ({ type: 'collection', name }),
  clientDoc: (_db: any, collectionName: string, id: string) => ({ type: 'doc', collectionName, id }),
  clientQuery: (collectionRef: any, ...constraints: any[]) => ({ type: 'query', collectionRef, constraints }),
  clientWhere: (field: string, op: string, value: any) => ({ type: 'where', field, op, value }),
  clientGetDoc: vi.fn(),
  clientGetDocs: vi.fn()
}));

vi.mock('../../shared/examScoring', () => ({
  scoreExam: vi.fn()
}));

import { clientGetDoc, clientGetDocs } from '../firestoreClient';
import { scoreExam } from '../../shared/examScoring';
import { orderQuestionsForAttempt } from '../../shared/examQuestionOrder';
import { recomputeAttemptScore, __resetAnswerKeyCache } from './scoreVerification';

const mockGetDoc = clientGetDoc as unknown as ReturnType<typeof vi.fn>;
const mockGetDocs = clientGetDocs as unknown as ReturnType<typeof vi.fn>;
const mockScoreExam = scoreExam as unknown as ReturnType<typeof vi.fn>;

function notFound() {
  return { exists: () => false, data: (): any => null };
}

function found(data: any) {
  return { exists: () => true, data: () => data };
}

function questionsSnap(docs: { id: string; data: any }[]) {
  return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
}

beforeEach(() => {
  mockGetDoc.mockReset();
  mockGetDocs.mockReset();
  mockScoreExam.mockReset();
  // recomputeAttemptScore now caches each exam's answer key across calls, so tests that reuse
  // an examId would otherwise inherit the previous test's questions instead of their own.
  __resetAnswerKeyCache();
});

describe('recomputeAttemptScore', () => {
  it('throws without calling scoreExam when the attempt does not exist', async () => {
    mockGetDoc.mockResolvedValue(notFound());

    await expect(recomputeAttemptScore('missing_attempt', [])).rejects.toThrow('Cannot verify score: attempt does not exist');
    expect(mockScoreExam).not.toHaveBeenCalled();
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("fetches the attempt, queries its exam questions by examId, and returns scoreExam's result unchanged", async () => {
    mockGetDoc.mockResolvedValue(found({ examId: 'exam_1', studentId: 'student_1', examTitle: 'Midterm Math' }));
    mockGetDocs.mockResolvedValue(
      questionsSnap([
        { id: 'q1', data: { text: 'Q1', correctAnswerIndex: 1 } },
        { id: 'q2', data: { text: 'Q2', correctAnswerIndex: 0 } }
      ])
    );
    const scoringResult = { score: 8, correctCount: 2, accuracy: 100, errorBookEntries: [] as any[] };
    mockScoreExam.mockReturnValue(scoringResult);

    const answers = [1, 0];
    const result = await recomputeAttemptScore('att_1', answers);

    // Query must be scoped to this attempt's own exam, not a platform-wide questions scan.
    expect(mockGetDocs).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.arrayContaining([expect.objectContaining({ field: 'examId', op: '==', value: 'exam_1' })])
      })
    );
    // scoreExam pairs answers[idx] with questions[idx] purely by position, and `answers` was
    // recorded against the student's per-attempt SHUFFLED order (ExamInterface.tsx), not
    // whatever order Firestore happened to return — so the fetched questions must be run
    // through the same orderQuestionsForAttempt(questions, attemptDocId) reorder before being
    // handed to scoreExam, not passed through in raw fetch order. Compute the expected order
    // the same way production code does, so this test breaks if that reorder is ever dropped.
    const expectedOrder = orderQuestionsForAttempt(
      [
        { id: 'q1', text: 'Q1', correctAnswerIndex: 1 },
        { id: 'q2', text: 'Q2', correctAnswerIndex: 0 }
      ],
      'att_1'
    );
    expect(mockScoreExam).toHaveBeenCalledWith(expectedOrder, answers, {
      studentId: 'student_1',
      examId: 'exam_1',
      examSubject: 'Midterm Math'
    });
    // The client-submitted answers feed scoring, but the returned score/accuracy come
    // straight from the server-side recompute — never trusted/echoed from client input.
    expect(result).toBe(scoringResult);
  });
});

describe('answer-key caching', () => {
  it("reads an exam's questions once no matter how many of its attempts are graded", async () => {
    mockGetDoc.mockResolvedValue(found({ examId: 'exam_shared', studentId: 's', examTitle: 'Physics' }));
    mockGetDocs.mockResolvedValue(questionsSnap([{ id: 'q1', data: { examId: 'exam_shared', correctAnswer: 'A' } }]));
    mockScoreExam.mockReturnValue({ score: 1, accuracy: 100 });

    await recomputeAttemptScore('att_1', []);
    await recomputeAttemptScore('att_2', []);
    await recomputeAttemptScore('att_3', []);

    // Grading is a burst over a handful of exams. Re-reading the same question paper per
    // attempt is what turned a 100-question exam sat by 100k students into 10M reads.
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    // The attempt itself is still read every time — that one IS per-student.
    expect(mockGetDoc).toHaveBeenCalledTimes(3);
  });

  it('issues a single query when a burst of attempts all miss the cache at once', async () => {
    mockGetDoc.mockResolvedValue(found({ examId: 'exam_burst', studentId: 's', examTitle: 'Physics' }));
    let resolveQuery: (value: any) => void = () => {};
    mockGetDocs.mockReturnValue(new Promise((resolve) => (resolveQuery = resolve)));
    mockScoreExam.mockReturnValue({ score: 1, accuracy: 100 });

    const grading = Promise.all(Array.from({ length: 50 }, (_, i) => recomputeAttemptScore(`att_${i}`, [])));
    // Nothing has been cached yet — without in-flight sharing these 50 would each fire their
    // own identical query, which is exactly the stampede at the start of a grading burst.
    resolveQuery(questionsSnap([{ id: 'q1', data: { examId: 'exam_burst', correctAnswer: 'A' } }]));
    await grading;

    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed lookup, so the next attempt retries instead of inheriting it', async () => {
    mockGetDoc.mockResolvedValue(found({ examId: 'exam_flaky', studentId: 's', examTitle: 'Physics' }));
    mockGetDocs.mockRejectedValueOnce(new Error('Firestore unavailable'));
    mockScoreExam.mockReturnValue({ score: 1, accuracy: 100 });

    await expect(recomputeAttemptScore('att_1', [])).rejects.toThrow('Firestore unavailable');

    mockGetDocs.mockResolvedValue(questionsSnap([{ id: 'q1', data: { examId: 'exam_flaky', correctAnswer: 'A' } }]));
    await expect(recomputeAttemptScore('att_2', [])).resolves.toEqual({ score: 1, accuracy: 100 });
    expect(mockGetDocs).toHaveBeenCalledTimes(2);
  });

  it('keeps separate answer keys per exam', async () => {
    mockGetDocs
      .mockResolvedValueOnce(questionsSnap([{ id: 'q_a', data: { examId: 'exam_a' } }]))
      .mockResolvedValueOnce(questionsSnap([{ id: 'q_b', data: { examId: 'exam_b' } }]));
    mockScoreExam.mockReturnValue({ score: 0, accuracy: 0 });

    mockGetDoc.mockResolvedValue(found({ examId: 'exam_a', studentId: 's', examTitle: 'A' }));
    await recomputeAttemptScore('att_a', []);
    mockGetDoc.mockResolvedValue(found({ examId: 'exam_b', studentId: 's', examTitle: 'B' }));
    await recomputeAttemptScore('att_b', []);

    expect(mockGetDocs).toHaveBeenCalledTimes(2);
    expect(mockScoreExam.mock.calls[0][0][0].id).toBe('q_a');
    expect(mockScoreExam.mock.calls[1][0][0].id).toBe('q_b');
  });
});
