import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, signInWithGoogle as firebaseSignInWithGoogle, signInWithEmail as firebaseSignInWithEmail, signUpWithEmail as firebaseSignUpWithEmail, logout as firebaseLogout, sendPasswordResetEmail as firebaseSendPasswordResetEmail } from './firebase';
import { UserProfile, UserRole } from '../types';
import { onAuthStateChanged, User } from 'firebase/auth';
import { toast } from 'sonner';
import { setSessionToken, clearSessionToken } from './sessionStore';

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

  // Delegates profile lookup/creation and role assignment entirely to the server
  // (/api/auth/validate), which verifies the caller's Firebase ID token and applies the
  // real authorization rules (e.g. admin self-registration is blocked). This also mints
  // the session token that authorizes every subsequent /api/db/query and /api/db/write call.
  const fetchProfile = async (firebaseUser: User) => {
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ displayName: firebaseUser.displayName })
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to validate session');
      }
      setSessionToken(payload.sessionToken);
      setProfile(payload.profile);
    } catch (error: any) {
      console.error("Error validating session with server:", error);
      const userEmail = firebaseUser.email?.trim().toLowerCase() || '';
      const defaultRole: UserRole = userEmail.includes('student') ? 'student' : 'school';

      // Offline/network-failure fallback: a local-only best-guess profile so the UI doesn't
      // hard-fail. No session token is issued, so subsequent DB proxy calls will 401 until
      // connectivity is restored and the next fetchProfile succeeds.
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
    let firebaseUser: User | null = null;
    try {
      firebaseUser = await firebaseSignUpWithEmail(email, pass, name);
      const idToken = await firebaseUser.getIdToken();

      // Server enforces the real rules here: admin self-registration is hard-blocked, and a
      // 'school' role is only granted if the email is verified against allowed_schools/schools.
      const res = await fetch('/api/auth/create-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ name, role, schoolId })
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to create profile');
      }
      setSessionToken(payload.sessionToken);
      setProfile(payload.profile);
    } catch (err: any) {
      // The Firebase Auth account is created before the server-side authorization check
      // runs (it has to be — we need a UID/ID token to call that check at all). If the
      // check then rejects the signup, roll the just-created account back so the user
      // isn't left with an orphaned, unusable "already registered" account on retry.
      if (firebaseUser) {
        try {
          await firebaseUser.delete();
        } catch (cleanupErr) {
          console.warn("Could not roll back orphaned signup account:", cleanupErr);
        }
      }
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
    clearSessionToken(); // clears the in-memory cache too, not just localStorage
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
