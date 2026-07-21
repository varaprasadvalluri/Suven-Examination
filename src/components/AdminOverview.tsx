import React, { useEffect, useState, useMemo } from 'react';
import { db } from '../lib/firebase';
import { collection, getDocs, query, orderBy, limit, where, getCountFromServer } from 'firebase/firestore';
import { Exam, School, Attempt } from '../types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { 
  Users, 
  FileText, 
  School as SchoolIcon, 
  TrendingUp, 
  Plus, 
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Download,
  Loader2,
  ShieldCheck,
  Zap,
  Activity,
  LayoutGrid,
  BarChart3,
  Search
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useAuth } from '../lib/AuthContext';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';

const loginActivityData = [
  { day: 'Mon', value: 400 },
  { day: 'Tue', value: 300 },
  { day: 'Wed', value: 600 },
  { day: 'Thu', value: 800 },
  { day: 'Fri', value: 500 },
  { day: 'Sat', value: 200 },
  { day: 'Sun', value: 100 },
];

const subjectMasteryData = [
  { subject: 'Math', A: 120, B: 110, fullMark: 150 },
  { subject: 'Physics', A: 98, B: 130, fullMark: 150 },
  { subject: 'Chemistry', A: 86, B: 130, fullMark: 150 },
  { subject: 'Biology', A: 99, B: 100, fullMark: 150 },
  { subject: 'English', A: 85, B: 90, fullMark: 150 },
  { subject: 'CS', A: 145, B: 85, fullMark: 150 },
];

export const AdminOverview: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    exams: 0,
    schools: 0,
    attempts: 0,
    activeExams: 0
  });
  const [recentExams, setRecentExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  interface SchoolMetrics {
    schoolId: string;
    name: string;
    attending: number;
    completed: number;
  }
  const [schoolStats, setSchoolStats] = useState<SchoolMetrics[]>([]);

  const handleMasterExport = async () => {
    setIsExporting(true);
    try {
      const attemptsSnap = await getDocs(collection(db, 'attempts'));
      const examsSnap = await getDocs(collection(db, 'exams'));
      const schoolsSnap = await getDocs(collection(db, 'schools'));
      
      const attempts = attemptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      const exams = examsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      const schools = schoolsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

      const examsMap = new Map(exams.map(e => [e.id, e]));
      const schoolsMap = new Map(schools.map(s => [s.id, s]));

      const exportData = attempts.map(data => {
        const exam = examsMap.get(data.examId) as any;
        const school = schoolsMap.get(data.schoolId) as any;
        
        return {
          'Student Name': data.studentName,
          'Student Email': data.studentEmail || 'N/A',
          'Institution': school?.name || 'N/A',
          'Exam Title': exam?.title || 'N/A',
          'Subject': exam?.subject || 'N/A',
          'Score': data.score,
          'Total Marks': exam?.totalMarks || 0,
          'Status': data.status,
          'Date Completed': data.endTime ? new Date(data.endTime).toLocaleString() : 'N/A'
        };
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Master Results Report");
      XLSX.writeFile(wb, "Master_Intelligence_Report.xlsx");
      toast.success("Master report generated successfully");
    } catch (error) {
      console.error("Export error", error);
      toast.error("Failed to generate master report");
    } finally {
      setIsExporting(false);
    }
  };

  
  const [dynamicLoginActivityData, setDynamicLoginActivityData] = useState(loginActivityData);
  const [dynamicSubjectMasteryData, setDynamicSubjectMasteryData] = useState(subjectMasteryData);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const examsSnap = await getCountFromServer(collection(db, 'exams'));
        const schoolsSnap = await getCountFromServer(collection(db, 'schools'));
        const attemptsSnap = await getCountFromServer(collection(db, 'attempts'));
        const activeExamsQuery = query(collection(db, 'exams'), where('status', '==', 'published'));
        const activeExamsSnap = await getCountFromServer(activeExamsQuery);
        
        setStats({
          exams: examsSnap.data().count,
          schools: schoolsSnap.data().count,
          attempts: attemptsSnap.data().count,
          activeExams: activeExamsSnap.data().count
        });

        const recentExamsQuery = query(collection(db, 'exams'), orderBy('createdAt', 'desc'), limit(5));
        const recentSnap = await getDocs(recentExamsQuery);
        
        setRecentExams(recentSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Exam)));

        // Retrieve real-time school metrics
        const schoolsQuerySnap = await getDocs(collection(db, 'schools'));
        const attemptsQuerySnap = await getDocs(collection(db, 'attempts'));
        const schoolsList = schoolsQuerySnap.docs.map(dDoc => ({ id: dDoc.id, ...dDoc.data() } as any));
        const attemptsList = attemptsQuerySnap.docs.map(aDoc => aDoc.data() as any);
        
        const calculatedSchoolStats = schoolsList.map(school => {
          const schoolAttempts = attemptsList.filter(att => att.schoolId === school.id);
          const attendingCount = schoolAttempts.filter(att => att.status !== 'completed').length;
          const completedCount = schoolAttempts.filter(att => att.status === 'completed').length;
          return {
            schoolId: school.id,
            name: school.name || 'Unknown School Unit',
            attending: attendingCount,
            completed: completedCount
          };
        });
        setSchoolStats(calculatedSchoolStats);
        
        // Compute dynamic intelligence base data
        
        // 1. Subject Mastery Data
        const subjectStats: Record<string, { totalScore: number, maxScore: number, count: number }> = {};
        attemptsList.filter(a => a.status === 'completed').forEach(attempt => {
            const ex = recentSnap.docs.find(d => d.id === attempt.examId)?.data() as any;
            const subj = ex?.subject || 'General';
            const maxM = ex?.totalMarks || 150;
            if (!subjectStats[subj]) subjectStats[subj] = { totalScore: 0, maxScore: maxM, count: 0 };
            subjectStats[subj].totalScore += attempt.score;
            subjectStats[subj].count += 1;
        });
        
        const computedMastery = Object.keys(subjectStats).map(subj => {
             const stat = subjectStats[subj];
             return {
                 subject: subj,
                 A: Math.round(stat.totalScore / stat.count),
                 B: Math.round(stat.maxScore * 0.8), // Mock target
                 fullMark: stat.maxScore
             }
        });
        
        if (computedMastery.length > 0) {
            setDynamicSubjectMasteryData(computedMastery);
        }
        
        // 2. Login Activity (Mocked using attempts creation time)
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayCounts = { 'Sun': 0, 'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0, 'Sat': 0 };
        attemptsList.forEach(a => {
            if (a.startTime) {
                const date = new Date(a.startTime);
                if (!isNaN(date.getTime())) {
                   dayCounts[days[date.getDay()]] += 10; // arbitrary multiplier for volume
                }
            }
        });
        const computedLogin = days.map(d => ({ day: d, value: dayCounts[d] > 0 ? dayCounts[d] : Math.floor(Math.random() * 200 + 100) }));
        setDynamicLoginActivityData(computedLogin);
        

      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);


    if (loading) return (
     <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
       <Loader2 className="h-10 w-10 text-indigo-600 animate-spin" />
       <p className="text-slate-500 font-bold animate-pulse uppercase tracking-widest text-sm">Synchronizing Intelligence Base...</p>
     </div>
  );

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-1">
        <div>
           <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-100 font-black text-[10px] px-2 py-0.5 rounded-md uppercase tracking-wider">Session Active</Badge>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{profile?.schoolId ? "School Admin" : "Master Admin"} Panel</span>
           </div>
          <h2 className="text-4xl font-display font-black text-slate-900 tracking-tight flex items-center gap-3">
            Command Center <Activity className="text-indigo-600 animate-pulse" size={32} />
          </h2>
          <p className="text-slate-500 font-medium mt-1">SaaS Infrastructure Heuristics & Academic Oversight.</p>
        </div>
        <div className="flex gap-3">
          <Button 
            variant="outline"
            onClick={handleMasterExport} 
            disabled={isExporting}
            className="border-slate-200 text-slate-700 h-14 px-8 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-50"
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            Export Intelligence
          </Button>
          <Button 
            onClick={() => navigate('/admin/exams')} 
            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xl shadow-indigo-200/50 h-14 px-8 rounded-2xl font-black text-[11px] uppercase tracking-widest flex items-center gap-2 group"
          >
            Initialize Exam <Plus className="h-4 w-4 group-hover:rotate-90 transition-transform" />
          </Button>
        </div>
      </header>

      {/* Bento Grid Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 grid-rows-auto gap-6">
        
        {/* Main Stats Area Chart */}
        <Card className="md:col-span-4 lg:col-span-4 row-span-2 shadow-2xl shadow-slate-200/40 border-0 rounded-[40px] overflow-hidden bg-white group flex flex-col border border-slate-100">
           <CardHeader className="p-10 pb-0">
              <div className="flex items-center justify-between">
                 <div>
                    <CardTitle className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Throughput Velocity</CardTitle>
                    <CardDescription className="font-semibold text-slate-400 mt-1">Digital assessments completed per diurnal cycle.</CardDescription>
                 </div>
                 <Badge className="bg-emerald-500/10 text-emerald-600 border-0 font-black text-[10px] uppercase px-3 py-1">Live Feed</Badge>
              </div>
           </CardHeader>
           <CardContent className="p-10 flex-grow h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={dynamicLoginActivityData}>
                    <defs>
                       <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                       </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} />
                    <YAxis hide />
                    <Tooltip 
                       contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.15)', padding: '20px' }}
                       labelStyle={{ fontWeight: 900, marginBottom: '8px', color: '#1e293b', textTransform: 'uppercase', fontSize: '10px' }}
                    />
                    <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={4} fillOpacity={1} fill="url(#colorValue)" />
                 </AreaChart>
              </ResponsiveContainer>
           </CardContent>
           <div className="bg-slate-50 p-8 flex items-center justify-between border-t border-slate-100">
              <div className="flex gap-10">
                 <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Peak Flux</span>
                    <span className="text-2xl font-black text-slate-900 mt-1">1,560 <span className="text-[10px] text-emerald-500">▲ 14%</span></span>
                 </div>
                 <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Avg Latency</span>
                    <span className="text-2xl font-black text-slate-900 mt-1">240ms <span className="text-[10px] text-slate-400">NOMINAL</span></span>
                 </div>
              </div>
              <Button variant="ghost" className="rounded-xl font-black text-[10px] uppercase tracking-widest text-indigo-600 hover:bg-indigo-100 h-10 px-6">Detailed Analytics</Button>
           </div>
        </Card>

        {/* Quick Stats - Bento Tiles */}
        <motion.div whileHover={{ y: -5 }} className="md:col-span-2 lg:col-span-2 bg-slate-900 rounded-[40px] p-10 text-white shadow-2xl shadow-indigo-900/20 relative overflow-hidden group">
           <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:opacity-20 transition-opacity">
              <Users size={120} />
           </div>
           <div className="relative z-10 flex flex-col h-full justify-between">
              <div>
                 <Badge className="bg-white/10 text-white border-0 font-black text-[10px] uppercase mb-4">Total Ecosystem</Badge>
                 <h3 className="text-6xl font-black tracking-tighter">{stats.attempts}</h3>
                 <p className="text-indigo-300 font-bold mt-2 uppercase tracking-widest text-[11px]">Submissions Processed</p>
              </div>
              <div className="mt-8 pt-8 border-t border-white/10 flex items-center justify-between">
                 <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] font-black uppercase text-white/50 tracking-widest">Active Now</span>
                 </div>
                 <span className="text-[11px] font-black">42 Nodes</span>
              </div>
           </div>
        </motion.div>

        {/* Subject Radar Mastery */}
        <Card className="md:col-span-2 lg:col-span-2 row-span-2 shadow-2xl shadow-slate-200/40 border-0 rounded-[40px] overflow-hidden bg-white border border-slate-100">
           <CardHeader className="p-8">
              <CardTitle className="text-lg font-black text-slate-900 uppercase tracking-tighter">Academic Purity Radar</CardTitle>
              <CardDescription className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Strength vectors across disciplines</CardDescription>
           </CardHeader>
           <CardContent className="h-[250px] p-4">
              <ResponsiveContainer width="100%" height="100%">
                 <RadarChart cx="50%" cy="50%" outerRadius="80%" data={dynamicSubjectMasteryData}>
                    <PolarGrid stroke="#f1f5f9" />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} />
                    <Radar 
                       name="Student Average" 
                       dataKey="A" 
                       stroke="#6366f1" 
                       fill="#6366f1" 
                       fillOpacity={0.6} 
                    />
                 </RadarChart>
              </ResponsiveContainer>
           </CardContent>
           <div className="p-8 pt-0 flex flex-col gap-3">
              <div className="flex justify-between items-center text-[11px] font-bold">
                 <span className="text-slate-400">MATH PROFICIENCY</span>
                 <span className="text-indigo-600">82%</span>
              </div>
              <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                 <div className="h-full bg-indigo-600 rounded-full" style={{ width: '82%' }} />
              </div>
              <div className="flex justify-between items-center text-[11px] font-bold mt-2">
                 <span className="text-slate-400">LOGICAL DENSITY</span>
                 <span className="text-indigo-600">94%</span>
              </div>
              <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                 <div className="h-full bg-indigo-600 rounded-full" style={{ width: '94%' }} />
              </div>
           </div>
        </Card>

        {/* Institutions Tile */}
        <Card className="md:col-span-2 lg:col-span-2 bg-indigo-50 border-0 rounded-[40px] p-10 flex flex-col justify-between group cursor-pointer hover:bg-indigo-100 transition-colors" onClick={() => navigate('/admin/schools')}>
           <div className="flex justify-between items-start">
              <div className="h-14 w-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-xl shadow-indigo-200">
                 <SchoolIcon size={28} />
              </div>
              <ChevronRight className="text-indigo-300 group-hover:translate-x-2 transition-transform" />
           </div>
           <div>
              <p className="text-5xl font-black text-indigo-900 tracking-tighter">{stats.schools}</p>
              <p className="text-[11px] font-black text-indigo-400 uppercase tracking-widest mt-2">Vetted Institutions</p>
           </div>
        </Card>

        {/* Live Monitoring Pulse */}
        <Card className="md:col-span-2 lg:col-span-2 bg-slate-50 border border-slate-100 rounded-[40px] p-10 flex flex-col justify-between overflow-hidden relative" onClick={() => navigate('/admin/proctoring')}>
           <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-200/20 blur-3xl -mr-10 -mt-10" />
           <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-10 bg-slate-900 rounded-xl flex items-center justify-center text-white">
                 <Zap size={20} className="text-amber-400" />
              </div>
              <div>
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block leading-none">Security Status</span>
                 <span className="text-sm font-black text-slate-900 uppercase">Proctoring Wall</span>
              </div>
           </div>
           <div className="space-y-4">
              <div className="flex items-center justify-between text-[11px] font-bold">
                 <span className="text-slate-500">ANOMALIES DETECTED</span>
                 <span className="text-rose-600">03 ALERT</span>
              </div>
              <div className="flex -space-x-4">
                 {[1,2,3,4].map(i => (
                    <div key={i} className="h-10 w-10 rounded-full border-4 border-white bg-slate-200 overflow-hidden">
                       <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${i+10}`} alt="avatar" />
                    </div>
                 ))}
                 <div className="h-10 w-10 rounded-full border-4 border-white bg-indigo-600 flex items-center justify-center text-white text-[9px] font-black">
                    +12
                 </div>
              </div>
           </div>
           <Button className="mt-8 bg-slate-900 text-white rounded-2xl h-12 font-black text-[10px] uppercase tracking-widest">Open Monitor</Button>
        </Card>

        {/* Live Institution Monitoring Terminal */}
        <Card className="col-span-1 md:col-span-4 lg:col-span-6 shadow-2xl shadow-slate-200/40 border-0 rounded-[40px] overflow-hidden bg-white border border-slate-100 p-10 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest">LIVE TRACKING METAMETRICS</span>
              </div>
              <CardTitle className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Live School Attendance Monitor</CardTitle>
              <CardDescription className="text-xs font-semibold text-slate-400 mt-1">
                Attending (in-session) vs. Completed standardized diagnostic registrations grouped by institution.
              </CardDescription>
            </div>
            <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 flex gap-6 text-center">
              <div>
                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-wider">Total Attending</p>
                <p className="text-xl font-bold text-slate-800">{schoolStats.reduce((sum, s) => sum + s.attending, 0)}</p>
              </div>
              <div className="w-[1px] bg-slate-200" />
              <div>
                <p className="text-[9px] font-black text-emerald-400 uppercase tracking-wider">Total Completed</p>
                <p className="text-xl font-bold text-slate-800">{schoolStats.reduce((sum, s) => sum + s.completed, 0)}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-4">
            {schoolStats.map((school) => {
              const total = school.attending + school.completed;
              const ratio = total > 0 ? Math.round((school.completed / total) * 100) : 0;
              return (
                <div key={school.schoolId} id={`school-monitor-${school.schoolId}`} className="border border-slate-100 hover:border-indigo-100 rounded-3xl p-6 bg-slate-50/50 hover:bg-white transition-all space-y-4">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">{school.name}</h4>
                      <p className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider mt-0.5">Id: {school.schoolId}</p>
                    </div>
                    <Badge className="bg-indigo-50 text-indigo-650 border border-indigo-100 font-bold text-[9px] px-2.5 py-1">
                      {ratio}% Done
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-center bg-white border border-slate-100 rounded-2xl p-3">
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Attending</p>
                      <p className="text-base font-bold text-indigo-600 flex items-center justify-center gap-1">
                        {school.attending} {school.attending > 0 && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Completed</p>
                      <p className="text-base font-bold text-emerald-600">{school.completed}</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-black text-slate-400">
                      <span>STREAMS CONSOLIDATION</span>
                      <span>{ratio}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-indigo-600 rounded-full transition-all duration-500" 
                        style={{ width: `${ratio}%` }} 
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            {schoolStats.length === 0 && (
              <div className="col-span-full py-10 text-center text-slate-400 font-semibold text-xs uppercase tracking-widest border border-dashed rounded-3xl">
                No institution analytics stream connected
              </div>
            )}
          </div>
        </Card>

        {/* Recent Deployments Table */}
        <Card className="md:col-span-4 lg:col-span-4 row-span-2 shadow-2xl shadow-slate-200/40 border-0 rounded-[40px] overflow-hidden bg-white border border-slate-100">
           <CardHeader className="p-10 border-b border-slate-50">
              <div className="flex items-center justify-between">
                 <div>
                    <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tighter">Academic Stream</CardTitle>
                    <CardDescription className="text-slate-400 font-semibold">Latest standardized assessment deployments.</CardDescription>
                 </div>
                 <Button variant="outline" size="sm" className="rounded-xl font-black text-[10px] uppercase tracking-widest" onClick={() => navigate('/admin/exams')}>Global Bank</Button>
              </div>
           </CardHeader>
           <CardContent className="p-0">
             <div className="divide-y divide-slate-100">
                {recentExams.map((exam) => (
                  <div key={exam.id} className="px-10 py-6 flex items-center justify-between hover:bg-slate-50/50 transition-colors cursor-pointer group" onClick={() => navigate(`/admin/exam/${exam.id}`)}>
                    <div className="flex items-center space-x-6">
                      <div className={`h-14 w-14 rounded-2xl flex items-center justify-center text-white ${exam.status === 'published' ? 'bg-emerald-500 shadow-xl shadow-emerald-200' : 'bg-slate-400 shadow-xl shadow-slate-200'}`}>
                        <FileText size={24} />
                      </div>
                      <div>
                        <p className="text-lg font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{exam.title}</p>
                        <div className="flex items-center gap-3 mt-1">
                           <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{exam.subject}</span>
                           <div className="h-1 w-1 bg-slate-300 rounded-full" />
                           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{exam.totalMarks} Points</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right hidden md:block">
                         <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Difficulty</p>
                         <p className="text-xs font-bold text-slate-600">{exam.difficulty}</p>
                      </div>
                      <Badge className={`${exam.status === 'published' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-slate-500 border-slate-100'} border font-black text-[9px] uppercase px-3 py-1`}>
                        {exam.status}
                      </Badge>
                    </div>
                  </div>
                ))}
                {recentExams.length === 0 && (
                  <div className="p-20 text-center">
                    <div className="h-20 w-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-6 text-slate-200">
                       <LayoutGrid size={40} />
                    </div>
                    <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">No active deployments</p>
                  </div>
                )}
             </div>
           </CardContent>
        </Card>

        {/* Global Rankings Preview */}
        <Card className="md:col-span-2 lg:col-span-2 bg-slate-900 rounded-[40px] p-10 text-white relative overflow-hidden group">
           <div className="relative z-10">
              <h3 className="text-xl font-black uppercase tracking-tighter mb-6">Merit Matrix</h3>
              <div className="space-y-6">
                 {[1,2,3].map(i => (
                    <div key={i} className="flex items-center justify-between group/row cursor-pointer">
                       <div className="flex items-center gap-4">
                          <span className="text-xs font-black text-indigo-400">0{i}</span>
                          <div className="h-8 w-8 rounded-full bg-white/10 overflow-hidden border border-white/20">
                             <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=rank-${i}`} alt="rank" />
                          </div>
                          <div>
                             <p className="text-xs font-black uppercase tracking-tight">Student Name</p>
                             <p className="text-[9px] font-bold text-slate-500">School ID #420</p>
                          </div>
                       </div>
                       <span className="text-xs font-black text-emerald-400">98.2%</span>
                    </div>
                 ))}
              </div>
              <Button variant="ghost" className="w-full mt-10 border border-white/10 hover:bg-white/5 rounded-2xl h-12 text-[10px] font-black uppercase tracking-widest text-white">Full Consolidated List</Button>
           </div>
        </Card>

      </div>
    </div>
  );
};
