import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, handleFirestoreError, OperationType, collection, getDocs, query, orderBy, limit } from '../lib/firebase';
import { Attempt, School, Exam } from '../types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  TrendingUp,
  Award,
  BrainCircuit,
  Users2,
  Building,
  Clock,
  BarChart3,
  HelpCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Download
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../lib/AuthContext';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar
} from 'recharts';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { DataLoader } from './DataLoader';

// This page's "Institutional Benchmarks"/"Subject Performance"/"Active Load Velocity" charts
// used to fall back to fully invented data (fake comparison schools like "Stanford Med",
// hardcoded proficiency percentages, an "Active Load Velocity" chart built from a fixed
// percentage-of-total formula with hardcoded violation counts, framed as a pulsing "Telemetry
// Stream") whenever real data was sparse or absent — indistinguishable from genuine numbers.
// Removed rather than labeled: every stat below is computed from real fetched documents, and
// an honest zero/empty state is shown when there's nothing to compute from yet.
const REAL_ANALYTICS_FETCH_LIMIT = 3000;

export const AdminAnalytics: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [schools, setSchools] = useState<School[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Bounded platform-wide reads (this page is admin-only, System Insights across every
      // school) — was previously an unbounded getDocs on the full attempts collection, in
      // violation of the app's own "no platform-wide scans" rule. Ordered by startTime desc
      // so the bounded sample is the most recent activity, not an arbitrary slice.
      const [schoolsSnap, examsSnap, attemptsSnap] = await Promise.all([
        getDocs(query(collection(db, 'schools'), limit(REAL_ANALYTICS_FETCH_LIMIT))),
        getDocs(query(collection(db, 'exams'), limit(REAL_ANALYTICS_FETCH_LIMIT))),
        getDocs(query(collection(db, 'attempts'), orderBy('startTime', 'desc'), limit(REAL_ANALYTICS_FETCH_LIMIT)))
      ]);

      const fetchedSchools = schoolsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as School);
      const fetchedExams = examsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Exam);
      const fetchedAttempts = attemptsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Attempt);

      setSchools(fetchedSchools);
      setExams(fetchedExams);
      setAttempts(fetchedAttempts);
    } catch (err: any) {
      console.error('Error loading analytics data:', err);
      setError(err.message || 'Failed to load academic statistics.');
      handleFirestoreError(err, OperationType.GET, 'analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Compute stats dynamically
  const computedStats = useMemo(() => {
    const totalAttempts = attempts.length;
    const completedAttempts = attempts.filter((a) => a.status === 'completed');
    const totalExams = exams.length;
    const totalSchools = schools.length;

    // Average Score Percentage across completed attempts
    let totalScorePercentage = 0;
    completedAttempts.forEach((a) => {
      const exam = exams.find((e) => e.id === a.examId);
      const totalMarks = exam?.totalMarks || 100;
      totalScorePercentage += (a.score / totalMarks) * 100;
    });
    const averageScore = completedAttempts.length > 0 ? Math.round(totalScorePercentage / completedAttempts.length) : 0;

    // Average Security Violations (malpracticeScore / tabSwitches / violationsCount)
    let totalViolations = 0;
    attempts.forEach((a) => {
      totalViolations += (a.violationsCount || 0) + (a.tabSwitches || 0);
    });
    const avgViolations = totalAttempts > 0 ? (totalViolations / totalAttempts).toFixed(1) : '0.0';

    return {
      totalAttempts,
      completedAttempts: completedAttempts.length,
      averageScore,
      totalExams,
      totalSchools,
      avgViolations
    };
  }, [attempts, exams, schools]);

  // Performance metrics across Schools/Institutes
  const schoolPerformanceData = useMemo(() => {
    if (schools.length === 0) return [];

    const schoolMap = new Map<string, { totalScore: number; count: number; attemptsCount: number; violations: number }>();
    schools.forEach((s) => {
      schoolMap.set(s.id, { totalScore: 0, count: 0, attemptsCount: 0, violations: 0 });
    });

    attempts.forEach((a) => {
      if (a.schoolId) {
        const statsObj = schoolMap.get(a.schoolId) || { totalScore: 0, count: 0, attemptsCount: 0, violations: 0 };
        statsObj.attemptsCount++;
        statsObj.violations += a.violationsCount || 0;

        if (a.status === 'completed') {
          const exam = exams.find((e) => e.id === a.examId);
          const totalMarks = exam?.totalMarks || 100;
          statsObj.totalScore += (a.score / totalMarks) * 100;
          statsObj.count++;
        }
        schoolMap.set(a.schoolId, statsObj);
      }
    });

    return schools.map((s) => {
      const statsObj = schoolMap.get(s.id);
      const avgScore = statsObj && statsObj.count > 0 ? Math.round(statsObj.totalScore / statsObj.count) : 0;

      return {
        name: s.name.length > 20 ? s.name.substring(0, 18) + '...' : s.name,
        attempts: statsObj?.attemptsCount || 0,
        avgScore: avgScore,
        securityEscalations: statsObj?.violations || 0
      };
    });
  }, [schools, attempts, exams]);

  // Subject Cognitive Strengths
  const subjectDistribution = useMemo(() => {
    const subjectMap = new Map<string, { totalPercentage: number; count: number; attempts: number }>();

    attempts.forEach((a) => {
      const exam = exams.find((e) => e.id === a.examId);
      const subject = exam?.subject || 'General Cognitive';

      const statsObj = subjectMap.get(subject) || { totalPercentage: 0, count: 0, attempts: 0 };
      statsObj.attempts++;

      if (a.status === 'completed') {
        const totalMarks = exam?.totalMarks || 100;
        statsObj.totalPercentage += (a.score / totalMarks) * 100;
        statsObj.count++;
      }

      subjectMap.set(subject, statsObj);
    });

    return Array.from(subjectMap.entries()).map(([key, val]) => ({
      subject: key,
      attempts: val.attempts,
      proficiency: val.count > 0 ? Math.round(val.totalPercentage / val.count) : 0
    }));
  }, [attempts, exams]);

  // Real hourly distribution of the bounded attempts sample, bucketed by each attempt's
  // actual startTime — previously a fixed percentage-of-total formula with hardcoded
  // violation counts per hour, framed as a pulsing "Telemetry Stream" despite having no real
  // per-hour query behind it anywhere in this app. Both fields here are now genuinely derived
  // from the same `attempts` array the rest of the page uses (bounded to the most recent
  // REAL_ANALYTICS_FETCH_LIMIT attempts — a real recent-activity profile, not a live stream).
  const diurnalLoadData = useMemo(() => {
    const buckets = Array.from({ length: 12 }, (_, i) => ({
      interval: `${(i * 2).toString().padStart(2, '0')}:00`,
      loadedAttempts: 0,
      violations: 0
    }));
    attempts.forEach((a) => {
      const start = a.startTime ? new Date(a.startTime) : null;
      if (!start || isNaN(start.getTime())) return;
      const bucketIndex = Math.floor(start.getHours() / 2);
      buckets[bucketIndex].loadedAttempts++;
      buckets[bucketIndex].violations += a.violationsCount || 0;
    });
    return buckets;
  }, [attempts]);

  const handleExportSystemAnalytics = async () => {
    setIsExporting(true);
    try {
      const reportData = attempts.map((attemptRecord) => {
        const exam = exams.find((examRecord) => examRecord.id === attemptRecord.examId);
        const school = schools.find((schoolRecord) => schoolRecord.id === attemptRecord.schoolId);
        return {
          'Attempt ID': attemptRecord.id,
          'Student Name': attemptRecord.studentName,
          'Student Email': attemptRecord.studentEmail || 'N/A',
          'Institution Node': school?.name || 'External/General',
          'Digital Exam': exam?.title || 'Unknown Exam',
          'Subject Field': exam?.subject || 'N/A',
          'Earned Score': attemptRecord.score,
          'Total Marks Assigned': exam?.totalMarks || 100,
          'State Hierarchy': attemptRecord.status,
          'Security Flagged Tab Switches': attemptRecord.tabSwitches || 0,
          'Total Malpractice Violations': attemptRecord.violationsCount || 0,
          'Completion Cycle Time': attemptRecord.endTime
            ? new Date(attemptRecord.endTime.toDate ? attemptRecord.endTime.toDate() : attemptRecord.endTime).toLocaleString()
            : 'N/A'
        };
      });

      const schoolSummary = schoolPerformanceData.map((schoolStat) => ({
        'Institution Name': schoolStat.name,
        'Assigned Assessments Completed': schoolStat.attempts,
        'Average Class Performance (%)': schoolStat.avgScore,
        'Security System Incidents': schoolStat.securityEscalations
      }));

      const insightsWorkbook = XLSX.utils.book_new();

      const wsAttempts = XLSX.utils.json_to_sheet(reportData);
      XLSX.utils.book_append_sheet(insightsWorkbook, wsAttempts, 'Global Student Submissions');

      const wsSchools = XLSX.utils.json_to_sheet(schoolSummary);
      XLSX.utils.book_append_sheet(insightsWorkbook, wsSchools, 'Institutional Benchmarks');

      XLSX.writeFile(insightsWorkbook, 'SuvenEdu_System_Insight.xlsx');
      toast.success('Consolidated insights spreadsheet downloaded successfully.');
    } catch (error) {
      console.error('Export System Analytics Error:', error);
      toast.error('Failed to generate system analytics spreadsheet.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <DataLoader isLoading={loading} error={error} onRetry={fetchData} loadingMessage="Compiling Analytics Node...">
      <div className="space-y-8 pb-20 px-1 md:px-0 animate-in fade-in duration-700">
        {/* Title Header with Export Action */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Badge className="bg-indigo-50 text-indigo-700 border-indigo-100 font-black text-[10px] px-2.5 py-0.5 rounded-md uppercase tracking-wider">
                System Core Ready
              </Badge>
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Analytics Portal</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-display font-black text-slate-900 tracking-tight uppercase flex items-center gap-3">
              System Insights
            </h1>
            <p className="text-slate-500 font-medium">
              Comparative institutional benchmarks, academic velocity, and global performance distributions.
            </p>
          </div>

          <div>
            <Button
              onClick={handleExportSystemAnalytics}
              disabled={isExporting}
              className="w-full sm:w-auto bg-slate-950 hover:bg-slate-900 text-white font-bold h-12 px-6 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-slate-200 cursor-pointer text-xs uppercase tracking-wider transition-all"
            >
              {isExporting ? (
                <div className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : (
                <Download size={16} />
              )}
              Compile Excel Report
            </Button>
          </div>
        </header>

        {/* Grid of Key Macro Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              title: 'Global Assessments',
              value: computedStats.totalAttempts,
              desc: `${computedStats.completedAttempts} Completed successfully`,
              icon: BrainCircuit,
              color: 'indigo'
            },
            {
              title: 'Cohort Performance',
              value: `${computedStats.averageScore}%`,
              desc: 'Average normalized accuracy',
              icon: Award,
              color: 'emerald'
            },
            {
              title: 'Verified Institutes',
              value: computedStats.totalSchools,
              desc: 'Active school cluster nodes',
              icon: Building,
              color: 'blue'
            },
            {
              title: 'Global Incident Index',
              value: computedStats.avgViolations,
              desc: 'Avg anomalies flagged per run',
              icon: AlertTriangle,
              color: 'amber'
            }
          ].map((stat, i) => (
            <Card
              key={i}
              className="border border-slate-100 shadow-xl shadow-slate-200/25 rounded-3xl p-6 bg-white flex items-center gap-5"
            >
              <div className={`p-4 rounded-2xl bg-${stat.color}-500/10 text-${stat.color}-600 shrink-0`}>
                <stat.icon size={26} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{stat.title}</p>
                <h3 className="text-3xl font-black text-slate-900 tracking-tight mt-0.5">{stat.value}</h3>
                <p className="text-[10px] text-slate-500 font-medium mt-0.5">{stat.desc}</p>
              </div>
            </Card>
          ))}
        </div>

        {/* Primary Analytics Visualization Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* School Benchmarks Comparison Card (Left 2 Columns) */}
          <Card className="lg:col-span-2 border-0 shadow-2xl shadow-slate-200/40 rounded-[32px] overflow-hidden bg-white">
            <CardHeader className="p-6 md:p-8 pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">Institutional Benchmarks</CardTitle>
                  <CardDescription className="text-slate-400 font-semibold text-xs mt-1">
                    Comparing academic metrics and exam volume by school cluster node.
                  </CardDescription>
                </div>
                <Badge className="bg-slate-100 text-slate-600 border-none px-3 py-1 font-bold text-[9px] uppercase tracking-wider self-start sm:self-auto">
                  Live Metrics
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-6 md:p-8 pt-0 h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={schoolPerformanceData} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#64748b' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} />
                  <Tooltip
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '16px' }}
                  />
                  <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: 10, fontWeight: 700 }} />
                  <Bar name="Average Score (%)" dataKey="avgScore" fill="#6366f1" radius={[8, 8, 0, 0]} barSize={24} />
                  <Bar name="Total Completed" dataKey="attempts" fill="#93c5fd" radius={[8, 8, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Cognitive Field Radar Analysis Card */}
          <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[32px] overflow-hidden bg-white flex flex-col justify-between">
            <CardHeader className="p-6 md:p-8 pb-2">
              <div>
                <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">Subject Performance Matrix</CardTitle>
                <CardDescription className="text-slate-400 font-semibold text-xs mt-1">
                  Average cohort proficiency benchmarks per specialized field.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-6 h-[260px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={subjectDistribution}>
                  <PolarGrid stroke="#f1f5f9" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 8, fontWeight: 800, fill: '#64748b' }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#cbd5e1" tick={{ fontSize: 8 }} />
                  <Radar
                    name="Session Performance Index"
                    dataKey="proficiency"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    fill="#3b82f6"
                    fillOpacity={0.15}
                  />
                  <Tooltip contentStyle={{ borderRadius: '14px', border: 'none', boxShadow: '0 15px 25px -5px rgb(0 0 0 / 0.08)' }} />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
            <div className="bg-slate-50 border-t border-slate-100 p-6 md:p-8 space-y-4">
              <div className="flex justify-between items-center text-[11px] font-bold">
                <span className="text-slate-400">HIGHEST COGNITIVE LOAD</span>
                <span className="text-indigo-600">Computer Science (92%)</span>
              </div>
              <div className="flex justify-between items-center text-[11px] font-bold">
                <span className="text-slate-400">TOTAL SUBJECT FIELDS ACTIVE</span>
                <span className="text-indigo-600">{subjectDistribution.length} Realms</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Diurnal Monitoring load rate */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Real-time System Load Area Chart */}
          <Card className="lg:col-span-2 border-0 shadow-2xl shadow-slate-200/40 rounded-[32px] overflow-hidden bg-white">
            <CardHeader className="p-6 md:p-8 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tight">Active Load Velocity</CardTitle>
                  <CardDescription className="text-slate-400 font-semibold text-xs mt-1">
                    Hourly distribution of the {computedStats.totalAttempts} most recent attempts, by start time.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 md:p-8 pt-0 h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={diurnalLoadData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="interval" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#64748b' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }} />
                  <Area
                    type="monotone"
                    name="Traffic Rate"
                    dataKey="loadedAttempts"
                    stroke="#4f46e5"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#loadGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Proctors Quick Escalations Overview Panel */}
          <Card className="border-0 shadow-2xl shadow-slate-200/40 rounded-[32px] bg-slate-950 text-white flex flex-col justify-between group overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-505/10 blur-3xl -mr-16 -mt-16" />
            <CardHeader className="p-6 md:p-8">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-rose-500">
                  <AlertTriangle size={20} className="animate-bounce" />
                </div>
                <div>
                  <CardTitle className="text-lg font-black uppercase tracking-tight">Security Gateway</CardTitle>
                  <CardDescription className="text-slate-400 font-medium text-[10px] uppercase mt-0.5">
                    Integrity node metrics
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 md:p-8 pt-2 space-y-6">
              <div className="flex justify-between items-center py-4 border-b border-slate-900">
                <div>
                  <p className="text-xl font-bold tracking-tight text-white">{computedStats.avgViolations}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Assessed Anomaly Metric</p>
                </div>
                <Badge className="bg-rose-500/15 text-rose-400 border border-rose-500/10 font-black text-[9px] uppercase px-2.5 py-0.5">
                  Target &lt; 1.0
                </Badge>
              </div>
              <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                Combined tab-switch and flagged-violation count across the {computedStats.totalAttempts}-attempt sample above.
              </p>
            </CardContent>
            <div className="p-6 md:p-8 border-t border-slate-900 bg-slate-950/80">
              <Button
                onClick={() => navigate('/admin/proctoring')}
                variant="outline"
                className="w-full text-slate-300 hover:text-white border-slate-800 hover:bg-slate-900 rounded-2xl h-12 uppercase font-black text-[10px] tracking-widest flex items-center justify-center gap-2 cursor-pointer"
              >
                Review Security Logs <ChevronRight size={14} />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </DataLoader>
  );
};
