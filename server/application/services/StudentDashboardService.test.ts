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
//
// Rebuilt per test, and handed a clock the test drives. The service caches its school-wide
// reads for a TTL, so a single shared instance would carry one test's cached links into the
// next; `now` lets the cache tests below expire an entry without sleeping.
let studentDashboardService: StudentDashboardService;
let now = 0;

function buildService() {
  return new StudentDashboardService(
    { findByStudent } as any,
    { findById, findPublishedForSchool } as any,
    { findPendingByStudent } as any,
    { findActiveForSchool } as any,
    () => now
  );
}

const exam = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  exists: true,
  data: { title: `Exam ${id}`, subject: 'Physics', createdAt: '2026-08-01T00:00:00.000Z', ...over }
});

beforeEach(() => {
  vi.clearAllMocks();
  now = 0;
  studentDashboardService = buildService();
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

  // The whole-school re-attempt grant ("Allow Re-attempt" in SchoolStudentOnboarding's
  // Method A panel). The per-student grant writes canReattempt onto one attempt doc; doing
  // that for a whole school would be one write per student, so the school-wide grant is a
  // single `reattemptFrom` stamp on the secure link and the comparison happens here.
  describe('school-wide re-attempt grant', () => {
    const finishedAttempt = (over: Record<string, unknown> = {}) => ({
      items: [
        {
          id: 'att_done',
          data: {
            examId: 'exam_done',
            status: 'submitted',
            canReattempt: false,
            startTime: '2026-09-01T09:00:00.000Z',
            endTime: '2026-09-01T11:00:00.000Z',
            ...over
          }
        }
      ],
      page: 1,
      pageSize: 200,
      total: 1,
      totalPages: 1
    });

    it('re-opens a submitted exam when the school granted a re-attempt after it was handed in', async () => {
      findByStudent.mockResolvedValue(finishedAttempt());
      findActiveForSchool.mockResolvedValue([
        { id: 'gen_school_1_exam_done', data: { examId: 'exam_done', reattemptFrom: '2026-09-02T10:00:00.000Z' } }
      ]);

      const candidates = await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');

      expect(candidates.map((c) => c.exam.id)).toEqual(['exam_done']);
      // The dashboard restarts the EXISTING attempt off this flag. Without it the client
      // would treat the exam as never attempted and create a second attempt doc for the same
      // student and exam.
      expect(candidates[0].attempt.reopenedBySchoolLink).toBe(true);
    });

    it('does not re-open an attempt handed in AFTER the grant, so one grant is not reusable', async () => {
      findByStudent.mockResolvedValue(finishedAttempt({ endTime: '2026-09-03T11:00:00.000Z' }));
      findActiveForSchool.mockResolvedValue([
        { id: 'gen_school_1_exam_done', data: { examId: 'exam_done', reattemptFrom: '2026-09-02T10:00:00.000Z' } }
      ]);

      const candidates = await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');

      // A student who re-sat and submitted again is locked out until the school grants again.
      expect(candidates).toEqual([]);
      expect(findById).not.toHaveBeenCalled();
    });

    it('leaves a finished exam locked when the school link carries no grant', async () => {
      findByStudent.mockResolvedValue(finishedAttempt());
      findActiveForSchool.mockResolvedValue([{ id: 'gen_school_1_exam_done', data: { examId: 'exam_done' } }]);

      const candidates = await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');

      // Triggering or re-triggering the exam link on its own must never re-open submitted
      // papers — that is the separate, explicit decision this grant exists to represent.
      expect(candidates).toEqual([]);
    });

    it('reads the grant from a link whose exam the student already reached through their own attempt', async () => {
      // The attempt branch claims exam_done first, so a grant map built only from links that
      // introduced a NEW examId would miss the one case it exists for.
      findByStudent.mockResolvedValue(finishedAttempt({ status: 'completed' }));
      findActiveForSchool.mockResolvedValue([
        { id: 'gen_school_1_exam_done', data: { examId: 'exam_done', reattemptFrom: '2026-09-02T10:00:00.000Z' } }
      ]);

      const candidates = await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');

      expect(candidates.map((c) => c.exam.id)).toEqual(['exam_done']);
    });

    it('costs no extra read — the grant rides on links already fetched', async () => {
      findByStudent.mockResolvedValue(finishedAttempt());
      findActiveForSchool.mockResolvedValue([
        { id: 'gen_school_1_exam_done', data: { examId: 'exam_done', reattemptFrom: '2026-09-02T10:00:00.000Z' } }
      ]);

      await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');

      // One links query per dashboard load, same as before the grant existed. This runs on
      // every poll for every student, so an extra read here is an extra read cohort-wide.
      expect(findActiveForSchool).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================================
// SCHOOL-WIDE READ CACHING
// ============================================================================
// The cost shape this service is judged on. Everything it reads per student divides into two
// groups, and only one of them is actually per-student: the attempt history and the pending
// invitations are, while the school's active links, the school's published exam list and the
// exam documents themselves are the same bytes for every student of that school. Without a
// cache the second group is re-read per student per 20-second poll, which at cohort scale is
// the same query answered tens of thousands of times a minute.
describe('school-wide reads are cached, per-student reads are not', () => {
  const twoStudents = async () => {
    await studentDashboardService.getUpcomingListItems('student_1', 'school_1');
    await studentDashboardService.getUpcomingListItems('student_2', 'school_1');
  };

  it('reads a school’s links and published exams once for the whole cohort', async () => {
    await twoStudents();

    expect(findActiveForSchool).toHaveBeenCalledTimes(1);
    expect(findPublishedForSchool).toHaveBeenCalledTimes(1);
  });

  it('still reads each student’s own history and invitations every time', async () => {
    // The point of the cache is that it is keyed by school, never by student. Caching these
    // would show one student another student's dashboard.
    await twoStudents();

    expect(findByStudent).toHaveBeenCalledTimes(2);
    expect(findPendingByStudent).toHaveBeenCalledTimes(2);
  });

  it('keeps two schools apart', async () => {
    await studentDashboardService.getUpcomingListItems('student_1', 'school_1');
    await studentDashboardService.getUpcomingListItems('student_2', 'school_2');

    expect(findActiveForSchool.mock.calls.map(([id]) => id)).toEqual(['school_1', 'school_2']);
  });

  it('reads an exam document once however many students are sitting it', async () => {
    findActiveForSchool.mockResolvedValue([{ id: 'gen_school_1_exam_1', data: { examId: 'exam_1' } }]);

    await twoStudents();

    expect(findById).toHaveBeenCalledTimes(1);
  });

  it('picks up a newly triggered exam once the staleness budget passes', async () => {
    await studentDashboardService.getUpcomingListItems('student_1', 'school_1');

    // The school triggers an exam a moment later. Within the TTL the dashboard is entitled to
    // keep serving the previous answer; past it, the next caller pays for a fresh read.
    findActiveForSchool.mockResolvedValue([{ id: 'gen_school_1_exam_new', data: { examId: 'exam_new' } }]);

    now += 5000;
    const stale = await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');
    expect(stale).toEqual([]);

    now += 20000;
    const fresh = await studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1');
    expect(fresh.map((c) => c.exam.id)).toEqual(['exam_new']);
  });

  it('collapses a burst of simultaneous misses into one read', async () => {
    // THE RUSH. Every student opens the dashboard in the same few seconds at exam time, so the
    // misses arrive together — the moment the cache is least able to help unless concurrent
    // misses share the read in flight rather than each starting their own.
    // One gate shared by every call, held open until all three have had a chance to reach the
    // cache — so this fails if each miss starts its own read rather than joining the first.
    let release!: (value: any[]) => void;
    const gate = new Promise<any[]>((resolve) => (release = resolve));
    findActiveForSchool.mockImplementation(() => gate);

    const inFlight = Promise.all([
      studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1'),
      studentDashboardService.getAccessibleExamCandidates('student_2', 'school_1'),
      studentDashboardService.getAccessibleExamCandidates('student_3', 'school_1')
    ]);
    setTimeout(() => release([]), 0);
    await inFlight;

    expect(findActiveForSchool).toHaveBeenCalledTimes(1);
  });

  it('does not serve a failed read back to everyone for the rest of the TTL', async () => {
    findActiveForSchool.mockRejectedValueOnce(new Error('firestore unavailable'));

    await expect(studentDashboardService.getAccessibleExamCandidates('student_1', 'school_1')).rejects.toThrow('firestore unavailable');

    // The next student retries for real rather than inheriting the failure.
    findActiveForSchool.mockResolvedValue([]);
    await expect(studentDashboardService.getAccessibleExamCandidates('student_2', 'school_1')).resolves.toEqual([]);
    expect(findActiveForSchool).toHaveBeenCalledTimes(2);
  });

  it('asks for a bounded slice of the published exam list', async () => {
    await studentDashboardService.getUpcomingListItems('student_1', 'school_1');

    const [, maxResults] = findPublishedForSchool.mock.calls[0];
    expect(maxResults).toBeLessThanOrEqual(200);
  });
});
