import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import {
  Clock,
  FileText,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Loader2,
  PlayCircle,
  NotebookPen,
  Award,
  CalendarDays,
  Lock,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { ExamInstructionsScreen } from './ExamInstructionsScreen';
import { useStudentExams, ExamCandidate, UpcomingItem } from '../hooks/useStudentExams';
import { examsApi, attemptsService } from '../services/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';

type DashboardView = 'in-progress' | 'upcoming' | 'completed';

// Pastel accent palette, additive on top of the structural navy #0B1E3F / amber #f2a81e
// brand (unchanged) — same hexes as StudentPortal.tsx's subject icon fills, reused here for
// visual continuity with that reference material. Keyed by real exam.subject/item.subject
// strings; anything unmapped falls back to `peach`, never left uncolored.
const SUBJECT_PALETTE: Record<string, { bg: string; border: string; text: string }> = {
  Mathematics: { bg: '#FFE28A', border: '#E8B92E', text: '#7A5B00' },
  Physics: { bg: '#B5F2D2', border: '#4CBE86', text: '#0F5132' },
  Science: { bg: '#B5F2D2', border: '#4CBE86', text: '#0F5132' },
  'Computer Science': { bg: '#BAE6FD', border: '#38BDF8', text: '#075985' },
  English: { bg: '#FFB2B8', border: '#F45C6B', text: '#7A1224' },
  'General Knowledge': { bg: '#E1CCFF', border: '#B586F0', text: '#4C1D95' }
};
const DEFAULT_SUBJECT_COLOR = { bg: '#FFD2C4', border: '#F0916E', text: '#7C2D12' };
const subjectColor = (subject?: string) => (subject && SUBJECT_PALETTE[subject]) || DEFAULT_SUBJECT_COLOR;

// Small hand-drawn-style mascot for the "nothing here yet" empty states — matches the
// neubrutalist icon conventions from StudentPortal.tsx (thick black stroke, flat pastel
// fill) without resurrecting that component itself.
const WaitingMascot: React.FC = () => (
  <svg className="h-16 w-16 mx-auto" viewBox="0 0 100 100" fill="none">
    <circle cx="50" cy="52" r="34" fill="#BAE6FD" stroke="black" strokeWidth="3.5" />
    <circle cx="38" cy="46" r="4" fill="black" />
    <circle cx="62" cy="46" r="4" fill="black" />
    <path d="M 38 64 Q 50 58 62 64" stroke="black" strokeWidth="3" strokeLinecap="round" fill="none" />
    <path d="M 50 16 V 26" stroke="black" strokeWidth="3" strokeLinecap="round" />
    <circle cx="50" cy="12" r="4.5" fill="#f2a81e" stroke="black" strokeWidth="2.5" />
  </svg>
);

// Threshold-based achievement chips — derived entirely from completedPage.total, no data
// this app doesn't already have. Deliberately no day-streak/rank here: a streak would need
// the student's *full* attempt history (not just the current paginated page) to be honest
// once they have more than one page of completed exams, and this app has no ranking system
// at all (see the no-fake-numbers note on StudentDashboard below) — inventing either would
// mean showing a number that can quietly become wrong.
const ACHIEVEMENT_THRESHOLDS: { count: number; label: string; emoji: string }[] = [
  { count: 1, label: 'First Quiz Done', emoji: '🎉' },
  { count: 5, label: '5 Quizzes Done', emoji: '🔥' },
  { count: 10, label: '10 Quizzes Done', emoji: '🏆' }
];

// Cosmetic, per-device "welcome back" note — localStorage only, never phrased as a numeric
// streak (a numeric claim would imply server truth this app doesn't track; see above).
// Resets silently on a new device/cleared storage, which is fine since it's just a warm
// touch, not a system of record.
function useWelcomeBack(): boolean {
  const [isReturning, setIsReturning] = useState(false);
  useEffect(() => {
    try {
      const key = 'suvenedu_student_last_visit';
      const today = new Date().toDateString();
      const last = localStorage.getItem(key);
      if (last && last !== today) setIsReturning(true);
      localStorage.setItem(key, today);
    } catch {
      // Private browsing / storage disabled — just skip the flourish.
    }
  }, []);
  return isReturning;
}

// A load failure (network blip, transient 500) must never render identically to a genuine
// empty state — "we couldn't load your data" and "you have nothing" are different facts, and
// only one of them should tell a student there's nothing for them to do.
const LoadErrorCard: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <Card className="rounded-[24px] border-2 border-rose-200 border-b-4 bg-rose-50/40">
    <CardContent className="p-6 sm:p-8 text-center space-y-3">
      <AlertCircle className="h-8 w-8 text-rose-400 mx-auto" />
      <p className="text-sm font-bold text-rose-700">Couldn't load this right now</p>
      <p className="text-xs text-rose-500 font-medium leading-relaxed">
        Something went wrong reaching the server. Your data hasn't changed — try again.
      </p>
      <Button
        variant="outline"
        className="h-10 px-4 border-rose-300 text-rose-700 hover:bg-rose-100 font-bold text-xs rounded-xl flex items-center gap-2 mx-auto"
        onClick={onRetry}
      >
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </Button>
    </CardContent>
  </Card>
);

// Upcoming is a preview-only list — it never launches or resumes an exam, triggered or not.
// A triggered exam's actual "go take it" action lives exclusively on the In Progress screen
// (the single highlighted card there); this card just points the student there.
const UpcomingCard: React.FC<{ item: UpcomingItem; onViewInProgress: () => void }> = ({ item, onViewInProgress }) => {
  const color = subjectColor(item.subject);

  if (item.locked) {
    return (
      <Card className="rounded-2xl shadow-sm border-slate-150 bg-slate-50/60">
        <CardContent className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="h-11 w-11 rounded-xl bg-slate-200/70 border-2 border-slate-300 flex items-center justify-center shrink-0">
              <Lock className="h-4.5 w-4.5 text-slate-400" />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full text-slate-400 bg-slate-200/70 flex items-center gap-1">
                  Soon
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{item.subject}</span>
              </div>
              <p className="text-xs text-slate-400 font-semibold italic">Details unlock once your school triggers this exam.</p>
            </div>
          </div>
          <Button
            disabled
            className="h-11 px-5 bg-slate-200 text-slate-400 font-bold text-xs shrink-0 rounded-xl flex items-center gap-2 cursor-not-allowed"
          >
            Soon
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl shadow-sm border-slate-200 hover:border-slate-300 transition-colors">
      <CardContent className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div
            className="h-11 w-11 rounded-xl border-2 flex items-center justify-center shrink-0 text-base font-black"
            style={{ backgroundColor: color.bg, borderColor: color.border, color: color.text }}
          >
            {(item.subject || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full text-emerald-700 bg-emerald-100">
                Triggered
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{item.subject}</span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-slate-900 leading-snug truncate">{item.exam?.title}</h3>
            <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
              {item.exam?.startTime && (
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {new Date(item.exam.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> {item.exam?.duration} mins
              </span>
              <span className="flex items-center gap-1.5">
                <Award className="h-3.5 w-3.5" /> {item.exam?.totalMarks} marks
              </span>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          className="h-11 px-5 border-slate-300 text-slate-700 font-bold text-xs shrink-0 rounded-xl flex items-center gap-2"
          onClick={onViewInProgress}
        >
          Go to In Progress
          <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
};

// Purpose-built student landing page — brand shell matches LoginPage.tsx (navy #0B1E3F +
// amber #f2a81e). Three flat sidebar screens (In Progress / Upcoming / Completed), each its
// own dedicated view rather than a combined dashboard with tabs — kept that way on request so
// each screen stays simple. No fake rank/average/streak numbers — this app has no ranking
// system yet, so none are shown. Separate from StudentPortal.tsx by design (see project
// decision to keep that component untouched and unrouted rather than folding this into it).
export const StudentDashboard: React.FC = () => {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [activeView, setActiveView] = useState<DashboardView>('in-progress');

  const {
    loadingStatus,
    inProgress,
    statusError,
    loadStatus,
    loadingUpcoming,
    upcomingPage,
    upcomingError,
    loadUpcoming,
    loadingCompleted,
    completedPage,
    completedError,
    loadCompleted
  } = useStudentExams(profile?.uid);

  const [pendingExam, setPendingExam] = useState<any | null>(null);
  const [pendingReattemptId, setPendingReattemptId] = useState<string | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<any[]>([]);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isLaunchingExam, setIsLaunchingExam] = useState(false);
  // Guards the Start/Continue button while the question set loads — without this, a slow or
  // failed fetch left the student staring at a spinner-less button with nothing visibly
  // happening, or (on failure) silently landed them on an instructions screen with zero
  // questions and no explanation.
  const [isLoadingInstructions, setIsLoadingInstructions] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const isReturning = useWelcomeBack();

  const openInstructions = async (exam: any, reattemptId: string | null) => {
    setIsLoadingInstructions(true);
    try {
      const questions = await examsApi.getQuestions(exam.id);
      setAgreedToTerms(false);
      setPendingReattemptId(reattemptId);
      setPendingQuestions(questions.map((questionRecord) => ({ id: questionRecord.id, ...questionRecord.data })));
      // Set last — this is what actually navigates to the instructions screen (see the
      // `if (pendingExam)` render branch below), so it must only happen once the questions
      // are confirmed loaded, not before.
      setPendingExam(exam);
    } catch (err) {
      console.error('Failed to load exam structure for instructions screen:', err);
      toast.error('Could not load this exam. Please try again.');
    } finally {
      setIsLoadingInstructions(false);
    }
  };

  const handleStartCandidate = (candidate: ExamCandidate) => {
    const { exam, attempt } = candidate;
    if (attempt?.status === 'started' || attempt?.status === 'in-progress') {
      navigate(`/exam/${attempt.id}`);
      return;
    }
    if (attempt?.status === 'completed' && attempt?.canReattempt) {
      openInstructions(exam, attempt.id);
      return;
    }
    openInstructions(exam, null);
  };

  const confirmStartExam = async () => {
    if (!profile || !pendingExam) return;
    if (!agreedToTerms) {
      toast.error('Please read and agree to the instructions by selecting the checkbox.');
      return;
    }

    setIsLaunchingExam(true);
    try {
      let attemptId: string;
      if (pendingReattemptId) {
        await attemptsService.update(pendingReattemptId, {
          status: 'started',
          score: 0,
          answers: [],
          startTime: new Date().toISOString(),
          canReattempt: false
        });
        attemptId = pendingReattemptId;
      } else {
        attemptId = await attemptsService.create({
          examId: pendingExam.id,
          examTitle: pendingExam.title,
          studentId: profile.uid,
          studentName: profile.name,
          schoolId: profile.schoolId || null,
          answers: [],
          score: 0,
          startTime: new Date().toISOString(),
          status: 'started'
        });
      }
      setPendingExam(null);
      setPendingReattemptId(null);
      navigate(`/exam/${attemptId}`);
    } catch (err) {
      toast.error(pendingReattemptId ? 'Failed to re-initialize exam attempt' : 'Failed to start exam');
    } finally {
      setIsLaunchingExam(false);
    }
  };

  if (pendingExam) {
    return (
      <ExamInstructionsScreen
        exam={pendingExam}
        questions={pendingQuestions}
        studentName={profile?.name}
        rollNumber={profile?.rollNumber}
        agreedToTerms={agreedToTerms}
        onAgreedChange={setAgreedToTerms}
        onConfirm={confirmStartExam}
        onBack={() => {
          setPendingExam(null);
          setPendingReattemptId(null);
        }}
        isLaunching={isLaunchingExam}
        confirmLabel={pendingReattemptId ? 'I Agree and Restart Exam' : 'I Agree and Start Exam'}
        confirmLoadingLabel="Starting..."
      />
    );
  }

  const initial = (profile?.name || 'S').trim().charAt(0).toUpperCase();
  const classLine = [profile?.class, profile?.section].filter(Boolean).join('-');
  // Build only the parts that actually exist — with both empty this used to render a bare
  // space character (an empty-looking blank line) instead of just not rendering anything.
  const subtitleParts = [classLine ? `Class ${classLine}` : null, profile?.rollNumber ? `Roll #${profile.rollNumber}` : null].filter(
    Boolean
  );

  const candidateStatusLabel = (c: ExamCandidate) =>
    c.attempt?.status === 'started' || c.attempt?.status === 'in-progress' ? 'Resume' : 'Ready to Start';

  const NAV_ACCENT: Record<DashboardView, string> = {
    'in-progress': '#f2a81e',
    upcoming: '#BAE6FD',
    completed: '#B5F2D2'
  };

  // Mobile: compact horizontal tab strip (a student shouldn't have to scroll past a full
  // vertical nav list to reach content). Desktop (md:): full-width vertical sidebar list, as
  // before. Active state uses a shared-layout `motion` pill (layoutId) so switching tabs
  // slides the highlight instead of just repainting a class.
  const NavButton: React.FC<{ view: DashboardView; icon: React.ReactNode; label: string; badge?: number }> = ({
    view,
    icon,
    label,
    badge
  }) => {
    const active = activeView === view;
    return (
      <button
        onClick={() => setActiveView(view)}
        className={`flex-1 md:flex-none md:w-full flex flex-col md:flex-row items-center justify-center md:justify-start gap-1 md:gap-3 px-2 md:px-3.5 h-14 md:h-11 rounded-xl font-bold text-[10px] md:text-sm transition-colors cursor-pointer relative overflow-hidden shrink-0 ${
          active ? 'text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        {active && (
          <motion.div
            layoutId="nav-active-pill"
            className="absolute inset-0 bg-white/10 rounded-xl"
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          />
        )}
        <span
          className="relative z-10 shrink-0 flex items-center justify-center h-7 w-7 rounded-lg transition-colors"
          style={active ? { backgroundColor: NAV_ACCENT[view], color: '#0B1E3F' } : undefined}
        >
          {icon}
        </span>
        <span className="relative z-10 truncate max-w-full">{label}</span>
        {!!badge && (
          <motion.span
            key={badge}
            initial={{ scale: 0.7 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 20 }}
            className="z-10 absolute top-1 right-1 md:static md:ml-auto h-4 min-w-[16px] md:h-5 md:min-w-[20px] px-1 md:px-1.5 rounded-full bg-[#f2a81e] text-[#0B1E3F] text-[9px] md:text-[10px] font-black flex items-center justify-center"
          >
            {badge}
          </motion.span>
        )}
      </button>
    );
  };

  return (
    // Same brand shell as LoginPage.tsx (navy #0B1E3F + amber #f2a81e logo mark) so the
    // student side of the app reads as the same product as the school/admin login, not a
    // different visual system. Sidebar on desktop, collapses to a compact top bar + tab strip
    // on phones — kept short so a student reaches actual exam content without much scrolling.
    <div className="min-h-screen w-full bg-[#f3f6f9] font-sans text-slate-800 flex flex-col md:flex-row">
      <aside className="w-full md:w-72 md:min-h-screen bg-[#0B1E3F] text-white shrink-0 flex flex-col">
        <div
          className="p-4 md:p-6 flex items-center justify-between md:block"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 1rem)' }}
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#f2a81e] flex items-center justify-center font-black text-white text-lg shadow-md shadow-[#f2a81e]/20 shrink-0">
              S
            </div>
            <div>
              <span className="font-sans font-extrabold text-sm uppercase tracking-wider text-white block leading-none">SUVEN EDU</span>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mt-0.5">Student Portal</span>
            </div>
          </div>

          <Button
            variant="outline"
            aria-label="Sign out"
            title="Sign out"
            className="md:hidden h-9 px-3 border-white/20 bg-white/5 hover:bg-white/10 text-white font-bold text-xs shrink-0"
            onClick={() => setShowSignOutConfirm(true)}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>

        <div className="hidden md:block px-5 md:px-6 pb-5 md:pb-6 space-y-3">
          <div className="flex items-center gap-3 bg-white/[0.04] border border-white/10 rounded-2xl p-4">
            <div className="h-11 w-11 rounded-full bg-[#f2a81e]/20 border-2 border-[#f2a81e]/40 text-[#f2a81e] flex items-center justify-center font-black text-base shrink-0">
              {initial}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-white truncate">{profile?.name || 'Student'}</p>
              {subtitleParts.length > 0 && <p className="text-[11px] font-semibold text-slate-400 truncate">{subtitleParts.join(' · ')}</p>}
            </div>
          </div>
          {isReturning && (
            <p className="text-[11px] font-semibold text-[#f2a81e]/90 px-1 flex items-center gap-1.5">
              <span>👋</span> Welcome back!
            </p>
          )}
          {!!completedPage?.total && (
            <p className="text-[11px] font-bold text-slate-400 px-1">
              🎉 {completedPage.total} quiz{completedPage.total === 1 ? '' : 'zes'} completed
            </p>
          )}
        </div>

        <nav className="px-3 md:px-4 pb-3 md:pb-0 flex flex-row gap-2 md:flex-col md:gap-0 md:space-y-1 md:flex-1">
          <NavButton
            view="in-progress"
            icon={<PlayCircle className="h-4.5 w-4.5 shrink-0" />}
            label="In Progress"
            badge={inProgress ? 1 : 0}
          />
          <NavButton
            view="upcoming"
            icon={<NotebookPen className="h-4.5 w-4.5 shrink-0" />}
            label="Upcoming"
            badge={upcomingPage?.total ?? 0}
          />
          <NavButton
            view="completed"
            icon={<CheckCircle2 className="h-4.5 w-4.5 shrink-0" />}
            label="Completed"
            badge={completedPage?.total ?? 0}
          />
        </nav>

        <div className="hidden md:block mt-auto p-6 border-t border-white/10">
          <Button
            variant="outline"
            className="w-full h-11 border-white/20 bg-white/5 hover:bg-white/10 text-white font-bold text-xs"
            onClick={() => setShowSignOutConfirm(true)}
          >
            <LogOut className="h-4 w-4 mr-1.5" />
            Sign Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 px-4 py-6 sm:px-6 sm:py-10" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
            className="max-w-3xl mx-auto space-y-6 sm:space-y-8"
          >
            {activeView === 'in-progress' && (
              <>
                <div>
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">In Progress</h1>
                  <p className="text-slate-500 text-xs font-semibold mt-0.5">The exam your school currently has ready for you</p>
                </div>

                {loadingStatus ? (
                  <Card className="rounded-2xl border-slate-200">
                    <CardContent className="p-8 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </CardContent>
                  </Card>
                ) : statusError ? (
                  <LoadErrorCard onRetry={loadStatus} />
                ) : !inProgress ? (
                  <Card className="rounded-[24px] border-2 border-slate-200 border-b-4">
                    <CardContent className="p-6 sm:p-8 text-center space-y-3">
                      <WaitingMascot />
                      <p className="text-sm font-bold text-slate-700">No exam assigned right now</p>
                      <p className="text-xs text-slate-500 font-medium leading-relaxed">
                        Your school hasn't triggered an exam for you yet. Check back once they do.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  (() => {
                    const color = subjectColor(inProgress.exam?.subject);
                    return (
                      <Card
                        className="rounded-[28px] border-2 border-b-[6px] shadow-sm overflow-hidden"
                        style={{ borderColor: '#0B1E3F', backgroundColor: `${color.bg}33` }}
                      >
                        <CardContent className="p-5 sm:p-6 space-y-4">
                          <div className="flex items-start gap-3.5 min-w-0">
                            <div
                              className="h-12 w-12 rounded-2xl border-2 flex items-center justify-center shrink-0 text-lg font-black"
                              style={{ backgroundColor: color.bg, borderColor: color.border, color: color.text }}
                            >
                              {(inProgress.exam?.subject || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <span className="text-[10px] font-black uppercase tracking-widest text-[#0B1E3F] bg-white px-2.5 py-1 rounded-full border border-[#0B1E3F]/15">
                                {candidateStatusLabel(inProgress)}
                              </span>
                              <h3 className="text-lg sm:text-xl font-black text-slate-900 mt-2.5 leading-snug truncate">
                                {inProgress.exam.title}
                              </h3>
                              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs font-semibold text-slate-500">
                                <span className="flex items-center gap-1.5">
                                  <Clock className="h-3.5 w-3.5" /> {inProgress.exam.duration} mins
                                </span>
                                <span>{inProgress.exam.totalMarks} points</span>
                              </div>
                            </div>
                          </div>
                          <motion.button
                            whileTap={{ scale: 0.97 }}
                            className="w-full h-12 bg-[#0B1E3F] hover:bg-[#0B1E3F]/90 text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                            onClick={() => handleStartCandidate(inProgress)}
                            disabled={isLoadingInstructions}
                          >
                            {isLoadingInstructions ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                              </>
                            ) : (
                              <>
                                {candidateStatusLabel(inProgress) === 'Resume' ? 'Continue Exam' : 'Start Exam'}
                                <ArrowRight className="h-4 w-4" />
                              </>
                            )}
                          </motion.button>
                        </CardContent>
                      </Card>
                    );
                  })()
                )}
              </>
            )}

            {activeView === 'upcoming' && (
              <>
                <div>
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Upcoming</h1>
                  <p className="text-slate-500 text-xs font-semibold mt-0.5">Exams triggered for you, plus a preview of what's coming</p>
                </div>

                {loadingUpcoming ? (
                  <Card className="rounded-2xl border-slate-200">
                    <CardContent className="p-8 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </CardContent>
                  </Card>
                ) : upcomingError ? (
                  <LoadErrorCard onRetry={() => loadUpcoming(upcomingPage?.page || 1)} />
                ) : !upcomingPage || upcomingPage.items.length === 0 ? (
                  <Card className="rounded-[24px] border-2 border-slate-200 border-b-4">
                    <CardContent className="p-6 sm:p-8 text-center space-y-3">
                      <FileText className="h-8 w-8 text-slate-300 mx-auto" />
                      <p className="text-sm font-bold text-slate-700">No exams assigned right now</p>
                      <p className="text-xs text-slate-500 font-medium leading-relaxed">
                        Your school hasn't triggered an exam for you yet. Check back once they do.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <motion.div
                    className="space-y-3"
                    initial="hidden"
                    animate="show"
                    variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
                  >
                    {upcomingPage.items.map((item) => (
                      <motion.div key={item.examId} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
                        <UpcomingCard item={item} onViewInProgress={() => setActiveView('in-progress')} />
                      </motion.div>
                    ))}

                    {upcomingPage.totalPages > 1 && (
                      <div className="flex items-center justify-between pt-1 px-1">
                        <Button
                          variant="outline"
                          className="h-10 px-3 border-slate-300 font-bold text-xs"
                          disabled={upcomingPage.page <= 1}
                          onClick={() => loadUpcoming(upcomingPage.page - 1)}
                        >
                          <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                        </Button>
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          Page {upcomingPage.page} of {upcomingPage.totalPages}
                        </span>
                        <Button
                          variant="outline"
                          className="h-10 px-3 border-slate-300 font-bold text-xs"
                          disabled={upcomingPage.page >= upcomingPage.totalPages}
                          onClick={() => loadUpcoming(upcomingPage.page + 1)}
                        >
                          Next <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </div>
                    )}
                  </motion.div>
                )}
              </>
            )}

            {activeView === 'completed' && (
              <>
                <div>
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Completed</h1>
                  <p className="text-slate-500 text-xs font-semibold mt-0.5">Exams you've already submitted</p>
                </div>

                {loadingCompleted ? (
                  <Card className="rounded-2xl border-slate-200">
                    <CardContent className="p-8 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </CardContent>
                  </Card>
                ) : completedError ? (
                  <LoadErrorCard onRetry={() => loadCompleted(completedPage?.page || 1)} />
                ) : !completedPage || completedPage.items.length === 0 ? (
                  <Card className="rounded-[24px] border-2 border-slate-200 border-b-4">
                    <CardContent className="p-6 sm:p-8 text-center space-y-3">
                      <WaitingMascot />
                      <p className="text-xs text-slate-500 font-semibold">Nothing completed yet — your first quiz will show up here.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {/* Threshold achievement chips — purely derived from completedPage.total,
                      no invented stats. Locked chips stay visible (grayed) so students can
                      see what's next, not just what they've already unlocked. */}
                    <div className="flex flex-wrap gap-2">
                      {ACHIEVEMENT_THRESHOLDS.map((tier) => {
                        const unlocked = (completedPage?.total || 0) >= tier.count;
                        return (
                          <span
                            key={tier.count}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide border-2 ${
                              unlocked
                                ? 'bg-[#f2a81e]/15 border-[#f2a81e] text-[#8a5c00]'
                                : 'bg-slate-100 border-slate-200 text-slate-350 grayscale opacity-60'
                            }`}
                          >
                            <span>{tier.emoji}</span> {tier.label}
                          </span>
                        );
                      })}
                    </div>

                    <motion.div
                      className="space-y-2.5"
                      initial="hidden"
                      animate="show"
                      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
                    >
                      {completedPage.items.map((attemptRecord) => {
                        const attemptData = attemptRecord.data as any;
                        const accuracy = typeof attemptData.accuracy === 'number' ? Math.round(attemptData.accuracy) : null;
                        const dateLabel = attemptData.endTime
                          ? new Date(attemptData.endTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                          : null;
                        return (
                          <motion.div key={attemptRecord.id} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}>
                            <Card
                              className="rounded-2xl border-slate-200 cursor-pointer hover:border-emerald-300 transition-colors"
                              onClick={() => navigate(`/result/${attemptRecord.id}`)}
                            >
                              <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="h-9 w-9 rounded-xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center shrink-0">
                                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                                  </div>
                                  <div className="min-w-0">
                                    <span className="text-sm font-bold text-slate-800 truncate block">
                                      {attemptData.examTitle || 'Exam'}
                                    </span>
                                    {(accuracy !== null || dateLabel) && (
                                      <span className="text-[11px] font-semibold text-slate-500 truncate block">
                                        {accuracy !== null ? `${accuracy}%` : ''}
                                        {accuracy !== null && dateLabel ? ' · ' : ''}
                                        {dateLabel || ''}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
                              </CardContent>
                            </Card>
                          </motion.div>
                        );
                      })}
                    </motion.div>

                    {completedPage.totalPages > 1 && (
                      <div className="flex items-center justify-between pt-1 px-1">
                        <Button
                          variant="outline"
                          className="h-10 px-3 border-slate-300 font-bold text-xs"
                          disabled={completedPage.page <= 1}
                          onClick={() => loadCompleted(completedPage.page - 1)}
                        >
                          <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                        </Button>
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          Page {completedPage.page} of {completedPage.totalPages}
                        </span>
                        <Button
                          variant="outline"
                          className="h-10 px-3 border-slate-300 font-bold text-xs"
                          disabled={completedPage.page >= completedPage.totalPages}
                          onClick={() => loadCompleted(completedPage.page + 1)}
                        >
                          Next <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Lightweight two-button confirm — deliberately not ConfirmationDialog.tsx (that one
          requires typing a keyword to confirm, built for permanent-deletion actions; signing
          out is routine and instantly reversible, a typed-keyword gate there would be pure
          friction, not safety). */}
      <Dialog open={showSignOutConfirm} onOpenChange={setShowSignOutConfirm}>
        <DialogContent className="max-w-sm p-6 bg-white border border-slate-200 rounded-3xl">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-lg font-bold text-slate-900">Sign out?</DialogTitle>
            <DialogDescription className="text-slate-500 text-sm">
              You'll need to sign in again to see your exams and results.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowSignOutConfirm(false)}
              className="w-full sm:w-auto h-10 border-slate-200 text-slate-700 font-semibold rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setShowSignOutConfirm(false);
                signOut();
              }}
              className="w-full sm:w-auto h-10 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl"
            >
              Sign Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
