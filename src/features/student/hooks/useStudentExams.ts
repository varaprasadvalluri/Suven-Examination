import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { studentDashboardApi, PagedResult } from '../../../services/api';

export type ExamCandidate = { exam: any; attempt: any | null };
export type UpcomingItem = { examId: string; subject: string; locked: boolean; exam?: any; attempt?: any | null };

// How often the dashboard re-asks the server whether anything became available.
//
// A school makes an exam visible by writing ONE `secure_exam_links` doc (Method A) or one
// `invitations` doc per student (Method B) — see StudentDashboardService. Neither write pushes
// anything to a student who is already sitting on this screen, and this hook used to fetch
// exactly once on mount, so a student waiting for the paper to appear saw nothing until they
// manually reloaded the page. On exam day that is the whole cohort refreshing by hand.
//
// 20s rather than the 6-12s used by apiService's onSnapshot polling: the upcoming-list call is
// the expensive one. Its school-wide reads — the active links, the published exam list, the
// exam documents — are now bounded and cached per school on the server
// (StudentDashboardService's SCHOOL_READ_CACHE_TTL_MS), so a poll from the whole cohort costs a
// handful of reads per school per interval rather than a set per student. What is left
// per-student is the student's own attempt history and invitations, which is why this stays at
// 20s rather than dropping to the snapshot cadence.
//
// Worst case for a student waiting on a freshly triggered exam is therefore one interval plus
// one server-side TTL — still well under a minute, against the manual reload this replaced.
const DASHBOARD_REFRESH_INTERVAL_MS = 20000;

// Container-side data logic for the student dashboard, extracted out of StudentDashboard.tsx
// so that component stays focused on rendering (Container/Presentational split) — this hook
// owns fetching + loading state for all three dashboard screens (In Progress / Upcoming /
// Completed) and the shared "stale session" handling, with no rendering concerns of its own.
export function useStudentExams(studentId: string | undefined) {
  const navigate = useNavigate();

  const [loadingStatus, setLoadingStatus] = useState(true);
  const [inProgress, setInProgress] = useState<ExamCandidate | null>(null);
  const [statusError, setStatusError] = useState(false);

  const [loadingUpcoming, setLoadingUpcoming] = useState(true);
  const [upcomingPage, setUpcomingPage] = useState<PagedResult<UpcomingItem> | null>(null);
  const [upcomingError, setUpcomingError] = useState(false);

  const [completedPage, setCompletedPage] = useState<PagedResult<{ id: string; data: any }> | null>(null);
  const [loadingCompleted, setLoadingCompleted] = useState(true);
  const [completedError, setCompletedError] = useState(false);

  // A session that's no longer valid server-side (e.g. it survived a JWT signing-key
  // rotation) must not be allowed to silently render as an empty dashboard — that reads as
  // "you have nothing," which is wrong; the truth is "we don't know, log in again."
  const handleAuthError = useCallback(
    (err: any): boolean => {
      if (err?.status === 401) {
        toast.error('Your session has expired. Please sign in again.');
        navigate('/login');
        return true;
      }
      return false;
    },
    [navigate]
  );

  // `silent` refreshes are the background poll: they replace the data but never flip the
  // loading flags, because toggling those on a timer would blank the screen back to skeletons
  // every 20 seconds while the student is reading it. They also leave the existing error state
  // alone on failure — one dropped background poll on a flaky school network is not a reason
  // to replace a rendered list with an error card; the next tick just tries again.
  const loadStatus = useCallback(
    async (silent = false) => {
      if (!studentId) return;
      if (!silent) {
        setLoadingStatus(true);
        setStatusError(false);
      }
      try {
        const statusResponse = await studentDashboardApi.getStatus(studentId);
        setInProgress(statusResponse.inProgress);
        if (silent) setStatusError(false);
      } catch (err) {
        if (!handleAuthError(err) && !silent) {
          console.error('Failed to load exam status:', err);
          setStatusError(true);
        }
      } finally {
        if (!silent) setLoadingStatus(false);
      }
    },
    [studentId, handleAuthError]
  );

  const loadUpcoming = useCallback(
    async (page: number, silent = false) => {
      if (!studentId) return;
      if (!silent) {
        setLoadingUpcoming(true);
        setUpcomingError(false);
      }
      try {
        const upcomingResult = await studentDashboardApi.getAccessibleExams(studentId, page, 10);
        setUpcomingPage(upcomingResult);
        if (silent) setUpcomingError(false);
      } catch (err) {
        if (!handleAuthError(err) && !silent) {
          console.error('Failed to load accessible exams:', err);
          setUpcomingError(true);
        }
      } finally {
        if (!silent) setLoadingUpcoming(false);
      }
    },
    [studentId, handleAuthError]
  );

  const loadCompleted = useCallback(
    async (page: number) => {
      if (!studentId) return;
      setLoadingCompleted(true);
      setCompletedError(false);
      try {
        const completedResult = await studentDashboardApi.getCompletedAttempts(studentId, page, 10);
        setCompletedPage(completedResult);
      } catch (err) {
        if (!handleAuthError(err)) {
          console.error('Failed to load completed exams:', err);
          setCompletedError(true);
        }
      } finally {
        setLoadingCompleted(false);
      }
    },
    [studentId, handleAuthError]
  );

  useEffect(() => {
    loadStatus();
    loadUpcoming(1);
    loadCompleted(1);
  }, [loadStatus, loadUpcoming, loadCompleted]);

  // Which upcoming page the student is actually looking at, read by the poll below without
  // making the poll re-subscribe every time they page. A ref rather than a dependency because
  // restarting the interval on every page change would reset the countdown each click.
  const upcomingPageRef = useRef(1);
  upcomingPageRef.current = upcomingPage?.page || 1;

  // THE POLL — what makes a freshly triggered exam show up without a manual reload.
  //
  // Mirrors apiService's onSnapshot polling behaviour deliberately: pause entirely while the
  // tab is hidden (a backgrounded dashboard costs reads for a screen nobody is looking at),
  // and refetch immediately on the way back rather than waiting out the remaining interval —
  // which is also the common case of a student switching back to the tab to check.
  //
  // Completed history is NOT polled: it only changes as a result of this student submitting,
  // which navigates away from the dashboard and remounts this hook on return.
  useEffect(() => {
    if (!studentId) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const refresh = () => {
      loadStatus(true);
      // Only page 1 is polled. Replacing the list under a student who has paged forward would
      // move rows they are reading, and a deeper page can't contain a just-triggered exam
      // anyway — getUpcomingListItems puts attemptable items first.
      if (upcomingPageRef.current === 1) loadUpcoming(1, true);
    };

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(refresh, DASHBOARD_REFRESH_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        refresh();
        startPolling();
      }
    };

    if (!document.hidden) startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [studentId, loadStatus, loadUpcoming]);

  return {
    loadingStatus,
    inProgress,
    statusError,
    loadStatus,
    loadingUpcoming,
    upcomingPage,
    upcomingError,
    loadUpcoming,
    loadingCompleted,
    completedPage,
    completedError,
    loadCompleted
  };
}
