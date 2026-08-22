import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { studentDashboardApi, PagedResult } from '../services/api';

export type ExamCandidate = { exam: any; attempt: any | null };
export type UpcomingItem = { examId: string; subject: string; locked: boolean; exam?: any; attempt?: any | null };

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

  const loadStatus = useCallback(async () => {
    if (!studentId) return;
    setLoadingStatus(true);
    setStatusError(false);
    try {
      const statusResponse = await studentDashboardApi.getStatus(studentId);
      setInProgress(statusResponse.inProgress);
    } catch (err) {
      if (!handleAuthError(err)) {
        console.error('Failed to load exam status:', err);
        setStatusError(true);
      }
    } finally {
      setLoadingStatus(false);
    }
  }, [studentId, handleAuthError]);

  const loadUpcoming = useCallback(
    async (page: number) => {
      if (!studentId) return;
      setLoadingUpcoming(true);
      setUpcomingError(false);
      try {
        const upcomingResult = await studentDashboardApi.getAccessibleExams(studentId, page, 10);
        setUpcomingPage(upcomingResult);
      } catch (err) {
        if (!handleAuthError(err)) {
          console.error('Failed to load accessible exams:', err);
          setUpcomingError(true);
        }
      } finally {
        setLoadingUpcoming(false);
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
