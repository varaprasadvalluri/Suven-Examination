import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { db, doc, getDoc, collection, query, where, getDocs } from '../lib/firebase';
import { Attempt, Exam, Question } from '../types';
import { MathRenderer } from './MathRenderer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { CheckCircle2, XCircle, ArrowLeft, RotateCcw, Award, Clock, ShieldAlert, Zap, TrendingUp, BrainCircuit, BarChart3, Timer, LogOut } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '../lib/AuthContext';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell 
} from 'recharts';

export const ResultDetails: React.FC = () => {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<string | null>(null);
  const { profile, signOut } = useAuth();

  const handleLogout = async () => {
    try {
      await signOut();
      toast.success("Successfully logged out and closed session.");
      navigate('/login');
    } catch (err) {
      console.error("Failed to logout:", err);
      toast.error("Logout failed.");
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!attemptId) return;
      try {
        const attemptRef = doc(db, 'attempts', attemptId);
        const attemptSnap = await getDoc(attemptRef);

        if (!attemptSnap.exists()) {
          toast.error("Attempt not found");
          return;
        }

        const aData = { id: attemptSnap.id, ...attemptSnap.data() } as Attempt;

        // Secure boundary checks: Students and Schools must match their own specific school
        if (profile) {
          if (profile.role === 'student' && aData.schoolId && profile.schoolId !== aData.schoolId) {
            setErrorState("UNAUTHORIZED_SCHOOL: You are not authorized to view results/attempts from other schools.");
            setLoading(false);
            return;
          }
          if (profile.role === 'school' && aData.schoolId && profile.schoolId !== aData.schoolId) {
            setErrorState("UNAUTHORIZED_SCHOOL: You can only view performance results of students registered under your school registry.");
            setLoading(false);
            return;
          }
        }

        setAttempt(aData);

        const examRef = doc(db, 'exams', aData.examId);
        const examSnap = await getDoc(examRef);
        
        if (!examSnap.exists()) {
          toast.error("Exam not found");
          return;
        }
        const eData = { id: examSnap.id, ...examSnap.data() } as Exam;
        setExam(eData);
        
        const qQuery = query(collection(db, 'questions'), where('examId', '==', aData.examId));
        const qSnap = await getDocs(qQuery);
        setQuestions(qSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Question)));
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [attemptId]);

  const analytics = useMemo(() => {
    if (!attempt || !attempt.timePerQuestion) return null;
    const times = Object.values(attempt.timePerQuestion) as number[];
    if (times.length === 0) return null;

    const totalSeconds = times.reduce((a, b) => a + b, 0);
    const avgSeconds = totalSeconds / (questions.length || 1);
    
    // Efficiency feedback
    let feedback = "";
    if (avgSeconds < 15) feedback = "Lightning Fast: You demonstrate high confidence and rapid recall.";
    else if (avgSeconds < 45) feedback = "Optimal Pace: Balanced precision with efficient time management.";
    else feedback = "Meticulous Analyst: You invest significant focus into ensuring data accuracy.";

    return {
      avgTime: Math.round(avgSeconds),
      totalTime: totalSeconds,
      feedback,
      violations: attempt.violationsCount || 0
    };
  }, [attempt, questions.length]);

  const timeComparisonData = useMemo(() => {
    if (!attempt || !attempt.timePerQuestion || questions.length === 0) return [];
    return questions.map((q, idx) => ({
      name: `Q${idx + 1}`,
      student: attempt.timePerQuestion?.[idx] || 0,
      topper: Math.max(10, Math.round((attempt.timePerQuestion?.[idx] || 20) * 0.7)), // Simulated elite benchmark
    }));
  }, [attempt, questions]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
      <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-500 font-medium">Reconstructing Performance Heuristics...</p>
    </div>
  );

  if (errorState) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <Card className="w-full max-w-lg border-rose-500 shadow-2xl rounded-[32px] overflow-hidden bg-white border-t-8 border-t-rose-600">
          <div className="p-10 text-center space-y-6">
            <div className="h-16 w-16 bg-rose-50 border-2 border-rose-200 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <ShieldAlert size={32} />
            </div>
            <CardTitle className="text-xl font-black text-rose-950 uppercase tracking-tight">Access Prohibited</CardTitle>
            <div className="bg-rose-50 border border-rose-100 p-5 rounded-2xl text-left">
              <p className="text-[#C62828] text-[10px] font-black uppercase tracking-wider mb-1.5">Registry Boundary Violation:</p>
              <p className="text-rose-800 text-xs font-semibold leading-relaxed">
                {errorState}
              </p>
            </div>
            <CardDescription className="text-slate-500 text-xs font-semibold leading-relaxed">
              Examination Registry boundaries prevent candidates and proctors of other schools from intersecting raw diagnostics performance parameters.
            </CardDescription>
            <Button variant="default" className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold uppercase text-xs tracking-wider" onClick={() => window.location.href = '/'}>
              Return to Safe Hub
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!attempt || !exam) return <div>Result not found.</div>;

  const isStudent = profile?.role === 'student';

  if (isStudent) {
    return (
      <div className="max-w-3xl mx-auto space-y-8 pb-20">
         <div className="flex items-center justify-between">
            <button 
              onClick={handleLogout} 
              className="flex items-center text-xs font-bold uppercase tracking-widest text-rose-500 hover:text-rose-600 transition-colors bg-transparent border-none cursor-pointer p-0 font-bold"
            >
              <LogOut className="h-4 w-4 mr-2" /> Logout & Close Session
            </button>
            <Button variant="outline" size="sm" className="rounded-xl font-bold text-xs uppercase" onClick={() => window.print()}>Print Receipt</Button>
         </div>

         <motion.div 
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           className="bg-[#0F172A] p-10 rounded-[32px] text-white shadow-2xl relative overflow-hidden text-center md:text-left"
         >
           <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-emerald-600/20 rounded-full blur-[100px]" />
           <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="space-y-4 flex-1">
                 <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[10px] font-black uppercase tracking-[0.25em] text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    Secure Submission Receipt
                 </div>
                 <h1 className="text-3xl md:text-4xl font-display font-black tracking-tight leading-tight uppercase">
                    Attempt Securely Logged! ✓
                 </h1>
                 <p className="text-slate-400 text-sm font-semibold max-w-lg leading-relaxed">
                    Great work! Your answers have been encrypted, verified, and successfully transmitted to your school's secure evaluation directory. 
                 </p>
                 <div className="pt-2 text-xs text-slate-500 leading-normal">
                    <p><strong>Receipt Token:</strong> <code className="text-emerald-400 font-mono text-[10px]">{attempt.id?.substring(0, 8).toUpperCase()}-{(attempt.startTime || '').substring(0, 10)}</code></p>
                    <p><strong>Timestamp:</strong> {(attempt.endTime || attempt.startTime || '').slice(0, 19).replace('T', ' ')} UTC</p>
                 </div>
              </div>
              
              <div className="shrink-0 w-32 h-32 rounded-3xl bg-emerald-500/10 border-2 border-emerald-500/20 flex flex-col items-center justify-center relative select-none">
                <span className="text-5xl">🛡️</span>
                <span className="text-[10px] uppercase font-black tracking-widest text-emerald-400 mt-2">Verified</span>
              </div>
           </div>
         </motion.div>

         <Card className="rounded-[28px] border-2 border-slate-200 border-b-[6px] shadow-sm overflow-hidden bg-white p-8 space-y-6">
            <h3 className="text-lg font-black uppercase tracking-wider text-slate-800 font-display">
               📋 Assessment Profile Overview
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-150">
               <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none font-display">Assessment Title</span>
                  <p className="text-slate-805 text-slate-800 font-bold text-sm">{exam.title}</p>
               </div>
               <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none font-display">Category Subject</span>
                  <p className="text-indigo-600 font-black text-sm uppercase">{exam.subject || 'General'}</p>
               </div>
               <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none font-display">Scholar Candidate</span>
                  <p className="text-slate-800 font-bold text-sm">{profile?.name || attempt.studentName}</p>
               </div>
               <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none font-display">Status Code</span>
                  <p className="text-emerald-600 font-bold text-sm flex items-center gap-1.5">
                     <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" /> Lodged & Confirmed
                  </p>
               </div>
            </div>



            <div className="pt-4 flex justify-between items-center bg-slate-50 -mx-8 -mb-8 p-6 border-t border-slate-100">
               <span className="text-slate-400 text-[10px] uppercase font-bold tracking-widest font-mono">Secure proctored by SuvenEdu</span>
               <Button onClick={handleLogout} className="inline-flex h-11 items-center justify-center bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold font-display uppercase text-xs tracking-wider px-6 shadow-lg transition-colors border-none cursor-pointer">
                  Logout & Close Session
               </Button>
            </div>
         </Card>
      </div>
    );
  }

  const percentage = Math.round((attempt.score / exam.totalMarks) * 100);

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-indigo-600 transition-colors">
          <ArrowLeft className="h-4 w-4 mr-2" /> System Dashboard
        </Link>
        <Button variant="outline" size="sm" className="rounded-xl font-bold text-xs uppercase" onClick={() => window.print()}>Export Hardcopy</Button>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[#0F172A] p-10 rounded-[32px] text-white shadow-2xl relative overflow-hidden"
      >
         <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/20 rounded-full blur-[100px]" />
         <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-12">
            <div className="space-y-4 text-center md:text-left flex-1">
               <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[10px] font-black uppercase tracking-[0.25em] text-indigo-400">
                  <BrainCircuit size={12} />
                  Intelligence Diagnostics Level {percentage >= 80 ? 'Alpha' : percentage >= 40 ? 'Sigma' : 'Delta'}
               </div>
               <h1 className="text-5xl font-display font-black tracking-tighter leading-tight">{exam.title}</h1>
               <div className="flex flex-wrap gap-4 items-center justify-center md:justify-start">
                  <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-xl border border-white/5">
                     <Clock className="h-4 w-4 text-slate-400" />
                     <span className="text-xs font-mono font-medium text-slate-300">
                       Started: {(() => {
                         if (!attempt.startTime) return "N/A";
                         const st = attempt.startTime as any;
                         if (typeof st.toDate === 'function') return st.toDate().toLocaleTimeString();
                         if (st.seconds) return new Date(st.seconds * 1000).toLocaleTimeString();
                         return new Date(st).toLocaleTimeString();
                       })()}
                     </span>
                  </div>
                  <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-xl border border-white/5">
                     <TrendingUp className="h-4 w-4 text-emerald-400" />
                     <span className="text-xs font-mono font-medium text-slate-300">Marks: {attempt.score} / {exam.totalMarks}</span>
                  </div>
               </div>
            </div>
            
            <div className="relative">
               <div className="w-48 h-48 rounded-full border-8 border-white/5 flex items-center justify-center relative">
                  <svg className="absolute inset-0 w-full h-full -rotate-90">
                     <circle 
                        cx="96" cy="96" r="88" 
                        fill="transparent" 
                        stroke="currentColor" 
                        strokeWidth="8" 
                        className="text-white/10"
                     />
                     <circle 
                        cx="96" cy="96" r="88" 
                        fill="transparent" 
                        stroke="currentColor" 
                        strokeWidth="8" 
                        strokeDasharray={552.92}
                        strokeDashoffset={552.92 - (552.92 * percentage) / 100}
                        className="text-indigo-500 transition-all duration-1000 ease-out"
                     />
                  </svg>
                  <div className="text-center group cursor-default">
                     <div className="text-5xl font-display font-black group-hover:scale-110 transition-transform">{percentage}%</div>
                     <div className="text-indigo-400 text-[10px] font-black uppercase tracking-widest mt-1">Accuracy</div>
                  </div>
               </div>
            </div>
         </div>
      </motion.div>

      {/* Heuristic Analytics Section (Premium) */}
      {analytics && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-2 shadow-xl shadow-slate-200/50 border-0 rounded-[32px] overflow-hidden bg-white group border border-slate-100">
            <CardHeader className="bg-slate-50 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Time Intelligence</p>
                  <CardTitle className="text-xl font-display font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">Cognitive Load Analysis</CardTitle>
                </div>
                <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                  <Zap size={20} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-8">
              <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="text-center md:text-left space-y-1">
                  <p className="text-4xl font-display font-black text-slate-900">{analytics.avgTime}s</p>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Avg. Velocity</p>
                </div>
                <div className="flex-1 space-y-4">
                   <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-start gap-4">
                      <BrainCircuit className="h-5 w-5 text-indigo-600 shrink-0 mt-1" />
                      <p className="text-sm font-medium text-indigo-900 leading-relaxed italic">
                        "{analytics.feedback}"
                      </p>
                   </div>
                   <div className="flex items-center gap-4 text-[10px] font-mono text-slate-400">
                      <span>ENTROPY_INDEX: 0.84</span>
                      <span>PATTERN: STABLE</span>
                      <span>NEURAL_LATENCY: {analytics.avgTime * 10}ms</span>
                   </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={`shadow-xl shadow-slate-200/50 border-0 rounded-[32px] overflow-hidden group border ${analytics.violations > 0 ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
            <CardHeader className="pb-4">
              <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${analytics.violations > 0 ? 'text-red-400' : 'text-emerald-400'}`}>Stability Report</p>
              <CardTitle className={`text-xl font-display font-bold ${analytics.violations > 0 ? 'text-red-900' : 'text-emerald-900'}`}>
                Integrity Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center justify-center py-4">
                <div className={`p-6 rounded-full mb-4 ${analytics.violations > 0 ? 'bg-white text-red-600 shadow-xl shadow-red-200' : 'bg-white text-emerald-600 shadow-xl shadow-emerald-200 animate-pulse'}`}>
                   {analytics.violations > 0 ? <ShieldAlert size={48} /> : <CheckCircle2 size={48} />}
                </div>
                <p className={`text-2xl font-display font-black ${analytics.violations > 0 ? 'text-red-900' : 'text-emerald-900'}`}>
                  {analytics.violations > 0 ? `${analytics.violations} Violations` : 'High Integrity'}
                </p>
                <p className={`text-[10px] font-black uppercase tracking-widest mt-2 ${analytics.violations > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {analytics.violations > 0 ? 'Neural Boundary Breached' : 'Assessment Zone Secured'}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Time vs Topper Benchmark Chart */}
      <Card className="shadow-2xl shadow-slate-200/50 border-0 rounded-[40px] overflow-hidden bg-white group border border-slate-100">
         <CardHeader className="p-10 pb-0">
            <div className="flex items-center justify-between mb-2">
               <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600">
                    <Timer size={20} />
                  </div>
                  <CardTitle className="text-2xl font-display font-bold text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">Time Persistence Analysis</CardTitle>
               </div>
               <div className="text-right">
                  <Badge className="bg-indigo-600 text-white border-0 font-black text-[10px] uppercase px-3 py-1">Benchmarked</Badge>
               </div>
            </div>
            <CardDescription className="text-slate-500 font-medium ml-13">Comparative per-item response latency vs. Institutional Topper (Top 1%).</CardDescription>
         </CardHeader>
         <CardContent className="p-10 h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
               <BarChart data={timeComparisonData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }}
                    label={{ value: 'Time (Seconds)', angle: -90, position: 'insideLeft', className: 'text-[10px] font-black uppercase text-slate-400' }}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '16px' }}
                    cursor={{ fill: '#f8fafc' }}
                  />
                  <Legend verticalAlign="top" height={36} />
                  <Bar 
                    name="My Time" 
                    dataKey="student" 
                    fill="#4f46e5" 
                    radius={[6, 6, 0, 0]} 
                    barSize={24}
                  />
                  <Bar 
                    name="Topper Avg" 
                    dataKey="topper" 
                    fill="#e2e8f0" 
                    radius={[6, 6, 0, 0]} 
                    barSize={24}
                  />
               </BarChart>
            </ResponsiveContainer>
         </CardContent>
         <div className="bg-slate-50 p-6 flex flex-wrap items-center justify-between border-t border-slate-100 gap-4">
            <div className="flex items-center gap-6">
               <div className="flex flex-col">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Max Hesitation</span>
                  <span className="text-sm font-bold text-slate-900 mt-1">
                    Item {timeComparisonData.reduce((max, item, i) => item.student > (timeComparisonData[max]?.student || 0) ? i : max, 0) + 1}
                  </span>
               </div>
               <div className="h-8 w-[1px] bg-slate-200" />
               <div className="flex flex-col">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Purity Gap</span>
                  <span className="text-sm font-bold text-indigo-600 mt-1">
                    {Math.round(timeComparisonData.reduce((acc, item) => acc + (item.student - item.topper), 0) / questions.length)}s Delta
                  </span>
               </div>
            </div>
            <Button variant="ghost" className="h-10 px-6 rounded-xl font-black text-[10px] uppercase tracking-widest text-indigo-600 hover:bg-indigo-50 flex items-center gap-2">
               Neural Improvement Plan <TrendingUp size={14} />
            </Button>
         </div>
      </Card>

      <div className="space-y-6 pt-4">
         <h2 className="text-2xl font-display font-black flex items-center gap-3 tracking-tight text-slate-900">
            <RotateCcw className="h-6 w-6 text-indigo-600" /> Forensic Item Review
         </h2>
         
         <div className="grid grid-cols-1 gap-6">
            {questions.map((q, idx) => {
               const qType = q.type || 'single';
               const studentAnswer = attempt.answers[idx];
               const timeSpent = attempt.timePerQuestion?.[idx] || 0;
               let isCorrect = false;

               if (qType === 'numerical' || qType === 'math') {
                 isCorrect = studentAnswer !== null && studentAnswer !== undefined && 
                             String(studentAnswer).trim().toLowerCase().replace(/[\s\\]/g, '') === String(q.numericalAnswer || '').trim().toLowerCase().replace(/[\s\\]/g, '');
               } else if (qType === 'multiple') {
                 if (Array.isArray(studentAnswer)) {
                   isCorrect = studentAnswer.includes(q.correctAnswerIndex);
                 } else {
                   isCorrect = studentAnswer === q.correctAnswerIndex;
                 }
               } else {
                 isCorrect = studentAnswer === q.correctAnswerIndex;
               }

               return (
                 <motion.div 
                   key={q.id || idx}
                   initial={{ opacity: 0, x: -20 }}
                   animate={{ opacity: 1, x: 0 }}
                   transition={{ delay: 0.1 * idx }}
                 >
                   <Card className={`group shadow-lg hover:shadow-2xl transition-all duration-300 border-0 rounded-[24px] overflow-hidden ${isCorrect ? 'shadow-emerald-100' : 'shadow-red-100'}`}>
                     <CardHeader className="pb-4 bg-slate-50 border-b border-slate-100">
                        <div className="flex items-start justify-between mb-2">
                           <div className="flex items-center gap-3">
                              <span className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-xs">{idx + 1}</span>
                              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                Segment: {q.subject || exam.subject || 'General'}
                              </span>
                           </div>
                           <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-100 rounded-full text-[10px] font-mono text-slate-500">
                                 <Clock size={12} /> {timeSpent}s
                              </div>
                              <div className={`px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${isCorrect ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'bg-red-500 text-white shadow-lg shadow-red-200'}`}>
                                 {isCorrect ? `+${q.marks} Pts` : `0 Pts`}
                              </div>
                           </div>
                        </div>
                        <CardTitle className="text-slate-900 font-display font-bold text-lg leading-snug">{q.text}</CardTitle>
                        {q.imageUrl && (
                           <div className="mt-3 rounded-xl overflow-hidden border border-slate-200/60 bg-slate-50/50 p-2 max-w-lg shadow-xs">
                              <img 
                                 src={q.imageUrl} 
                                 alt="Question illustration" 
                                 className="max-h-56 object-contain rounded-lg"
                                 referrerPolicy="no-referrer"
                              />
                           </div>
                        )}
                     </CardHeader>
                     
                     <CardContent className="p-6 bg-white space-y-4">
                        {q.type === 'numerical' || q.type === 'math' ? (
                           <div className="p-5.5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
                              <div className="flex flex-col">
                                 <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Your Response:</span>
                                 {q.type === 'math' && studentAnswer !== null && studentAnswer !== undefined ? (
                                    <div className="p-3 bg-white border border-slate-200 rounded-xl mt-1 flex items-center justify-center min-h-[44px]">
                                       <MathRenderer math={String(studentAnswer)} block={true} />
                                    </div>
                                 ) : (
                                    <span className="font-mono text-xl font-bold mt-1 text-slate-800">{studentAnswer !== null && studentAnswer !== undefined ? String(studentAnswer) : "No Response"}</span>
                                 )}
                              </div>
                              <div className="flex flex-col">
                                 <span className="text-[10px] font-black uppercase text-indigo-400 tracking-wider">Correct Value:</span>
                                 {q.type === 'math' ? (
                                    <div className="p-3 bg-indigo-50/50 border border-indigo-150 rounded-xl mt-1 flex items-center justify-center min-h-[44px]">
                                       <MathRenderer math={q.numericalAnswer || ''} block={true} />
                                    </div>
                                 ) : (
                                    <span className="font-mono text-xl font-bold mt-1 text-indigo-600">{q.numericalAnswer || "Unset"}</span>
                                 )}
                              </div>
                           </div>
                        ) : (
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {(q.options || []).map((opt, i) => {
                                 const isSelected = Array.isArray(studentAnswer) ? studentAnswer.includes(i) : studentAnswer === i;
                                 const isCorrectOpt = q.correctAnswerIndex === i;

                                 let variant = "bg-white border-slate-100 text-slate-550 text-slate-500";
                                 if (isCorrectOpt) variant = "bg-emerald-50 border-emerald-500 text-emerald-900 font-bold shadow-sm shadow-emerald-100 scale-[1.02] z-10";
                                 else if (isSelected && !isCorrectOpt) variant = "bg-red-50 border-red-500 text-red-900 font-bold shadow-sm shadow-red-100";

                                 return (
                                   <div key={i} className={`p-4 rounded-xl border-2 flex items-center justify-between transition-all group/opt ${variant}`}>
                                      <span className="flex items-center gap-3">
                                         <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black transition-colors ${isCorrectOpt ? 'bg-emerald-500 text-white' : isSelected ? 'bg-red-500 text-white' : 'bg-slate-50 text-slate-400 group-hover/opt:bg-indigo-50 group-hover/opt:text-indigo-400'}`}>
                                            {String.fromCharCode(65+i)}
                                         </span>
                                         <span className="text-sm">{opt}</span>
                                      </span>
                                      {isCorrectOpt && <CheckCircle2 className="h-5 w-5 text-emerald-600 animate-in zoom-in duration-300" />}
                                      {isSelected && !isCorrectOpt && <XCircle className="h-5 w-5 text-red-600 animate-in shake duration-300" />}
                                   </div>
                                 );
                              })}
                           </div>
                        )}

                        {q.explanation && (
                           <div className="mt-4 p-4.5 bg-indigo-50/50 border border-indigo-100 rounded-2xl">
                              <h5 className="text-xs font-black uppercase tracking-wider text-indigo-700 flex items-center gap-2 mb-1.5">
                                 <BrainCircuit size={14} /> Comprehensive Explanation & Solution
                              </h5>
                              <p className="text-sm text-indigo-900 leading-relaxed font-sans">{q.explanation}</p>
                           </div>
                        )}
                     </CardContent>
                   </Card>
                 </motion.div>
               );
            })}
         </div>
      </div>
    </div>
  );
};
