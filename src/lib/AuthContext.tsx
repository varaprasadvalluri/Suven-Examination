import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, signInWithGoogle as firebaseSignInWithGoogle, signInWithEmail as firebaseSignInWithEmail, signUpWithEmail as firebaseSignUpWithEmail, logout as firebaseLogout, sendPasswordResetEmail as firebaseSendPasswordResetEmail } from './firebase';
import { UserProfile, AppPermission } from '../types';
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
    const local = localStorage.getItem('invite_student_profile');
    if (local) {
      const parsed = JSON.parse(local);
      return { uid: parsed.uid, email: parsed.email, displayName: parsed.name } as any;
    }
    return null;
  });
  const [profile, setProfile] = useState<UserProfile | null>(() => {
    const local = localStorage.getItem('invite_student_profile');
    return local ? JSON.parse(local) : null;
  });
  const [loading, setLoading] = useState(() => {
    const local = localStorage.getItem('invite_student_profile');
    return local ? false : true;
  });

  const fetchProfile = async (firebaseUser: User) => {
    try {
      const response = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName
        })
      });

      if (!response.ok) {
        throw new Error(await response.text() || 'Failed to validate authentication with server');
      }

      const data = await response.json();
      if (data.success) {
        localStorage.setItem('secure_session_token', data.sessionToken);
        setProfile(data.profile);
      }
    } catch (error: any) {
      console.error("Critical Error in fetchProfile:", error);
      toast.error("Profile validation failed: " + error.message);
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
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
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

    return () => unsubscribe();
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
      
      const response = await fetch('/api/auth/create-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uid: firebaseUser.uid,
          email,
          name,
          role,
          schoolId
        })
      });

      if (!response.ok) {
        throw new Error(await response.text() || 'Failed to create user profile on backend');
      }

      const data = await response.json();
      if (data.success) {
        localStorage.setItem('secure_session_token', data.sessionToken);
        setProfile(data.profile);
      }
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
