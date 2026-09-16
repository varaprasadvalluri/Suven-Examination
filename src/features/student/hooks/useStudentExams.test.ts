import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression cover for the bug this hook exists to not have: the dashboard fetched ONCE on
 * mount and never again. A school triggers a paper (one `secure_exam_links` write, see
 * StudentDashboardService's Method A), and a student already sitting on /student/dashboard
 * saw nothing at all until they manually reloaded the page.
 *
 * These tests drive the poll with fake timers rather than waiting real seconds.
 */

const getStatus = vi.fn();
const getAccessibleExams = vi.fn();
const getCompletedAttempts = vi.fn();

vi.mock('../../../services/api', () => ({
  studentDashboardApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getAccessibleExams: (...args: unknown[]) => getAccessibleExams(...args),
    getCompletedAttempts: (...args: unknown[]) => getCompletedAttempts(...args)
  }
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

import { useStudentExams } from './useStudentExams';

const POLL_MS = 20000;

const page = (items: unknown[], pageNumber = 1) => ({
  items,
  page: pageNumber,
  pageSize: 10,
  total: items.length,
  totalPages: 1
});

// `document.hidden` is a getter on the prototype, so it can't be assigned directly.
const setTabHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.clearAllMocks();
  getStatus.mockResolvedValue({ inProgress: null });
  getAccessibleExams.mockResolvedValue(page([]));
  getCompletedAttempts.mockResolvedValue(page([]));
  setTabHidden(false);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useStudentExams polling', () => {
  it('picks up an exam triggered after mount without a page reload', async () => {
    const { result } = renderHook(() => useStudentExams('student-1'));

    await waitFor(() => expect(result.current.loadingUpcoming).toBe(false));
    expect(result.current.upcomingPage?.items).toEqual([]);

    // The school triggers the paper somewhere between two polls.
    const triggered = { examId: 'exam-1', subject: 'Physics', locked: false, exam: { id: 'exam-1' }, attempt: null };
    getAccessibleExams.mockResolvedValue(page([triggered]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });

    await waitFor(() => expect(result.current.upcomingPage?.items).toEqual([triggered]));
  });

  it('does not flip the list back to a loading skeleton on a background poll', async () => {
    const { result } = renderHook(() => useStudentExams('student-1'));
    await waitFor(() => expect(result.current.loadingUpcoming).toBe(false));

    const loadingStates: boolean[] = [];
    getAccessibleExams.mockImplementation(async () => {
      loadingStates.push(result.current.loadingUpcoming);
      return page([]);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });

    expect(loadingStates).toEqual([false]);
  });

  it('keeps rendering the last good list when one background poll fails', async () => {
    const item = { examId: 'exam-1', subject: 'Physics', locked: false };
    getAccessibleExams.mockResolvedValue(page([item]));

    const { result } = renderHook(() => useStudentExams('student-1'));
    await waitFor(() => expect(result.current.upcomingPage?.items).toEqual([item]));

    getAccessibleExams.mockRejectedValue(new Error('network blip'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });

    expect(result.current.upcomingError).toBe(false);
    expect(result.current.upcomingPage?.items).toEqual([item]);
  });

  it('stops polling while the tab is hidden and catches up immediately on return', async () => {
    const { result } = renderHook(() => useStudentExams('student-1'));
    await waitFor(() => expect(result.current.loadingUpcoming).toBe(false));

    const callsAfterMount = getStatus.mock.calls.length;

    act(() => setTabHidden(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    });
    expect(getStatus.mock.calls.length).toBe(callsAfterMount);

    await act(async () => {
      setTabHidden(false);
    });
    await waitFor(() => expect(getStatus.mock.calls.length).toBe(callsAfterMount + 1));
  });

  it('leaves a student who has paged forward on their own page', async () => {
    const { result } = renderHook(() => useStudentExams('student-1'));
    await waitFor(() => expect(result.current.loadingUpcoming).toBe(false));

    getAccessibleExams.mockResolvedValue(page([], 2));
    await act(async () => {
      await result.current.loadUpcoming(2);
    });
    await waitFor(() => expect(result.current.upcomingPage?.page).toBe(2));

    const callsBeforePoll = getAccessibleExams.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    });

    // Status still polls (that is how a live attempt is noticed); the list does not.
    expect(getAccessibleExams.mock.calls.length).toBe(callsBeforePoll);
    expect(getStatus.mock.calls.length).toBeGreaterThan(1);
  });

  it('sends an expired session to /login instead of rendering an empty dashboard', async () => {
    getStatus.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));

    renderHook(() => useStudentExams('student-1'));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login'));
    expect(toastError).toHaveBeenCalled();
  });
});
