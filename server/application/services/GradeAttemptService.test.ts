import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GradeAttemptService } from './GradeAttemptService';
import type { AttemptDao } from '../ports/AttemptDao';
import type { ScoreVerificationService } from './scoreVerification';
import type { SingleDocResult } from '../ports/SchoolDao';

// Grading now depends only on the AttemptDao port and the scoring service, so this needs no
// module mocking at all — just two fakes.
const mockFindById = vi.fn();
const mockUpdate = vi.fn();
const mockRecompute = vi.fn();

const attempts = { findById: mockFindById, update: mockUpdate } as unknown as AttemptDao;
const scoring = { recompute: mockRecompute } as unknown as ScoreVerificationService;

const service = new GradeAttemptService(attempts, scoring);

// gradeAttempt re-reads the attempt before writing a grade; this sets what that read returns.
const attemptInStatus = (status: string | null) =>
  mockFindById.mockResolvedValue(
    (status === null ? { id: 'att', exists: false } : { id: 'att', exists: true, data: { status } }) as SingleDocResult
  );

function task(overrides: Partial<Record<string, any>> = {}) {
  return {
    eventId: 'evt_1',
    timestamp: '2026-08-21T00:00:00.000Z',
    examId: 'exam_1',
    studentId: 'student_1',
    answers: [] as any[],
    attemptId: 'att_1',
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GradeAttemptService.grade', () => {
  it('recomputes the score and writes status=completed through the attempt DAO', async () => {
    attemptInStatus('submitted');
    mockRecompute.mockResolvedValue({ score: 8, accuracy: 80 });

    await service.grade(task({ answers: [{ questionId: 'q1', selectedOption: 'B' }] }));

    expect(mockRecompute).toHaveBeenCalledWith('att_1', [{ questionId: 'q1', selectedOption: 'B' }]);
    expect(mockUpdate).toHaveBeenCalledWith('att_1', { status: 'completed', score: 8, accuracy: 80 });
  });

  it('propagates a recompute failure without writing anything', async () => {
    attemptInStatus('submitted');
    mockRecompute.mockRejectedValue(new Error('attempt does not exist'));

    await expect(service.grade(task({ attemptId: 'missing_attempt' }))).rejects.toThrow('attempt does not exist');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // A school re-triggering an attempt during the grading window resets it to 'started' with
  // empty answers. Writing the old grade over that would resurrect a stale score on an attempt
  // the student is actively retaking.
  it.each(['started', 'in-progress', 'completed', 'expired'])('skips grading when the attempt has moved to %s', async (currentStatus) => {
    attemptInStatus(currentStatus);

    await service.grade(task({ eventId: 'evt_guard', attemptId: 'att_guard' }));

    expect(mockRecompute).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // Cloud Tasks delivers at least once, so a redelivered task must be a no-op rather than a
  // second write.
  it('is idempotent: a redelivered task for an already-graded attempt writes nothing', async () => {
    attemptInStatus('completed');

    await service.grade(task({ eventId: 'evt_dup', attemptId: 'att_dup' }));

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('skips grading when the attempt no longer exists', async () => {
    attemptInStatus(null);

    await service.grade(task({ eventId: 'evt_gone', attemptId: 'att_gone' }));

    expect(mockRecompute).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
