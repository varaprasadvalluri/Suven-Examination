import express from 'express';
import { randomUUID } from 'node:crypto';
import { generateEduKey } from '../../../../../shared/idGenerator';
import { signSessionToken, signGatekeeperTicket, verifyGatekeeperTicket } from '../../../../application/services/tokens';
import { gatekeeperLookupLimiter, gatekeeperEnrollLimiter } from '../middleware/rateLimit';
import { LOAD_TEST_SECRET } from '../../../../config';
import { asyncHandler } from '../middleware/errorHandler';
import { logger } from '../../../../lib/logger';
import { mockLoadTestStore } from '../../../../lib/loadTestStore';
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  GoneError,
  UnprocessableEntityError
} from '../../../../lib/errors';
import { isAttemptFinished, isReopenedBySchoolLink } from '../../../../../shared/attemptStatus';
import {
  clientDb,
  clientCollection,
  clientDoc,
  clientGetDoc,
  clientGetDocs,
  clientSetDoc,
  clientUpdateDoc,
  clientQuery,
  clientWhere,
  clientRunTransaction
} from '../../../out/firestore/firestoreClient';

const router = express.Router();

// Single failure message for every rejected student-login attempt (unknown roll number, wrong
// name, wrong DOB). One shared string is what keeps the responses indistinguishable — see the
// enumeration-oracle note on the student-login route below. It names both failure modes so an
// un-onboarded student still knows what to do without the response disclosing which one it was.
const STUDENT_LOGIN_FAILURE_MESSAGE =
  "We couldn't verify those details. Check your Full Name and Register / Roll Number, or ask your school to onboard you if you haven't been added yet.";

// Pre-session identity verification for the invite-link student flow: resolves (or
// auto-onboards) a student by roll number + school, exactly mirroring what the client used
// to do via direct (now-unauthenticated-blocked) Firestore calls to the `users` collection.
// Runs before any session exists — same trust model as /api/gatekeeper/enroll itself, which
// is the only reason this needs to be its own public route rather than going through the
// now-authenticated /api/db/query proxy.
/**
 * @openapi
 * /api/gatekeeper/verify-identity:
 *   post:
 *     summary: Resolve (or auto-onboard) a student by roll number + school for the invite-link entry flow
 *     description: Pre-session route — runs before any session token exists, so it is intentionally public. Rate-limited (gatekeeperLookupLimiter).
 *     tags: [Gatekeeper]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rollNumber, schoolId, username]
 *             properties:
 *               rollNumber: { type: string }
 *               schoolId: { type: string }
 *               username: { type: string }
 *     responses:
 *       200:
 *         description: Resolved (or newly auto-onboarded) student profile
 *       400:
 *         description: Missing rollNumber, schoolId, or username
 *       500:
 *         description: Server/Firestore error
 */
router.post(
  ['/api/v1/exam-entry/identity/verify', '/api/gatekeeper/verify-identity'],
  gatekeeperLookupLimiter,
  asyncHandler(async (req, res) => {
    const { rollNumber, schoolId: finalSchoolId, username } = req.body;
    if (!rollNumber || !finalSchoolId || !username) {
      throw new BadRequestError('Missing rollNumber, schoolId, or username.');
    }

    const usersRef = clientCollection(clientDb, 'users');
    let querySnap = await clientGetDocs(
      clientQuery(
        usersRef,
        clientWhere('schoolId', '==', finalSchoolId),
        clientWhere('rollNumber', '==', rollNumber.trim()),
        clientWhere('role', '==', 'student')
      )
    );

    if (querySnap.empty) {
      querySnap = await clientGetDocs(
        clientQuery(usersRef, clientWhere('rollNumber', '==', rollNumber.trim()), clientWhere('role', '==', 'student'))
      );
    }

    let profileData: any;

    if (!querySnap.empty) {
      const matchedDoc = querySnap.docs[0];
      const matchedStudentData = matchedDoc.data() as any;

      profileData = {
        uid: matchedDoc.id,
        id: matchedDoc.id,
        ...matchedStudentData,
        name: matchedStudentData.name || username.trim(),
        schoolId: matchedStudentData.schoolId || finalSchoolId
      };
    } else {
      // Auto-onboard student for seamless link entry
      const newStudentId = generateEduKey('users');
      profileData = {
        uid: newStudentId,
        id: newStudentId,
        name: username.trim(),
        rollNumber: rollNumber.trim(),
        schoolId: finalSchoolId,
        role: 'student',
        permissions: ['take_exams'],
        createdAt: new Date().toISOString(),
        class: 'Adaptive Grade'
      };
      await clientSetDoc(clientDoc(clientDb, 'users', newStudentId), profileData);
    }

    const verificationTicket = signGatekeeperTicket({
      uid: profileData.uid,
      schoolId: profileData.schoolId,
      rollNumber: profileData.rollNumber
    });

    return res.status(200).json({ success: true, profileData, verificationTicket });
  })
);

// Pre-session metadata lookup for the per-student invite-link flow (`/login?invite=<token>`,
// generated by SchoolStudentOnboarding.tsx). Mirrors the old client-side direct-Firestore
// version exactly, just moved server-side since `invitations`/`users` now require a session.
/**
 * @openapi
 * /api/gatekeeper/invite-metadata:
 *   post:
 *     summary: Look up invite/student/school metadata for a per-student invite link
 *     description: Pre-session route (invitations/users require a session for direct access, so this proxies the lookup). Public. Rate-limited (gatekeeperLookupLimiter).
 *     tags: [Gatekeeper]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [inviteToken]
 *             properties:
 *               inviteToken: { type: string }
 *     responses:
 *       200:
 *         description: Invite data, resolved student profile, and school (if any)
 *       400:
 *         description: Missing inviteToken
 *       404:
 *         description: Invite is invalid or expired
 *       422:
 *         description: Invite exists but is missing required schoolId
 *       500:
 *         description: Server/Firestore error
 */
router.post(
  ['/api/v1/exam-entry/invitations/lookup', '/api/gatekeeper/invite-metadata'],
  gatekeeperLookupLimiter,
  asyncHandler(async (req, res) => {
    const { inviteToken } = req.body;
    if (!inviteToken) {
      throw new BadRequestError('Missing inviteToken.');
    }

    const inviteSnap = await clientGetDoc(clientDoc(clientDb, 'invitations', inviteToken));

    if (!inviteSnap.exists()) {
      // Previously fell back to a schoolless, platform-wide roll-number search — that let
      // anyone with zero information (no valid invite needed) query any student's profile
      // by guessing a roll number, with no tenant boundary. A broken/expired link should
      // fail cleanly instead; the properly-scoped exam-entry link is unaffected.
      throw new NotFoundError('This invitation link is invalid or has expired. Please contact your school for a new link.');
    }

    const iData = { id: inviteSnap.id, ...inviteSnap.data() } as any;
    if (!iData.schoolId) {
      // A school is required to scope this invite — silently defaulting to a placeholder
      // school here would previously have attached the student to the wrong tenant with no
      // visible error. This invite doc is malformed; fail loudly instead.
      logger.error('Invitation is missing schoolId — cannot resolve student', { inviteToken });
      throw new UnprocessableEntityError(
        'This invitation is missing required school information. Please contact your school for a new link.'
      );
    }
    const resolvedStudentId = iData.studentId || `student-${inviteToken}`;

    let studentProfile: any;
    try {
      const studentSnap = await clientGetDoc(clientDoc(clientDb, 'users', resolvedStudentId));
      if (!studentSnap.exists()) {
        studentProfile = {
          uid: resolvedStudentId,
          name: iData.studentName || 'Candidate',
          rollNumber: 'ROLL-TEMP',
          schoolId: iData.schoolId,
          role: 'student',
          permissions: ['take_exams'],
          createdAt: new Date().toISOString(),
          class: 'Adaptive Grade'
        };
        await clientSetDoc(clientDoc(clientDb, 'users', resolvedStudentId), studentProfile);
      } else {
        studentProfile = { uid: studentSnap.id, ...studentSnap.data() };
      }
    } catch (studentErr) {
      logger.warn('Could not retrieve/create user profile directly', { err: studentErr });
      studentProfile = {
        uid: resolvedStudentId,
        name: iData.studentName || 'Candidate',
        rollNumber: 'ROLL-TEMP',
        schoolId: iData.schoolId,
        role: 'student',
        permissions: ['take_exams'],
        createdAt: new Date().toISOString(),
        class: 'Adaptive Grade'
      };
    }

    let school: any = null;
    if (iData.schoolId) {
      try {
        const schoolSnap = await clientGetDoc(clientDoc(clientDb, 'schools', iData.schoolId));
        if (schoolSnap.exists()) school = { id: schoolSnap.id, ...schoolSnap.data() };
      } catch (_e) {
        /* non-fatal */
      }
    }

    return res.status(200).json({ success: true, inviteData: iData, studentProfile, school });
  })
);

// Pre-session identity + target-exam resolution for the per-student invite-link flow. The
// actual attempt creation/resume is deliberately NOT done here — the client follows this
// call with /api/gatekeeper/enroll (passing this route's output plus inviteToken), reusing
// its already-correct resume/reattempt/already-completed transaction logic instead of a
// second, divergent copy of it.
/**
 * @openapi
 * /api/gatekeeper/verify-invite:
 *   post:
 *     summary: Verify a student's entered name/roll against an invite and resolve the target exam
 *     description: Pre-session route. Does not create/resume an attempt itself — the client follows this with /api/gatekeeper/enroll. Public. Rate-limited (gatekeeperLookupLimiter).
 *     tags: [Gatekeeper]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enteredName, enteredRoll]
 *             properties:
 *               inviteToken: { type: string }
 *               enteredName: { type: string }
 *               enteredRoll: { type: string }
 *     responses:
 *       200:
 *         description: Resolved student + target exam/school info
 *       400:
 *         description: Missing name/roll number, or input failed HTML/script sanitization check
 *       404:
 *         description: Invite is invalid or expired
 *       422:
 *         description: Invite exists but is missing required schoolId
 *       500:
 *         description: Server/Firestore error
 */
router.post(
  ['/api/v1/exam-entry/invitations/verify', '/api/gatekeeper/verify-invite'],
  gatekeeperLookupLimiter,
  asyncHandler(async (req, res) => {
    const { inviteToken, enteredName, enteredRoll } = req.body;
    if (!enteredName || !enteredRoll) {
      throw new BadRequestError('Please enter both your Full Name and Register / Roll Number');
    }

    const containsHTMLOrScripts = (val: string) => {
      const lowercase = val.toLowerCase();
      return (
        lowercase.includes('<script') ||
        lowercase.includes('javascript:') ||
        lowercase.includes('<') ||
        lowercase.includes('>') ||
        lowercase.includes('onload')
      );
    };
    const trimmedName = enteredName.trim();
    const trimmedRoll = enteredRoll.trim();
    if (containsHTMLOrScripts(trimmedName) || containsHTMLOrScripts(trimmedRoll)) {
      throw new BadRequestError('Invalid credentials provided');
    }

    // A valid, existing invitation is required — no schoolless fallback search. That
    // fallback used to let anyone query any student's profile platform-wide by guessing a
    // roll number with zero prior information (no invite needed at all), since roll
    // numbers are only unique within a school and there was no school to scope by.
    const inviteSnap = inviteToken ? await clientGetDoc(clientDoc(clientDb, 'invitations', inviteToken)) : null;
    if (!inviteSnap || !inviteSnap.exists()) {
      throw new NotFoundError('This invitation link is invalid or has expired. Please contact your school for a new link.');
    }
    const iData: any = { id: inviteSnap.id, ...inviteSnap.data() };
    if (!iData.schoolId) {
      // See invite-metadata's identical guard above — a missing schoolId on the invite doc
      // must fail loudly, not silently default to a placeholder school.
      logger.error('Invitation is missing schoolId — cannot resolve student', { inviteToken });
      throw new UnprocessableEntityError(
        'This invitation is missing required school information. Please contact your school for a new link.'
      );
    }

    const targetExamId = iData.examId;
    const targetExamTitle = iData.examTitle || 'Institution Secure Exam';
    const targetSchoolId = iData.schoolId;

    let resolvedStudentProfile: any;
    const usersRef = clientCollection(clientDb, 'users');

    const querySnap = await clientGetDocs(
      clientQuery(usersRef, clientWhere('rollNumber', '==', trimmedRoll), clientWhere('schoolId', '==', targetSchoolId))
    );

    if (!querySnap.empty) {
      const matchProfile = querySnap.docs[0].data() as any;
      const matchId = querySnap.docs[0].id;
      resolvedStudentProfile = { uid: matchId, ...matchProfile, name: matchProfile.name || trimmedName };
      if (!matchProfile.name) {
        await clientSetDoc(clientDoc(clientDb, 'users', matchId), resolvedStudentProfile);
      }
    } else {
      const newStudentId = generateEduKey('users');
      resolvedStudentProfile = {
        uid: newStudentId,
        name: trimmedName,
        rollNumber: trimmedRoll,
        schoolId: targetSchoolId,
        role: 'student',
        permissions: ['take_exams'],
        createdAt: new Date().toISOString(),
        class: 'Adaptive Grade'
      };
      await clientSetDoc(clientDoc(clientDb, 'users', newStudentId), resolvedStudentProfile);
    }

    const verificationTicket = signGatekeeperTicket({
      uid: resolvedStudentProfile.uid,
      schoolId: targetSchoolId,
      rollNumber: resolvedStudentProfile.rollNumber
    });

    return res.status(200).json({
      success: true,
      matchedStudentId: resolvedStudentProfile.uid,
      matchedStudentData: resolvedStudentProfile,
      finalSchoolId: targetSchoolId,
      finalExamId: targetExamId,
      examTitle: targetExamTitle,
      isFallback: false,
      verificationTicket
    });
  })
);

// Direct student login from the main login page (no exam link/invite involved): same
// credential shape as the link-entry flow (name + roll/register number), but scoped by
// roll number alone since there's no school context to disambiguate with. Unlike
// verify-identity/verify-invite, this never auto-onboards on a miss — a mistyped roll number
// here has no school/invite to safely attach a new account to, so it must fail cleanly
// instead of silently creating a bogus student record.
/**
 * @openapi
 * /api/gatekeeper/student-login:
 *   post:
 *     summary: Direct student login by name + roll number (no exam link/invite involved)
 *     description: Pre-session route — mints the session token itself, so it is intentionally public. Name must match the account on file. DOB is optional at onboarding, so it's optional here too — checked only when both entered and present on the account; never onboards a new account on a miss. Rate-limited (gatekeeperLookupLimiter).
 *     tags: [Gatekeeper]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, rollNumber]
 *             properties:
 *               name: { type: string }
 *               rollNumber: { type: string }
 *               dob: { type: string, description: "Optional. Checked only if both this and the account's on-file DOB are present." }
 *     responses:
 *       200:
 *         description: Login succeeded — returns profile + session token
 *       400:
 *         description: Missing name or roll number
 *       401:
 *         description: >-
 *           Credentials rejected. Deliberately identical (status and message) whether the roll
 *           number matched no account, the name didn't match, or a supplied DOB didn't match —
 *           distinguishing these would let a caller enumerate valid roll numbers.
 *       409:
 *         description: Roll number is ambiguous across multiple student accounts
 *       500:
 *         description: Server/Firestore error
 */
router.post(
  ['/api/v1/exam-entry/student-login', '/api/gatekeeper/student-login'],
  gatekeeperLookupLimiter,
  asyncHandler(async (req, res) => {
    const { name, rollNumber, dob } = req.body;
    if (!name || !rollNumber) {
      throw new BadRequestError('Please enter both your Full Name and Register / Roll Number');
    }

    const trimmedRoll = rollNumber.trim();
    const trimmedName = name.trim();
    const trimmedDob = typeof dob === 'string' ? dob.trim() : '';
    if (!trimmedRoll || !trimmedName) {
      throw new BadRequestError('Please enter both your Full Name and Register / Roll Number');
    }

    const usersRef = clientCollection(clientDb, 'users');
    const querySnap = await clientGetDocs(
      clientQuery(usersRef, clientWhere('rollNumber', '==', trimmedRoll), clientWhere('role', '==', 'student'))
    );

    // Deliberately the same status and message as the name/DOB mismatch below. Distinct
    // responses here ("no such roll number" vs "roll number exists, name wrong") would be a
    // user-enumeration oracle: it lets a caller sweep roll numbers to learn which ones map to
    // real accounts, then concentrate name-guessing on the confirmed ones. The wording still
    // names both possibilities so a genuinely un-onboarded student gets an actionable hint
    // without the response revealing which case they actually hit.
    if (querySnap.empty) {
      throw new UnauthorizedError(STUDENT_LOGIN_FAILURE_MESSAGE);
    }

    // Roll numbers are only guaranteed unique within a school. Without a school to scope by
    // here, more than one match is a genuine ambiguity — fail with a clear message rather
    // than silently guessing which student this is.
    if (querySnap.docs.length > 1) {
      throw new ConflictError(
        "Multiple student accounts share this Register / Roll Number. Please sign in via your school's exam link instead."
      );
    }

    const matchedDoc = querySnap.docs[0];
    const matchedData = matchedDoc.data() as any;

    // Name must match the account on file — roll number alone (often short/sequential)
    // must not be sufficient to log in as another student.
    const accountName = typeof matchedData.name === 'string' ? matchedData.name.trim() : '';
    if (!accountName || accountName.toLowerCase() !== trimmedName.toLowerCase()) {
      throw new UnauthorizedError(STUDENT_LOGIN_FAILURE_MESSAGE);
    }

    // DOB is optional at onboarding, so it's optional here too: checked only when the
    // student entered one AND the account actually has one on file. Product decision,
    // accepted with known risk — DOB stays skippable at login even for accounts that do
    // have one on file, since name-match above already closes the roll-number-only bypass.
    if (trimmedDob && matchedData.dob && String(matchedData.dob).trim() !== trimmedDob) {
      throw new UnauthorizedError(STUDENT_LOGIN_FAILURE_MESSAGE);
    }

    const profileData = {
      uid: matchedDoc.id,
      id: matchedDoc.id,
      ...matchedData,
      name: matchedData.name || trimmedName
    };

    // One-device-at-a-time: see server/auth/middleware.ts's resolveAuth.
    const sessionId = randomUUID();
    await clientUpdateDoc(clientDoc(clientDb, 'users', matchedDoc.id), { activeSessionId: sessionId });

    const sessionToken = signSessionToken({
      uid: profileData.uid,
      role: 'student',
      schoolId: profileData.schoolId || null,
      email: profileData.email || null,
      sessionId
    });

    return res.status(200).json({ success: true, profileData, sessionToken });
  })
);

/**
 * @openapi
 * /api/gatekeeper/enroll:
 *   post:
 *     summary: Atomically create/resume/reattempt an exam attempt and mint the student's session
 *     description: >
 *       Pre-session route — mints the session token itself, so it is intentionally public.
 *       Runs an atomic Firestore transaction covering student onboarding, attempt
 *       creation/resume/reattempt, and exam-window expiry. The caller's identity is NOT
 *       trusted from the request body — verificationTicket (issued by verify-identity or
 *       verify-invite, which do the real name/roll/invite match server-side) is required and
 *       must resolve to a uid/schoolId that matches finalSchoolId, or the request is rejected.
 *       Supports an internal load-test bypass gated on a server-side secret (`x-load-test-secret`
 *       header must match LOAD_TEST_SECRET, which is unset/disabled in normal deployments —
 *       fail-closed, not merely unauthenticated); that path alone still self-computes its uid,
 *       since it never has a real ticket. Rate-limited (gatekeeperEnrollLimiter).
 *     tags: [Gatekeeper]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [finalSchoolId, finalExamId, rollNumber, verificationTicket]
 *             properties:
 *               verificationTicket: { type: string, description: "Signed ticket from verify-identity/verify-invite proving this caller's identity was actually checked server-side. Required except for the load-test bypass." }
 *               matchedStudentData: { type: object, description: "Non-authoritative display fallback only — identity itself comes from verificationTicket, not this." }
 *               username: { type: string }
 *               rollNumber: { type: string }
 *               finalSchoolId: { type: string }
 *               finalExamId: { type: string }
 *               examTitle: { type: string }
 *               clientFootprint: { type: string, description: "Opaque device fingerprint used to detect session hijack across devices." }
 *               inviteToken: { type: string }
 *               inviteIsFallback: { type: boolean }
 *     responses:
 *       200:
 *         description: Attempt created/resumed/reattempted, with session token and resolved profile
 *       400:
 *         description: Missing finalSchoolId, finalExamId, or rollNumber
 *       401:
 *         description: Missing, invalid, or expired verificationTicket
 *       403:
 *         description: SESSION_HIJACK_BLOCKED (device footprint mismatch), or verificationTicket's schoolId does not match finalSchoolId
 *       409:
 *         description: EXAM_ALREADY_COMPLETED — attempt already submitted and not eligible for reattempt
 *       410:
 *         description: EXAM_WINDOW_EXPIRED — exam's time window has passed
 *       500:
 *         description: Transaction/server error
 */
// 2. BACKEND API FOR HEAVY WRITES: THE GATEKEEPER TRANSACTION
router.post(
  ['/api/v1/exam-entry/enrollments', '/api/gatekeeper/enroll'],
  gatekeeperEnrollLimiter,
  asyncHandler(async (req, res) => {
    const {
      matchedStudentData,
      username,
      rollNumber,
      finalSchoolId,
      finalExamId,
      examTitle,
      clientFootprint,
      inviteToken,
      inviteIsFallback,
      verificationTicket
    } = req.body;

    if (!finalSchoolId || !finalExamId || !rollNumber) {
      throw new BadRequestError('Missing required validation payload parameters.');
    }

    const now = new Date();

    // Gated on a server-side secret (never client-suppliable) rather than the header alone —
    // this branch mints a real, verifiable session token, so trusting a bare client-sent
    // header (or worse, guessable substrings in attacker-controlled body fields) let anyone
    // forge a valid student session for free with zero enrollment. If LOAD_TEST_SECRET isn't
    // configured, this bypass is fully disabled (fail-closed), not merely unauthenticated.
    const isLoadTestRequest =
      !!LOAD_TEST_SECRET && req.headers['x-load-test'] === 'true' && req.headers['x-load-test-secret'] === LOAD_TEST_SECRET;

    if (isLoadTestRequest) {
      const resolvedStudentId = `std_${finalSchoolId}_${rollNumber.trim().replace(/\s+/g, '_').toLowerCase()}`;
      const attemptIdRaw = `att_${finalExamId}_${resolvedStudentId}`;
      const mockProfile = {
        uid: resolvedStudentId,
        name: username?.trim() || `Simulated Student ${rollNumber}`,
        rollNumber: rollNumber.trim(),
        schoolId: finalSchoolId,
        role: 'student',
        permissions: ['take_exams'],
        createdAt: now.toISOString(),
        class: 'Adaptive Cluster'
      };
      const mockAttempt = {
        examId: finalExamId,
        examTitle: examTitle || 'Stress Test Simulated Exam',
        studentId: resolvedStudentId,
        studentName: mockProfile.name,
        studentEmail: `${rollNumber.trim().toLowerCase()}@school.com`,
        schoolId: finalSchoolId,
        answers: [] as any[],
        score: 0,
        startTime: now.toISOString(),
        status: 'started',
        deviceFootprint: clientFootprint || 'StressTesterWorkerNode',
        ephemeralToken: 'MOCK_TOKEN_LOADTEST',
        timePerQuestion: {}
      };
      mockLoadTestStore.set(`users_${resolvedStudentId}`, mockProfile);
      mockLoadTestStore.set(`attempts_${attemptIdRaw}`, mockAttempt);

      // A signed JWT needs no Firestore write/lookup either way, so the load-test path now
      // gets a real session token for free — no more special-cased in-memory session map. No
      // real users/{uid} doc exists for a load-test uid, so resolveAuth's activeSessionId
      // check naturally no-ops for it (missing field = allowed) — this sessionId is just here
      // for a consistent token shape, not enforced against anything.
      const loadTestSessionToken = signSessionToken({
        uid: resolvedStudentId,
        role: 'student',
        schoolId: finalSchoolId,
        email: null,
        sessionId: randomUUID()
      });

      return res.status(200).json({
        success: true,
        resolvedStudentId,
        attemptIdRaw,
        finalStudentProfile: mockProfile,
        sessionToken: loadTestSessionToken,
        isSimulatedLoadTest: true
      });
    }

    // The identity for every real (non-load-test) enrollment must come from a ticket signed
    // by verify-identity or verify-invite — those are the only places that actually check a
    // roll-number/name/invite match server-side. Without this, a caller could POST any
    // matchedStudentId (or the guessable `std_{schoolId}_{rollNumber}` fallback id) directly
    // to this endpoint and get a real signed session for a student they never verified as.
    if (!verificationTicket) {
      throw new UnauthorizedError('Missing identity verification ticket. Please verify your details again.');
    }
    const ticketClaims = verifyGatekeeperTicket(verificationTicket);
    if (!ticketClaims) {
      throw new UnauthorizedError('Identity verification has expired or is invalid. Please verify your details again.');
    }
    if (ticketClaims.schoolId !== finalSchoolId) {
      throw new ForbiddenError('Verified identity does not match the requested school.');
    }

    const resolvedStudentId = ticketClaims.uid;
    const studentDocRef = clientDoc(clientDb, 'users', resolvedStudentId);
    const attemptIdRaw = `att_${finalExamId}_${resolvedStudentId}`;
    const attemptDocRef = clientDoc(clientDb, 'attempts', attemptIdRaw);
    const examDocRef = clientDoc(clientDb, 'exams', finalExamId);
    // The school+exam secure link, at the deterministic id handleActivateDynamicSecurity
    // writes. Read here only to pick up a whole-school `reattemptFrom` grant; one extra read
    // per enrollment, which happens once per student per sitting rather than per poll.
    const secureLinkDocRef = clientDoc(clientDb, 'secure_exam_links', `gen_${finalSchoolId}_${finalExamId}`);

    let finalStudentProfile: any = null;
    let isNewAttempt = false;
    let attemptAction: 'created' | 'resumed' | 'reattempted' = 'resumed';
    let examWindowExpired = false;

    // Atomic Database Transaction running on Node.js Server using Client SDK
    await clientRunTransaction(clientDb, async (transaction) => {
      const studentSnap = await transaction.get(studentDocRef);
      const attemptSnap = await transaction.get(attemptDocRef);
      const examSnap = await transaction.get(examDocRef);
      const secureLinkSnap = await transaction.get(secureLinkDocRef);
      const examDurationMs = examSnap.exists() ? (examSnap.data() as any).duration * 60 * 1000 : null;

      // A revoked link grants nothing — "Disable and Revert to Standard" sets isActive:false,
      // and a stale reattemptFrom left behind on that doc must not keep reopening submitted
      // attempts after the school has closed the exam off.
      const secureLinkData = secureLinkSnap.exists() ? (secureLinkSnap.data() as any) : null;
      const schoolWideReattemptFrom = secureLinkData?.isActive ? secureLinkData.reattemptFrom : null;

      // A. Onboard or fetch Student Profile atomically
      if (studentSnap.exists()) {
        finalStudentProfile = { uid: studentSnap.id, ...studentSnap.data() };
      } else if (matchedStudentData) {
        finalStudentProfile = { uid: resolvedStudentId, ...matchedStudentData };
      } else {
        // Safe auto-onboard fallback
        finalStudentProfile = {
          uid: resolvedStudentId,
          name: username?.trim() || 'Candidate',
          rollNumber: rollNumber.trim(),
          schoolId: finalSchoolId,
          role: 'student',
          permissions: ['take_exams'],
          createdAt: now.toISOString(),
          class: 'Adaptive Cluster'
        };
        transaction.set(studentDocRef, finalStudentProfile);
      }

      // B. Onboard or update Exam Attempt state atomically
      if (attemptSnap.exists()) {
        const attemptData = attemptSnap.data() as any;

        // 'expired' needs the exact same canReattempt gate as 'completed' — a school
        // re-triggering an expired attempt (SchoolStudentOnboarding's handleReTriggerInvite)
        // sets canReattempt:true expecting the student to get back in, same as it does for
        // a completed one. Without 'expired' here, a re-triggered student would hit the
        // resume branch below, immediately re-expire again, and canReattempt would never
        // even be consulted.
        // isAttemptFinished covers 'submitted' and 'grading_failed' too, not just
        // 'completed' — grading is asynchronous, so an attempt that has been handed in sits in
        // 'submitted' for a while. Testing 'completed' alone let a student re-enter and retake
        // the exam they had just submitted, for as long as grading took.
        if (isAttemptFinished(attemptData.status) || attemptData.status === 'expired') {
          // Two independent grants, checked together so this door matches the dashboard card
          // (StudentDashboardService.getAccessibleExamCandidates): `canReattempt` is the
          // per-student grant written by handleReTriggerInvite, `reattemptFrom` is the
          // whole-school grant written once onto the secure link by handleAllowSchoolWideReattempt.
          if (attemptData.canReattempt || isReopenedBySchoolLink(attemptData, schoolWideReattemptFrom)) {
            attemptAction = 'reattempted';
            transaction.update(attemptDocRef, {
              status: 'started',
              score: 0,
              answers: [] as any[],
              startTime: now.toISOString(),
              // Cleared, not left behind. isReopenedBySchoolLink reads `endTime || startTime`,
              // so a stale endTime from the PREVIOUS sitting stays older than the grant
              // forever — and any terminal status reached without writing a new endTime (lazy
              // expiry, or grading_failed on an abandoned re-entry) would then be re-opened by
              // the same grant again, and again. Clearing it makes the grant single-use as
              // designed: the next finish timestamp is the re-sit's, which is after the grant.
              endTime: null,
              canReattempt: false
            });
          } else if (attemptData.status === 'expired') {
            examWindowExpired = true;
          } else {
            // attemptIdRaw and the original EXAM_ALREADY_COMPLETED code string ride along in
            // details — the frontend (LoginPage.tsx, StudentLinkEntry.tsx) switches on both.
            throw new ConflictError('This assessment attempt has already been submitted and completed.', {
              attemptIdRaw,
              code: 'EXAM_ALREADY_COMPLETED'
            });
          }
        } else {
          if (attemptData.deviceFootprint && attemptData.deviceFootprint !== clientFootprint) {
            // The original custom code string (not ForbiddenError's generic 'FORBIDDEN') rides
            // along in details — StudentLinkEntry.tsx switches on it.
            throw new ForbiddenError(
              'SESSION_HIJACK_BLOCKED: Mismatched browser/device footprint registered for this unique link. Please complete on your primary device or request a clean reset from terminal administrators.',
              { code: 'SESSION_HIJACK_BLOCKED' }
            );
          }

          // Lazy expiry: nothing proactively flips an abandoned attempt once its exam
          // window passes, so check it here on the one path a student would come back
          // through — resuming a stale link days later shouldn't silently re-open the exam.
          // Includes any school-granted extraTime (ExamInterface.tsx honors this live during
          // the exam via onSnapshot), or a student who legitimately got extra minutes could
          // be wrongly expired if their session drops and they resume within their real,
          // extended window but past the exam's base duration.
          // Note: this write must land via a normal (non-throwing) transaction return —
          // clientRunTransaction only applies queued transaction.update/set/delete calls
          // AFTER the callback resolves, so throwing here would discard this update too.
          const effectiveDurationMs = examDurationMs !== null ? examDurationMs + (attemptData.extraTime || 0) * 60 * 1000 : null;
          const elapsedMs = now.getTime() - new Date(attemptData.startTime).getTime();
          if (effectiveDurationMs && elapsedMs > effectiveDurationMs) {
            examWindowExpired = true;
            transaction.update(attemptDocRef, { status: 'expired' });
          } else {
            // Active session resume
            transaction.update(attemptDocRef, {
              lastResumedAt: now.toISOString(),
              status: 'started'
            });
          }
        }
      } else {
        // Initial clean session booking
        isNewAttempt = true;
        attemptAction = 'created';
        const newAttemptData = {
          examId: finalExamId,
          examTitle: examTitle || 'Single Term Link Entry Exam',
          studentId: resolvedStudentId,
          studentName: finalStudentProfile.name,
          studentEmail: finalStudentProfile.email || `${rollNumber.trim().toLowerCase()}@school.com`,
          schoolId: finalSchoolId,
          answers: [] as any[],
          score: 0,
          startTime: now.toISOString(),
          status: 'started',
          deviceFootprint: clientFootprint || 'GENERIC_BROWSER_PLATFORM',
          ephemeralToken: Buffer.from(Math.random().toString()).toString('base64').substring(0, 16),
          timePerQuestion: {}
        };
        transaction.set(attemptDocRef, newAttemptData);
      }
    });

    if (examWindowExpired) {
      // attemptIdRaw and the original EXAM_WINDOW_EXPIRED code string ride along in details —
      // the frontend (StudentLinkEntry.tsx) switches on both.
      throw new GoneError("This exam's time window has passed. Ask your school to re-trigger a fresh attempt.", {
        attemptIdRaw,
        code: 'EXAM_WINDOW_EXPIRED'
      });
    }

    // Invite-link students never go through Firebase Auth, so this is the only place that
    // can mint their session — without it, every subsequent /api/db/write during the exam
    // (autosave, proctoring logs, final submit) would 401.
    // One-device-at-a-time: see server/auth/middleware.ts's resolveAuth. Note this endpoint
    // can be re-called on the same device (resuming/reloading an in-progress attempt) — each
    // call mints a fresh sessionId, which is self-consistent (the new token is what the page
    // uses going forward) but means a very old still-open tab from an earlier reload of the
    // same link would itself now read as "another device" and stop working, same as intended
    // for a genuinely different device.
    // clientSetDoc(merge:true), not clientUpdateDoc — the matchedStudentData branch above
    // doesn't guarantee studentDocRef already exists, and update() fails on a missing doc.
    const sessionId = randomUUID();
    await clientSetDoc(studentDocRef, { activeSessionId: sessionId }, { merge: true });

    const sessionToken = signSessionToken({
      uid: resolvedStudentId,
      role: 'student',
      schoolId: finalSchoolId,
      email: finalStudentProfile?.email || `${rollNumber.trim().toLowerCase()}@school.com`,
      sessionId
    });

    // Best-effort: mark a per-student invitation link as consumed once it has actually
    // produced a brand-new attempt (not a resume of an existing one).
    if (inviteToken && !inviteIsFallback && isNewAttempt) {
      try {
        await clientUpdateDoc(clientDoc(clientDb, 'invitations', inviteToken), {
          status: 'used',
          consumedAt: now.toISOString()
        });
      } catch (inviteErr) {
        logger.warn('Failed to mark invitation as consumed (non-fatal)', { err: inviteErr });
      }
    }

    return res.status(200).json({
      success: true,
      resolvedStudentId,
      attemptIdRaw,
      finalStudentProfile,
      sessionToken,
      isNewAttempt,
      attemptAction
    });
  })
);

export default router;
