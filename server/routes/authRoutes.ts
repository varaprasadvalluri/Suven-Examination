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

const router = express.Router();

// SECURE SERVER-SIDE AUTHENTICATION ENDPOINTS
router.post('/api/auth/validate', async (req, res) => {
  // uid/email must come from a verified Firebase ID token, never trusted from the request
  // body directly — otherwise any client could mint a session for an arbitrary uid.
  const authHeader = req.headers.authorization;
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.idToken;
  if (!idToken) {
    return res.status(401).json({ error: 'Missing Firebase ID token' });
  }

  let uid: string, email: string | null, displayName: string | null;
  try {
    const decoded = await verifyFirebaseIdToken(idToken);
    uid = decoded.uid;
    email = decoded.email;
    displayName = decoded.name || req.body.displayName || null;
  } catch (err: any) {
    console.error("[Auth] Firebase ID token verification failed:", err?.message || err);
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }

  const emailLower = email?.toLowerCase() || '';
  const userRef = clientDoc(clientDb, 'users', uid);

  try {
    const docSnap = await clientGetDoc(userRef);

    const isDemoAdmin = emailLower === 'admin@suvenedu.demo';
    const isDemoSchool = emailLower === 'school@suvenedu.demo';
    const isDemoStudent = emailLower === 'student@suvenedu.demo';

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
        console.error("fetchProfile query existing users error in server:", err);
      }
    }

    // 2. Query Firestore schools to see if this user is a school admin
    let realSchoolId = '';
    let isRealSchool = false;
    if (emailLower && !emailLower.endsWith('@suvenedu.demo')) {
      try {
        const sRef = clientCollection(clientDb, 'schools');
        const q = clientQuery(sRef, clientWhere('adminEmail', '==', emailLower));
        const snap = await clientGetDocs(q);
        if (!snap.empty) {
          isRealSchool = true;
          realSchoolId = snap.docs[0].id;
        } else {
          // Case-insensitive fallback lookup
          const allSchools = await clientGetDocs(sRef);
          const foundSchool = allSchools.docs.find(doc => {
            const data = doc.data();
            return (data.adminEmail || '').trim().toLowerCase() === emailLower;
          });
          if (foundSchool) {
            isRealSchool = true;
            realSchoolId = foundSchool.id;
          }
        }
      } catch (e) {
        console.error("fetchProfile school verification error in server:", e);
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
        const superAdminByEmail = await clientGetDoc(clientDoc(clientDb, 'super_admins', safeEmailId));
        const adminByEmail = await clientGetDoc(clientDoc(clientDb, 'admins', safeEmailId));
        isAdminInFirestore = superAdminByEmail.exists() || adminByEmail.exists();
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
      console.error("admins/super_admins verification error in server:", err);
    }

    const isSchoolAdmin = isDemoSchool || isRealSchool || (matchedProfile?.role === 'school') || (docSnap.exists() && (docSnap.data() as any).role === 'school');
    const isSystemAdmin = isDemoAdmin || isAdminInFirestore || (matchedProfile?.role === 'admin') || (docSnap.exists() && (docSnap.data() as any).role === 'admin');

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
        schoolId = realSchoolId || 'school-core-node-1';
      } else if (matchedProfile) {
        role = matchedProfile.role || 'student';
        permissions = matchedProfile.permissions || ['take_exams'];
        schoolId = matchedProfile.schoolId;
      } else if (isDemoStudent) {
        role = 'student';
        permissions = ['take_exams'];
        schoolId = 'school-core-node-1';
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
        updatedProfile.schoolId = realSchoolId || 'school-core-node-1';
        needsUpdate = true;
      } else if (isSchoolAdmin && !isSystemAdmin && currentProfile.role === 'school' && realSchoolId && currentProfile.schoolId !== realSchoolId) {
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

  } catch (err: any) {
    console.error("Error validating session in server:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

router.post('/api/auth/create-profile', async (req, res) => {
  // uid/email must come from a verified Firebase ID token, never trusted from the request
  // body directly — otherwise any client could create/overwrite a profile for an arbitrary uid.
  const authHeader = req.headers.authorization;
  const idToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.idToken;
  if (!idToken) {
    return res.status(401).json({ error: 'Missing Firebase ID token' });
  }

  let uid: string, email: string;
  try {
    const decoded = await verifyFirebaseIdToken(idToken);
    uid = decoded.uid;
    email = decoded.email || '';
  } catch (err: any) {
    console.error("[Auth] Firebase ID token verification failed:", err?.message || err);
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }

  const { name, role, schoolId } = req.body;
  if (!uid || !email) {
    return res.status(400).json({ error: 'Verified token is missing uid or email' });
  }

  const emailLower = email.toLowerCase();

  // 1. Block public admin self-registration completely
  if (role === 'admin') {
    return res.status(403).json({
      error: 'Admin self-registration is disabled. Admin accounts must be manually created in Firestore by the system administrator.'
    });
  }

  // 2. Server-side validation for school role
  let validSchoolId = schoolId;
  if (role === 'school') {
    let isAuthorized = false;
    try {
      // Check allowed_schools by email
      const sRef = clientCollection(clientDb, 'allowed_schools');
      const q = clientQuery(sRef, clientWhere('email', '==', emailLower));
      const snap = await clientGetDocs(q);

      if (!snap.empty) {
        isAuthorized = true;
        validSchoolId = snap.docs[0].data()?.schoolId || ('school-' + uid);
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
          const found = allSchools.docs.find(docSnap => {
            const data = docSnap.data();
            if (!data) return false;
            const isEmailMatch = (data.adminEmail || '').trim().toLowerCase() === emailLower;
            const emailDomain = emailLower.split('@')[1];
            const isDomainMatch = emailDomain && Array.isArray(data.allowedDomains) &&
              data.allowedDomains.map((d: string) => d.trim().toLowerCase()).includes(emailDomain.toLowerCase());
            return isEmailMatch || isDomainMatch;
          });

          if (found) {
            isAuthorized = true;
            validSchoolId = found.id;
          } else {
            isAuthorized = true;
            validSchoolId = 'school-' + emailLower.replace(/[^a-zA-Z0-9]/g, '-');
          }
        }
      }

      if (!isAuthorized) {
        return res.status(403).json({
          error: `Registration denied: The email address (${emailLower}) has not been onboarded by an Admin. Please contact the administrator to onboard your school before creating an account.`
        });
      }
    } catch (err) {
      console.error("School validation error:", err);
      return res.status(500).json({ error: 'Internal server error during validation' });
    }
  }

  const permissions = role === 'admin'
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

  try {
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
  } catch (err: any) {
    console.error("Error creating profile in server:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Returns the caller's full current profile (session tokens only carry uid/role/schoolId,
// not name/permissions/etc.) — a deliberate Firestore read, since this is a low-frequency
// "fetch my full profile" call, not the hot exam-taking path.
router.get('/api/auth/session', requireSession, async (req: any, res) => {
  try {
    const userSnap = await clientGetDoc(clientDoc(clientDb, 'users', req.auth.uid));
    if (!userSnap.exists()) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    return res.status(200).json({ success: true, profile: userSnap.data() });
  } catch (err: any) {
    console.error("Error validating session token in server:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
