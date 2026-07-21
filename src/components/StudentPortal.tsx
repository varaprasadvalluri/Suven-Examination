import React, { useEffect, useState } from 'react';
import { db, handleFirestoreError, OperationType, collection, query, where, onSnapshot, addDoc, doc, updateDoc } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Exam, Attempt } from '../types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Clock, FileText, ArrowRight, CheckCircle2, TrendingUp, Search, BookOpen, Brain, Code, Globe, Calculator, FlaskConical, LayoutGrid, Milestone, BookX, ShieldCheck, ArrowUpRight, Star, Compass, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { StudentAdvancedAnalytics } from './StudentAdvancedAnalytics';
import { MicroscheduleDashboard } from './MicroscheduleDashboard';
import { ErrorBook } from './ErrorBook';

// Cute hand-drawn aesthetic responsive icons for children
const MathIcon: React.FC = () => (
  <svg className="h-6 w-6 shrink-0 transform group-hover:scale-110 group-hover:rotate-3 transition-transform" viewBox="0 0 100 100" fill="none">
    <rect x="15" y="15" width="70" height="70" rx="14" fill="#FFE28A" stroke="black" strokeWidth="3.5" />
    <path d="M 32 38 H 48" stroke="black" strokeWidth="4.5" strokeLinecap="round" />
    <path d="M 40 30 V 46" stroke="black" strokeWidth="4.5" strokeLinecap="round" />
    <path d="M 32 68 H 48" stroke="black" strokeWidth="4.5" strokeLinecap="round" />
    <path d="M 58 38 H 70" stroke="black" strokeWidth="4.5" strokeLinecap="round" />
    <path d="M 58 44 H 70" stroke="black" strokeWidth="4.5" strokeLinecap="round" />
    <path d="M 58 60 L 68 70" stroke="black" strokeWidth="4.5" strokeLinecap="round" />
    <path d="M 68 60 L 58 70" stroke="black" strokeWidth="4.5" strokeLinecap="round" />
  </svg>
);

const ScienceIcon: React.FC = () => (
  <svg className="h-6 w-6 shrink-0 transform group-hover:scale-110 group-hover:-rotate-3 transition-transform" viewBox="0 0 100 100" fill="none">
    <path d="M 50 15 L 50 38 L 22 76 A 8 8 0 0 0 29 88 H 71 A 8 8 0 0 0 78 76 L 50 38" fill="#B5F2D2" />
    <path d="M 38 15 H 62 M 45 15 V 40 L 22 76 C 19 81 23 88 30 88 H 70 C 77 88 81 81 78 76 L 55 40 V 15" stroke="black" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="38" cy="72" r="7.5" stroke="black" strokeWidth="2.5" fill="white" />
    <path d="M 36 71 Q 38 73 40 71" stroke="black" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="58" cy="65" r="5" stroke="black" strokeWidth="2.5" fill="#FFE28A" />
    <path d="M 56 64 Q 58 66 60 64" stroke="black" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="48" cy="50" r="4" stroke="black" strokeWidth="2" fill="white" />
  </svg>
);

const TechIcon: React.FC = () => (
  <svg className="h-6 w-6 shrink-0 transform group-hover:scale-110 group-hover:rotate-3 transition-transform" viewBox="0 0 100 100" fill="none">
    <rect x="15" y="16" width="70" height="52" rx="12" fill="#BAE6FD" stroke="black" strokeWidth="3.5" />
    <path d="M 40 68 L 32 86 H 68 L 60 68" fill="white" stroke="black" strokeWidth="3.5" strokeLinejoin="round" />
    <circle cx="40" cy="40" r="5" fill="black" />
    <circle cx="60" cy="40" r="5" fill="black" />
    <path d="M 45 49 Q 50 54 55 49" stroke="black" strokeWidth="4" strokeLinecap="round" fill="none" />
  </svg>
);

const LanguageIcon: React.FC = () => (
  <svg className="h-6 w-6 shrink-0 transform group-hover:scale-110 group-hover:-rotate-3 transition-transform" viewBox="0 0 100 100" fill="none">
    <path d="M 22 18 H 70 C 76 18 78 22 78 28 V 78 C 78 84 74 86 68 86 H 22 Z" fill="#FFB2B8" stroke="black" strokeWidth="3.5" strokeLinejoin="round" />
    <path d="M 22 24 H 72 C 75 24 75 27 72 27 H 22" fill="white" stroke="black" strokeWidth="2.5" />
    <path d="M 22 30 H 72 C 75 30 75 33 72 33 H 22" fill="white" stroke="black" strokeWidth="2.5" />
    <circle cx="42" cy="52" r="8" stroke="black" strokeWidth="2.5" fill="white" />
    <circle cx="58" cy="52" r="8" stroke="black" strokeWidth="2.5" fill="white" />
    <path d="M 50 52 H 51.5" stroke="black" strokeWidth="3" strokeLinecap="round" />
    <path d="M 47 66 Q 50 69 53 66" stroke="black" strokeWidth="3" strokeLinecap="round" fill="none" />
  </svg>
);

const GeneralGKIcon: React.FC = () => (
  <svg className="h-6 w-6 shrink-0 transform group-hover:scale-110 transition-transform" viewBox="0 0 100 100" fill="none">
    <circle cx="50" cy="50" r="32" fill="#E1CCFF" stroke="black" strokeWidth="3.5" />
    <path d="M 25 50 C 35 40 65 40 75 50" stroke="black" strokeWidth="2.5" fill="none" />
    <path d="M 25 50 C 35 60 65 60 75 50" stroke="black" strokeWidth="2.5" fill="none" />
    <path d="M 50 18 V 82" stroke="black" strokeWidth="2.5" />
    <circle cx="40" cy="38" r="4.5" fill="black" />
    <path d="M 56 35 Q 59 33 61 36" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M 46 64 Q 50 67 54 64" stroke="black" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const DefaultQuizIcon: React.FC = () => (
  <svg className="h-6 w-6 shrink-0 transform group-hover:scale-110 transition-transform" viewBox="0 0 100 100" fill="none">
    <rect x="20" y="20" width="60" height="60" rx="10" fill="#FFD2C4" stroke="black" strokeWidth="3.5" />
    <circle cx="40" cy="40" r="4" fill="black" />
    <circle cx="60" cy="40" r="4" fill="black" />
    <path d="M 44 54 H 56" stroke="black" strokeWidth="3.5" strokeLinecap="round" />
  </svg>
);

const SUBJECT_ICONS_NEUBRUTALIST: Record<string, React.ReactNode> = {
  'Mathematics': <MathIcon />,
  'Physics': <ScienceIcon />,
  'Computer Science': <TechIcon />,
  'English': <LanguageIcon />,
  'General Knowledge': <GeneralGKIcon />,
  'Psychology': <ScienceIcon />,
  'Other': <DefaultQuizIcon />
};

export const StudentPortal: React.FC = () => {
  const { profile } = useAuth();
  const canTakeExams = true;

  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const navigate = useNavigate();

  // URL search params to drive main tabs (Portal, Ranker Diagnostics, Learning Roadmap, Error Book)
  const [searchParams, setSearchParams] = useSearchParams();
  const activeMainTab = searchParams.get('tab') || 'exams';
  const setActiveMainTab = (tab: string) => {
    setSearchParams({ tab });
  };

  useEffect(() => {
    if (!profile || !canTakeExams) return;
    
    setLoading(true);
    
    // Subscribe to published exams
    const examsQuery = query(collection(db, 'exams'), where('status', '==', 'published'));
    const unsubscribeExams = onSnapshot(examsQuery, (snapshot) => {
       const fetchedExams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Exam));
       const studentSchoolId = profile?.schoolId;
       const permittedExams = studentSchoolId
         ? fetchedExams.filter(e => !e.assignedSchoolIds || e.assignedSchoolIds.length === 0 || e.assignedSchoolIds.includes(studentSchoolId))
         : fetchedExams;
       setExams(permittedExams);
    }, (error) => {
       handleFirestoreError(error, OperationType.LIST, 'exams');
    });

    // Subscribe to student attempts
    const attemptsQuery = query(collection(db, 'attempts'), where('studentId', '==', profile.uid));
    const unsubscribeAttempts = onSnapshot(attemptsQuery, (snapshot) => {
       const fetchedAttempts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Attempt));
       setAttempts(fetchedAttempts);
       setLoading(false);
    }, (error) => {
       setLoading(false);
       handleFirestoreError(error, OperationType.LIST, 'attempts');
    });

    return () => {
      unsubscribeExams();
      unsubscribeAttempts();
    };
  }, [profile, canTakeExams]);

  const startExam = async (exam: Exam) => {
    if (!profile) return;
    
    // Check time window
    const now = new Date();
    if (exam.startTime) {
      const startTime = new Date(exam.startTime);
      if (now < startTime) {
        toast.error(`This exam starts at ${startTime.toLocaleString()}`);
        return;
      }
    }
    if (exam.endTime) {
      const endTime = new Date(exam.endTime);
      if (now > endTime) {
        toast.error("This exam window has closed");
        return;
      }
    }

    const existingAttempt = attempts.find(a => a.examId === exam.id);
    
    // Check if already completed
    if (existingAttempt?.status === 'completed') {
      if (existingAttempt.canReattempt) {
        try {
          const attemptRef = doc(db, 'attempts', existingAttempt.id);
          await updateDoc(attemptRef, {
            status: 'started',
            score: 0,
            answers: [],
            startTime: new Date().toISOString(),
            canReattempt: false
          });
          navigate(`/exam/${existingAttempt.id}`);
          return;
        } catch (error) {
          toast.error("Failed to re-initialize exam attempt");
          return;
        }
      }
      toast.error("You have already completed this exam");
      return;
    }

    // Direct to existing if started
    if (existingAttempt?.status === 'started' || existingAttempt?.status === 'in-progress') {
      navigate(`/exam/${existingAttempt.id}`);
      return;
    }

    try {
      const attemptData = {
        examId: exam.id,
        examTitle: exam.title,
        studentId: profile.uid,
        studentName: profile.name,
        schoolId: profile.schoolId || null,
        answers: [],
        score: 0,
        startTime: new Date().toISOString(),
        status: 'started'
      };
      
      const docRef = await addDoc(collection(db, 'attempts'), attemptData);
      navigate(`/exam/${docRef.id}`);
    } catch (error) {
      toast.error("Failed to start exam");
    }
  };

  if (!canTakeExams) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-500 max-w-md mx-auto">
        <div className="bg-rose-50 border-2 border-rose-200 p-6 rounded-3xl mb-6">
          <BookX className="h-12 w-12 text-rose-600" />
        </div>
        <h3 className="text-2xl font-display font-black text-slate-950 uppercase tracking-tight">Access Restricted</h3>
        <p className="text-slate-600 mt-3 font-semibold text-sm leading-relaxed">
          Your current security clearance does not possess the required <code>take_exams</code> authority token. Reach out to your academy registrar.
        </p>
        <Button variant="default" className="mt-8 bg-slate-900 text-white" onClick={() => navigate('/')}>
          Return to Hub
        </Button>
      </div>
    );
  }

  const getAttempt = (examId: string) => attempts.find(a => a.examId === examId);

  const filteredExams = exams.filter(exam => {
    const subjectStr = exam.subject || '';
    const matchesSearch = exam.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          subjectStr.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = activeTab === 'All' || subjectStr === activeTab;
    return matchesSearch && matchesTab;
  });

  return (
    <div className="space-y-11 pb-24 animate-in fade-in duration-500 font-sans text-slate-800">
      
      {/* 4-Tab Main Layout Header styled with Soft Playground claymorphic themes */}
      <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="space-y-11">
        
        {/* Redesigned Student Portal Status Title Banner */}
        {profile?.role !== 'student' && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-white p-6 md:p-8 rounded-[32px] border-2 border-b-[8px] border-slate-200 shadow-[4px_6px_0px_rgba(163,191,220,0.15)]">
            <div>
              <h1 className="text-2xl md:text-3xl font-black text-indigo-950 font-display uppercase tracking-tight">🪐 Student Portal Cosmos</h1>
              <p className="text-slate-500 font-bold text-xs mt-1 md:mt-2">Embark on daily educational quests, master diagnostic quizzes, and track milestones!</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-6 px-2 font-display">
               <div className="flex flex-col items-end">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Cognitive Gain</span>
                  <span className="text-xs font-black text-emerald-600 flex items-center gap-1.5 mt-1.5 bg-emerald-50 border-2 border-emerald-200 px-3 py-1 rounded-full">+12.4% <ArrowUpRight className="h-4 w-4 shrink-0" strokeWidth={3} /></span>
               </div>
               <div className="h-9 w-[2px] bg-slate-200 hidden sm:block" />
               <div className="flex flex-col items-end">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Academy Rank</span>
                  <span className="text-xs font-black text-amber-700 mt-1.5 bg-amber-50 border-2 border-amber-200 px-3 py-1 rounded-full">#42 / 2,410</span>
               </div>
            </div>
          </div>
        )}

        {/* ================= EXAMINATION PORTAL VALUE ================= */}
        <TabsContent value="exams" className="space-y-11 outline-none">
          
          {/* Child-friendly structured layout grid (Center: 12 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-11 items-start">
             
             {/* CENTER COLUMN: Centralized prominent modular main view (12 Columns, full width) */}
             <div className="lg:col-span-12 space-y-11">
                
                {/* 1. Playful Compact Welcome Banner */}
                <div className="bg-[#EBF3FF] rounded-[32px] p-8 border-2 border-b-[8px] border-indigo-200 shadow-sm relative overflow-hidden min-w-[280px] sm:min-w-[320px]">
                   <div className="absolute right-6 top-6 opacity-30 pointer-events-none hidden md:block">
                      {/* Grid / cloud doodle illustration */}
                      <svg className="w-36 h-36 text-indigo-300" viewBox="0 0 100 100" fill="none" stroke="currentColor">
                        <circle cx="20" cy="20" r="4" fill="currentColor" />
                        <circle cx="80" cy="30" r="6" fill="currentColor" />
                        <path d="M10 50 Q 30 30 50 50 T 90 50" strokeWidth="2" strokeDasharray="3,3" />
                      </svg>
                   </div>

                   <div className="relative z-10 space-y-4">
                      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-50 border-2 border-indigo-200 text-indigo-600 text-[10px] font-black uppercase tracking-widest">
                         <Sparkles className="h-3.5 w-3.5 text-amber-500 animate-spin" />
                         <span>COSMIC KNOWLEDGE CENTER ACTIVE</span>
                      </div>
                      <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
                        Howdy, {profile?.name || "Awesome Scholar"}! 👑
                      </h2>
                      <p className="text-slate-600 text-sm md:text-base font-semibold max-w-xl leading-relaxed">
                        Assemble your logic gears and unlock daily milestones! Take e-exams to gather magical stardust, study gems, and academy trophies. Ready to showcase your wizard powers? 🚀✨
                      </p>
                      
                      <div className="flex flex-wrap gap-4 pt-2">
                         <div className="flex items-center gap-2 bg-white border-2 border-slate-200 rounded-full px-4.5 py-2.5 shadow-sm select-none">
                            <Star className="h-5 w-5 text-amber-400 fill-amber-400 animate-bounce" />
                            <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-widest">
                              {attempts.filter(a => a.status === 'completed').length} Completed Quests ✓
                            </span>
                         </div>
                         <div className="flex items-center gap-2 bg-white border-2 border-slate-200 rounded-full px-4.5 py-2.5 shadow-sm select-none">
                            <span className="text-base">🪙</span>
                            <span className="text-[11px] font-extrabold text-slate-700 uppercase tracking-widest">
                              {attempts.filter(a => a.status === 'completed').length * 100} Star Coins
                            </span>
                         </div>
                      </div>
                   </div>
                </div>

                {/* 2. ACTIVE EXAM WINDOW: Hero Quest Banner / Interactive Progress Timeline */}
                {(() => {
                  const activeQuestExam = exams.find(e => !getAttempt(e.id)) || exams[0];
                  if (!activeQuestExam) return null;
                  
                  const activeQuestAttempt = getAttempt(activeQuestExam.id);

                  return (
                    <div className="bg-white border-2 border-b-[8px] border-slate-800 rounded-[32px] p-8 shadow-[4px_6px_0px_rgba(0,0,0,0.15)] relative overflow-hidden space-y-6">
                      <div className="absolute top-0 right-0 h-28 w-28 bg-[#FFEFC4] rounded-bl-[100px] flex items-start justify-end p-5 text-3xl pointer-events-none">
                        🎯
                      </div>
                      
                      <div className="space-y-2 max-w-md md:max-w-xl">
                        <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest bg-rose-50 border border-rose-200 px-3 py-1 rounded-full">ACTIVE STAR MISSION</span>
                        <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight mt-2">{activeQuestExam.title}</h3>
                        <p className="text-slate-500 text-xs font-semibold leading-relaxed">
                          Your active brain power course is currently ready for launch. Complete the checklist checkpoints to fetch maximum points today!
                        </p>
                      </div>

                      {/* Whimsical horizontal progress timeline tracking current question metrics visually */}
                      <div className="py-6 border-y-2 border-dashed border-slate-100">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Quest Map Progress Timeline</p>
                        
                        <div className="relative flex items-center justify-between w-full max-w-2xl mx-auto px-4 mt-2">
                          {/* Background solid connector line */}
                          <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-2.5 bg-slate-100 rounded-full z-0 border border-slate-200" />
                          
                          {/* Active connector fill line */}
                          <div 
                            className="absolute left-6 top-1/2 -translate-y-1/2 h-2.5 bg-gradient-to-r from-amber-400 to-emerald-450 rounded-full z-0 transition-all duration-500" 
                            style={{ width: activeQuestAttempt ? '70%' : '33%' }}
                          />

                          {/* Interactive milestones */}
                          {[
                            { name: 'Warm-up', icon: '🔋', status: 'completed' },
                            { name: 'Practice Arena', icon: '⚡', status: 'active' },
                            { name: 'Quiz Duel', icon: '⚔️', status: activeQuestAttempt ? 'completed' : 'pending' },
                            { name: 'Star Trophy', icon: '🏆', status: 'pending' }
                          ].map((node, index) => {
                            const isDone = node.status === 'completed';
                            const isActive = node.status === 'active';
                            
                            return (
                              <div key={index} className="flex flex-col items-center relative z-10 text-center">
                                <div className={`w-11 h-11 rounded-full flex items-center justify-center border-2 border-b-[4px] ${
                                  isDone ? 'bg-emerald-400 border-slate-800' :
                                  isActive ? 'bg-amber-400 border-slate-800 animate-pulse' : 'bg-slate-50 border-slate-200'
                                } shadow-sm text-base`}>
                                  {isDone ? '✅' : node.icon}
                                </div>
                                <span className={`text-[10px] uppercase font-black tracking-wider mt-2.5 ${
                                  isDone ? 'text-emerald-600' :
                                  isActive ? 'text-amber-600 font-extrabold' : 'text-slate-400'
                                }`}>
                                  {node.name}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Massive high-contrast primary call-to-action play button (Height: 56px, h-14) */}
                      <div className="flex justify-start">
                        <Button 
                          className="h-14 py-4 px-8 text-sm font-black text-slate-900 bg-amber-400 hover:bg-amber-500 border-2 border-b-[6px] border-slate-800 rounded-2xl cursor-pointer flex items-center gap-3.5 transition-transform hover:translate-y-[-2px] hover:border-b-[8px] active:translate-y-[2px] active:border-b-[2px]" 
                          onClick={() => startExam(activeQuestExam)}
                        >
                          <span className="text-lg">🎮</span>
                          <span>{activeQuestAttempt ? 'CONTINUE YOUR QUEST' : 'LAUNCH QUIZ MISSION NOW!'}</span>
                          <ArrowRight className="h-5 w-5 shrink-0 stroke-[3px]" />
                        </Button>
                      </div>
                    </div>
                  );
                })()}

                {/* 3. METRICS BENTO ROW: Automatically wrapping visual micro-widgets */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {[
                    { label: 'Completed Tests', value: attempts.filter(a => a.status === 'completed').length, sub: 'Knowledge tags', icon: CheckCircle2, accBg: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-500' },
                    { label: 'Cognitive Effort', value: attempts.length > 0 ? 'Optimal' : 'Active', sub: 'Careful & Steady', icon: TrendingUp, accBg: 'bg-amber-100 text-amber-800 border-amber-300', dot: 'bg-amber-505' },
                    { label: 'Active Quizzes', value: exams.length, sub: 'Open pathways', icon: BookOpen, accBg: 'bg-sky-100 text-sky-850 border-sky-300', dot: 'bg-sky-500' },
                    { label: 'Safety Seal', value: 'Lv. 1 Safe', sub: 'Proctor verified', icon: ShieldCheck, accBg: 'bg-rose-100 text-rose-800 border-rose-300', dot: 'bg-rose-500' }
                  ].map((stat, i) => (
                    <div key={i} className="p-6 rounded-[24px] bg-white border-2 border-b-[6px] border-slate-200 shadow-sm transition-all hover:translate-y-[-2px] hover:shadow-md flex flex-col justify-between min-w-[195px]">
                      <div className="flex items-center justify-between gap-3 mb-4">
                         <div className={`p-2 rounded-xl border-2 ${stat.accBg} shrink-0 h-11 w-11 flex items-center justify-center`}>
                            <stat.icon className="h-5 w-5 shrink-0" strokeWidth={2.5} />
                         </div>
                         <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B] text-slate-450 truncate">{stat.label}</span>
                      </div>
                      <div>
                         <h4 className="text-3xl font-black text-slate-900 leading-none tracking-tight">{stat.value}</h4>
                         <div className="flex items-center gap-1.5 mt-2.5">
                           <div className={`h-2 w-2 rounded-full ${stat.dot}`} />
                           <p className="text-[10px] font-bold text-slate-400 uppercase leading-none">{stat.sub}</p>
                         </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 4. SELECTION CONTROLS CATALOGUE: Search and Subject Portals */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 p-6 bg-white border-2 border-b-[6px] border-slate-200 rounded-[28px] shadow-sm">
                  <div>
                    <h3 className="text-xl font-extrabold text-indigo-950 tracking-tight leading-none uppercase font-display">Quiz Universe Catalogue</h3>
                    <p className="text-slate-450 mt-2 text-xs font-bold leading-relaxed">
                      Filter by specific subject trackers or find exams using keywords.
                    </p>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center flex-wrap">
                    {/* Search Input Box */}
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-450" strokeWidth={2.5} />
                      <Input 
                        placeholder="Search exam tracks..." 
                        className="pl-12 pr-4 h-12 bg-slate-50 border-2 border-b-[4px] border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 focus-visible:ring-0 focus-visible:border-indigo-400 shadow-inner w-full"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>

                    {/* Subject Filter neubrutalist buttons with touchable targets */}
                    <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 border-2 border-slate-200 rounded-xl">
                      {['All', ...Array.from(new Set(exams.map(e => e.subject).filter(Boolean)))].map(sub => {
                        const subStr = sub || '';
                        const isS = activeTab === subStr;
                        return (
                          <button
                            key={subStr}
                            onClick={() => setActiveTab(subStr)}
                            className={`px-4.5 h-10 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-200 cursor-pointer ${isS ? 'bg-indigo-950 text-white font-black shadow' : 'hover:bg-slate-200 text-slate-600'}`}
                          >
                            {subStr === 'All' ? '🌌 ALL' : subStr === 'Mathematics' ? '🧮 MATH' : subStr === 'Physics' ? '🧪 SCIENCE' : `📚 ${subStr.toUpperCase()}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 5. LIVE EXAM CATALOGUE GRID: Rounded Multi-choice Subject Cards */}
                {filteredExams.length === 0 ? (
                  <div className="p-16 text-center bg-white border-2 border-b-[6px] border-slate-200 rounded-[32px] max-w-xl mx-auto space-y-4 shadow-sm">
                     <FileText className="h-12 w-12 text-slate-400 mx-auto" strokeWidth={2.5} />
                     <p className="text-base text-slate-700 font-bold uppercase">No active quizzes match that search!</p>
                     <p className="text-xs text-slate-450 font-semibold leading-relaxed">Try searching for other key terms to launch active exam simulations.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                    {filteredExams.map(exam => {
                      const attempt = getAttempt(exam.id);
                      const isCompleted = attempt?.status === 'completed' && !attempt?.canReattempt;

                      // Subject specific color configurations
                      const borderTheme = exam.subject === 'Mathematics' ? 'border-amber-300 hover:border-amber-400 border-b-[8px]' : exam.subject === 'Physics' ? 'border-emerald-300 hover:border-emerald-400 border-b-[8px]' : 'border-sky-305 hover:border-sky-400 border-b-[8px]';
                      const badgeTheme = exam.subject === 'Mathematics' ? 'text-amber-800 bg-amber-50 border-amber-200' : exam.subject === 'Physics' ? 'text-emerald-800 bg-emerald-50 border-emerald-202' : 'text-sky-850 bg-sky-50 border-sky-200';
                      
                      // Fun children's micro-copy depending on index/text
                      const microCopyOption = [
                        "Let's crack some science puzzles! Gather stardust and unlock secrets.",
                        "Assemble your numbers radar to conquer this logic board!",
                        "Fabulous space adventure study run. Try it yourself! ✨",
                        "Show off your academy wizard powers, you are amazing!"
                      ];
                      const encourageText = microCopyOption[exam.title.length % microCopyOption.length];

                      return (
                        <Card 
                          key={exam.id} 
                          className={`group relative overflow-hidden bg-white border-2 transition-all duration-300 shadow-sm hover:shadow-md rounded-[32px] flex flex-col justify-between min-w-[280px] sm:min-w-[320px] w-full ${borderTheme}`}
                        >
                          <div className="relative p-7 md:p-8 space-y-5 flex-1 flex flex-col justify-between">
                            {/* Card Header details */}
                            <div className="space-y-4">
                              <div className="flex items-center justify-between gap-4 flex-wrap">
                                 <div className="flex items-center gap-3">
                                    {/* FIXED ASSET BOUNDING BOX FOR ICON (exactly h-14 w-14) */}
                                    <div className="h-14 w-14 rounded-2xl bg-slate-50 border-2 border-b-[4px] border-slate-200 flex items-center justify-center shrink-0 shadow-sm transition-transform group-hover:rotate-6 duration-300">
                                       {SUBJECT_ICONS_NEUBRUTALIST[exam.subject] || <DefaultQuizIcon />}
                                    </div>
                                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">{exam.subject}</span>
                                 </div>
                                 <Badge className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 border-2 rounded-full ${badgeTheme}`}>
                                   {exam.difficulty}
                                 </Badge>
                              </div>

                              <CardTitle className="font-display font-black text-xl text-slate-900 group-hover:text-indigo-950 leading-snug uppercase tracking-tight transition-colors">
                                {exam.title}
                              </CardTitle>
                              
                              {/* Encouraging Kid-friendly micro-copy description */}
                              <CardDescription className="text-slate-500 text-xs font-bold leading-relaxed font-sans mt-3">
                                {encourageText}
                              </CardDescription>
                            </div>

                            {/* Card Core metrics */}
                            <div className="flex flex-wrap items-center gap-2.5 pt-2">
                              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-600 bg-slate-105 px-3 py-2 rounded-xl border border-slate-200 uppercase tracking-wide h-10">
                                <Clock className="h-5 w-5 shrink-0 text-sky-505" strokeWidth={2.5} /> 
                                <span>{exam.duration} mins</span>
                              </div>
                              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-600 bg-slate-105 px-3 py-2 rounded-xl border border-slate-200 uppercase tracking-wide h-10">
                                <Star className="h-5 w-5 shrink-0 text-amber-500 fill-amber-300" strokeWidth={2.5} /> 
                                <span>{exam.totalMarks} points</span>
                              </div>
                            </div>
                          </div>

                          {/* Interactive Card Action Footer */}
                          <CardFooter className="bg-slate-50/80 border-t-2 border-slate-100 p-6 md:p-8 flex flex-col gap-5 mt-auto relative z-10 shrink-0">
                             {isCompleted && attempt ? (
                                <div className="w-full bg-emerald-50 border-2 border-emerald-200 p-4 rounded-xl flex items-center justify-between shadow-inner gap-4">
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Assessment Lodged</span>
                                    <span className="text-xs font-bold text-slate-800 mt-1 leading-snug">
                                      Saved to Valuation Core
                                    </span>
                                  </div>
                                  <div className="h-9 px-3 rounded-lg bg-emerald-400 text-slate-900 border-2 border-b-[4px] border-emerald-500 flex items-center justify-center font-mono font-black text-[10px] shrink-0 gap-1">
                                    ✓ SECURE
                                  </div>
                                </div>
                             ) : (
                               attempt && (
                                 <div className="w-full bg-sky-50 border-2 border-sky-200 p-4 rounded-xl flex items-center justify-between shadow-inner gap-4">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <ShieldCheck className="h-5 w-5 text-sky-500 shrink-0" strokeWidth={2.5} />
                                      <p className="text-[10px] font-black text-sky-700 uppercase tracking-widest truncate">Rescue Checkpoint Active</p>
                                    </div>
                                    <div className="h-2.5 w-2.5 rounded-full bg-sky-500 animate-pulse shrink-0" />
                                 </div>
                               )
                             )}

                             {!isCompleted ? (
                               <Button 
                                 className="w-full h-12.5 bg-rose-500 hover:bg-rose-600 text-white font-extrabold text-xs tracking-wider uppercase transition-all duration-300 rounded-xl flex items-center justify-center gap-2.5 cursor-pointer shadow-[0px_4px_0px_#B91C1C] hover:translate-y-[2px] hover:shadow-[0px_2px_0px_#B91C1C] active:translate-y-[4px] active:shadow-none" 
                                 onClick={() => startExam(exam)}
                               >
                                 <span>{attempt ? 'CONTINUE ASSESSMENT' : 'LAUNCH QUIZ NOW!'}</span> 
                                 <ArrowRight className="h-5 w-5 shrink-0" strokeWidth={2.5} />
                               </Button>
                             ) : (
                               <Button 
                                 className="w-full h-12.5 text-slate-700 bg-white hover:bg-slate-50 border-2 border-b-[5px] border-slate-200 hover:border-slate-300 text-xs font-extrabold tracking-wider uppercase transition-all rounded-xl flex items-center justify-center gap-2.5 cursor-pointer" 
                                 onClick={() => navigate(`/result/${attempt.id}`)}
                               >
                                  <span>VIEW SECURE RECEIPT</span> 
                                  <ArrowRight className="h-5 w-5 shrink-0" strokeWidth={2.5} />
                               </Button>
                             )}
                          </CardFooter>
                        </Card>
                      );
                    })}
                  </div>
                )}
             </div>

          </div>

        </TabsContent>

        {/* ================= DIAGNOSTIC ADVANCED ANALYTICS CONTENTS ================= */}
        <TabsContent value="analytics" className="outline-none">
           <StudentAdvancedAnalytics attempts={attempts} />
        </TabsContent>

        {/* ================= MICROSCHEDULE WEEKLY ROADMAP ================= */}
        <TabsContent value="schedule" className="outline-none">
           <MicroscheduleDashboard />
        </TabsContent>

        {/* ================= STUDY LEDGER ERROR BOOK CONTENTS ================= */}
        <TabsContent value="error-book" className="outline-none">
           <ErrorBook />
        </TabsContent>
      </Tabs>
    </div>
  );
};
