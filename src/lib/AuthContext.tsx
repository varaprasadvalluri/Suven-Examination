import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, signInWithGoogle as firebaseSignInWithGoogle, signInWithEmail as firebaseSignInWithEmail, signUpWithEmail as firebaseSignUpWithEmail, logout as firebaseLogout, sendPasswordResetEmail as firebaseSendPasswordResetEmail } from './firebase';
import { UserProfile, AppPermission, UserRole } from '../types';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string, role: 'admin' | 'school' | 'student', schoolId?: string) => Promise<void>;
  signInWithDemo: (role: 'admin' | 'school' | 'student') => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface RetryOptions {
  retries: number;
  timeoutMs: number;
  initialDelayMs: number;
  factor: number;
}

const runWithRetry = async <T,>(
  fn: () => Promise<T>,
  options: RetryOptions = { retries: 3, timeoutMs: 15000, initialDelayMs: 1000, factor: 2 }
): Promise<T> => {
  let attempt = 0;
  while (true) {
    attempt++;
    let timeoutId: any;
    
    // Create a promise that rejects after timeoutMs
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Network connection timed out. Please check your internet connectivity."));
      }, options.timeoutMs);
    });

    try {
      // Race the actual async execution with the timeout
      const result = await Promise.race([
        fn().finally(() => clearTimeout(timeoutId)),
        timeoutPromise
      ]);
      return result;
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      // If we exhausted all retry attempts, throw a descriptive user-facing error
      if (attempt > options.retries) {
        throw new Error(
          error.message?.includes("timed out")
            ? "Network Timeout: The security gateway timed out after 15 seconds. Please verify your connection status and try again."
            : `Authentication Connection Failed: ${error.message || "An unexpected network disruption occurred."}`
        );
      }

      // Calculate exponential backoff delay: 1s, 2s, 4s...
      const delay = options.initialDelayMs * Math.pow(options.factor, attempt - 1);
      toast.warning(`Connection disruption: Login attempt ${attempt}/${options.retries + 1} failed. Re-establishing link in ${(delay / 1000).toFixed(1)}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const local = localStorage.getItem('invite_student_profile');
      if (local) {
        const parsed = JSON.parse(local);
        if (parsed && parsed.uid) {
          return { uid: parsed.uid, email: parsed.email, displayName: parsed.name } as any;
        }
      }
    } catch (e) {
      console.warn("Failed to parse invite_student_profile from localStorage:", e);
      localStorage.removeItem('invite_student_profile');
    }
    return null;
  });
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    try {
      const local = localStorage.getItem('invite_student_profile');
      if (local) {
        return JSON.parse(local);
      }
    } catch (e) {
      console.warn("Failed to parse invite_student_profile from localStorage:", e);
      localStorage.removeItem('invite_student_profile');
    }
    return null;
  });
  const [loading, setLoading] = useState(() => {
    try {
      const local = localStorage.getItem('invite_student_profile');
      if (local && JSON.parse(local)) {
        return false;
      }
    } catch (e) {}
    return true;
  });

  const lookupSchoolByEmail = async (emailStr?: string | null): Promise<{ schoolId: string | undefined; isSchool: boolean }> => {
    if (!emailStr) return { schoolId: undefined, isSchool: false };
    const lowerEmail = emailStr.trim().toLowerCase();
    
    try {
      // 1. Check schools collection where adminEmail == lowerEmail
      const schoolsRef = collection(db, 'schools');
      const qAdmin = query(schoolsRef, where('adminEmail', '==', lowerEmail));
      const snapAdmin = await getDocs(qAdmin);
      if (!snapAdmin.empty) {
        return { schoolId: snapAdmin.docs[0].id, isSchool: true };
      }

      // 2. Check allowed_schools collection
      const safeEmailId = lowerEmail.replace(/[^a-zA-Z0-9_-]/g, '_');
      const allowedDoc = await getDoc(doc(db, 'allowed_schools', safeEmailId));
      if (allowedDoc.exists() && allowedDoc.data()?.schoolId) {
        return { schoolId: allowedDoc.data()?.schoolId, isSchool: true };
      }

      const qAllowed = query(collection(db, 'allowed_schools'), where('email', '==', lowerEmail));
      const snapAllowed = await getDocs(qAllowed);
      if (!snapAllowed.empty && snapAllowed.docs[0].data()?.schoolId) {
        return { schoolId: snapAllowed.docs[0].data()?.schoolId, isSchool: true };
      }

      // 3. Check allowedDomains in all schools
      const emailDomain = lowerEmail.split('@')[1];
      if (emailDomain) {
        const allSchoolsSnap = await getDocs(schoolsRef);
        const domainMatch = allSchoolsSnap.docs.find(d => {
          const domains = d.data()?.allowedDomains;
          return Array.isArray(domains) && domains.map((dm: string) => dm.trim().toLowerCase()).includes(emailDomain);
        });
        if (domainMatch) {
          return { schoolId: domainMatch.id, isSchool: true };
        }
      }
    } catch (err) {
      console.warn("Error looking up school by email in AuthContext:", err);
    }

    return { schoolId: undefined, isSchool: false };
  };

  const checkFirestoreAdminStatus = async (firebaseUser: User, userEmail: string): Promise<boolean> => {
    if (!userEmail && !firebaseUser.uid) return false;
    try {
      // Check admins or super_admins collection in Firestore
      const superAdminByUid = await getDoc(doc(db, 'super_admins', firebaseUser.uid));
      if (superAdminByUid.exists()) return true;

      const adminByUid = await getDoc(doc(db, 'admins', firebaseUser.uid));
      if (adminByUid.exists()) return true;

      if (userEmail) {
        const safeEmailId = userEmail.replace(/[^a-zA-Z0-9_-]/g, '_');
        const superAdminByEmail = await getDoc(doc(db, 'super_admins', safeEmailId));
        if (superAdminByEmail.exists()) return true;

        const adminByEmail = await getDoc(doc(db, 'admins', safeEmailId));
        if (adminByEmail.exists()) return true;

        const qSuper = query(collection(db, 'super_admins'), where('email', '==', userEmail));
        const snapSuper = await getDocs(qSuper);
        if (!snapSuper.empty) return true;

        const qAdmin = query(collection(db, 'admins'), where('email', '==', userEmail));
        const snapAdmin = await getDocs(qAdmin);
        if (!snapAdmin.empty) return true;
      }
    } catch (err) {
      console.warn("Firestore admin check error:", err);
    }
    return false;
  };

  const fetchProfile = async (firebaseUser: User) => {
    try {
      const userRef = doc(db, 'users', firebaseUser.uid);
      const userSnap = await getDoc(userRef);
      const userEmail = firebaseUser.email?.trim().toLowerCase() || '';

      const { schoolId } = await lookupSchoolByEmail(userEmail);

      if (userSnap.exists()) {
        const existingData = userSnap.data() as UserProfile;
        
        // Respect whatever role is in Firestore.
        // If role is school but schoolId was resolved, update schoolId if missing
        if (existingData.role === 'school' && !existingData.schoolId && schoolId) {
          const updatedProfile: UserProfile = {
            ...existingData,
            schoolId
          };
          await updateDoc(userRef, { schoolId });
          setProfile(updatedProfile);
          return;
        }

        setProfile(existingData);
      } else {
        // NEW USER PROFILE CREATION - Check Firestore for admin record or default to school/student
        const isAdminInFirestore = await checkFirestoreAdminStatus(firebaseUser, userEmail);

        let assignedRole: UserRole = 'school';
        if (isAdminInFirestore) {
          assignedRole = 'admin';
        } else if (userEmail.includes('student')) {
          assignedRole = 'student';
        }

        let permissions: AppPermission[] = [];
        if (assignedRole === 'admin') {
          permissions = ['manage_exams', 'view_results'];
        } else if (assignedRole === 'school') {
          permissions = ['manage_exams', 'view_results', 'manage_students'];
        } else {
          permissions = ['take_exams'];
        }

        const newProfile: UserProfile = {
          uid: firebaseUser.uid,
          name: firebaseUser.displayName || userEmail.split('@')[0] || 'User',
          email: userEmail,
          role: assignedRole,
          permissions,
          schoolId: schoolId || undefined,
          createdAt: new Date().toISOString()
        };

        await setDoc(userRef, newProfile);
        setProfile(newProfile);
      }
    } catch (error: any) {
      console.error("Error fetching user profile from Firestore:", error);
      const userEmail = firebaseUser.email?.trim().toLowerCase() || '';
      const defaultRole: UserRole = userEmail.includes('student') ? 'student' : 'school';

      setProfile({
        uid: firebaseUser.uid,
        name: firebaseUser.displayName || userEmail.split('@')[0] || 'User',
        email: userEmail,
        role: defaultRole,
        permissions: defaultRole === 'school' ? ['manage_exams', 'view_results', 'manage_students'] : ['take_exams'],
        createdAt: new Date().toISOString()
      });
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user);
    }
  };

  useEffect(() => {
    if (localStorage.getItem('invite_student_profile')) {
      setLoading(false);
      return;
    }
    
    // Safety fallback: Ensure app never hangs indefinitely on loading
    const safetyTimer = setTimeout(() => {
      setLoading(false);
    }, 2500);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(safetyTimer);
      setUser(firebaseUser);
      if (firebaseUser) {
        setLoading(true);
        try {
          await fetchProfile(firebaseUser);
        } finally {
          setLoading(false);
        }
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    try {
      await firebaseSignInWithGoogle();
    } catch (err: any) {
      console.error("Google Sign-in Error:", err);
      toast.error("Google Sign-in failed: " + err.message);
      throw err;
    }
  };

  const signInWithEmail = async (email: string, pass: string) => {
    try {
      await runWithRetry(async () => {
        await firebaseSignInWithEmail(email, pass);
      });
    } catch (err: any) {
      throw err;
    }
  };

  const signUpWithEmail = async (email: string, pass: string, name: string, role: 'admin' | 'school' | 'student', schoolId?: string) => {
    try {
      const firebaseUser = await firebaseSignUpWithEmail(email, pass, name);
      const userRef = doc(db, 'users', firebaseUser.uid);
      const lowerEmail = email.trim().toLowerCase();

      let resolvedSchoolId = schoolId;
      if (!resolvedSchoolId) {
        const schoolLookup = await lookupSchoolByEmail(lowerEmail);
        if (schoolLookup.schoolId) {
          resolvedSchoolId = schoolLookup.schoolId;
        } else if (role === 'school') {
          resolvedSchoolId = 'school-' + lowerEmail.replace(/[^a-zA-Z0-9]/g, '-');
        }
      }

      let assignedRole = role;
      if (assignedRole === 'admin') {
        const isAdminInFirestore = await checkFirestoreAdminStatus(firebaseUser, lowerEmail);
        if (!isAdminInFirestore) {
          assignedRole = 'school';
        }
      }

      let permissions: AppPermission[] = [];
      if (assignedRole === 'admin') permissions = ['manage_exams', 'view_results'];
      else if (assignedRole === 'school') permissions = ['manage_exams', 'view_results', 'manage_students'];
      else permissions = ['take_exams'];

      const newProfile: UserProfile = {
        uid: firebaseUser.uid,
        name,
        email: lowerEmail,
        role: assignedRole,
        permissions,
        schoolId: resolvedSchoolId,
        createdAt: new Date().toISOString()
      };

      await setDoc(userRef, newProfile);
      setProfile(newProfile);
    } catch (err: any) {
      toast.error("Sign-up failed: " + err.message);
      throw err;
    }
  };

  const signInWithDemo = async (role: 'admin' | 'school' | 'student') => {
    setLoading(true);
    try {
      const demoNames = {
        admin: 'Dr. Amruthav (Lead Dean)',
        school: 'Narayana Core Proctor',
        student: 'Rohan Sharma (Rank 1 Candidate)'
      };
      
      const email = `${role}@suvenedu.demo`;
      const pass = `demoPassword123!`;
      const name = demoNames[role];

      let firebaseUser: User;
      try {
        firebaseUser = await firebaseSignInWithEmail(email, pass);
      } catch (signInErr: any) {
        try {
          firebaseUser = await firebaseSignUpWithEmail(email, pass, name);
        } catch (signUpErr: any) {
          throw new Error(`Failed to initialize or sign in to sandbox user: ${signUpErr.message || signUpErr}`);
        }
      }

      await fetchProfile(firebaseUser);
      toast.success(`Sandbox Access Configured: Logged in as ${role.toUpperCase()}`);
    } catch (err: any) {
      toast.error("Sandbox failure: " + err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      await firebaseLogout();
    } catch (e) {
      // Ignore firebase auth logout if offline/demo
    }
    // Properly clear all session data, tokens (JWT/Cookies), and local cache upon logout
    localStorage.clear();
    sessionStorage.clear();
    
    // Clear cookies by setting their expiration date to the past
    document.cookie.split(";").forEach((cookie) => {
      const eqPos = cookie.indexOf("=");
      const name = eqPos > -1 ? cookie.slice(0, eqPos).trim() : cookie.trim();
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;`;
    });

    setProfile(null);
    setUser(null);
  };

  const sendPasswordResetEmail = async (email: string) => {
    try {
      await firebaseSendPasswordResetEmail(email);
    } catch (err: any) {
      console.error("Password reset error:", err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      loading, 
      signInWithGoogle, 
      signInWithEmail,
      signUpWithEmail,
      signInWithDemo,
      signOut,
      refreshProfile,
      sendPasswordResetEmail
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
