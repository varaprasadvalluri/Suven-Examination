import { describe, it, expect, vi, beforeEach } from 'vitest';

// This service backs the screen every student lands on at login, so its cost profile is a
// cohort-wide cost profile: whatever it does per student happens 50,000 times inside the same
// few minutes. These tests are about that shape — how much it reads, and whether it reads
// serially — as much as about the exam list it returns.

const { findByStudent, findById, findPendingByStudent, findActiveForSchool, findPublishedForSchool } = vi.hoisted(() => ({
  findByStudent: vi.fn(),
  findById: vi.fn(),
  findPendingByStudent: vi.fn(),
  findActiveForSchool: vi.fn(),
  findPublishedForSchool: vi.fn()
}));

import { StudentDashboardService } from './StudentDashboardService';

// The service takes its DAOs as constructor arguments, so the fakes go straight in — no
// module mocking, and nothing in the composition root is involved.
const studentDashboardService = new StudentDashboardService(
  { findByStudent } as any,
  { findById, findPublishedForSchool } as any,
  { findPendingByStudent } as any,
  { findActiveForSchool } as any
);

const exam = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  exists: true,
  data: { title: `Exam ${id}`, subject: 'Physics', createdAt: '2026-08-01T00:00:00.000Z', ...over }
});

beforeEach(() => {
  vi.clearAllMocks();
  findByStudent.mockResolvedValue({ items: [], page: 1, pageSize: 200, total: 0, totalPages: 1 });
  findPendingByStudent.mockResolvedValue([]);
  findActiveForSchool.mockResolvedValue([]);
  findPublishedForSchool.mockResolvedValue([]);
  findById.mockImplementation(async (id: string) => exam(id));
});

describe('getAccessibleExamCandidates', () => {
  it('asks for a bounded page of the student history, not an effectively unbounded one', async () => {
    await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');

    // Was pageSize 10000 — calling the DAO directly and so stepping around pagination.ts's
    // MAX_PAGE_SIZE. No student has that many attempts, which is exactly why it never showed
    // up as a bug: an unbounded request that a small collection happened to answer.
    const [, opts] = findByStudent.mock.calls[0];
    expect(opts.pageSize).toBeLessThanOrEqual(200);
    expect(opts.page).toBe(1);
  });

  it('fetches the candidate exams concurrently rather than one round trip at a time', async () => {
    findPendingByStudent.mockResolvedValue([
      { id: 'i1', data: { examId: 'exam_1' } },
      { id: 'i2', data: { examId: 'exam_2' } },
      { id: 'i3', data: { examId: 'exam_3' } }
    ]);

    let inFlight = 0;
    let peakInFlight = 0;
    findById.mockImplementation(async (id: string) => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return exam(id);
    });

    const candidates = await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');

    // Awaiting these one at a time held the request open for the SUM of their latencies. With
    // the whole cohort logging in at once, that difference is the login queue.
    expect(peakInFlight).toBe(3);
    expect(candidates).toHaveLength(3);
  });

  it('spends no exam read at all on an exam the student has already finished', async () => {
    findByStudent.mockResolvedValue({
      items: [
        { id: 'att_done', data: { examId: 'exam_done', status: 'completed', canReattempt: false } },
        { id: 'att_live', data: { examId: 'exam_live', status: 'in-progress' } }
      ],
      page: 1,
      pageSize: 200,
      total: 2,
      totalPages: 1
    });

    const candidates = await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');

    // The lock-out decision needs only the attempt, so it is made before any exam is fetched —
    // a student with a long history of completed exams costs nothing extra to load.
    const fetchedExamIds = findById.mock.calls.map(([id]) => id);
    expect(fetchedExamIds).toEqual(['exam_live']);
    expect(candidates.map((c) => c.exam.id)).toEqual(['exam_live']);
  });

  it('still hides an exam whose window closed, and still keeps a live attempt in it', async () => {
    const closed = '2026-01-01T00:00:00.000Z';
    findPendingByStudent.mockResolvedValue([{ id: 'i1', data: { examId: 'exam_closed' } }]);
    findByStudent.mockResolvedValue({
      items: [{ id: 'att_live', data: { examId: 'exam_still_open', status: 'started' } }],
      page: 1,
      pageSize: 200,
      total: 1,
      totalPages: 1
    });
    findById.mockImplementation(async (id: string) => exam(id, { endTime: closed }));

    const candidates = await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');

    // A student mid-exam must finish even if the window closes under them; an untouched exam
    // whose window has passed must not sit there looking attemptable forever.
    expect(candidates.map((c) => c.exam.id)).toEqual(['exam_still_open']);
  });

  it('skips a candidate whose exam no longer exists instead of throwing', async () => {
    findPendingByStudent.mockResolvedValue([
      { id: 'i1', data: { examId: 'exam_deleted' } },
      { id: 'i2', data: { examId: 'exam_ok' } }
    ]);
    findById.mockImplementation(async (id: string) => (id === 'exam_deleted' ? { id, exists: false } : exam(id)));

    const candidates = await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');

    expect(candidates.map((c) => c.exam.id)).toEqual(['exam_ok']);
  });
});
