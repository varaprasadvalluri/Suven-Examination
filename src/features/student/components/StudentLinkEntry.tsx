import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { db, doc, getDoc, getDocs, collection, query, where, runTransaction } from '../../../lib/firebase';
import { Button } from '../../../components/ui/button';
import { Card, CardDescription, CardTitle } from '../../../components/ui/card';
import { toast } from 'sonner';
import { ShieldCheck, AlertCircle, ShieldAlert, Lock, User2, Key, Loader2 } from 'lucide-react';
import { useAuth } from '../../../lib/AuthContext';
import { setSessionToken } from '../../../lib/sessionStore';
import { ExamInstructionsScreen } from '../../exam-session';
import { isAttemptFinished, isReopenedBySchoolLink } from '../../../../shared/attemptStatus';
import { BrandingPanel } from '../../../shared/components/BrandingPanel';
import { LobbyConsentNotice } from '../../../shared/components/LobbyConsentNotice';

export const StudentLinkEntry: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { routeSchoolId, routeExamId, routeToken } = useParams();

  const examId = routeExamId || searchParams.get('examId');
  const schoolId = routeSchoolId || searchParams.get('schoolId');
  const token = routeToken || searchParams.get('token'); // Read dynamic token
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  const [exam, setExam] = useState<any | null>(null);
  const [school, setSchool] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenVerified, setTokenVerified] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Parsed and verified IDs
  const [resolvedExamId, setResolvedExamId] = useState<string | null>(null);
  const [resolvedSchoolId, setResolvedSchoolId] = useState<string | null>(null);
  // The secure link's whole-school re-attempt grant, if the school issued one. Null for a
  // tokenless entry, which is why the fallback gate below keeps working exactly as before
  // when there is no link in play.
  const [linkReattemptFrom, setLinkReattemptFrom] = useState<string | null>(null);

  // Form State
  const [username, setUsername] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  const [step, setStep] = useState<'login' | 'instructions'>('login');
  const [matchedStudentProfile, setMatchedStudentProfile] = useState<any | null>(null);
  // Proof that /api/v1/exam-entry/identity/verify actually checked this identity server-side —
  // required by /api/v1/exam-entry/enrollments instead of trusting a client-asserted student id.
  const [verificationTicket, setVerificationTicket] = useState<string | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [questions, setQuestions] = useState<any[]>([]);

  const handleReturnToLogin = async () => {
    try {
      await signOut();
    } catch (err) {
      console.warn('Failed to clear credentials during restricted logout direct:', err);
    }
    setUsername('');
    setRollNumber('');
    navigate('/login');
  };

  useEffect(() => {
    const runProactiveSecurityPurge = async () => {
      try {
        await signOut();
        setUsername('');
        setRollNumber('');
      } catch (e) {
        console.warn('[Security Monitor] Failed proactive session clean-up:', e);
      }
    };
    runProactiveSecurityPurge();
  }, [signOut]);

  useEffect(() => {
    const fetchDetails = async () => {
      setLoading(true);
      setTokenError(null);

      // Rule Block: Restrict Administrators from taking/accessing school student portals
      if (profile?.role === 'admin') {
        setTokenError(
          'ADMIN_EXCLUSION_RULE: System Administrators are strictly restricted from entering or taking exams via school/candidate dynamic links. Please configure parameters from the main administrative dashboard.'
        );
        setLoading(false);
        return;
      }

      try {
        let activeExamId = examId;
        let activeSchoolId = schoolId;

        // If there's a dynamic cryptographically secure token
        if (token) {
          // We can locate the token in the 'secure_exam_links' collection by querying for the token value or document ID
          // Let's first search with standard doc query since the link generator writes 'gen_{schoolId}_{examId}' as document ID
          // Since we might not know schoolId and examId immediately from token query param alone,
          // let's run a query for the token attribute on 'secure_exam_links' collection
          const linksQuery = query(collection(db, 'secure_exam_links'), where('id', '==', token));
          const linksSnap = await getDocs(linksQuery);

          if (linksSnap.empty) {
            setTokenError('AUTHENTICITY_FAILED: The dynamic security link provided is unauthentic, tampered with, or revoked.');
            setLoading(false);
            return;
          }

          const tokenDoc = linksSnap.docs[0];
          const tokenData = tokenDoc.data();

          // Double-Layered Dynamic Link Specificity: verify that the school and exam in route matches the token
          if ((schoolId && tokenData.schoolId !== schoolId) || (examId && tokenData.examId !== examId)) {
            setTokenError('MISMATCH_VIOLATION: Security parameters do not match the designated school and exam paper registry layout.');
            setLoading(false);
            return;
          }

          // A. Authenticity & Master Switch check
          if (!tokenData.isActive) {
            setTokenError('REVOKED: This dynamic exam portal access link has been deactivated globally by your school administrator.');
            setLoading(false);
            return;
          }

          // B. Temporal Window validation
          const now = new Date();
          if (tokenData.expiresAt && now > new Date(tokenData.expiresAt)) {
            setTokenError(
              `EXPIRED: The temporal window for this secure exam session expired on ${new Date(tokenData.expiresAt).toLocaleString()}.`
            );
            setLoading(false);
            return;
          }

          activeExamId = tokenData.examId;
          activeSchoolId = tokenData.schoolId;
          setResolvedExamId(activeExamId);
          setResolvedSchoolId(activeSchoolId);
          // Carried so the offline fallback transaction below can apply the same whole-school
          // re-attempt grant the server gate applies. Read here rather than re-fetched: this
          // is the doc that holds it, and it has just been validated as active and unexpired.
          setLinkReattemptFrom(tokenData.reattemptFrom || null);
          setTokenVerified(true);
        }

        if (!activeExamId || !activeSchoolId) {
          setLoading(false);
          return;
        }

        // Fetch Exam Description
        const examRef = doc(db, 'exams', activeExamId);
        const examSnap = await getDoc(examRef);
        let resolvedExam: any = null;
        if (examSnap.exists()) {
          resolvedExam = { id: examSnap.id, ...examSnap.data() };

          // Guard Temporal Access Window (Expiration check) BEFORE loading school details or caching exam metadata!
          const now = new Date();
          if (resolvedExam.endTime) {
            const endTimeDate = new Date(resolvedExam.endTime);
            if (now > endTimeDate) {
              setTokenError(
                `EXPIRED: The temporal window for this secure exam session has expired (locked on ${endTimeDate.toLocaleString()}). Access to school resources and examination details is restricted.`
              );
              setLoading(false);
              return;
            }
          }

          setExam(resolvedExam);

          // Fetch Questions to group by subject for exam structure
          const qsQuery = query(collection(db, 'questions'), where('examId', '==', activeExamId));
          const qsSnap = await getDocs(qsQuery);
          const resolvedQuestions = qsSnap.docs.map((questionDoc) => ({ id: questionDoc.id, ...questionDoc.data() }));
          setQuestions(resolvedQuestions);
        } else {
          setTokenError('EXAM_NOT_FOUND: The referenced exam paper document has been deleted or does not exist.');
          setLoading(false);
          return;
        }

        // Fetch School profile details
        const schoolRef = doc(db, 'schools', activeSchoolId);
        const schoolSnap = await getDoc(schoolRef);
        if (schoolSnap.exists()) {
          setSchool({ id: schoolSnap.id, ...schoolSnap.data() });
        } else {
          setTokenError('SCHOOL_NOT_FOUND: The authorized school portal context is unrecognized.');
          setLoading(false);
          return;
        }

        // C. Institutional Boundary Check: Is this school authorized to access this specific exam paper?
        if (resolvedExam) {
          const hasSchoolIdMismatch = resolvedExam.schoolId && resolvedExam.schoolId !== activeSchoolId;
          const isAssignedToThisSchool =
            !resolvedExam.assignedSchoolIds ||
            resolvedExam.assignedSchoolIds.length === 0 ||
            resolvedExam.assignedSchoolIds.includes(activeSchoolId);

          if (hasSchoolIdMismatch || !isAssignedToThisSchool) {
            setTokenError(
              'UNAUTHORIZED: Your school registration block is not authorized to host, distribute, or access this designated exam paper.'
            );
            setLoading(false);
            return;
          }
        }
      } catch (err) {
        console.error('Error loading secure entry node details', err);
        setTokenError('CRITICAL: Failed to validate administrative credentials.');
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [examId, schoolId, token]);

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalExamId = resolvedExamId || examId;
    const finalSchoolId = resolvedSchoolId || schoolId;

    if (!finalExamId || !finalSchoolId) {
      toast.error('Invalid portal payload. Missing exam or school parameters.');
      return;
    }

    if (!username.trim() || !rollNumber.trim()) {
      toast.error('Please provide both your Username and Roll / Register Number.');
      return;
    }

    setIsLaunching(true);
    const toastId = toast.loading('Verifying gatekeeper credentials & active session...');

    try {
      // 1. MODULE 3: Guard Temporal Access Window (Expiration check)
      const now = new Date();
      if (exam?.endTime) {
        const endTimeDate = new Date(exam.endTime);
        if (now > endTimeDate) {
          toast.error(`Portal Expired: The exam window locked on ${endTimeDate.toLocaleString()}.`, { id: toastId });
          setIsLaunching(false);
          return;
        }
      }
      if (exam?.startTime) {
        const startTimeDate = new Date(exam.startTime);
        if (now < startTimeDate) {
          toast.error(`Portal Inactive: Registration opens on ${startTimeDate.toLocaleString()}.`, { id: toastId });
          setIsLaunching(false);
          return;
        }
      }

      // Search for (or auto-onboard) the student by roll number — done server-side since
      // there's no session yet at this point in the flow (identical result to the old
      // direct-Firestore lookup, just routed through a route that runs before auth exists).
      const verifyRes = await fetch('/api/v1/exam-entry/identity/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rollNumber: rollNumber.trim(),
          schoolId: finalSchoolId,
          username: username.trim()
        })
      });
      const verifyPayload = await verifyRes.json();
      if (!verifyRes.ok || !verifyPayload.success) {
        throw new Error(verifyPayload.error || 'Identity verification failed.');
      }

      const profileData = verifyPayload.profileData;

      setMatchedStudentProfile(profileData);
      setVerificationTicket(verifyPayload.verificationTicket);

      toast.success('Identity verified! Please read and agree to the instructions to proceed.', { id: toastId });
      setStep('instructions');
    } catch (err: any) {
      console.error('[Gatekeeper Verification Event]:', err);
      toast.error(`Authorization Discrepancy: ${err.message || 'A technical error occurred alignment details.'}`, { id: toastId });
    } finally {
      setIsLaunching(false);
    }
  };

  const handleConfirmStartExam = async () => {
    if (!agreedToTerms) {
      toast.error('Please read and agree to the instructions by selecting the checkbox.');
      return;
    }

    const finalExamId = resolvedExamId || examId;
    const finalSchoolId = resolvedSchoolId || schoolId;
    let attemptIdRaw = '';

    if (!finalExamId || !finalSchoolId || !matchedStudentProfile) {
      toast.error('Invalid portal session payload. Please return and log in again.');
      return;
    }

    setIsLaunching(true);
    const toastId = toast.loading('Initializing secure attempt session...');

    try {
      const now = new Date();
      const clientFootprint = btoa([navigator.userAgent, screen.width, screen.height, navigator.language].join('|')).substring(0, 32);

      const resolvedStudentId = matchedStudentProfile.uid;
      const studentDocRef = doc(db, 'users', resolvedStudentId);
      attemptIdRaw = `att_${finalExamId}_${resolvedStudentId}`;
      const attemptDocRef = doc(db, 'attempts', attemptIdRaw);

      let finalStudentProfile: any = null;
      let backendSuccess = false;

      // HYBRID TRANSITION ROUTING LAYER
      try {
        console.log('Attempting secure state enrollment via Node.js Express backend API...');
        const response = await fetch('/api/v1/exam-entry/enrollments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            matchedStudentData: matchedStudentProfile,
            username: matchedStudentProfile.name,
            rollNumber: matchedStudentProfile.rollNumber,
            finalSchoolId,
            finalExamId,
            examTitle: exam?.title,
            clientFootprint,
            verificationTicket
          })
        });

        if (response.ok) {
          const resData = await response.json();
          if (resData.success) {
            finalStudentProfile = resData.finalStudentProfile;
            attemptIdRaw = resData.attemptIdRaw;
            backendSuccess = true;
            // Invite-link students never authenticate via Firebase, so this session token is
            // the only thing that authorizes their subsequent exam-taking API calls.
            if (resData.sessionToken) {
              setSessionToken(resData.sessionToken);
            }
            console.log('Successfully processed gatekeeper enrollment via Node.js API backend.');
          }
        } else {
          const errorPayload = await response.json().catch(() => ({}));
          if (errorPayload.code === 'EXAM_ALREADY_COMPLETED') {
            throw new Error('EXAM_ALREADY_COMPLETED');
          }
          if (errorPayload.code === 'SESSION_HIJACK_BLOCKED') {
            throw new Error(errorPayload.error);
          }
          if (errorPayload.code === 'EXAM_WINDOW_EXPIRED') {
            throw new Error('EXAM_WINDOW_EXPIRED');
          }
          console.warn(`Server responded with failure: ${response.status}. Reverting to client-side Firebase fallback.`);
        }
      } catch (backendError: any) {
        if (
          backendError.message === 'EXAM_ALREADY_COMPLETED' ||
          backendError.message === 'EXAM_WINDOW_EXPIRED' ||
          backendError.message.includes('SESSION_HIJACK_BLOCKED')
        ) {
          throw backendError;
        }
        console.warn('Express backend API unreachable/unstable. Invoking client-side Firebase Fallback Rule:', backendError);
      }

      let fallbackExamWindowExpired = false;
      if (!backendSuccess) {
        await runTransaction(db, async (transaction) => {
          const studentSnap = await transaction.get(studentDocRef);
          const attemptSnap = await transaction.get(attemptDocRef);

          if (studentSnap.exists()) {
            finalStudentProfile = { uid: studentSnap.id, ...studentSnap.data() };
          } else {
            finalStudentProfile = { ...matchedStudentProfile };
            transaction.set(studentDocRef, finalStudentProfile);
          }

          if (attemptSnap.exists()) {
            const attemptData = attemptSnap.data() as any;

            // 'expired' gets the same canReattempt gate as 'completed' — otherwise a school
            // re-triggering an expired attempt would never actually unlock it (the resume
            // branch below would just re-expire it again without ever consulting canReattempt).
            // Mirrors the server-side gate in server/routes/gatekeeper.ts: an attempt that
            // has been handed in but is still grading ('submitted') is finished for re-entry
            // purposes, even though it isn't 'completed' yet.
            if (isAttemptFinished(attemptData.status) || attemptData.status === 'expired') {
              // Same pair of grants the server gate checks (server/routes/gatekeeper.ts):
              // the per-student canReattempt flag, or the school-wide reattemptFrom carried
              // on the secure link. This branch only runs when the backend call failed, so
              // without the second check a school-wide-granted student would be told their
              // exam was already completed purely because the server was unreachable.
              if (attemptData.canReattempt || isReopenedBySchoolLink(attemptData, linkReattemptFrom)) {
                transaction.update(attemptDocRef, {
                  status: 'started',
                  score: 0,
                  answers: [],
                  startTime: now.toISOString(),
                  // Cleared for the same reason the server gate clears it: isReopenedBySchoolLink
                  // reads `endTime || startTime`, so a leftover endTime from the previous sitting
                  // would stay older than the grant and keep re-opening this attempt.
                  endTime: null,
                  canReattempt: false
                });
              } else if (attemptData.status === 'expired') {
                fallbackExamWindowExpired = true;
              } else {
                throw new Error('EXAM_ALREADY_COMPLETED');
              }
            } else {
              if (attemptData.deviceFootprint && attemptData.deviceFootprint !== clientFootprint) {
                throw new Error(
                  'SESSION_HIJACK_BLOCKED: Mismatched browser/device footprint registered for this unique link. Please complete on your primary device or request a clean reset from terminal administrators.'
                );
              }

              // Lazy expiry, mirroring the server-side gatekeeper check — must set a flag
              // and let the transaction commit normally rather than throw, since throwing
              // inside a Firestore transaction discards every queued write in it, including
              // the "mark expired" update itself. Includes any school-granted extraTime,
              // same reasoning as the server-side check (ExamInterface.tsx honors extraTime
              // live during the exam, so the expiry check must too or a legitimately
              // time-extended student gets wrongly expired).
              const durationMs = exam?.duration ? (exam.duration + (attemptData.extraTime || 0)) * 60 * 1000 : null;
              const elapsedMs = now.getTime() - new Date(attemptData.startTime).getTime();
              if (durationMs && elapsedMs > durationMs) {
                fallbackExamWindowExpired = true;
                transaction.update(attemptDocRef, { status: 'expired' });
              } else {
                transaction.update(attemptDocRef, {
                  lastResumedAt: now.toISOString(),
                  status: 'started'
                });
              }
            }
          } else {
            const newAttemptData = {
              examId: finalExamId,
              examTitle: exam?.title || 'Single Term Link Entry Exam',
              studentId: resolvedStudentId,
              studentName: finalStudentProfile.name,
              studentEmail: finalStudentProfile.email || `${finalStudentProfile.rollNumber?.toLowerCase()}@school.com`,
              schoolId: finalSchoolId,
              answers: [],
              score: 0,
              startTime: now.toISOString(),
              status: 'started',
              deviceFootprint: clientFootprint,
              ephemeralToken: btoa(Math.random().toString()).substring(0, 16),
              timePerQuestion: {}
            };
            transaction.set(attemptDocRef, newAttemptData);
          }
        });

        if (fallbackExamWindowExpired) {
          throw new Error('EXAM_WINDOW_EXPIRED');
        }
      }

      sessionStorage.setItem('invite_student_profile', JSON.stringify(finalStudentProfile || matchedStudentProfile));
      toast.success('Gatekeeper synchronized! Redirecting to your dashboard...', { id: toastId });

      // Land on the dashboard (triggered exam shows there as In Progress) instead of
      // auto-launching straight into the exam interface.
      setTimeout(() => {
        window.location.href = '/student/dashboard';
      }, 500);
    } catch (err: any) {
      console.error('[Gatekeeper Security Event]:', err);
      if (err.message === 'EXAM_ALREADY_COMPLETED') {
        toast.error('Access Forbidden: Your assessment attempt has already been submitted and finalized.', { id: toastId });
        navigate(`/result/${attemptIdRaw}`);
      } else if (err.message === 'EXAM_WINDOW_EXPIRED') {
        toast.error("This exam's time window has passed. Ask your school to re-trigger a fresh attempt.", { id: toastId, duration: 8000 });
      } else if (err.message && err.message.includes('SESSION_HIJACK_BLOCKED')) {
        toast.error(err.message, { id: toastId, duration: 8000 });
      } else {
        toast.error(`Authorization Discrepancy: ${err.message || 'A technical error occurred alignment details.'}`, { id: toastId });
      }
      setIsLaunching(false);
    }
  };

  const finalExamId = resolvedExamId || examId;
  const finalSchoolId = resolvedSchoolId || schoolId;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0F4FA] flex flex-col items-center justify-center gap-6 p-4">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
        <p className="text-slate-700 font-display font-black text-xs uppercase tracking-widest animate-pulse">
          Establishing Secure Exam Link Core...
        </p>
      </div>
    );
  }

  if (tokenError) {
    return (
      <div className="min-h-screen bg-[#F0F4FA] flex items-center justify-center p-4">
        <Card className="w-full max-w-lg border-rose-500 shadow-2xl rounded-3xl overflow-hidden bg-white border-t-8 border-t-rose-600">
          <div className="p-8 text-center space-y-4">
            <div className="h-16 w-16 bg-rose-50 border-2 border-rose-200 text-rose-600 rounded-full flex items-center justify-center mx-auto animate-pulse">
              <ShieldAlert size={32} />
            </div>
            <CardTitle className="text-xl font-black text-rose-950 uppercase tracking-tight">Security Gateway Blocked</CardTitle>
            <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl text-left">
              <p className="text-[#C62828] text-[11px] md:text-[10px] font-black uppercase tracking-wider mb-1">Violation Diagnostics:</p>
              <p className="text-rose-800 text-xs font-semibold leading-relaxed">{tokenError}</p>
            </div>
            <CardDescription className="text-slate-500 text-xs font-medium leading-relaxed">
              Dynamically sealed URLs expire past designated schedules or are locked instantly when the physical/institutional terminal
              detects potential session spoofing. Please request your institution's director to re-generate the secure token.
            </CardDescription>
            <Button
              variant="default"
              className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold uppercase text-xs tracking-wider"
              onClick={handleReturnToLogin}
            >
              Return to Login Portal
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!finalExamId || !finalSchoolId || !exam) {
    return (
      <div className="min-h-screen bg-[#F0F4FA] flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-rose-300 shadow-2xl rounded-3xl overflow-hidden bg-white">
          <div className="p-8 text-center space-y-4">
            <div className="h-16 w-16 bg-rose-50 border-2 border-rose-100 text-rose-500 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={32} />
            </div>
            <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">Security Gateway Error</CardTitle>
            <CardDescription className="text-slate-500 text-xs font-semibold leading-relaxed">
              The secure link is incomplete or contains critical parameter discrepancies. Please ensure you are opening the exact URL
              dispatched by your school.
            </CardDescription>
            <Button
              variant="default"
              className="w-full h-11 bg-slate-900 text-white rounded-xl font-bold uppercase text-xs tracking-wider"
              onClick={handleReturnToLogin}
            >
              Return to Login Portal
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (step === 'instructions') {
    return (
      <ExamInstructionsScreen
        exam={exam}
        questions={questions}
        studentName={matchedStudentProfile?.name}
        rollNumber={matchedStudentProfile?.rollNumber}
        agreedToTerms={agreedToTerms}
        onAgreedChange={setAgreedToTerms}
        onConfirm={handleConfirmStartExam}
        onBack={() => setStep('login')}
        isLaunching={isLaunching}
      />
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#f3f6f9] relative overflow-hidden font-sans text-slate-800">
      {/* LEFT SIDE PANEL: Educational Identity (matches Figma/Screenshot design) */}
      <BrandingPanel />

      {/* RIGHT SIDE PANEL: "Verify Academic Pass" Card */}
      <div className="w-full lg:w-[55%] bg-[#f3f6f9] p-6 md:p-12 lg:p-16 flex flex-col justify-center items-center min-h-[500px] lg:min-h-screen relative">
        <div className="max-w-md w-full mx-auto bg-white rounded-3xl p-8 md:p-10 shadow-[0_10px_35px_-5px_rgba(15,23,42,0.05)] border border-slate-100">
          {/* Header with Custom Welcome */}
          <div className="mb-6 text-center lg:text-left">
            <h2 className="text-2xl lg:text-3xl font-black text-slate-900 tracking-tight leading-tight">Verify Academic Pass</h2>
            <p className="text-slate-500 font-semibold text-xs mt-2 block leading-relaxed">
              Input student credentials to decrypt secure assessment lobby.
            </p>
          </div>

          {/* Authorized Metadata Block */}
          <div className="mb-6 p-4 bg-gradient-to-br from-indigo-50/40 to-sky-50/30 border border-slate-100 rounded-2xl space-y-3 shadow-sm">
            <div className="flex items-center gap-2 font-black text-[11px] md:text-[10px] uppercase text-indigo-700 tracking-widest">
              <ShieldCheck size={14} className="text-indigo-600 shrink-0" />
              <span>SECURE ASSESSMENT PASS AUTHORIZED</span>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-slate-200/60">
              <div>
                <span className="text-[11px] md:text-[9px] uppercase tracking-wider text-slate-400 font-extrabold">School Unit</span>
                <p className="font-extrabold text-slate-800 text-xs mt-0.5 truncate">{school?.name || 'Test001'}</p>
              </div>
              <div>
                <span className="text-[11px] md:text-[9px] uppercase tracking-wider text-slate-400 font-extrabold">Active Assessment</span>
                <p className="font-extrabold text-slate-800 text-xs mt-0.5 truncate">{exam?.title || 'Test'}</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleLaunch} className="space-y-4">
            {/* Field 1: Enter Name */}
            <div className="space-y-1.5">
              <span className="text-[11px] md:text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Student Full Name</span>
              <div className="relative flex items-center h-12 rounded-xl bg-slate-50 border border-slate-200 px-4 focus-within:bg-white focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-100/50 transition-all duration-200">
                <User2 className="h-4 w-4 mr-2 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="e.g. Leo Skywalker"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-slate-900 placeholder-slate-400 text-xs font-semibold focus:ring-0"
                  required
                  disabled={isLaunching}
                  autoComplete="off"
                />
              </div>
            </div>

            {/* Field 2: Enter Student Register ID */}
            <div className="space-y-1.5">
              <span className="text-[11px] md:text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Student Register ID
              </span>
              <div className="relative flex items-center h-12 rounded-xl bg-slate-50 border border-slate-200 px-4 focus-within:bg-white focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-100/50 transition-all duration-200">
                <Key className="h-4 w-4 mr-2 text-slate-400 shrink-0" />
                <input
                  type="text"
                  placeholder="e.g. REG-78401"
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-slate-900 placeholder-slate-400 text-xs font-semibold focus:ring-0 font-mono"
                  required
                  disabled={isLaunching}
                  autoComplete="off"
                />
              </div>
            </div>

            <LobbyConsentNotice />

            {/* Submit Block */}
            <div className="pt-3 space-y-2.5">
              <button
                type="submit"
                className="w-full h-12 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-indigo-600/10 border-none hover:scale-[1.01] active:scale-[0.99]"
                disabled={isLaunching}
              >
                {isLaunching ? (
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5 text-indigo-200" /> Unlock & Launch Exam
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleReturnToLogin}
                className="w-full h-12 rounded-xl bg-white text-slate-600 hover:bg-slate-50 border border-slate-200 text-[11px] md:text-[10px] font-extrabold uppercase tracking-widest cursor-pointer transition-colors"
              >
                Return to Main Login
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
