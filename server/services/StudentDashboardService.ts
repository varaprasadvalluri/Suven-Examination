import { attemptDao, examDao, invitationDao, secureExamLinkDao } from '../dao';

export type ExamCandidate = { exam: any; attempt: any | null };
export type UpcomingListItem =
  { examId: string; subject: string; locked: false; exam: any; attempt: any | null } | { examId: string; subject: string; locked: true };

// Groups the student-dashboard exam-access queries as one cohesive unit — both operations
// share the same DAO dependencies and getUpcomingListItems is built directly on top of
// getAccessibleExamCandidates, so they belong together rather than as two loose exports.
class StudentDashboardService {
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
    const attemptsPage = await attemptDao.findByStudent(studentId, { page: 1, pageSize: 10000 });
    const attemptsByExamId = new Map<string, any>();
    attemptsPage.items.forEach((rec) => attemptsByExamId.set((rec.data as any).examId, { id: rec.id, ...rec.data }));

    const examIds = new Map<string, { source: 'attempt' | 'invitation' | 'school-link' }>();

    attemptsPage.items
      .map((rec) => ({ id: rec.id, ...(rec.data as any) }))
      .filter((attemptItem) => attemptItem.status === 'started' || attemptItem.status === 'in-progress')
      .forEach((attemptItem) => examIds.set(attemptItem.examId, { source: 'attempt' }));

    const pendingInvites = await invitationDao.findPendingByStudent(studentId);
    pendingInvites.forEach((inv) => {
      const examId = (inv.data as any).examId;
      if (!examIds.has(examId)) examIds.set(examId, { source: 'invitation' });
    });

    if (schoolId) {
      const activeLinks = await secureExamLinkDao.findActiveForSchool(schoolId);
      activeLinks.forEach((link) => {
        const examId = (link.data as any).examId;
        if (!examIds.has(examId)) examIds.set(examId, { source: 'school-link' });
      });
    }

    const candidates: ExamCandidate[] = [];
    for (const examId of examIds.keys()) {
      const attempt = attemptsByExamId.get(examId) || null;
      const isLockedComplete = attempt && attempt.status === 'completed' && !attempt.canReattempt;
      if (isLockedComplete) continue;

      const examResult = await examDao.findById(examId);
      if (!examResult.exists) continue;
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
      const published = await examDao.findPublishedForSchool(schoolId, 200);
      lockedItems = published
        .filter((rec) => !unlockedIds.has(rec.id))
        .map((rec) => ({ examId: rec.id, subject: (rec.data as any)?.subject || 'General', locked: true }));
    }

    return [...unlockedItems, ...lockedItems];
  }
}

export const studentDashboardService = new StudentDashboardService();

// Backward-compatible named exports — every existing call site keeps working unchanged.
export const getAccessibleExamCandidates = studentDashboardService.getAccessibleExamCandidates.bind(studentDashboardService);
export const getUpcomingListItems = studentDashboardService.getUpcomingListItems.bind(studentDashboardService);
