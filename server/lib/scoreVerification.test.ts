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

vi.mock('../../src/lib/examScoring', () => ({
  scoreExam: vi.fn()
}));

import { clientGetDoc, clientGetDocs } from '../firestoreClient';
import { scoreExam } from '../../src/lib/examScoring';
import { orderQuestionsForAttempt } from '../../src/lib/examQuestionOrder';
import { scoreVerificationService } from './scoreVerification';

const mockGetDoc = clientGetDoc as unknown as ReturnType<typeof vi.fn>;
const mockGetDocs = clientGetDocs as unknown as ReturnType<typeof vi.fn>;
const mockScoreExam = scoreExam as unknown as ReturnType<typeof vi.fn>;

function notFound() {
  return { exists: () => false, data: () => null };
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
});

describe('recomputeAttemptScore', () => {
  it('throws without calling scoreExam when the attempt does not exist', async () => {
    mockGetDoc.mockResolvedValue(notFound());

    await expect(scoreVerificationService.recomputeAttemptScore('missing_attempt', [])).rejects.toThrow(
      'Cannot verify score: attempt does not exist'
    );
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
    const scoringResult = { score: 8, correctCount: 2, accuracy: 100, errorBookEntries: [] };
    mockScoreExam.mockReturnValue(scoringResult);

    const answers = [1, 0];
    const result = await scoreVerificationService.recomputeAttemptScore('att_1', answers);

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
