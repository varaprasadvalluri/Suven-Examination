import { describe, it, expect, vi, beforeEach } from 'vitest';

// This tests the orchestration (fetch attempt -> fetch its questions -> call scoreExam with
// the right args -> return its result / throw if the attempt doesn't exist), not scoring
// correctness itself — scoreExam's actual grading logic already has thorough coverage in
// shared/examScoring.test.ts, so it's mocked here rather than re-tested.
//
// Persistence is reached only through the AttemptDao/QuestionDao ports, so the collaborators
// below are plain fakes rather than a mocked Firestore module.
vi.mock('../../../shared/examScoring', () => ({
  scoreExam: vi.fn()
}));

import { scoreExam } from '../../../shared/examScoring';
import { orderQuestionsForAttempt } from '../../../shared/examQuestionOrder';
import { ScoreVerificationService } from './scoreVerification';
import type { AttemptDao } from '../ports/AttemptDao';
import type { QuestionDao } from '../ports/QuestionDao';
import type { SingleDocResult } from '../ports/SchoolDao';

const mockFindAttempt = vi.fn();
const mockFindQuestions = vi.fn();
const mockScoreExam = scoreExam as unknown as ReturnType<typeof vi.fn>;

const attempts = { findById: mockFindAttempt } as unknown as AttemptDao;
const questions = { findByExamId: mockFindQuestions } as unknown as QuestionDao;
// Frozen: nothing here depends on real elapsed time, and the answer-key TTL must not expire
// mid-test just because the suite ran slowly.
const clock = { now: () => new Date(0), timestamp: () => 0 };

let service: ScoreVerificationService;

function notFound(): SingleDocResult {
  return { id: 'missing', exists: false };
}

function found(data: any): SingleDocResult {
  return { id: 'existing', exists: true, data };
}

function questionRecords(docs: { id: string; data: any }[]) {
  return docs.map((d) => ({ id: d.id, data: d.data }));
}

beforeEach(() => {
  mockFindAttempt.mockReset();
  mockFindQuestions.mockReset();
  mockScoreExam.mockReset();
  // The service caches each exam's answer key across calls, so a fresh instance per test
  // stops one test inheriting the previous test's questions for the same examId.
  service = new ScoreVerificationService(attempts, questions, clock);
});

describe('recompute', () => {
  it('throws without calling scoreExam when the attempt does not exist', async () => {
    mockFindAttempt.mockResolvedValue(notFound());

    await expect(service.recompute('missing_attempt', [])).rejects.toThrow('Cannot verify score: attempt does not exist');
    expect(mockScoreExam).not.toHaveBeenCalled();
    expect(mockFindQuestions).not.toHaveBeenCalled();
  });

  it("fetches the attempt, queries its exam questions by examId, and returns scoreExam's result unchanged", async () => {
    mockFindAttempt.mockResolvedValue(found({ examId: 'exam_1', studentId: 'student_1', examTitle: 'Midterm Math' }));
    mockFindQuestions.mockResolvedValue(
      questionRecords([
        { id: 'q1', data: { text: 'Q1', correctAnswerIndex: 1 } },
        { id: 'q2', data: { text: 'Q2', correctAnswerIndex: 0 } }
      ])
    );
    const scoringResult = { score: 8, correctCount: 2, accuracy: 100, errorBookEntries: [] as any[] };
    mockScoreExam.mockReturnValue(scoringResult);

    const answers = [1, 0];
    const result = await service.recompute('att_1', answers);

    // Lookup must be scoped to this attempt's own exam, not a platform-wide questions scan.
    expect(mockFindQuestions).toHaveBeenCalledWith('exam_1');
    // scoreExam pairs answers[idx] with questions[idx] purely by position, and `answers` was
    // recorded against the student's per-attempt SHUFFLED order (ExamInterface.tsx), not
    // whatever order the store happened to return — so the fetched questions must be run
    // through the same orderQuestionsForAttempt(questions, attemptDocId) reorder before being
    // handed to scoreExam, not passed through in raw fetch order. Compute the expected order
    // the same way production code does, so this test breaks if that reorder is ever dropped.
    const expectedOrder = orderQuestionsForAttempt(
      [
        { id: 'q1', text: 'Q1', correctAnswerIndex: 1 },
        { id: 'q2', text: 'Q2', correctAnswerIndex: 0 }
      ] as any,
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
    mockFindAttempt.mockResolvedValue(found({ examId: 'exam_shared', studentId: 's', examTitle: 'Physics' }));
    mockFindQuestions.mockResolvedValue(questionRecords([{ id: 'q1', data: { examId: 'exam_shared', correctAnswer: 'A' } }]));
    mockScoreExam.mockReturnValue({ score: 1, accuracy: 100 });

    await service.recompute('att_1', []);
    await service.recompute('att_2', []);
    await service.recompute('att_3', []);

    // Grading is a burst over a handful of exams. Re-reading the same question paper per
    // attempt is what turned a 100-question exam sat by 100k students into 10M reads.
    expect(mockFindQuestions).toHaveBeenCalledTimes(1);
    // The attempt itself is still read every time — that one IS per-student.
    expect(mockFindAttempt).toHaveBeenCalledTimes(3);
  });

  it('issues a single query when a burst of attempts all miss the cache at once', async () => {
    mockFindAttempt.mockResolvedValue(found({ examId: 'exam_burst', studentId: 's', examTitle: 'Physics' }));
    let resolveQuery: (value: any) => void = () => {};
    mockFindQuestions.mockReturnValue(new Promise((resolve) => (resolveQuery = resolve)));
    mockScoreExam.mockReturnValue({ score: 1, accuracy: 100 });

    const grading = Promise.all(Array.from({ length: 50 }, (_, i) => service.recompute(`att_${i}`, [])));
    // Nothing has been cached yet — without in-flight sharing these 50 would each fire their
    // own identical query, which is exactly the stampede at the start of a grading burst.
    resolveQuery(questionRecords([{ id: 'q1', data: { examId: 'exam_burst', correctAnswer: 'A' } }]));
    await grading;

    expect(mockFindQuestions).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed lookup, so the next attempt retries instead of inheriting it', async () => {
    mockFindAttempt.mockResolvedValue(found({ examId: 'exam_flaky', studentId: 's', examTitle: 'Physics' }));
    mockFindQuestions.mockRejectedValueOnce(new Error('Firestore unavailable'));
    mockScoreExam.mockReturnValue({ score: 1, accuracy: 100 });

    await expect(service.recompute('att_1', [])).rejects.toThrow('Firestore unavailable');

    mockFindQuestions.mockResolvedValue(questionRecords([{ id: 'q1', data: { examId: 'exam_flaky', correctAnswer: 'A' } }]));
    await expect(service.recompute('att_2', [])).resolves.toEqual({ score: 1, accuracy: 100 });
    expect(mockFindQuestions).toHaveBeenCalledTimes(2);
  });

  it('keeps separate answer keys per exam', async () => {
    mockFindQuestions
      .mockResolvedValueOnce(questionRecords([{ id: 'q_a', data: { examId: 'exam_a' } }]))
      .mockResolvedValueOnce(questionRecords([{ id: 'q_b', data: { examId: 'exam_b' } }]));
    mockScoreExam.mockReturnValue({ score: 0, accuracy: 0 });

    mockFindAttempt.mockResolvedValue(found({ examId: 'exam_a', studentId: 's', examTitle: 'A' }));
    await service.recompute('att_a', []);
    mockFindAttempt.mockResolvedValue(found({ examId: 'exam_b', studentId: 's', examTitle: 'B' }));
    await service.recompute('att_b', []);

    expect(mockFindQuestions).toHaveBeenCalledTimes(2);
    expect(mockScoreExam.mock.calls[0][0][0].id).toBe('q_a');
    expect(mockScoreExam.mock.calls[1][0][0].id).toBe('q_b');
  });
});
