import { RequestAuth } from './auth/middleware';
import { clientDb, clientDoc, clientGetDoc } from './firestoreClient';

// ==========================================
// COLLECTION-LEVEL AUTHORIZATION (DB PROXY)
// ==========================================
// Every collection the app touches through /api/db/query and /api/db/write, and which
// roles may read/write it. Catalog-style content (exam listings, school directory,
// syllabus, question banks, login screen config) stays publicly readable because it's
// needed to render pre-login/pre-enrollment screens (the login page, and the invite-link
// "join this exam" preview) and carries no per-user secrets. Everything else requires a
// valid session, with tenant scoping enforced below for school/student roles.
export type ProxyRole = 'admin' | 'school' | 'student';

export const PUBLIC_READ_COLLECTIONS = new Set(['login_options', 'exams', 'schools', 'questions', 'syllabus']);

// `questions` docs carry the answer key (correctAnswerIndex, numericalAnswer) alongside the
// explanation shown post-submission — none of that may reach a caller who hasn't
// authenticated. The pre-login invite-link preview screen (StudentLinkEntry.tsx) only ever
// needs subject/marks to render its section breakdown, so stripping these fields for
// unauthenticated reads costs that screen nothing while closing an answer-key leak that
// would otherwise let anyone hit /api/db/query directly, no login required, and read every
// question's correct answer before (or during) the exam.
const ANSWER_REVEALING_FIELDS = ['correctAnswerIndex', 'numericalAnswer', 'explanation'];

// secure_exam_links holds exam-entry tokens — not publicly listable, but a pre-session
// visitor following an invite link must be able to look up the one doc matching their
// token to see the "join this exam" preview screen.
export const TOKEN_LOOKUP_COLLECTIONS = new Set(['secure_exam_links']);

export const COLLECTION_ACCESS: Record<string, { read: ProxyRole[]; write: ProxyRole[] }> = {
  users: { read: ['admin', 'school', 'student'], write: ['admin', 'school', 'student'] },
  // Per intended role model: school views exams/question papers only, does not author them.
  exams: { read: ['admin', 'school', 'student'], write: ['admin'] },
  questions: { read: ['admin', 'school', 'student'], write: ['admin'] },
  schools: { read: ['admin', 'school', 'student'], write: ['admin'] },
  attempts: { read: ['admin', 'school', 'student'], write: ['admin', 'school', 'student'] },
  results: { read: ['admin'], write: ['admin'] },
  admins: { read: ['admin'], write: [] },
  super_admins: { read: ['admin'], write: [] },
  allowed_schools: { read: ['admin'], write: ['admin'] },
  syllabus: { read: ['admin', 'school', 'student'], write: ['admin', 'school'] },
  invitations: { read: ['admin', 'school'], write: ['admin', 'school'] },
  notifications_queue: { read: ['admin'], write: ['admin'] },
  proctoring_logs: { read: ['admin', 'school'], write: ['admin', 'school', 'student'] },
  error_book: { read: ['admin', 'school'], write: ['admin', 'school'] },
  error_books: { read: ['admin', 'school', 'student'], write: ['admin', 'school', 'student'] },
  benchmarks: { read: ['admin'], write: ['admin'] },
  secure_exam_links: { read: ['admin', 'school', 'student'], write: ['admin', 'school'] },
  report_jobs: { read: ['admin', 'school'], write: ['admin', 'school'] }
};

// For non-admin roles, which field on each collection's documents must match the caller's
// own schoolId/uid. 'exams' is scoped by creatorId (the school that created it), not
// schoolId, since schools also legitimately read/act on exams assigned to them by admins.
export const SCOPE_FIELD: Record<string, { school?: string; student?: string }> = {
  users: { school: 'schoolId' },
  exams: { school: 'creatorId' },
  attempts: { school: 'schoolId', student: 'studentId' },
  syllabus: { school: 'schoolId' },
  invitations: { school: 'schoolId' },
  // proctoring_logs/error_books documents carry studentId but never schoolId in practice
  // (verified against actual write payloads) — school-role access to these is trusted at
  // the COLLECTION_ACCESS level rather than scope-injected, since injecting a schoolId
  // constraint that matches no document would silently break school's real query pattern
  // (querying by studentId, e.g. SchoolStudentOnboarding's per-student cascade delete).
  proctoring_logs: { student: 'studentId' },
  error_books: { student: 'studentId' },
  secure_exam_links: { school: 'schoolId' },
  report_jobs: { school: 'schoolId' }
};

// Encapsulates the DB-proxy authorization rules — the highest-stakes code in the app — as a
// single cohesive unit: the collection/scope config above (read via the class, not mutated),
// plus the owner-verification cache, which used to be a bare module-level Map. As a plain
// module-level variable, nothing outside this file *could* reach in and mutate it either, so
// wrapping it in the class doesn't change any security property — but it does put the cache's
// lifecycle and the methods that read/write it in one place with a clear boundary, instead of
// a Map floating at module scope beside unrelated exports.
class AuthorizationService {
  // Caches the verified owner value (e.g. a student's uid on their own attempt doc, or a
  // school's creatorId on an exam) for scoped-write ownership checks. Ownership fields are
  // never reassigned after doc creation in this app, so this is safe to trust for its TTL.
  // Exists to keep authorizeWrite() from doing an extra synchronous Firestore read on every
  // single write — critical during exam windows where up to ~100k students are each
  // autosaving their attempt doc every ~30s; without this cache that overhead would double
  // the read load on the hottest collection in the app for the entire exam duration.
  private readonly ownerVerificationCache = new Map<string, { value: string; expiry: number }>();
  private readonly OWNER_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — comfortably longer than an autosave gap

  sanitizeForPublicRead(collectionName: string, data: any): any {
    if (collectionName !== 'questions' || !data) return data;
    const sanitized = { ...data };
    for (const field of ANSWER_REVEALING_FIELDS) {
      delete sanitized[field];
    }
    return sanitized;
  }

  scopeFieldFor(collectionName: string, role: ProxyRole): string | undefined {
    const scope = SCOPE_FIELD[collectionName];
    if (!scope) return undefined;
    return role === 'school' ? scope.school : role === 'student' ? scope.student : undefined;
  }

  scopeValueFor(auth: RequestAuth, role: ProxyRole): string | null {
    return role === 'school' ? auth.schoolId : role === 'student' ? auth.uid : null;
  }

  // Injects (or validates) the tenant-scoping `where` constraint for a school/student read
  // query. Returns null if the caller already specified a scope constraint pointing at
  // someone else's data (hard block), otherwise returns the (possibly augmented) constraints.
  injectReadScope(auth: RequestAuth, collectionName: string, constraints: any[]): any[] | null {
    if (auth.role === 'admin') return constraints;
    const field = this.scopeFieldFor(collectionName, auth.role as ProxyRole);
    if (!field) return constraints;
    const requiredValue = this.scopeValueFor(auth, auth.role as ProxyRole);
    if (!requiredValue) return null;

    const existing = (constraints || []).find((constraint: any) => constraint.type === 'where' && constraint.field === field);
    if (existing) {
      return existing.op === '==' && existing.value === requiredValue ? constraints : null;
    }
    return [...(constraints || []), { type: 'where', field, op: '==', value: requiredValue }];
  }

  // Cache key includes scopeField because collections like `attempts` have TWO distinct scope
  // fields depending on caller role (schoolId for school, studentId for student) — without the
  // scopeField in the key, a student's autosave caching studentId and a school's later write
  // checking against schoolId would collide on the same cache entry, causing a false "you do
  // not own this document" 403 for the school (this is exactly what broke reattempt/regenerate
  // -link: the school's canReattempt write got rejected because a student's own studentId was
  // still cached under the same key).
  private getCachedOwner(collectionName: string, scopeField: string, docId: string): string | undefined {
    const key = `${collectionName}/${scopeField}/${docId}`;
    const cached = this.ownerVerificationCache.get(key);
    if (!cached) return undefined;
    if (cached.expiry < Date.now()) {
      this.ownerVerificationCache.delete(key);
      return undefined;
    }
    return cached.value;
  }

  private setCachedOwner(collectionName: string, scopeField: string, docId: string, value: string) {
    this.ownerVerificationCache.set(`${collectionName}/${scopeField}/${docId}`, { value, expiry: Date.now() + this.OWNER_CACHE_TTL_MS });
    // Opportunistic cleanup, same 1%-per-call pattern used for localSubmissionLocks below.
    if (Math.random() < 0.01) {
      const now = Date.now();
      for (const [key, entry] of this.ownerVerificationCache.entries()) {
        if (entry.expiry < now) this.ownerVerificationCache.delete(key);
      }
    }
  }

  // Authorizes a single /api/db/write operation for a non-admin caller. Admins bypass this
  // entirely. Returns the (possibly scope-injected) data to actually write, or a rejection.
  async authorizeWrite(
    auth: RequestAuth,
    type: string,
    collectionName: string,
    docId: string | undefined,
    data: any
  ): Promise<{ ok: true; data: any } | { ok: false; status: number; error: string }> {
    if (auth.role === 'admin') {
      return { ok: true, data };
    }

    const access = COLLECTION_ACCESS[collectionName];
    if (!access || !access.write.includes(auth.role as ProxyRole)) {
      return { ok: false, status: 403, error: 'Forbidden: role cannot write to this collection' };
    }

    // `users` is field-protected: role/permissions/schoolId may only be set by admins, except
    // that a school may create/manage its own student accounts (role forced to 'student',
    // schoolId forced to the caller's own school).
    if (collectionName === 'users') {
      if (auth.role === 'student') {
        if (docId !== auth.uid) {
          return { ok: false, status: 403, error: 'Forbidden: students may only update their own profile' };
        }
        if (data && ('role' in data || 'schoolId' in data || 'permissions' in data)) {
          return { ok: false, status: 403, error: 'Forbidden: students cannot change role, schoolId, or permissions' };
        }
        return { ok: true, data };
      }

      // school — may create/manage its own student accounts. `permissions` is never trusted
      // from the client here: it's forced to the fixed student default rather than rejected,
      // since onboarding (manual + bulk import) always sends it as part of a normal create.
      if (data && 'role' in data && data.role !== 'student') {
        return { ok: false, status: 403, error: 'Forbidden: schools may only manage student accounts' };
      }
      if (data && 'schoolId' in data && data.schoolId !== auth.schoolId) {
        return { ok: false, status: 403, error: 'Forbidden: schoolId must match your own school' };
      }
      if (docId) {
        const existingSnap = await clientGetDoc(clientDoc(clientDb, 'users', docId));
        if (existingSnap.exists()) {
          const existing = existingSnap.data() as any;
          if (existing.schoolId !== auth.schoolId || (existing.role && existing.role !== 'student')) {
            return { ok: false, status: 403, error: 'Forbidden: you may only manage your own students' };
          }
        }
      }
      return {
        ok: true,
        data: data
          ? {
              ...data,
              schoolId: auth.schoolId,
              role: 'student',
              ...('permissions' in data ? { permissions: ['take_exams'] } : {})
            }
          : data
      };
    }

    // `exams` is scoped by creatorId — a school may only create/edit exams it created.
    if (collectionName === 'exams') {
      if (docId) {
        const cachedCreator = this.getCachedOwner('exams', 'creatorId', docId);
        if (cachedCreator !== undefined) {
          if (cachedCreator !== auth.uid) {
            return { ok: false, status: 403, error: 'Forbidden: you may only modify exams you created' };
          }
        } else {
          const existingSnap = await clientGetDoc(clientDoc(clientDb, 'exams', docId));
          if (existingSnap.exists()) {
            const creatorId = (existingSnap.data() as any).creatorId;
            if (creatorId) this.setCachedOwner('exams', 'creatorId', docId, creatorId);
            if (creatorId !== auth.uid) {
              return { ok: false, status: 403, error: 'Forbidden: you may only modify exams you created' };
            }
          }
        }
      }
      if (data && 'creatorId' in data && data.creatorId !== auth.uid) {
        return { ok: false, status: 403, error: 'Forbidden: creatorId must match your own uid' };
      }
      return { ok: true, data: data ? { ...data, creatorId: auth.uid } : data };
    }

    // `questions` inherits authorization from its parent exam's creatorId.
    if (collectionName === 'questions') {
      let targetExamId = data?.examId;
      if (!targetExamId && docId) {
        const existingQ = await clientGetDoc(clientDoc(clientDb, 'questions', docId));
        if (existingQ.exists()) targetExamId = (existingQ.data() as any).examId;
      }
      if (!targetExamId) {
        return { ok: false, status: 400, error: 'Missing examId for question write' };
      }
      const cachedCreator = this.getCachedOwner('exams', 'creatorId', targetExamId);
      if (cachedCreator !== undefined) {
        if (cachedCreator !== auth.uid) {
          return { ok: false, status: 403, error: 'Forbidden: you may only manage questions on exams you created' };
        }
      } else {
        const examSnap = await clientGetDoc(clientDoc(clientDb, 'exams', targetExamId));
        const creatorId = examSnap.exists() ? (examSnap.data() as any).creatorId : undefined;
        if (creatorId) this.setCachedOwner('exams', 'creatorId', targetExamId, creatorId);
        if (!examSnap.exists() || creatorId !== auth.uid) {
          return { ok: false, status: 403, error: 'Forbidden: you may only manage questions on exams you created' };
        }
      }
      return { ok: true, data };
    }

    // Generic tenant-scoped collections: attempts, invitations, proctoring_logs, error_books,
    // secure_exam_links, report_jobs, syllabus. school scoped by schoolId, student by studentId.
    // Collections allowed in COLLECTION_ACCESS but with no scope field defined (e.g. error_book,
    // singular — deleted by studentId+examId, not schoolId) are trusted as-is: the caller
    // already had to reach a specific docId/query through a properly-scoped read elsewhere.
    const scopeField = this.scopeFieldFor(collectionName, auth.role as ProxyRole);
    if (!scopeField) {
      return { ok: true, data };
    }
    const requiredValue = this.scopeValueFor(auth, auth.role as ProxyRole);
    if (!requiredValue) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }

    if (!docId) {
      // Creating a new doc — inject/verify the scope field.
      const existingVal = data?.[scopeField];
      if (existingVal !== undefined && existingVal !== requiredValue) {
        return { ok: false, status: 403, error: 'Forbidden: scope mismatch' };
      }
      return { ok: true, data: { ...data, [scopeField]: requiredValue } };
    }

    // Updating/deleting/setting an existing doc — verify it currently belongs to the caller.
    // Checked against the owner cache first (see getCachedOwner comment) so that the highest-
    // frequency write in the app — a student's attempt-doc autosave, every ~30s per active
    // exam-taker — does one real Firestore read per attempt, not one per autosave.
    const cachedOwner = this.getCachedOwner(collectionName, scopeField, docId);
    if (cachedOwner !== undefined) {
      if (cachedOwner !== requiredValue) {
        return { ok: false, status: 403, error: 'Forbidden: you do not own this document' };
      }
      if (data && data[scopeField] !== undefined && data[scopeField] !== requiredValue) {
        return { ok: false, status: 403, error: 'Forbidden: cannot move document out of your scope' };
      }
      return { ok: true, data };
    }

    // A doc that simply doesn't carry the scope field (e.g. proctoring_logs/error_books have
    // no schoolId of their own) is allowed through rather than blocked, since reaching a
    // specific docId already required a properly-scoped read (e.g. the parent attempt/exam).
    const existingSnap = await clientGetDoc(clientDoc(clientDb, collectionName, docId));
    if (existingSnap.exists()) {
      const existing = existingSnap.data() as any;
      if (existing[scopeField] !== undefined) {
        this.setCachedOwner(collectionName, scopeField, docId, existing[scopeField]);
      }
      if (existing[scopeField] !== undefined && existing[scopeField] !== requiredValue) {
        return { ok: false, status: 403, error: 'Forbidden: you do not own this document' };
      }
    }
    if (data && data[scopeField] !== undefined && data[scopeField] !== requiredValue) {
      return { ok: false, status: 403, error: 'Forbidden: cannot move document out of your scope' };
    }
    return { ok: true, data };
  }
}

export const authorizationService = new AuthorizationService();

// Backward-compatible named exports — every existing call site (routes + tests) keeps
// working unchanged; these are just bound references to the singleton's methods, same
// pattern as the DAO singletons in server/dao/index.ts.
export const sanitizeForPublicRead = authorizationService.sanitizeForPublicRead.bind(authorizationService);
export const scopeFieldFor = authorizationService.scopeFieldFor.bind(authorizationService);
export const scopeValueFor = authorizationService.scopeValueFor.bind(authorizationService);
export const injectReadScope = authorizationService.injectReadScope.bind(authorizationService);
export const authorizeWrite = authorizationService.authorizeWrite.bind(authorizationService);
