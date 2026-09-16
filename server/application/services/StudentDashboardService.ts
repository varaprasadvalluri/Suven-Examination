import { AttemptDao } from '../ports/AttemptDao';
import { ExamDao } from '../ports/ExamDao';
import { InvitationDao } from '../ports/InvitationDao';
import { SecureExamLinkDao } from '../ports/SecureExamLinkDao';
import { isAttemptFinished, isReopenedBySchoolLink } from '../../../shared/attemptStatus';
import { TtlCache } from '../../lib/ttlCache';
import { DocRecord, SingleDocResult } from '../ports/SchoolDao';

// How much of a student's own attempt history the dashboard reads. Newest first, so the
// entries that decide what the dashboard shows — live attempts to resume, recently completed
// exams to lock out — are always the ones kept.
//
// Was 10,000, which bypassed pagination.ts's MAX_PAGE_SIZE by calling the DAO directly. No
// student has ten thousand attempts, so it never truncated anything; it was a request for an
// unbounded read that happened to be answered by a small collection. On a route every student
// hits at login, the bound needs to be real rather than nominal.
const DASHBOARD_ATTEMPT_HISTORY_LIMIT = 200;

// How long the school-wide reads behind this dashboard may be served from cache.
//
// THE STALENESS BUDGET. The dashboard polls every 20 seconds (useStudentExams.ts), so what a
// student actually waits to see a newly triggered exam is at worst one poll plus one TTL —
// roughly half a minute, against the manual page reload this replaced. The same bound applies
// to a school clicking "Allow Re-attempt": the grant is live on the entry gate immediately
// (gatekeeper.ts reads the link doc directly, uncached), it is only the dashboard CARD that
// can lag by up to this long.
//
// What it buys: the three reads below are identical for every student of a school, and without
// a cache each one is repeated per student per poll. At the scale this platform is built for
// that is the difference between a handful of reads per school per interval and hundreds of
// thousands (see [[project-scale-target]]).
const SCHOOL_READ_CACHE_TTL_MS = 15000;

// How many published exams the locked "Soon" preview will look at. Not a page size the caller
// chooses — the preview is a teaser strip, and a school with more published exams than this
// simply doesn't get all of them previewed.
const PUBLISHED_EXAM_PREVIEW_LIMIT = 200;

export type ExamCandidate = { exam: any; attempt: any | null };
export type UpcomingListItem =
  { examId: string; subject: string; locked: false; exam: any; attempt: any | null } | { examId: string; subject: string; locked: true };

// Groups the student-dashboard exam-access queries as one cohesive unit — both operations
// share the same DAO dependencies and getUpcomingListItems is built directly on top of
// getAccessibleExamCandidates, so they belong together rather than as two loose exports.
export class StudentDashboardService {
  // Keyed by schoolId / examId only — never by student. Everything cached here is identical
  // for every student who could ask for it; the per-student reads (attempt history, pending
  // invitations) deliberately stay uncached and go to the database every time.
  private readonly activeLinksCache: TtlCache<DocRecord[]>;
  private readonly publishedExamsCache: TtlCache<DocRecord[]>;
  private readonly examCache: TtlCache<SingleDocResult>;

  constructor(
    private readonly attempts: AttemptDao,
    private readonly exams: ExamDao,
    private readonly invitations: InvitationDao,
    private readonly secureExamLinks: SecureExamLinkDao,
    // Injected so tests can move time without faking the global clock.
    now: () => number = Date.now
  ) {
    this.activeLinksCache = new TtlCache<DocRecord[]>(SCHOOL_READ_CACHE_TTL_MS, now);
    this.publishedExamsCache = new TtlCache<DocRecord[]>(SCHOOL_READ_CACHE_TTL_MS, now);
    this.examCache = new TtlCache<SingleDocResult>(SCHOOL_READ_CACHE_TTL_MS, now);
  }

  // Every exam a student currently has access to and hasn't completed-and-locked yet. A school
  // grants exam access two ways — both explicit triggers, never an implicit "any published
  // exam assigned to my school":
  //   Method B (individual): one `invitations` doc per studentId+examId — "Trigger Link" /
  //     "Re-trigger Link" per student row in SchoolStudentOnboarding.tsx.
  //   Method A (whole school): one `secure_exam_links` doc per schoolId+examId with
  //     isActive:true — "Trigger Exam" / "Re-trigger Exam" in the same screen's Method A
  //     panel. Triggering this makes the exam visible to every student of that school at once.
  // Bounded, not paginated — the candidate set is however many exams are actively triggered
  // right now, which stays small regardless of platform scale (see [[project-scale-target]]).
  async getAccessibleExamCandidates(studentId: string, schoolId: string | null): Promise<ExamCandidate[]> {
    const attemptsPage = await this.attempts.findByStudent(studentId, { page: 1, pageSize: DASHBOARD_ATTEMPT_HISTORY_LIMIT });
    const attemptsByExamId = new Map<string, any>();
    attemptsPage.items.forEach((rec) => attemptsByExamId.set((rec.data as any).examId, { id: rec.id, ...rec.data }));

    const examIds = new Map<string, { source: 'attempt' | 'invitation' | 'school-link' }>();

    attemptsPage.items
      .map((rec) => ({ id: rec.id, ...(rec.data as any) }))
      .filter((attemptItem) => attemptItem.status === 'started' || attemptItem.status === 'in-progress')
      .forEach((attemptItem) => examIds.set(attemptItem.examId, { source: 'attempt' }));

    const pendingInvites = await this.invitations.findPendingByStudent(studentId);
    pendingInvites.forEach((inv) => {
      const examId = (inv.data as any).examId;
      if (!examIds.has(examId)) examIds.set(examId, { source: 'invitation' });
    });

    // When the school granted a whole-school re-attempt for each exam, if it did. Built from
    // EVERY active link, not only the ones that added a new examId above: an exam the student
    // already has a finished attempt for is reached through the attempt branch first, and that
    // is exactly the case this map exists to unlock. Costs no extra reads — the links are
    // already in hand.
    const reattemptFromByExamId = new Map<string, string>();

    if (schoolId) {
      // Same answer for every student of this school, so one read serves all of them for the
      // length of the TTL — and concurrent misses share a single read rather than stampeding.
      const activeLinks = await this.activeLinksCache.getOrLoad(schoolId, () => this.secureExamLinks.findActiveForSchool(schoolId));
      activeLinks.forEach((link) => {
        const examId = (link.data as any).examId;
        const reattemptFrom = (link.data as any).reattemptFrom;
        if (reattemptFrom) reattemptFromByExamId.set(examId, reattemptFrom);
        if (!examIds.has(examId)) examIds.set(examId, { source: 'school-link' });
      });
    }

    // The locked-out check runs BEFORE any exam is fetched, so a student with a long history of
    // completed exams costs no reads for them.
    // 'submitted' and 'grading_failed' lock the exam out of the dashboard's candidate list
    // exactly like 'completed' does — otherwise an exam the student just handed in pops back
    // up as available to start while grading is still running.
    // A finished attempt is reopened by EITHER grant: `canReattempt` on the attempt itself
    // (per-student "Re-trigger Link"), or the school-wide `reattemptFrom` on the exam's
    // secure link ("Allow Re-attempt"). The gatekeeper applies the same pair before letting
    // the student actually back in, so the card and the door agree — showing one without the
    // other would mean an exam that is visible but throws EXAM_ALREADY_COMPLETED on click.
    const unlockedExamIds = [...examIds.keys()].filter((examId) => {
      const attempt = attemptsByExamId.get(examId);
      if (!attempt || !isAttemptFinished(attempt.status)) return true;
      return !!attempt.canReattempt || isReopenedBySchoolLink(attempt, reattemptFromByExamId.get(examId));
    });

    // One round trip deep instead of N. These reads are independent, and awaiting them one at
    // a time held the request open for the SUM of their latencies — on the route every student
    // loads at login, that is per-student latency multiplied by the whole cohort arriving at
    // once. The candidate set stays small (only actively triggered exams), so this is a bounded
    // fan-out, not an unbounded one.
    // Cached per exam id, not per student: an exam document is the same for everyone sitting
    // it, and during an exam window every student of the school asks for the same two or three
    // ids on every poll. The fan-out stays bounded either way; the cache is what stops it being
    // re-paid per student.
    const examResults = await Promise.all(
      unlockedExamIds.map((examId) => this.examCache.getOrLoad(examId, () => this.exams.findById(examId)))
    );

    const candidates: ExamCandidate[] = [];
    for (let i = 0; i < unlockedExamIds.length; i++) {
      const examResult = examResults[i];
      if (!examResult.exists) continue;

      const rawAttempt = attemptsByExamId.get(unlockedExamIds[i]) || null;
      const exam = { id: examResult.id, ...(examResult.data as any) };

      // Derived, response-only field: this finished attempt is re-openable because of the
      // school-wide grant rather than because canReattempt was set on it. The dashboard needs
      // to know the difference — without it StudentDashboard.handleStartCandidate would treat
      // the exam as never attempted and call attemptsService.create(), producing a SECOND
      // attempt doc for the same student+exam instead of restarting the existing one (the
      // gatekeeper's attempt ids are deterministic, so it would never collide and never be
      // noticed until the results came out doubled).
      const attempt =
        rawAttempt && isAttemptFinished(rawAttempt.status) && !rawAttempt.canReattempt
          ? { ...rawAttempt, reopenedBySchoolLink: isReopenedBySchoolLink(rawAttempt, reattemptFromByExamId.get(unlockedExamIds[i])) }
          : rawAttempt;

      // A triggered link/invite doesn't override the exam's own time window — a school that
      // triggered this weeks ago for an exam whose window has since closed shouldn't leave it
      // showing as attemptable forever. A live attempt is the one exception: let the student
      // finish/resume what they already started even if the window just closed under them.
      const isLive = attempt?.status === 'started' || attempt?.status === 'in-progress';
      if (!isLive && exam.endTime && new Date(exam.endTime).getTime() < Date.now()) continue;

      candidates.push({ exam, attempt });
    }

    // Live/resumable attempts first, then newest exam first.
    candidates.sort((a, b) => {
      const aLive = a.attempt?.status === 'started' || a.attempt?.status === 'in-progress';
      const bLive = b.attempt?.status === 'started' || b.attempt?.status === 'in-progress';
      if (aLive !== bLive) return aLive ? -1 : 1;
      return new Date(b.exam.createdAt || 0).getTime() - new Date(a.exam.createdAt || 0).getTime();
    });

    return candidates;
  }

  // Merges the attemptable candidates above with a locked "Soon" preview (subject only) of
  // exams published for the student's school but not yet triggered for them. The locked
  // preview is a visibility teaser, never a grant — attempt access is decided entirely by
  // getAccessibleExamCandidates.
  async getUpcomingListItems(studentId: string, schoolId: string | null): Promise<UpcomingListItem[]> {
    const candidates = await this.getAccessibleExamCandidates(studentId, schoolId);
    const unlockedIds = new Set(candidates.map((candidate) => candidate.exam.id));

    const unlockedItems: UpcomingListItem[] = candidates.map((candidate) => ({
      examId: candidate.exam.id,
      subject: candidate.exam.subject || 'General',
      locked: false,
      exam: candidate.exam,
      attempt: candidate.attempt
    }));

    let lockedItems: UpcomingListItem[] = [];
    if (schoolId) {
      // The most expensive read on this route — two Firestore queries merged, up to
      // PUBLISHED_EXAM_PREVIEW_LIMIT documents each — and the one whose result is least
      // student-specific: it is the school's published exam list, nothing more. Cached per
      // school for the same reason and the same TTL as the links above.
      const published = await this.publishedExamsCache.getOrLoad(schoolId, () =>
        this.exams.findPublishedForSchool(schoolId, PUBLISHED_EXAM_PREVIEW_LIMIT)
      );
      lockedItems = published
        .filter((rec) => !unlockedIds.has(rec.id))
        .map((rec) => ({ examId: rec.id, subject: (rec.data as any)?.subject || 'General', locked: true }));
    }

    return [...unlockedItems, ...lockedItems];
  }
}

// The service object is the only export. The two `.bind()` shims that used to sit here
// published a second, un-substitutable API alongside it — callers bound to a bare function
// that could never be swapped for a fake, which is the cost of a class with none of the
// benefit. Callers now go through the object.
