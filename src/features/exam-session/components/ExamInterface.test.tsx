import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attempt, Exam, Question } from '../../../types';

/**
 * Regression cover for how the exam screen renders each question TYPE.
 *
 * This is the gap that actually shipped: a 'numerical' question is authored with
 * `options: []` and `correctAnswerIndex: -1`, and the screen only ever mapped over
 * `options` — so the student saw the question text with no way to answer it, while
 * scoreExam happily graded the (always empty) answer. Nothing caught it because there
 * were no frontend tests at all.
 */

// ---------------------------------------------------------------------------
// Fixtures the fake Firestore below serves
// ---------------------------------------------------------------------------
const ATTEMPT_ID = 'attempt-1';

const attempt: Attempt = {
  id: ATTEMPT_ID,
  examId: 'exam-1',
  studentId: 'student-1',
  studentName: 'Test Student',
  status: 'in-progress',
  answers: [],
  score: 0,
  // `startTime`, not `startedAt` — that is the field types.ts declares and the one the
  // server actually writes. The fixture drifted, so every render in this file had a
  // NaN countdown and no test noticed.
  startTime: new Date().toISOString()
} as unknown as Attempt;

const exam: Exam = {
  id: 'exam-1',
  title: 'Physics Mock',
  subject: 'Physics',
  duration: 60,
  totalMarks: 8
} as unknown as Exam;

let questions: Question[] = [];

// ---------------------------------------------------------------------------
// Module mocks — every Firestore call in this component goes through ../lib/firebase,
// so faking that single module is enough to drive the whole load path.
// ---------------------------------------------------------------------------
const snap = (data: unknown, id: string) => ({ id, exists: () => data !== null, data: () => data });

vi.mock('../../../lib/firebase', () => ({
  db: {},
  OperationType: { GET: 'GET', UPDATE: 'UPDATE', CREATE: 'CREATE' },
  handleFirestoreError: vi.fn(),
  collection: (_db: unknown, name: string) => ({ name }),
  query: (ref: unknown) => ref,
  where: () => ({}),
  doc: (_db: unknown, name: string, id: string) => ({ name, id }),
  getDoc: async (ref: { name: string; id: string }) => {
    if (ref.name === 'attempts') return snap(attempt, ref.id);
    if (ref.name === 'exams') return snap(exam, ref.id);
    return snap(null, ref.id);
  },
  getDocs: async () => ({ docs: questions.map((q) => snap(q, q.id!)) }),
  updateDoc: vi.fn(async () => {}),
  setDoc: vi.fn(async () => {}),
  addDoc: vi.fn(async () => ({ id: 'new-doc' })),
  writeBatch: () => ({ set: vi.fn(), update: vi.fn(), commit: vi.fn(async () => {}) }),
  onSnapshot: () => () => {}
}));

// navigate must be a STABLE reference. The component's fetchData useCallback lists it as a
// dependency, so returning a fresh vi.fn() per render would re-run the load effect on every
// render and reset answers state — the component would look broken when only the mock was.
const navigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useParams: () => ({ attemptId: ATTEMPT_ID }),
  useNavigate: () => navigate
}));

vi.mock('../../../lib/AuthContext', () => ({ useAuth: () => ({ signOut: vi.fn() }) }));

const syncAnswers = vi.fn(async () => {});

vi.mock('./ExamSyncContext', () => ({
  // ExamInterface wraps its own core in ExamSyncProvider, so the mock has to supply the
  // provider as well as the hook, otherwise the component cannot even mount.
  ExamSyncProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useExamSync: () => ({
    isOnline: true,
    isSynced: true,
    syncAnswers,
    forceBackgroundSync: vi.fn(async () => {})
  })
}));

vi.mock('../../../services/api', () => ({ examAnswerQueue: { enqueue: vi.fn(), flush: vi.fn(async () => {}) } }));

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

vi.mock('../../../lib/customErrors', () => ({ reportClientCrash: vi.fn() }));

import { ExamInterface } from './ExamInterface';
import { updateDoc } from '../../../lib/firebase';

const updateDocMock = updateDoc as unknown as ReturnType<typeof vi.fn>;

const mcq = (over: Partial<Question> = {}): Question =>
  ({
    id: 'q-mcq',
    examId: 'exam-1',
    text: 'Which force keeps a satellite in orbit?',
    options: ['Gravity', 'Friction', 'Tension', 'Normal'],
    correctAnswerIndex: 0,
    marks: 4,
    type: 'single',
    ...over
  }) as Question;

const numerical = (over: Partial<Question> = {}): Question =>
  ({
    id: 'q-num',
    examId: 'exam-1',
    text: 'State the acceleration due to gravity in m/s^2.',
    // Exactly how ExamQuestions.tsx persists a numerical question.
    options: [],
    correctAnswerIndex: -1,
    numericalAnswer: '9.81',
    marks: 4,
    type: 'numerical',
    ...over
  }) as Question;

/**
 * The exam is gated behind a proctoring lockout screen that demands fullscreen before any
 * question renders. jsdom implements no Fullscreen API, so the component takes its own
 * documented fallback branch and simply flips the flag — the test just has to click through.
 */
async function renderExamAndEnter() {
  render(<ExamInterface />);
  const enterButton = await screen.findByRole('button', { name: /enter secure exam mode/i });
  await userEvent.click(enterButton);
}

beforeEach(() => {
  localStorage.clear();
  updateDocMock.mockClear();
});

describe('ExamInterface question rendering', () => {
  it('renders one selectable option button per choice for an MCQ', async () => {
    questions = [mcq()];
    await renderExamAndEnter();

    expect(await screen.findByText('Which force keeps a satellite in orbit?')).toBeInTheDocument();
    for (const option of ['Gravity', 'Friction', 'Tension', 'Normal']) {
      expect(screen.getByText(option)).toBeInTheDocument();
    }
  });

  it('gives a numerical question an input to answer with', async () => {
    questions = [numerical()];
    await renderExamAndEnter();

    expect(await screen.findByText('State the acceleration due to gravity in m/s^2.')).toBeInTheDocument();

    // The actual regression: this question type has no options, so without a dedicated
    // input the student is shown a question they cannot answer at all.
    const input = await screen.findByLabelText(/your answer/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('inputmode', 'decimal');
  });

  it('does not claim a wrong answer costs marks', async () => {
    questions = [mcq()];
    await renderExamAndEnter();

    await screen.findByText('Which force keeps a satellite in orbit?');

    // Scoring never deducts (see shared/examScoring.test.ts). The screen used to display a
    // hard-coded "-1" next to the marks, telling every student the opposite.
    expect(screen.getByText(/no negative marking/i)).toBeInTheDocument();
    expect(screen.queryByText('-1')).not.toBeInTheDocument();
  });

  it('records what the student types into a numerical answer', async () => {
    questions = [numerical()];
    await renderExamAndEnter();

    const input = await screen.findByLabelText(/your answer/i);
    await userEvent.type(input, '9.81');

    expect(input).toHaveValue('9.81');
    // The answer must reach the sync layer, not just component state — that is what survives
    // a refresh and what the server later rescores.
    await waitFor(() => expect(syncAnswers).toHaveBeenCalled());
    const lastCall = syncAnswers.mock.calls.at(-1) as unknown as [unknown[], string];
    expect(lastCall[0][0]).toBe('9.81');
  });

  it('shows the exam title and question position once loaded', async () => {
    questions = [mcq(), numerical()];
    await renderExamAndEnter();

    expect(await screen.findByText('Physics Mock')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Q 1 \/ 2/)).toBeInTheDocument());
  });
});

describe('the 30-second autosave tick', () => {
  // Both properties here are about what the tick WRITES, and both are load-bearing at exam
  // scale rather than cosmetic — see the effect's own comments in ExamInterface.tsx.
  it("sends status:'in-progress' on the first tick only, then stops re-writing it", async () => {
    questions = [mcq()];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderExamAndEnter();
      await screen.findByText('Which force keeps a satellite in orbit?');
      updateDocMock.mockClear();

      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(updateDocMock).toHaveBeenCalledTimes(1));
      expect(updateDocMock.mock.calls[0][1]).toMatchObject({ status: 'in-progress' });

      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(updateDocMock.mock.calls.length).toBeGreaterThan(1));

      // Every write of `status` touches a single-field index with three distinct values across
      // the whole attempts collection — a hot range Firestore throttles at roughly 500
      // writes/sec. Re-sending an unchanged value every 30s made that the dominant index write
      // of the entire exam window.
      const laterCalls = updateDocMock.mock.calls.slice(1);
      for (const [, payload] of laterCalls) {
        expect(payload).not.toHaveProperty('status');
        expect(payload).toHaveProperty('timePerQuestion');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops ticking once a submission has been made', async () => {
    questions = [mcq()];
    // Timers must be faked BEFORE the component mounts: advanceTimersByTime cannot advance an
    // interval that was created against the real clock, so installing them afterwards makes
    // the assertion below unfalsifiable rather than strict.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      await renderExamAndEnter();
      await screen.findByText('Which force keeps a satellite in orbit?');

      await user.click(screen.getByRole('button', { name: /^submit exam$/i }));
      await user.click(await screen.findByRole('button', { name: /yes, submit exam/i }));
      await waitFor(() => expect(updateDocMock.mock.calls.some(([, p]: any[]) => p.status === 'completed')).toBe(true));

      updateDocMock.mockClear();

      // A tick landing after this point would write status:'in-progress' over the
      // status:'submitted' the submission just persisted, after which the grading worker
      // (server/lib/taskQueue.ts) refuses to grade the attempt and leaves it silently
      // unscored. Two things stop it — handleSubmit's setLoading(true), which the effect
      // depends on, and hasSubmittedRef, which survives loading being reset — and this pins
      // the behaviour rather than either mechanism.
      await vi.advanceTimersByTimeAsync(90_000);
      expect(updateDocMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('accessibility of the exam screen', () => {
  // The countdown is the single most important piece of state on this screen, and it was
  // conveyed only as "12:30" inside a div — no role, and read aloud as a clock time rather
  // than a duration.
  it('exposes the countdown as a timer with a spoken duration, not a clock time', async () => {
    await renderExamAndEnter();

    const timer = await screen.findByRole('timer');

    // 60-minute fixture, so the label is minutes + seconds remaining, spelled out.
    expect(timer).toHaveAttribute('aria-label', expect.stringMatching(/minutes? \d+ seconds? remaining/));
    expect(timer.getAttribute('aria-label')).not.toMatch(/^\d+:\d+$/);
  });

  // Everything this screen tells the student about the safety of their answers — autosave,
  // time running out, the connection dropping — was visual or toast-only.
  it('renders a polite live region for autosave and connection status', async () => {
    await renderExamAndEnter();

    const status = await screen.findByRole('status');

    expect(status).toHaveAttribute('aria-live', 'polite');
    // Present from mount, not injected when it first has something to say — a live region
    // added at announce-time is frequently missed by assistive tech.
    expect(status).toBeInTheDocument();
  });

  it('announces the result of an autosave tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderExamAndEnter();

      await vi.advanceTimersByTimeAsync(30_000);

      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/answers saved/i));
    } finally {
      vi.useRealTimers();
    }
  });
});
