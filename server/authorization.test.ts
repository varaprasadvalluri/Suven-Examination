import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestAuth } from './auth/middleware';

// authorization.ts talks to Firestore only through these functions — mocking them lets us
// test the actual authorization logic (the highest-stakes code in the app) without a real
// Firestore connection, and lets each test control exactly what "existing doc" looks like.
vi.mock('./firestoreClient', () => ({
  clientDb: { type: 'db' },
  clientDoc: (_db: any, collectionName: string, id: string) => ({ type: 'doc', collectionName, id }),
  clientGetDoc: vi.fn()
}));

import { clientGetDoc } from './firestoreClient';
import { injectReadScope, authorizeWrite, sanitizeForPublicRead } from './authorization';

const mockGetDoc = clientGetDoc as unknown as ReturnType<typeof vi.fn>;

function notFound() {
  return { exists: () => false, data: () => null };
}

function found(data: any) {
  return { exists: () => true, data: () => data };
}

const admin: RequestAuth = { uid: 'admin-1', email: 'admin@x.com', role: 'admin', schoolId: null };
const schoolA: RequestAuth = { uid: 'school-uid-a', email: 'a@school.com', role: 'school', schoolId: 'school-A' };
const schoolB: RequestAuth = { uid: 'school-uid-b', email: 'b@school.com', role: 'school', schoolId: 'school-B' };
const studentA: RequestAuth = { uid: 'student-a', email: 's@a.com', role: 'student', schoolId: 'school-A' };

beforeEach(() => {
  mockGetDoc.mockReset();
});

describe('injectReadScope', () => {
  it('admin queries pass through unchanged', () => {
    const constraints = [{ type: 'where', field: 'foo', op: '==', value: 'bar' }];
    expect(injectReadScope(admin, 'attempts', constraints)).toBe(constraints);
  });

  it('school with no existing scope constraint gets schoolId injected', () => {
    const result = injectReadScope(schoolA, 'attempts', []);
    expect(result).toEqual([{ type: 'where', field: 'schoolId', op: '==', value: 'school-A' }]);
  });

  it('school query already scoped to own schoolId passes through unchanged', () => {
    const constraints = [{ type: 'where', field: 'schoolId', op: '==', value: 'school-A' }];
    expect(injectReadScope(schoolA, 'attempts', constraints)).toBe(constraints);
  });

  it('school query scoped to a DIFFERENT school is hard-blocked (returns null)', () => {
    const constraints = [{ type: 'where', field: 'schoolId', op: '==', value: 'school-B' }];
    expect(injectReadScope(schoolA, 'attempts', constraints)).toBeNull();
  });

  it('student queries get studentId injected, scoped by uid not schoolId', () => {
    const result = injectReadScope(studentA, 'attempts', []);
    expect(result).toEqual([{ type: 'where', field: 'studentId', op: '==', value: 'student-a' }]);
  });
});

describe('authorizeWrite: admin', () => {
  it('bypasses all checks, including on collections with no write access configured', async () => {
    const decision = await authorizeWrite(admin, 'set', 'users', 'anyone', { role: 'admin' });
    expect(decision).toEqual({ ok: true, data: { role: 'admin' } });
    expect(mockGetDoc).not.toHaveBeenCalled();
  });
});

describe('authorizeWrite: users collection', () => {
  it('student may update their own profile without touching role/schoolId/permissions', async () => {
    const decision = await authorizeWrite(studentA, 'update', 'users', 'student-a', { name: 'New Name' });
    expect(decision.ok).toBe(true);
  });

  it("student cannot update a different uid's profile", async () => {
    const decision = await authorizeWrite(studentA, 'update', 'users', 'someone-else', { name: 'X' });
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });

  it('student cannot self-escalate role, schoolId, or permissions', async () => {
    for (const field of ['role', 'schoolId', 'permissions']) {
      const decision = await authorizeWrite(studentA, 'update', 'users', 'student-a', { [field]: 'admin' });
      expect(decision).toMatchObject({ ok: false, status: 403 });
    }
  });

  it('school creating a new student gets schoolId/role forced and permissions forced to the safe default (regression: this was the onboarding-blocking bug)', async () => {
    // Onboarding always writes to a deterministic docId (std_{schoolId}_{rollNumber}) even
    // for a brand-new student, so the code does an existence check regardless — not found.
    mockGetDoc.mockResolvedValueOnce(notFound());
    const decision = await authorizeWrite(schoolA, 'set', 'users', 'new-student-id', {
      name: 'New Kid',
      role: 'student',
      schoolId: 'school-A',
      permissions: ['whatever', 'client', 'sent']
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.data.permissions).toEqual(['take_exams']);
      expect(decision.data.schoolId).toBe('school-A');
      expect(decision.data.role).toBe('student');
    }
  });

  it('school cannot set role to anything other than student', async () => {
    const decision = await authorizeWrite(schoolA, 'set', 'users', 'x', { role: 'admin' });
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });

  it("school cannot write into another school's scope", async () => {
    const decision = await authorizeWrite(schoolA, 'set', 'users', 'x', { schoolId: 'school-B' });
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });

  it('school cannot modify an existing student belonging to a different school', async () => {
    mockGetDoc.mockResolvedValueOnce(found({ schoolId: 'school-B', role: 'student' }));
    const decision = await authorizeWrite(schoolA, 'update', 'users', 'someone-in-school-b', { name: 'X' });
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });
});

describe('authorizeWrite: exams collection', () => {
  // COLLECTION_ACCESS currently restricts exam writes to admin only ({ write: ['admin'] }),
  // and admin bypasses authorizeWrite entirely before reaching any collection-specific
  // logic. That means the creatorId-ownership-scoping block inside authorizeWrite's `exams`
  // branch is presently unreachable by any real caller — worth knowing, not a bug being
  // asserted here, just documented by this test matching actual current behavior.
  it('school cannot write to exams at all (write access is admin-only)', async () => {
    const decision = await authorizeWrite(schoolA, 'add', 'exams', undefined, { title: 'Test' });
    expect(decision).toMatchObject({ ok: false, status: 403 });
    expect(mockGetDoc).not.toHaveBeenCalled();
  });
});

describe('authorizeWrite: generic tenant-scoped collections (attempts) — owner-cache regression', () => {
  // This is the exact bug fixed this session: attempts has TWO different scope fields
  // depending on caller role (schoolId for school, studentId for student). The owner-
  // verification cache used to be keyed only by collection/docId, so a student's cached
  // studentId would collide with a school's later write to the SAME doc, incorrectly
  // rejecting the school with "you do not own this document". The fix keys the cache by
  // scope field too. This test proves a student write followed by a school write to the
  // same attempt doc doesn't cross-contaminate.
  it('a student write followed by a school write to the same doc do not collide via the owner cache', async () => {
    const docId = 'shared-attempt-doc';

    // 1. Student writes their own attempt (populates the cache under the *studentId* scope).
    mockGetDoc.mockResolvedValueOnce(found({ studentId: 'student-a', schoolId: 'school-A' }));
    const studentDecision = await authorizeWrite(studentA, 'update', 'attempts', docId, { answers: [1, 2] });
    expect(studentDecision.ok).toBe(true);

    // 2. School writes to the SAME doc (e.g. setting canReattempt) — must do its own fresh
    // lookup keyed by *schoolId*, not reuse the student's cached value under a collided key.
    mockGetDoc.mockResolvedValueOnce(found({ studentId: 'student-a', schoolId: 'school-A' }));
    const schoolDecision = await authorizeWrite(schoolA, 'update', 'attempts', docId, { canReattempt: true });
    expect(schoolDecision.ok).toBe(true);

    // Confirms the school write actually triggered its own Firestore read (proves it wasn't
    // wrongly short-circuited by student's cache entry).
    expect(mockGetDoc).toHaveBeenCalledTimes(2);
  });

  it("school write to another school's attempt is rejected", async () => {
    mockGetDoc.mockResolvedValueOnce(found({ studentId: 'student-x', schoolId: 'school-B' }));
    const decision = await authorizeWrite(schoolA, 'update', 'attempts', 'other-schools-attempt', { canReattempt: true });
    expect(decision).toMatchObject({ ok: false, status: 403 });
  });

  it('student creating a new attempt gets studentId scope injected', async () => {
    const decision = await authorizeWrite(studentA, 'set', 'attempts', undefined, { examId: 'exam-1' });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.data.studentId).toBe('student-a');
  });
});

describe('sanitizeForPublicRead', () => {
  // `questions` is publicly readable pre-login (StudentLinkEntry.tsx's invite preview needs
  // subject/marks breakdown before the student has a session) — but the answer key must
  // never go out with it. This is the fix for that leak.
  it('strips the answer key and explanation from a public questions read', () => {
    const raw = {
      text: 'What is 2+2?',
      options: ['3', '4', '5', '6'],
      correctAnswerIndex: 1,
      numericalAnswer: '4',
      explanation: 'Basic arithmetic.',
      marks: 4,
      subject: 'Math'
    };
    const sanitized = sanitizeForPublicRead('questions', raw);
    expect(sanitized).not.toHaveProperty('correctAnswerIndex');
    expect(sanitized).not.toHaveProperty('numericalAnswer');
    expect(sanitized).not.toHaveProperty('explanation');
    // Fields the pre-login preview screen actually needs must survive.
    expect(sanitized.marks).toBe(4);
    expect(sanitized.subject).toBe('Math');
    expect(sanitized.text).toBe('What is 2+2?');
  });

  it('leaves other collections untouched', () => {
    const raw = { name: 'Some School', region: 'North' };
    expect(sanitizeForPublicRead('schools', raw)).toEqual(raw);
  });

  it('is a no-op on null/undefined data', () => {
    expect(sanitizeForPublicRead('questions', null)).toBeNull();
    expect(sanitizeForPublicRead('questions', undefined)).toBeUndefined();
  });
});
