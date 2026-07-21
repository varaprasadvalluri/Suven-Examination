import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { db, doc, getDoc, getDocs, collection, query, where, addDoc, setDoc, runTransaction } from '../lib/firebase';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { toast } from 'sonner';
import { Sparkles, GraduationCap, ArrowRight, ShieldCheck, Clock, BookOpen, AlertCircle, HelpCircle, UserCheck, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../lib/AuthContext';

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

  // Form State
  const [username, setUsername] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  const [step, setStep] = useState<'login' | 'instructions'>('login');
  const [matchedStudentProfile, setMatchedStudentProfile] = useState<any | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [questions, setQuestions] = useState<any[]>([]);

  const getSectionsInfo = () => {
    if (questions.length === 0) {
      return [
        {
          name: exam?.subject || 'General Paper',
          count: 0,
          marks: exam?.totalMarks || 100,
          marking: '+4 / -1'
        }
      ];
    }

    const groups: Record<string, { count: number; marks: number }> = {};
    questions.forEach(q => {
      const sub = q.subject || exam?.subject || 'General';
      if (!groups[sub]) {
        groups[sub] = { count: 0, marks: 0 };
      }
      groups[sub].count += 1;
      groups[sub].marks += q.marks || 4;
    });

    return Object.entries(groups).map(([name, data]) => ({
      name,
      count: data.count,
      marks: data.marks,
      marking: '+4 / -1'
    }));
  };

  const handleReturnToLogin = async () => {
    try {
      await signOut();
    } catch (err) {
      console.warn("Failed to clear credentials during restricted logout direct:", err);
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
        console.warn("[Security Monitor] Failed proactive session clean-up:", e);
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
        setTokenError("ADMIN_EXCLUSION_RULE: System Administrators are strictly restricted from entering or taking exams via school/candidate dynamic links. Please configure parameters from the main administrative dashboard.");
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
          const linksQuery = query(
            collection(db, 'secure_exam_links'),
            where('id', '==', token)
          );
          const linksSnap = await getDocs(linksQuery);

          if (linksSnap.empty) {
            setTokenError("AUTHENTICITY_FAILED: The dynamic security link provided is unauthentic, tampered with, or revoked.");
            setLoading(false);
            return;
          }

          const tokenDoc = linksSnap.docs[0];
          const tokenData = tokenDoc.data();

          // Double-Layered Dynamic Link Specificity: verify that the school and exam in route matches the token
          if ((schoolId && tokenData.schoolId !== schoolId) || (examId && tokenData.examId !== examId)) {
            setTokenError("MISMATCH_VIOLATION: Security parameters do not match the designated school and exam paper registry layout.");
            setLoading(false);
            return;
          }

          // A. Authenticity & Master Switch check
          if (!tokenData.isActive) {
            setTokenError("REVOKED: This dynamic exam portal access link has been deactivated globally by your school administrator.");
            setLoading(false);
            return;
          }

          // B. Temporal Window validation
          const now = new Date();
          if (tokenData.expiresAt && now > new Date(tokenData.expiresAt)) {
            setTokenError(`EXPIRED: The temporal window for this secure exam session expired on ${new Date(tokenData.expiresAt).toLocaleString()}.`);
            setLoading(false);
            return;
          }

          activeExamId = tokenData.examId;
          activeSchoolId = tokenData.schoolId;
          setResolvedExamId(activeExamId);
          setResolvedSchoolId(activeSchoolId);
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
              setTokenError(`EXPIRED: The temporal window for this secure exam session has expired (locked on ${endTimeDate.toLocaleString()}). Access to school resources and examination details is restricted.`);
              setLoading(false);
              return;
            }
          }
          
          setExam(resolvedExam);

          // Fetch Questions to group by subject for exam structure
          const qsQuery = query(collection(db, 'questions'), where('examId', '==', activeExamId));
          const qsSnap = await getDocs(qsQuery);
          const resolvedQuestions = qsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          setQuestions(resolvedQuestions);
        } else {
          setTokenError("EXAM_NOT_FOUND: The referenced exam paper document has been deleted or does not exist.");
          setLoading(false);
          return;
        }

        // Fetch School profile details
        const schoolRef = doc(db, 'schools', activeSchoolId);
        const schoolSnap = await getDoc(schoolRef);
        if (schoolSnap.exists()) {
          setSchool({ id: schoolSnap.id, ...schoolSnap.data() });
        } else {
          setTokenError("SCHOOL_NOT_FOUND: The authorized school portal context is unrecognized.");
          setLoading(false);
          return;
        }

        // C. Institutional Boundary Check: Is this school authorized to access this specific exam paper?
        if (resolvedExam) {
          const hasSchoolIdMismatch = resolvedExam.schoolId && resolvedExam.schoolId !== activeSchoolId;
          const isAssignedToThisSchool = !resolvedExam.assignedSchoolIds || 
                                         resolvedExam.assignedSchoolIds.length === 0 || 
                                         resolvedExam.assignedSchoolIds.includes(activeSchoolId);
          
          if (hasSchoolIdMismatch || !isAssignedToThisSchool) {
            setTokenError("UNAUTHORIZED: Your school registration block is not authorized to host, distribute, or access this designated exam paper.");
            setLoading(false);
            return;
          }
        }

      } catch (err) {
        console.error("Error loading secure entry node details", err);
        setTokenError("CRITICAL: Failed to validate administrative credentials.");
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
      toast.error("Invalid portal payload. Missing exam or school parameters.");
      return;
    }

    if (!username.trim() || !rollNumber.trim()) {
      toast.error("Please provide both your Username and Roll / Register Number.");
      return;
    }

    setIsLaunching(true);
    const toastId = toast.loading("Verifying gatekeeper credentials & active session...");

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

      // Search for any existing student profile with this roll number and school ID to prevent duplicates
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where('schoolId', '==', finalSchoolId),
        where('rollNumber', '==', rollNumber.trim()),
        where('role', '==', 'student')
      );
      const querySnap = await getDocs(q);
      
      if (querySnap.empty) {
        throw new Error(`Enrollment Verification Failed: Roll Number "${rollNumber.trim()}" is not registered under this school. Please contact your coordinator to enroll.`);
      }

      const matchedDoc = querySnap.docs[0];
      const matchedStudentId = matchedDoc.id;
      const matchedStudentData = matchedDoc.data();

      const registeredName = (matchedStudentData.name || '').trim().toLowerCase();
      const enteredName = username.trim().toLowerCase();
      
      if (registeredName !== enteredName) {
        throw new Error(`Identity Verification Failed: The name entered ("${username.trim()}") does not match the registered candidate name for Roll Number "${rollNumber.trim()}". Please verify your spelling and try again.`);
      }

      const profileData = { uid: matchedStudentId, id: matchedStudentId, ...matchedStudentData };
      setMatchedStudentProfile(profileData);
      
      toast.success("Identity verified! Please read and agree to the instructions to proceed.", { id: toastId });
      setStep('instructions');
    } catch (err: any) {
      console.error("[Gatekeeper Verification Event]:", err);
      toast.error(`Authorization Discrepancy: ${err.message || "A technical error occurred alignment details."}`, { id: toastId });
    } finally {
      setIsLaunching(false);
    }
  };

  const handleConfirmStartExam = async () => {
    if (!agreedToTerms) {
      toast.error("Please read and agree to the instructions by selecting the checkbox.");
      return;
    }

    const finalExamId = resolvedExamId || examId;
    const finalSchoolId = resolvedSchoolId || schoolId;
    let attemptIdRaw = '';

    if (!finalExamId || !finalSchoolId || !matchedStudentProfile) {
      toast.error("Invalid portal session payload. Please return and log in again.");
      return;
    }

    setIsLaunching(true);
    const toastId = toast.loading("Initializing secure attempt session...");

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
        console.log("Attempting secure state enrollment via Node.js Express backend API...");
        const response = await fetch('/api/gatekeeper/enroll', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            matchedStudentId: resolvedStudentId,
            matchedStudentData: matchedStudentProfile,
            username: matchedStudentProfile.name,
            rollNumber: matchedStudentProfile.rollNumber,
            finalSchoolId,
            finalExamId,
            examTitle: exam?.title,
            clientFootprint
          })
        });

        if (response.ok) {
          const resData = await response.json();
          if (resData.success) {
            finalStudentProfile = resData.finalStudentProfile;
            attemptIdRaw = resData.attemptIdRaw;
            backendSuccess = true;
            console.log("Successfully processed gatekeeper enrollment via Node.js API backend.");
          }
        } else {
          const errorPayload = await response.json().catch(() => ({}));
          if (errorPayload.code === 'EXAM_ALREADY_COMPLETED') {
            throw new Error("EXAM_ALREADY_COMPLETED");
          }
          if (errorPayload.code === 'SESSION_HIJACK_BLOCKED') {
            throw new Error(errorPayload.error);
          }
          console.warn(`Server responded with failure: ${response.status}. Reverting to client-side Firebase fallback.`);
        }
      } catch (backendError: any) {
        if (backendError.message === 'EXAM_ALREADY_COMPLETED' || backendError.message.includes("SESSION_HIJACK_BLOCKED")) {
          throw backendError;
        }
        console.warn("Express backend API unreachable/unstable. Invoking client-side Firebase Fallback Rule:", backendError);
      }

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

            if (attemptData.status === 'completed') {
              if (attemptData.canReattempt) {
                transaction.update(attemptDocRef, {
                  status: 'started',
                  score: 0,
                  answers: [],
                  startTime: now.toISOString(),
                  canReattempt: false
                });
              } else {
                throw new Error("EXAM_ALREADY_COMPLETED");
              }
            }

            if (attemptData.deviceFootprint && attemptData.deviceFootprint !== clientFootprint) {
              throw new Error("SESSION_HIJACK_BLOCKED: Mismatched browser/device footprint registered for this unique link. Please complete on your primary device or request a clean reset from terminal administrators.");
            }

            transaction.update(attemptDocRef, {
              lastResumedAt: now.toISOString(),
              status: 'started'
            });
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
      }

      localStorage.setItem('invite_student_profile', JSON.stringify(finalStudentProfile || matchedStudentProfile));
      toast.success("Gatekeeper synchronized! Launching exam environment...", { id: toastId });

      setTimeout(() => {
        window.location.href = `/exam/${attemptIdRaw}`;
      }, 500);

    } catch (err: any) {
      console.error("[Gatekeeper Security Event]:", err);
      if (err.message === "EXAM_ALREADY_COMPLETED") {
        toast.error("Access Forbidden: Your assessment attempt has already been submitted and finalized.", { id: toastId });
        navigate(`/result/${attemptIdRaw}`);
      } else if (err.message && err.message.includes("SESSION_HIJACK_BLOCKED")) {
        toast.error(err.message, { id: toastId, duration: 8000 });
      } else {
        toast.error(`Authorization Discrepancy: ${err.message || "A technical error occurred alignment details."}`, { id: toastId });
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
        <p className="text-slate-705 font-display font-black text-xs uppercase tracking-widest animate-pulse">Establishing Secure Exam Link Core...</p>
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
              <p className="text-[#C62828] text-[10px] font-black uppercase tracking-wider mb-1">Violation Diagnostics:</p>
              <p className="text-rose-800 text-xs font-semibold leading-relaxed">
                {tokenError}
              </p>
            </div>
            <CardDescription className="text-slate-500 text-xs font-medium leading-relaxed">
              Dynamically sealed URLs expire past designated schedules or are locked instantly when the physical/institutional terminal detects potential session spoofing. Please request your institution's director to re-generate the secure token.
            </CardDescription>
            <Button variant="default" className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold uppercase text-xs tracking-wider" onClick={handleReturnToLogin}>
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
            <CardTitle className="text-xl font-black text-slate-905 uppercase tracking-tight">Security Gateway Error</CardTitle>
            <CardDescription className="text-slate-500 text-xs font-semibold leading-relaxed">
              The secure link is incomplete or contains critical parameter discrepancies. Please ensure you are opening the exact URL dispatched by your school.
            </CardDescription>
            <Button variant="default" className="w-full h-11 bg-slate-900 text-white rounded-xl font-bold uppercase text-xs tracking-wider" onClick={handleReturnToLogin}>
              Return to Login Portal
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (step === 'instructions') {
    const sections = getSectionsInfo();
    const totalQs = questions.length || 30;
    const totalMarks = exam?.totalMarks || 120;
    const durationMin = exam?.duration || 180;
    
    return (
      <div className="min-h-screen bg-[#070B13] text-[#E2E8F0] flex flex-col md:flex-row relative overflow-hidden font-sans selection:bg-amber-500/20">
        {/* Background glowing gradients */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-amber-500/5 rounded-full blur-[120px] pointer-events-none" />

        {/* LEFT COLUMN: Candidate Details & Exam Structure */}
        <div className="w-full md:w-[360px] bg-[#0E1424] border-r border-slate-800/80 p-8 flex flex-col gap-8 flex-shrink-0">
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-amber-500 rounded-xl flex items-center justify-center font-black text-black text-xl shadow-lg shadow-amber-500/20">
              S
            </div>
            <div>
              <div className="font-display font-black text-sm uppercase tracking-wider text-white">SUVENEDU</div>
              <div className="text-[9px] font-bold text-amber-500 uppercase tracking-widest leading-none mt-0.5">EXAMINATION PORTAL</div>
            </div>
          </div>

          <hr className="border-slate-800/60" />

          {/* Candidate Profile Info */}
          <div className="space-y-4">
            <p className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">Candidate Details</p>
            <div className="flex items-center gap-4 bg-slate-900/50 p-4 rounded-2xl border border-slate-800/60">
              <div className="h-14 w-14 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 border-2 border-amber-400 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-amber-500/10 flex-shrink-0">
                {(matchedStudentProfile?.name || 'A')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-base font-black text-white truncate">{matchedStudentProfile?.name}</div>
                <div className="text-xs font-bold font-mono text-amber-400/90 mt-0.5">Roll: {matchedStudentProfile?.rollNumber}</div>
              </div>
            </div>
          </div>

          {/* Details Table */}
          <div className="space-y-1">
            <div className="flex justify-between items-center py-2.5 border-b border-slate-800/60 text-xs">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Exam</span>
              <span className="text-white font-semibold text-right max-w-[200px] truncate">{exam.title}</span>
            </div>
            <div className="flex justify-between items-center py-2.5 border-b border-slate-800/60 text-xs">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Subject</span>
              <span className="text-white font-semibold">{exam.subject || 'PCM Combined'}</span>
            </div>
            <div className="flex justify-between items-center py-2.5 border-b border-slate-800/60 text-xs">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Date</span>
              <span className="text-white font-semibold">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
            <div className="flex justify-between items-center py-2.5 border-b border-slate-800/60 text-xs">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Shift</span>
              <span className="text-white font-semibold">{exam.shift || 'Morning — 9:00 AM'}</span>
            </div>
          </div>

          {/* Exam Structure */}
          <div className="space-y-4 flex-grow">
            <p className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">Exam Structure</p>
            <div className="space-y-3">
              {sections.map((sec, idx) => {
                const colors = ['bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-rose-500'];
                const dotColor = colors[idx % colors.length];
                return (
                  <div key={idx} className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                      <span className="text-slate-300 font-semibold">{sec.name}</span>
                    </div>
                    <span className="text-slate-400 font-medium">{sec.count || 10} Qs · <strong className="text-white font-mono">{sec.marking}</strong></span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Total Summary Row */}
          <div className="bg-[#151D30] p-4 rounded-xl border border-slate-800 text-center text-xs font-bold text-white tracking-wide">
            Total: {totalQs} Qs • {durationMin} min • {totalMarks} marks
          </div>
        </div>

        {/* RIGHT COLUMN: Instructions, Checkbox, Start Button */}
        <div className="flex-grow overflow-y-auto p-6 md:p-12 flex flex-col gap-8 max-w-5xl">
          {/* Badge & Header */}
          <div className="space-y-4">
            <div className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-amber-500">
              📋 EXAMINATION INSTRUCTIONS
            </div>
            <h1 className="text-3xl md:text-5xl font-display font-black tracking-tight text-white leading-none">
              Before You Begin
            </h1>
            <p className="text-slate-400 text-sm md:text-base font-medium max-w-2xl leading-relaxed">
              Read all instructions carefully. Once the exam starts, the timer cannot be paused.
            </p>
          </div>

          {/* Grid of Instruction blocks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Box 1: Time Management */}
            <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
              <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Clock size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Time Management</h3>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">
                  Total duration is {durationMin} minutes. Each section has no individual time limit — allocate wisely.
                </p>
              </div>
            </div>

            {/* Box 2: Marking Scheme */}
            <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
              <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                <GraduationCap size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Marking Scheme</h3>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">
                  +4 marks for correct answer. -1 for incorrect. 0 for unattempted questions.
                </p>
              </div>
            </div>

            {/* Box 3: Navigation */}
            <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
              <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                <BookOpen size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Navigation</h3>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">
                  You can move between questions and sections freely. Use the palette on the right to jump directly.
                </p>
              </div>
            </div>

            {/* Box 4: Mark for Review */}
            <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
              <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Sparkles size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Mark for Review</h3>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">
                  Flag uncertain answers. Marked questions with an answer will still be evaluated.
                </p>
              </div>
            </div>

            {/* Box 5: Integrity */}
            <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
              <div className="h-10 w-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ShieldCheck size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Integrity</h3>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">
                  Do not switch browser tabs. Any violation will be logged and flagged to the proctor.
                </p>
              </div>
            </div>

            {/* Box 6: Auto-Save */}
            <div className="bg-[#0E1424] border border-slate-800/80 p-5 rounded-2xl flex gap-4 hover:border-slate-700/60 transition-all">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                <UserCheck size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Auto-Save</h3>
                <p className="text-xs text-slate-400 leading-relaxed font-medium">
                  Answers are saved automatically every 30 seconds. Do not refresh the page.
                </p>
              </div>
            </div>
          </div>

          <hr className="border-slate-800/80 my-2" />

          {/* Agreement Footer Area */}
          <div className="space-y-6">
            <div className="flex items-start gap-3 bg-[#111827]/40 p-4 rounded-2xl border border-slate-800/50">
              <input
                type="checkbox"
                id="agree-checkbox"
                checked={agreedToTerms}
                onChange={e => setAgreedToTerms(e.target.checked)}
                className="h-5 w-5 rounded border-slate-800 bg-[#0E1424] text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900 cursor-pointer mt-0.5 accent-amber-500"
              />
              <label htmlFor="agree-checkbox" className="text-xs text-slate-300 select-none cursor-pointer leading-relaxed font-medium">
                I have read and understood all instructions. I agree to abide by the rules and regulations of the examination, and I acknowledge that any form of malpractice, window switching, or proctoring violation will be recorded and could lead to disqualification.
              </label>
            </div>

            {/* Start Button */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                variant="outline"
                className="h-12 px-6 rounded-xl text-xs font-bold uppercase tracking-wider border-slate-800 bg-[#0E1424] text-slate-300 hover:bg-slate-900"
                onClick={() => setStep('login')}
                disabled={isLaunching}
              >
                Back to Details
              </Button>
              <Button
                className="h-12 px-8 rounded-xl text-xs font-black uppercase tracking-widest flex-grow sm:flex-grow-0 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2 group cursor-pointer border-0"
                onClick={handleConfirmStartExam}
                disabled={isLaunching}
              >
                {isLaunching ? (
                  <>
                    <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    <span>Initiating Assessment...</span>
                  </>
                ) : (
                  <>
                    <span>I Agree and Start Exam</span>
                    <ArrowRight className="h-4.5 w-4.5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4FA] flex flex-col justify-center items-center p-4 relative overflow-hidden bg-[linear-gradient(to_right,#E1E8F2_1.5px,transparent_1.5px),linear-gradient(to_bottom,#E1E8F2_1.5px,transparent_1.5px)] bg-[size:3.5rem_3.5rem] selection:bg-amber-100">
      
      {/* Decorative backdrop shapes */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Standalone secure card */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-lg mt-6"
      >
        <Card className="border-slate-200/80 shadow-[0_20px_40px_rgba(79,70,229,0.1)] rounded-[35px] overflow-hidden bg-white relative border-b-8">
          
          {/* Header Theme block */}
          <div className="bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-950 text-white p-8 border-b border-indigo-950/40 relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_90%_10%,rgba(99,102,241,0.2),transparent)] pointer-events-none" />
            
            <div className="relative z-10 space-y-4">
              <div className="flex justify-between items-start">
                <div className="inline-flex items-center gap-1.5 bg-indigo-500/20 border border-indigo-400/20 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-[#FFE28A]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Secure Exam Session Gateway
                </div>
                <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest bg-white/5 px-2.5 py-1 rounded-md border border-white/5">
                  ID: {finalExamId.substring(0,6).toUpperCase()}
                </div>
              </div>
              
              <div className="space-y-1.5 pt-1">
                <p className="text-[10px] uppercase font-black tracking-widest text-indigo-300">Active School: {school?.name || 'Academic Hub Center'}</p>
                <h1 className="text-2xl md:text-3xl font-display font-black leading-tight text-white tracking-tight">
                  {exam.title}
                </h1>
              </div>

              {/* Subject + Duration Metrics indicators */}
              <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-300 pt-1">
                <div className="flex items-center gap-1.5 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
                  <BookOpen size={14} className="text-[#FFE28A]" />
                  <span>Subject: <strong className="text-white">{exam.subject || 'Apticude'}</strong></span>
                </div>
                <div className="flex items-center gap-1.5 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
                  <Clock size={14} className="text-cyan-400" />
                  <span>Duration: <strong className="text-white">{exam.duration || 60} mins</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* Core Login/Launch parameters Form */}
          <CardContent className="p-8">
            <form onSubmit={handleLaunch} className="space-y-6">
              
              <div className="grid gap-2 relative">
                <Label htmlFor="stdName" className="text-[11px] font-black uppercase text-slate-500 tracking-wider">Student Username / Full Name</Label>
                <Input
                  id="stdName"
                  className="w-full h-12 border-slate-200 hover:border-slate-300 focus:border-indigo-600 rounded-2xl text-sm font-semibold transition-all shadow-xs"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Enter your registered name or code"
                  required
                  disabled={isLaunching}
                />
                <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">Provide your full name as recorded by your academic dashboard.</p>
              </div>

              <div className="grid gap-2 relative">
                <Label htmlFor="stdRoll" className="text-[11px] font-black uppercase text-slate-500 tracking-wider">Institution Roll / Register Number</Label>
                <Input
                  id="stdRoll"
                  className="w-full h-12 border-slate-200 hover:border-slate-300 focus:border-indigo-600 rounded-2xl font-mono text-sm font-bold transition-all shadow-xs"
                  value={rollNumber}
                  onChange={e => setRollNumber(e.target.value)}
                  placeholder="e.g. ROLL-1184"
                  required
                  disabled={isLaunching}
                />
                <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">Contact your school if you cannot remember your unique roll serial document.</p>
              </div>

              {/* Assessment Warning terms block */}
              <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-2xl flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="text-[11px] font-medium text-slate-600 leading-relaxed">
                  <p className="font-bold text-slate-800 uppercase tracking-widest text-[9px] mb-1">AUTOMATED PROCTORING ACTIVE</p>
                  By initiating this session, you agree to authorize full proctor tracking including viewport focus checks and tab alignment detection. Modifying windows during testing triggers instant coordinator flag alerts.
                </div>
              </div>

              {/* Trigger Button */}
              <Button
                type="submit"
                disabled={isLaunching}
                className="w-full h-13 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-black text-xs uppercase tracking-widest rounded-2xl transition-all shadow-md shadow-indigo-150 cursor-pointer flex items-center justify-center gap-2 group hover:scale-[1.01]"
              >
                {isLaunching ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Launching Examination Session...</span>
                  </>
                ) : (
                  <>
                    <span>Begin Secure Assessment</span>
                    <ArrowRight className="h-4.5 w-4.5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>

          {/* Secure gateway notice footer */}
          <CardFooter className="bg-slate-50 border-t border-slate-100 p-6 flex justify-between items-center text-[10px] font-semibold text-slate-500">
            <span className="flex items-center gap-1">
              <UserCheck size={14} className="text-emerald-500" /> Secure SSL Sandbox Sync
            </span>
            <span>Ref: {school?.code || 'INST_LINK'}</span>
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
};
