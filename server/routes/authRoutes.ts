import express from 'express';
import { verifyFirebaseIdToken, signSessionToken } from '../auth/tokens';
import { requireSession } from '../auth/middleware';
import {
  clientDb,
  clientCollection,
  clientDoc,
  clientGetDoc,
  clientGetDocs,
  clientSetDoc,
  clientUpdateDoc,
  clientQuery,
  clientWhere
} from '../firestoreClient';
import { asyncHandler } from '../middleware/errorHandler';
import { authLimiter } from '../middleware/rateLimit';
import { UnauthorizedError, BadRequestError, ForbiddenError, NotFoundError, InternalServerError } from '../lib/errors';

const router = express.Router();

/**
 * @openapi
 * /api/auth/validate:
 *   post:
 *     summary: Validate a Firebase ID token and resolve/create the caller's app session
 *     description: >
 *       Takes a Firebase ID token (Authorization Bearer header or body.idToken), verifies it
 *       server-side, and mints this app's own session token. Auto-detects admin/school role
 *       by cross-checking the schools/admins/super_admins collections, creating the users doc
 *       on first login if none exists. Public — this route's whole purpose is to bootstrap a
 *       session from a Firebase token, so no app session is required yet. Rate-limited (authLimiter).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idToken: { type: string, description: "Only used if not sent as Authorization: Bearer <idToken>" }
 *               displayName: { type: string }
 *     responses:
 *       200:
 *         description: Session token + resolved/created profile
 *       401:
 *         description: Missing, invalid, or expired Firebase ID token
 *       500:
 *         description: Server/Firestore error
 */
// SECURE SERVER-SIDE AUTHENTICATION ENDPOINTS
router.post(
  '/api/auth/validate',
  authLimiter,
  asyncHandler(async (req, res) => {
    // uid/email must come from a verified Firebase ID token, never trusted from the request
    // body directly — otherwise any client could mint a session for an arbitrary uid.
    const authHeader = req.headers.authorization;
    const idToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.idToken;
    if (!idToken) {
      throw new UnauthorizedError('Missing Firebase ID token');
    }

    let uid: string, email: string | null, displayName: string | null;
    try {
      const decoded = await verifyFirebaseIdToken(idToken);
      uid = decoded.uid;
      email = decoded.email;
      displayName = decoded.name || req.body.displayName || null;
    } catch (err: any) {
      console.error('[Auth] Firebase ID token verification failed:', err?.message || err);
      throw new UnauthorizedError('Invalid or expired authentication token');
    }

    const emailLower = email?.toLowerCase() || '';
    const userRef = clientDoc(clientDb, 'users', uid);

    const docSnap = await clientGetDoc(userRef);

    // 1. Check if there is an existing profile in users by querying email
    let matchedProfile: any = null;
    if (emailLower) {
      try {
        const uQuery = clientQuery(clientCollection(clientDb, 'users'), clientWhere('email', '==', emailLower));
        const uSnap = await clientGetDocs(uQuery);
        if (!uSnap.empty) {
          matchedProfile = uSnap.docs[0].data();
        }
      } catch (err) {
        console.error('fetchProfile query existing users error in server:', err);
      }
    }

    // 2. Query Firestore schools to see if this user is a school admin
    let realSchoolId = '';
    let isRealSchool = false;
    if (emailLower) {
      try {
        const schoolsRef = clientCollection(clientDb, 'schools');
        const schoolByAdminEmailQuery = clientQuery(schoolsRef, clientWhere('adminEmail', '==', emailLower));
        const snap = await clientGetDocs(schoolByAdminEmailQuery);
        if (!snap.empty) {
          isRealSchool = true;
          realSchoolId = snap.docs[0].id;
        } else {
          // Case-insensitive fallback lookup
          const allSchools = await clientGetDocs(schoolsRef);
          const foundSchool = allSchools.docs.find((doc) => {
            const schoolData = doc.data();
            return (schoolData.adminEmail || '').trim().toLowerCase() === emailLower;
          });
          if (foundSchool) {
            isRealSchool = true;
            realSchoolId = foundSchool.id;
          }
        }
      } catch (e) {
        console.error('fetchProfile school verification error in server:', e);
      }
    }

    // Admin accounts are provisioned manually by an administrator directly in Firestore
    // (self-registration is blocked in /api/auth/create-profile) — typically as an entry in
    // the `admins`/`super_admins` collections, which may predate (or never touch) this
    // user's own `users/{uid}` doc. Check those collections directly rather than relying
    // only on whatever role happens to already be on the users doc.
    let isAdminInFirestore = false;
    try {
      const safeEmailId = emailLower.replace(/[^a-zA-Z0-9_-]/g, '_');
      const superAdminByUid = await clientGetDoc(clientDoc(clientDb, 'super_admins', uid));
      const adminByUid = await clientGetDoc(clientDoc(clientDb, 'admins', uid));
      isAdminInFirestore = superAdminByUid.exists() || adminByUid.exists();

      if (!isAdminInFirestore && emailLower) {
        // Sanitizing email into a doc ID is lossy (e.g. "a.b@x.com" and "a_b@x.com" both
        // become "a_b_x_com") — confirm the fetched doc's own email field actually matches
        // before trusting it, so a crafted colliding email can't borrow another admin's doc.
        const superAdminByEmail = await clientGetDoc(clientDoc(clientDb, 'super_admins', safeEmailId));
        const adminByEmail = await clientGetDoc(clientDoc(clientDb, 'admins', safeEmailId));
        const superAdminEmailMatches = superAdminByEmail.exists() && (superAdminByEmail.data() as any)?.email?.toLowerCase() === emailLower;
        const adminEmailMatches = adminByEmail.exists() && (adminByEmail.data() as any)?.email?.toLowerCase() === emailLower;
        isAdminInFirestore = superAdminEmailMatches || adminEmailMatches;
      }

      if (!isAdminInFirestore && emailLower) {
        const qSuper = clientQuery(clientCollection(clientDb, 'super_admins'), clientWhere('email', '==', emailLower));
        const snapSuper = await clientGetDocs(qSuper);
        isAdminInFirestore = !snapSuper.empty;
      }

      if (!isAdminInFirestore && emailLower) {
        const qAdmin = clientQuery(clientCollection(clientDb, 'admins'), clientWhere('email', '==', emailLower));
        const snapAdmin = await clientGetDocs(qAdmin);
        isAdminInFirestore = !snapAdmin.empty;
      }
    } catch (err) {
      console.error('admins/super_admins verification error in server:', err);
    }

    const isSchoolAdmin =
      isRealSchool || matchedProfile?.role === 'school' || (docSnap.exists() && (docSnap.data() as any).role === 'school');
    const isSystemAdmin =
      isAdminInFirestore || matchedProfile?.role === 'admin' || (docSnap.exists() && (docSnap.data() as any).role === 'admin');

    let finalProfile: any = null;

    if (!docSnap.exists()) {
      // Create user document because it doesn't exist yet
      let role: 'admin' | 'school' | 'student' = 'student';
      let permissions: string[] = ['take_exams'];
      let schoolId: string | undefined = undefined;

      if (isSystemAdmin) {
        role = 'admin';
        permissions = ['manage_exams', 'view_results'];
      } else if (isSchoolAdmin) {
        role = 'school';
        permissions = ['manage_exams', 'view_results', 'manage_students'];
        schoolId = realSchoolId || undefined;
      } else if (matchedProfile) {
        role = matchedProfile.role || 'student';
        permissions = matchedProfile.permissions || ['take_exams'];
        schoolId = matchedProfile.schoolId;
      }

      finalProfile = {
        uid: uid,
        name: matchedProfile?.name || displayName || email?.split('@')[0] || 'Anonymous',
        email: email || '',
        role,
        permissions,
        createdAt: matchedProfile?.createdAt || new Date().toISOString(),
        ...(schoolId ? { schoolId } : {})
      };

      await clientSetDoc(userRef, finalProfile);
    } else {
      // Document exists, load it
      const currentProfile = docSnap.data() as any;
      let needsUpdate = false;
      const updatedProfile = { ...currentProfile };

      // If they are a verified admin or school admin on Firestore but roles don't match, sync it
      // Do not force overwrite to admin if the user has explicitly registered or chosen to be a school admin
      if (isSystemAdmin && currentProfile.role !== 'admin' && currentProfile.role !== 'school') {
        updatedProfile.role = 'admin';
        updatedProfile.permissions = ['manage_exams', 'view_results'];
        needsUpdate = true;
      } else if (isSchoolAdmin && !isSystemAdmin && currentProfile.role !== 'school') {
        updatedProfile.role = 'school';
        updatedProfile.permissions = ['manage_exams', 'view_results', 'manage_students'];
        updatedProfile.schoolId = realSchoolId || currentProfile.schoolId;
        needsUpdate = true;
      } else if (
        isSchoolAdmin &&
        !isSystemAdmin &&
        currentProfile.role === 'school' &&
        realSchoolId &&
        currentProfile.schoolId !== realSchoolId
      ) {
        // Sync school ID if it has changed/updated in schools collection
        updatedProfile.schoolId = realSchoolId;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await clientUpdateDoc(userRef, {
          role: updatedProfile.role,
          permissions: updatedProfile.permissions,
          ...(updatedProfile.schoolId ? { schoolId: updatedProfile.schoolId } : {})
        });
      }
      finalProfile = updatedProfile;
    }

    const sessionToken = signSessionToken({
      uid,
      role: finalProfile.role,
      schoolId: finalProfile.schoolId || null,
      email: emailLower
    });

    return res.status(200).json({
      success: true,
      sessionToken,
      profile: finalProfile
    });
  })
);

/**
 * @openapi
 * /api/auth/create-profile:
 *   post:
 *     summary: Create a new user profile (school or student self-registration) from a verified Firebase ID token
 *     description: >
 *       Public (bootstraps a session, same as /api/auth/validate). Admin self-registration is
 *       always blocked — admin accounts are provisioned manually in Firestore. A 'school' role
 *       requires the email to already be pre-authorized (allowed_schools, schools.adminEmail,
 *       or an allowed domain) or the request is rejected. Rate-limited (authLimiter).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, role]
 *             properties:
 *               idToken: { type: string, description: "Only used if not sent as Authorization: Bearer <idToken>" }
 *               name: { type: string }
 *               role: { type: string, enum: [school, student] }
 *               schoolId: { type: string }
 *     responses:
 *       200:
 *         description: Session token + newly created profile
 *       400:
 *         description: Verified token is missing uid or email
 *       401:
 *         description: Missing, invalid, or expired Firebase ID token
 *       403:
 *         description: Admin self-registration attempted, or school role email not pre-authorized
 *       500:
 *         description: Server/Firestore error
 */
router.post(
  '/api/auth/create-profile',
  authLimiter,
  asyncHandler(async (req, res) => {
    // uid/email must come from a verified Firebase ID token, never trusted from the request
    // body directly — otherwise any client could create/overwrite a profile for an arbitrary uid.
    const authHeader = req.headers.authorization;
    const idToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.idToken;
    if (!idToken) {
      throw new UnauthorizedError('Missing Firebase ID token');
    }

    let uid: string, email: string;
    try {
      const decoded = await verifyFirebaseIdToken(idToken);
      uid = decoded.uid;
      email = decoded.email || '';
    } catch (err: any) {
      console.error('[Auth] Firebase ID token verification failed:', err?.message || err);
      throw new UnauthorizedError('Invalid or expired authentication token');
    }

    const { name, role, schoolId } = req.body;
    if (!uid || !email) {
      throw new BadRequestError('Verified token is missing uid or email');
    }

    const emailLower = email.toLowerCase();

    // 1. Block public admin self-registration completely
    if (role === 'admin') {
      throw new ForbiddenError(
        'Admin self-registration is disabled. Admin accounts must be manually created in Firestore by the system administrator.'
      );
    }

    // 2. Server-side validation for school role
    let validSchoolId = schoolId;
    if (role === 'school') {
      let isAuthorized = false;
      try {
        // Check allowed_schools by email
        const allowedSchoolsRef = clientCollection(clientDb, 'allowed_schools');
        const allowedSchoolByEmailQuery = clientQuery(allowedSchoolsRef, clientWhere('email', '==', emailLower));
        const snap = await clientGetDocs(allowedSchoolByEmailQuery);

        if (!snap.empty) {
          isAuthorized = true;
          validSchoolId = snap.docs[0].data()?.schoolId || 'school-' + uid;
        } else {
          // Check schools collection by adminEmail
          const schoolsRef = clientCollection(clientDb, 'schools');
          const qSchools = clientQuery(schoolsRef, clientWhere('adminEmail', '==', emailLower));
          const snapSchools = await clientGetDocs(qSchools);

          if (!snapSchools.empty) {
            isAuthorized = true;
            validSchoolId = snapSchools.docs[0].id;
          } else {
            // Check allowedDomains in schools collection
            const allSchools = await clientGetDocs(schoolsRef);
            const found = allSchools.docs.find((docSnap) => {
              const schoolDoc = docSnap.data();
              if (!schoolDoc) return false;
              const isEmailMatch = (schoolDoc.adminEmail || '').trim().toLowerCase() === emailLower;
              const emailDomain = emailLower.split('@')[1];
              const isDomainMatch =
                emailDomain &&
                Array.isArray(schoolDoc.allowedDomains) &&
                schoolDoc.allowedDomains.map((domain: string) => domain.trim().toLowerCase()).includes(emailDomain.toLowerCase());
              return isEmailMatch || isDomainMatch;
            });

            if (found) {
              isAuthorized = true;
              validSchoolId = found.id;
            }
          }
        }
      } catch (err) {
        console.error('School validation error:', err);
        throw new InternalServerError('Internal server error during validation');
      }

      if (!isAuthorized) {
        throw new ForbiddenError(
          `Registration denied: The email address (${emailLower}) has not been onboarded by an Admin. Please contact the administrator to onboard your school before creating an account.`
        );
      }
    }

    const permissions =
      role === 'admin'
        ? ['manage_exams', 'view_results']
        : role === 'school'
          ? ['manage_exams', 'view_results', 'manage_students']
          : ['take_exams'];

    const userRef = clientDoc(clientDb, 'users', uid);
    const newProfile = {
      uid,
      name,
      email: emailLower,
      role,
      permissions,
      createdAt: new Date().toISOString(),
      ...(validSchoolId ? { schoolId: validSchoolId } : {})
    };

    await clientSetDoc(userRef, newProfile);

    const sessionToken = signSessionToken({
      uid,
      role,
      schoolId: validSchoolId || null,
      email: emailLower
    });

    return res.status(200).json({
      success: true,
      sessionToken,
      profile: newProfile
    });
  })
);

/**
 * @openapi
 * /api/auth/session:
 *   get:
 *     summary: Fetch the caller's full current profile
 *     description: Session tokens only carry uid/role/schoolId, not name/permissions/etc, so this does a deliberate Firestore read for the full profile. Low-frequency call, not part of the hot exam-taking path.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Caller's full profile document
 *       401:
 *         description: Missing, invalid, or expired session
 *       404:
 *         description: User profile not found
 *       500:
 *         description: Server/Firestore error
 */
// Returns the caller's full current profile (session tokens only carry uid/role/schoolId,
// not name/permissions/etc.) — a deliberate Firestore read, since this is a low-frequency
// "fetch my full profile" call, not the hot exam-taking path.
router.get(
  '/api/auth/session',
  requireSession,
  asyncHandler(async (req: any, res) => {
    const userSnap = await clientGetDoc(clientDoc(clientDb, 'users', req.auth.uid));
    if (!userSnap.exists()) {
      throw new NotFoundError('User profile not found');
    }
    return res.status(200).json({ success: true, profile: userSnap.data() });
  })
);

export default router;
