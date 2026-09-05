import { AttemptDao } from '../ports/AttemptDao';
import { ExamDao } from '../ports/ExamDao';
import { InvitationDao } from '../ports/InvitationDao';
import { SecureExamLinkDao } from '../ports/SecureExamLinkDao';
import { isAttemptFinished } from '../../../shared/attemptStatus';

// How much of a student's own attempt history the dashboard reads. Newest first, so the
// entries that decide what the dashboard shows — live attempts to resume, recently completed
// exams to lock out — are always the ones kept.
//
// Was 10,000, which bypassed pagination.ts's MAX_PAGE_SIZE by calling the DAO directly. No
// student has ten thousand attempts, so it never truncated anything; it was a request for an
// unbounded read that happened to be answered by a small collection. On a route every student
// hits at login, the bound needs to be real rather than nominal.
const DASHBOARD_ATTEMPT_HISTORY_LIMIT = 200;

export type ExamCandidate = { exam: any; attempt: any | null };
export type UpcomingListItem =
  { examId: string; subject: string; locked: false; exam: any; attempt: any | null } | { examId: string; subject: string; locked: true };

// Groups the student-dashboard exam-access queries as one cohesive unit — both operations
// share the same DAO dependencies and getUpcomingListItems is built directly on top of
// getAccessibleExamCandidates, so they belong together rather than as two loose exports.
export class StudentDashboardService {
  constructor(
    private readonly attempts: AttemptDao,
    private readonly exams: ExamDao,
    private readonly invitations: InvitationDao,
    private readonly secureExamLinks: SecureExamLinkDao
  ) {}

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

    if (schoolId) {
      const activeLinks = await this.secureExamLinks.findActiveForSchool(schoolId);
      activeLinks.forEach((link) => {
        const examId = (link.data as any).examId;
        if (!examIds.has(examId)) examIds.set(examId, { source: 'school-link' });
      });
    }

    // The locked-out check runs BEFORE any exam is fetched, so a student with a long history of
    // completed exams costs no reads for them.
    // 'submitted' and 'grading_failed' lock the exam out of the dashboard's candidate list
    // exactly like 'completed' does — otherwise an exam the student just handed in pops back
    // up as available to start while grading is still running.
    const unlockedExamIds = [...examIds.keys()].filter((examId) => {
      const attempt = attemptsByExamId.get(examId);
      return !(attempt && isAttemptFinished(attempt.status) && !attempt.canReattempt);
    });

    // One round trip deep instead of N. These reads are independent, and awaiting them one at
    // a time held the request open for the SUM of their latencies — on the route every student
    // loads at login, that is per-student latency multiplied by the whole cohort arriving at
    // once. The candidate set stays small (only actively triggered exams), so this is a bounded
    // fan-out, not an unbounded one.
    const examResults = await Promise.all(unlockedExamIds.map((examId) => this.exams.findById(examId)));

    const candidates: ExamCandidate[] = [];
    for (let i = 0; i < unlockedExamIds.length; i++) {
      const examResult = examResults[i];
      if (!examResult.exists) continue;

      const attempt = attemptsByExamId.get(unlockedExamIds[i]) || null;
      const exam = { id: examResult.id, ...(examResult.data as any) };

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
      const published = await this.exams.findPublishedForSchool(schoolId, 200);
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
