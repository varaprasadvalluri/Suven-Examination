import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { db, collection, query, where, onSnapshot, getDocs, limit as fbLimit } from '../lib/firebase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { authHeaders } from '../lib/sessionStore';
import { toast } from 'sonner';
import {
  Trophy,
  Search,
  Filter,
  Download,
  TrendingUp,
  Users,
  Target,
  Medal,
  Crown,
  Award,
  ChevronsUp,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Check
} from 'lucide-react';
import { motion } from 'motion/react';

export const RankingEngine: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [students, setStudents] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<'rank' | 'percentile' | 'rollNumber'>('rank');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);
  // Safety ceiling for the on-screen live-listener fetch — the previous unbounded fetch
  // (no limit at all on 'users'/'attempts') would try to hold every student and every
  // completed attempt on the whole platform in this tab's memory, growing without bound.
  // This caps that at a generous number for realistic near-term use while making truncation
  // visible instead of silently degrading. The Export XLS button is NOT subject to this —
  // it's computed fresh server-side directly from Firestore, independent of this cap.
  const DISPLAY_FETCH_CAP = 5000;
  const [isTruncated, setIsTruncated] = useState(false);
  const [schoolDropdownOpen, setSchoolDropdownOpen] = useState(false);
  const [schoolSearchText, setSchoolSearchText] = useState('');

  // Load schools to map branch names dynamically for everyone
  useEffect(() => {
    getDocs(collection(db, 'schools'))
      .then((snap) => {
        setSchools(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      })
      .catch((err) => console.error('Error loading schools in Merit tracker:', err));
  }, []);

  // Listen to students and exam attempts dynamically based on user role and dropdown filter
  useEffect(() => {
    if (!profile) return;

    setLoading(true);
    setIsTruncated(false);

    let studentsQuery;
    let attemptsQuery;

    // Determine the active school ID filter based on RBAC rules
    const activeSchoolId = profile.role === 'admin' ? selectedSchoolId : profile.schoolId || 'no-school-assigned';

    if (activeSchoolId && activeSchoolId !== 'all') {
      studentsQuery = query(
        collection(db, 'users'),
        where('role', '==', 'student'),
        where('schoolId', '==', activeSchoolId),
        fbLimit(DISPLAY_FETCH_CAP)
      );
      attemptsQuery = query(
        collection(db, 'attempts'),
        where('status', '==', 'completed'),
        where('schoolId', '==', activeSchoolId),
        fbLimit(DISPLAY_FETCH_CAP)
      );
    } else {
      studentsQuery = query(collection(db, 'users'), where('role', '==', 'student'), fbLimit(DISPLAY_FETCH_CAP));
      attemptsQuery = query(collection(db, 'attempts'), where('status', '==', 'completed'), fbLimit(DISPLAY_FETCH_CAP));
    }

    const unsubscribeStudents = onSnapshot(
      studentsQuery,
      (snapshot) => {
        const studs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        }));
        setStudents(studs);
        setIsTruncated(studs.length >= DISPLAY_FETCH_CAP);
      },
      (err) => {
        console.error('Error subscribing to students: ', err);
      }
    );

    const unsubscribeAttempts = onSnapshot(
      attemptsQuery,
      (snapshot) => {
        const atts = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        }));
        setAttempts(atts);
        setLoading(false);
        if (atts.length >= DISPLAY_FETCH_CAP) setIsTruncated(true);
      },
      (err) => {
        console.error('Error subscribing to attempts: ', err);
        setLoading(false);
      }
    );

    return () => {
      unsubscribeStudents();
      unsubscribeAttempts();
    };
  }, [profile, selectedSchoolId]);

  // Aggregate and parse student-level metrics dynamically
  const combinedRankings = useMemo(() => {
    // Group attempts by studentId
    const attemptsByStudent: { [studentId: string]: any[] } = {};
    attempts.forEach((att) => {
      const sId = att.studentId;
      if (sId) {
        if (!attemptsByStudent[sId]) {
          attemptsByStudent[sId] = [];
        }
        attemptsByStudent[sId].push(att);
      }
    });

    // Build map of schools to resolve branch name beautifully
    const schoolNameMap: { [id: string]: string } = {};
    schools.forEach((s) => {
      if (s.id) schoolNameMap[s.id] = s.name;
    });

    const processedStudentIds = new Set<string>();
    const list: any[] = [];

    // First process all registered candidates of the active partition
    students.forEach((stud) => {
      const sId = stud.id || stud.uid;
      processedStudentIds.add(sId);

      const studAttempts = attemptsByStudent[sId] || [];
      const completedAttempts = studAttempts.filter((a) => a.status === 'completed');

      const examsAttended = completedAttempts.length;

      let averagePercentage = 0;
      let averageScore = 0;

      if (examsAttended > 0) {
        const totalAccuracy = completedAttempts.reduce((sum, a) => sum + (a.accuracy !== undefined ? a.accuracy : a.score || 0), 0);
        averagePercentage = Math.round(totalAccuracy / examsAttended);

        const totalScore = completedAttempts.reduce((sum, a) => sum + (a.score || 0), 0);
        averageScore = Math.round(totalScore / examsAttended);
      }

      // Calculate trend/improvement dynamically based on difference between the two most recent attempts
      let improvement = '0%';
      if (examsAttended >= 2) {
        const sortedAtts = [...completedAttempts].sort((a, b) => {
          const timeA = a.endTime ? new Date(a.endTime).getTime() : 0;
          const timeB = b.endTime ? new Date(b.endTime).getTime() : 0;
          return timeA - timeB; // oldest to newest
        });
        const latest = sortedAtts[sortedAtts.length - 1];
        const prev = sortedAtts[sortedAtts.length - 2];
        const accuracyLatest = latest.accuracy !== undefined ? latest.accuracy : latest.score || 0;
        const accuracyPrev = prev.accuracy !== undefined ? prev.accuracy : prev.score || 0;
        const diff = accuracyLatest - accuracyPrev;
        const roundDiff = Math.round(diff);
        improvement = `${roundDiff >= 0 ? '+' : ''}${roundDiff}%`;
      } else if (examsAttended === 1) {
        improvement = '+0%';
      } else {
        improvement = '-';
      }

      list.push({
        id: sId,
        name: stud.name || 'Autonomous Candidate',
        rollNumber: stud.rollNumber || '',
        score: averageScore,
        percentile: averagePercentage,
        examsAttended,
        improvement,
        branch: stud.schoolName || schoolNameMap[stud.schoolId] || 'Autonomous Hub',
        schoolId: stud.schoolId || '',
        class: stud.class || 'Unassigned',
        status: averagePercentage >= 90 ? 'Elite' : averagePercentage >= 75 ? 'Advanced' : 'Rising'
      });
    });

    // In case there are completed attempts for students we didn't receive user docs for directly
    attempts.forEach((att) => {
      const sId = att.studentId;
      if (sId && !processedStudentIds.has(sId)) {
        processedStudentIds.add(sId);

        const studAttempts = attemptsByStudent[sId] || [];
        const completedAttempts = studAttempts.filter((a) => a.status === 'completed');
        const examsAttended = completedAttempts.length;

        let averagePercentage = 0;
        let averageScore = 0;

        if (examsAttended > 0) {
          const totalAccuracy = completedAttempts.reduce((sum, a) => sum + (a.accuracy !== undefined ? a.accuracy : a.score || 0), 0);
          averagePercentage = Math.round(totalAccuracy / examsAttended);

          const totalScore = completedAttempts.reduce((sum, a) => sum + (a.score || 0), 0);
          averageScore = Math.round(totalScore / examsAttended);
        }

        let improvement = '0%';
        if (examsAttended >= 2) {
          const sortedAtts = [...completedAttempts].sort((a, b) => {
            const timeA = a.endTime ? new Date(a.endTime).getTime() : 0;
            const timeB = b.endTime ? new Date(b.endTime).getTime() : 0;
            return timeA - timeB;
          });
          const latest = sortedAtts[sortedAtts.length - 1];
          const prev = sortedAtts[sortedAtts.length - 2];
          const accuracyLatest = latest.accuracy !== undefined ? latest.accuracy : latest.score || 0;
          const accuracyPrev = prev.accuracy !== undefined ? prev.accuracy : prev.score || 0;
          const diff = accuracyLatest - accuracyPrev;
          const roundDiff = Math.round(diff);
          improvement = `${roundDiff >= 0 ? '+' : ''}${roundDiff}%`;
        } else if (examsAttended === 1) {
          improvement = '+0%';
        } else {
          improvement = '-';
        }

        list.push({
          id: sId,
          name: att.studentName || 'Autonomous Candidate',
          rollNumber: att.studentRollNumber || '',
          score: averageScore,
          percentile: averagePercentage,
          examsAttended,
          improvement,
          branch: att.schoolName || schoolNameMap[att.schoolId] || 'Autonomous Hub',
          schoolId: att.schoolId || '',
          class: 'Unassigned',
          status: averagePercentage >= 90 ? 'Elite' : averagePercentage >= 75 ? 'Advanced' : 'Rising'
        });
      }
    });

    // Establish rank based on average accuracy percentage descending
    const sorted = [...list].sort((a, b) => b.percentile - a.percentile || b.score - a.score);

    // Apply query search filtering
    const filteredList = sorted.filter((candidate) => candidate.name.toLowerCase().includes(filter.toLowerCase()));

    // Map positional index/rank onto the objects
    const assigned = filteredList.map((cand) => {
      const originalIndex = sorted.findIndex((item) => item.id === cand.id);
      const rank = originalIndex + 1;
      return {
        ...cand,
        rank
      };
    });

    // Sort according to grid selections. rollNumber sorts by school (branch) first, then
    // roll number within that school — matches how a school/admin actually wants to scan a
    // roster (grouped by institution, ascending register order), unlike rank/percentile
    // which are flat single-value comparisons.
    return assigned.sort((a, b) => {
      if (sortField === 'rollNumber') {
        const branchComp = a.branch.localeCompare(b.branch, undefined, { numeric: true, sensitivity: 'base' });
        const comp =
          branchComp !== 0
            ? branchComp
            : (a.rollNumber || '').localeCompare(b.rollNumber || '', undefined, { numeric: true, sensitivity: 'base' });
        return sortDirection === 'asc' ? comp : -comp;
      }

      let valA = 0;
      let valB = 0;
      if (sortField === 'rank') {
        valA = a.rank;
        valB = b.rank;
      } else if (sortField === 'percentile') {
        valA = a.percentile;
        valB = b.percentile;
      }
      if (valA === valB) return 0;
      const comp = valA > valB ? 1 : -1;
      return sortDirection === 'asc' ? comp : -comp;
    });
  }, [students, attempts, filter, schools, sortField, sortDirection]);

  // Top 5 overall, independent of whatever sort the table below is currently displaying —
  // `rank` was assigned from the percentile-desc order before the user's sort was applied,
  // so re-sorting by it here always gives the true top 5 regardless of table state.
  const topFive = useMemo(() => {
    return combinedRankings
      .filter((c) => c.examsAttended > 0)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 5);
  }, [combinedRankings]);

  // Top 5 per class — school role only ("for admin its fine no other change needed").
  // Groups by the student profile's `class` field, which isn't otherwise surfaced on this
  // page, so a school can see who leads each of their classes without cross-checking rosters.
  const topFiveByClass = useMemo(() => {
    if (profile?.role !== 'school') return [];
    const groups: Record<string, typeof combinedRankings> = {};
    combinedRankings
      .filter((c) => c.examsAttended > 0)
      .forEach((c) => {
        const cls = c.class || 'Unassigned';
        if (!groups[cls]) groups[cls] = [];
        groups[cls].push(c);
      });
    return Object.entries(groups)
      .map(([className, list]) => ({
        className,
        topFive: [...list].sort((a, b) => a.rank - b.rank).slice(0, 5)
      }))
      .sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }));
  }, [combinedRankings, profile?.role]);

  // Consolidated Merit List export — computed entirely server-side, directly from
  // Firestore (see server/routes/reports.ts), NOT from whatever's currently loaded in this
  // tab. The on-screen table caps its own live listener for browser performance, but export
  // needs to keep working correctly even as total student count grows well past that cap —
  // so this just tells the server which school (or "all", admin only) to export, rather
  // than sending it rows this page already has in memory.
  const handleExportXlsx = async () => {
    setIsExportingXlsx(true);
    try {
      const response = await fetch('/api/reports/merit-list-xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ schoolId: profile?.role === 'admin' ? selectedSchoolId : undefined })
      });

      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.error || `Export failed (status ${response.status})`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = `Consolidated_Merit_List_${new Date().toISOString().split('T')[0]}.xlsx`;
      downloadLink.click();
      window.URL.revokeObjectURL(url);
      toast.success('Merit list exported to Excel.');
    } catch (err: any) {
      console.error('Merit list export failed:', err);
      toast.error(err.message || 'Failed to export merit list.');
    } finally {
      setIsExportingXlsx(false);
    }
  };

  // Compute live calculated stats summary panel cards
  const statsSummary = useMemo(() => {
    const totalCandidates = combinedRankings.length;
    const candidatesWithAttempts = combinedRankings.filter((c) => c.examsAttended > 0);

    const sumAccuracy = candidatesWithAttempts.reduce((sum, item) => sum + item.percentile, 0);
    const meanPercentage = candidatesWithAttempts.length > 0 ? Math.round(sumAccuracy / candidatesWithAttempts.length) : 0;

    const masteryCount = candidatesWithAttempts.filter((item) => item.percentile >= 75).length;
    const masteryString = `${masteryCount}/${totalCandidates}`;

    return [
      {
        label: 'Total Candidates',
        value: totalCandidates.toLocaleString(),
        icon: <Users size={28} />,
        color: 'bg-indigo-50 text-indigo-600'
      },
      { label: 'Average Score', value: `${meanPercentage}%`, icon: <TrendingUp size={28} />, color: 'bg-emerald-50 text-emerald-600' },
      { label: 'Pass Rate (≥75%)', value: masteryString, icon: <Target size={28} />, color: 'bg-amber-50 text-amber-600' }
    ];
  }, [combinedRankings]);

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-1">
        <div>
          <Badge
            variant="outline"
            className="bg-indigo-50 text-indigo-700 border-indigo-100 font-black text-[10px] px-2 py-0.5 rounded-md uppercase tracking-wider mb-2"
          >
            Leaderboards
          </Badge>
          <h2 className="text-4xl font-display font-black text-slate-900 tracking-tight flex items-center gap-3">
            Analytics Engine <Trophy className="text-amber-500" size={32} />
          </h2>
          <p className="text-slate-500 font-medium mt-1">Compare student performance rankings across all schools.</p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleExportXlsx}
            disabled={isExportingXlsx}
            className="border-slate-200 h-12 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 bg-white shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isExportingXlsx ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {isExportingXlsx ? 'Exporting...' : 'Export XLS'}
          </Button>
          <Button className="bg-slate-900 text-white h-12 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 shadow-xl shadow-slate-200">
            <Medal size={14} /> Award Certificates
          </Button>
        </div>
      </header>

      {isTruncated && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 text-amber-800">
          <AlertTriangle size={18} className="shrink-0" />
          <p className="text-xs font-semibold">
            This view is showing the first {DISPLAY_FETCH_CAP.toLocaleString()} records and may not reflect every student — narrow by school
            above for a complete view. The <span className="font-bold">Export XLS</span> button is unaffected and always exports the
            complete list.
          </p>
        </div>
      )}

      {/* Stats Summary Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {statsSummary.map((stat, i) => (
          <Card key={i} className="shadow-2xl shadow-slate-200/40 border-0 rounded-[32px] bg-white overflow-hidden group">
            <CardContent className="p-5 md:p-8 flex items-center gap-6">
              <div
                className={`h-16 w-16 ${stat.color} rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110`}
              >
                {stat.icon}
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-2">{stat.label}</p>
                <p className="text-3xl font-black text-slate-900 tracking-tighter">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Top 5 overall highlight strip */}
      <Card className="shadow-2xl shadow-slate-200/50 border-0 rounded-[40px] overflow-hidden bg-gradient-to-br from-slate-900 to-indigo-950 text-white">
        <CardHeader className="p-5 md:p-8 border-b border-white/5">
          <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-300">Top 5 Students</CardTitle>
          <CardDescription className="text-xs font-semibold text-indigo-200 mt-1">
            {profile?.role === 'admin' ? 'Top performing candidates across all schools.' : "This school's top performing candidates."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5 md:p-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
            {topFive.map((cand, i) => {
              const rankIcon =
                i === 0 ? (
                  <Crown size={16} className="text-amber-400" />
                ) : i === 1 ? (
                  <Medal size={16} className="text-slate-300" />
                ) : i === 2 ? (
                  <Award size={16} className="text-orange-400" />
                ) : null;
              return (
                <div
                  key={cand.id}
                  className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col items-center text-center gap-2"
                >
                  <div className="flex items-center gap-1.5">
                    {rankIcon || <span className="text-xs font-black text-indigo-300">0{i + 1}</span>}
                  </div>
                  {i < 3 && (
                    <div className="h-6 w-1.5 rounded-full bg-white/10 overflow-hidden flex items-end">
                      <div
                        className={`w-full rounded-full ${i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-slate-300' : 'bg-orange-400'}`}
                        style={{ height: `${Math.max(10, Math.min(100, cand.percentile))}%` }}
                      />
                    </div>
                  )}
                  <p className="text-xs font-black uppercase tracking-tight truncate max-w-full">{cand.name}</p>
                  <p className="text-[9px] font-bold text-slate-400 truncate max-w-full">{cand.branch}</p>
                  <span className="text-xs font-black text-emerald-400">{cand.percentile}%</span>
                </div>
              );
            })}
            {topFive.length === 0 && (
              <p className="col-span-full text-xs font-bold text-slate-400 text-center py-6">No completed exams yet</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Top 5 per class — school role only */}
      {profile?.role === 'school' && topFiveByClass.length > 0 && (
        <Card className="shadow-2xl shadow-slate-200/50 border-0 rounded-[40px] overflow-hidden bg-white">
          <CardHeader className="p-8 border-b border-slate-50">
            <CardTitle className="text-xl font-black text-slate-900 tracking-tighter uppercase">Top 5 Per Class</CardTitle>
            <CardDescription className="font-bold text-slate-400">
              Leaderboard broken out by class, so each grade's top performers are easy to spot.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {topFiveByClass.map((group) => (
                <div key={group.className} className="border border-slate-100 rounded-3xl p-5 bg-slate-50/60">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">{group.className}</p>
                  <div className="space-y-3">
                    {group.topFive.map((cand, i) => (
                      <div key={cand.id} className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {i === 0 ? (
                            <Crown size={14} className="text-amber-500 shrink-0" />
                          ) : i === 1 ? (
                            <Medal size={14} className="text-slate-400 shrink-0" />
                          ) : i === 2 ? (
                            <Award size={14} className="text-orange-500 shrink-0" />
                          ) : (
                            <span className="text-[10px] font-black text-indigo-400 w-3.5 shrink-0">{i + 1}</span>
                          )}
                          <span className="text-xs font-bold text-slate-800 truncate">{cand.name}</span>
                        </div>
                        <span className="text-xs font-black text-indigo-600 shrink-0">{cand.percentile}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-2xl shadow-slate-200/50 border-0 rounded-[40px] overflow-hidden bg-white">
        <CardHeader className="p-5 md:p-10 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <CardTitle className="text-2xl font-black text-slate-900 tracking-tighter uppercase">Consolidated Merit List</CardTitle>
            <CardDescription className="font-bold text-slate-400">
              Aggregated performance data across all branches and institutions.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-4 items-center">
            {profile?.role === 'admin' && schools.length > 0 && (
              <div className="relative w-56">
                <button
                  type="button"
                  onClick={() => setSchoolDropdownOpen(!schoolDropdownOpen)}
                  className="w-full h-12 bg-white border-2 border-slate-300 rounded-xl font-bold text-sm text-slate-900 px-4 flex items-center justify-between shadow-sm hover:border-indigo-500 transition-all cursor-pointer"
                >
                  <span className="truncate">
                    {selectedSchoolId === 'all' ? 'All Schools' : schools.find((s) => s.id === selectedSchoolId)?.name || 'All Schools'}
                  </span>
                  <ChevronDown className="h-4 w-4 ml-2 text-slate-500 shrink-0" />
                </button>

                {schoolDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-[100]"
                      onClick={() => {
                        setSchoolDropdownOpen(false);
                        setSchoolSearchText('');
                      }}
                    />
                    <div className="absolute left-0 right-0 mt-1.5 bg-white border-2 border-slate-300 shadow-2xl rounded-2xl p-3 z-[110] flex flex-col gap-2 max-h-[320px] overflow-hidden">
                      <div className="relative flex items-center shrink-0">
                        <Search className="absolute left-3 h-3.5 w-3.5 text-slate-400" />
                        <input
                          type="text"
                          value={schoolSearchText}
                          onChange={(e) => setSchoolSearchText(e.target.value)}
                          placeholder="Search schools..."
                          className="w-full h-9 pl-9 pr-3 bg-slate-50 border-2 border-slate-100 focus:border-indigo-400 focus:bg-white text-xs font-bold text-slate-800 rounded-lg outline-none transition-all"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                        {(() => {
                          const queryFiltered = schools.filter((s) =>
                            (s.name || '').toLowerCase().includes(schoolSearchText.toLowerCase())
                          );
                          const sliced = queryFiltered.slice(0, 50);
                          const allMatchesLabel = 'all schools'.includes(schoolSearchText.toLowerCase());

                          if (sliced.length === 0 && !allMatchesLabel) {
                            return <div className="text-center py-6 text-xs text-slate-400 font-bold">No matching schools found</div>;
                          }

                          return (
                            <>
                              {allMatchesLabel && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedSchoolId('all');
                                    setSchoolDropdownOpen(false);
                                    setSchoolSearchText('');
                                  }}
                                  className={`w-full text-left font-black text-xs cursor-pointer py-2 px-3 rounded-lg flex items-center justify-between transition-colors ${
                                    selectedSchoolId === 'all'
                                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                      : 'text-slate-900 hover:bg-indigo-50'
                                  }`}
                                >
                                  All Schools
                                  {selectedSchoolId === 'all' && <Check className="h-3.5 w-3.5 shrink-0 text-white" />}
                                </button>
                              )}
                              {sliced.map((s) => {
                                const isSelected = s.id === selectedSchoolId;
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedSchoolId(s.id);
                                      setSchoolDropdownOpen(false);
                                      setSchoolSearchText('');
                                    }}
                                    className={`w-full text-left font-black text-xs cursor-pointer py-2 px-3 rounded-lg flex items-center justify-between transition-colors ${
                                      isSelected ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'text-slate-900 hover:bg-indigo-50'
                                    }`}
                                  >
                                    <span className="truncate pr-2">{s.name}</span>
                                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-white" />}
                                  </button>
                                );
                              })}
                              {queryFiltered.length > 50 && (
                                <div className="text-center py-2 text-[10px] text-slate-400 font-bold">
                                  {queryFiltered.length - 50} more — refine your search
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            {profile?.role === 'school' && (
              <div className="bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-xl flex flex-col justify-center text-left">
                <span className="text-[9px] font-black uppercase text-indigo-500 tracking-wider">Your Institution</span>
                <span className="text-xs font-black text-indigo-900">
                  {schools.find((s) => s.id === profile.schoolId)?.name || 'Your Assigned School'}
                </span>
              </div>
            )}
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search candidates..."
                className="pl-10 h-12 bg-slate-50 border-0 rounded-xl font-bold text-sm"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <Button variant="outline" className="h-12 w-12 p-0 rounded-xl border-slate-100 bg-slate-50 text-slate-400">
              <Filter size={20} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100/80 border-b border-slate-200">
                <tr className="divide-x divide-slate-200/50">
                  <th
                    className="px-6 py-3.5 cursor-pointer hover:bg-slate-200/50 transition-colors select-none font-sans text-xs uppercase font-black tracking-wider text-slate-500 w-28 text-left"
                    onClick={() => {
                      if (sortField === 'rank') {
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      } else {
                        setSortField('rank');
                        setSortDirection('asc');
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      Rank
                      {sortField === 'rank' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp size={13} className="text-indigo-650 font-bold" />
                        ) : (
                          <ArrowDown size={13} className="text-indigo-650 font-bold" />
                        )
                      ) : (
                        <ArrowUpDown size={13} className="text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3.5 font-sans text-xs uppercase font-black tracking-wider text-slate-500">Candidate Profile</th>
                  <th
                    className="px-6 py-3.5 cursor-pointer hover:bg-slate-200/50 transition-colors select-none font-sans text-xs uppercase font-black tracking-wider text-slate-500 w-32"
                    onClick={() => {
                      if (sortField === 'rollNumber') {
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      } else {
                        setSortField('rollNumber');
                        setSortDirection('asc');
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      Roll No.
                      {sortField === 'rollNumber' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp size={13} className="text-indigo-650 font-bold" />
                        ) : (
                          <ArrowDown size={13} className="text-indigo-650 font-bold" />
                        )
                      ) : (
                        <ArrowUpDown size={13} className="text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3.5 font-sans text-xs uppercase font-black tracking-wider text-slate-500 text-center w-28">
                    Score
                  </th>
                  <th
                    className="px-6 py-3.5 cursor-pointer hover:bg-slate-200/50 transition-colors select-none font-sans text-xs uppercase font-black tracking-wider text-slate-500 text-center w-36"
                    onClick={() => {
                      if (sortField === 'percentile') {
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      } else {
                        setSortField('percentile');
                        setSortDirection('desc');
                      }
                    }}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      Percentage
                      {sortField === 'percentile' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp size={13} className="text-indigo-650 font-bold" />
                        ) : (
                          <ArrowDown size={13} className="text-indigo-650 font-bold" />
                        )
                      ) : (
                        <ArrowUpDown size={13} className="text-slate-400" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3.5 font-sans text-xs uppercase font-black tracking-wider text-slate-500 w-32">Exam Attendance</th>
                  <th className="px-6 py-3.5 font-sans text-xs uppercase font-black tracking-wider text-slate-500 text-right">
                    Institutional Branch
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150">
                {combinedRankings.slice((page - 1) * pageSize, page * pageSize).map((entry, i) => (
                  <motion.tr
                    key={entry.id || i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    className="odd:bg-slate-50/50 even:bg-white hover:bg-slate-100 transition-colors group cursor-default font-mono text-xs divide-x divide-slate-100/50"
                  >
                    <td className="px-6 py-2.5 font-semibold text-slate-900">
                      <span
                        className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md font-bold text-center ${entry.rank <= 3 ? 'bg-amber-100 text-amber-800 border border-amber-200 font-extrabold' : 'bg-slate-100 text-slate-705 border border-slate-200'}`}
                      >
                        #{entry.rank}
                      </span>
                    </td>
                    <td className="px-6 py-2.5 font-sans">
                      <button
                        type="button"
                        onClick={() => entry.examsAttended > 0 && navigate(`/admin/student/${entry.id}`)}
                        disabled={entry.examsAttended === 0}
                        title={entry.examsAttended > 0 ? 'View full exam history' : undefined}
                        className={`flex items-center gap-2 text-left ${entry.examsAttended > 0 ? 'cursor-pointer hover:underline' : 'cursor-default'}`}
                      >
                        <div className="flex items-center gap-3">
                          <p className="text-xs font-black text-slate-800 uppercase tracking-tight">{entry.name}</p>
                          <Badge
                            className={`${entry.status === 'Elite' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : entry.status === 'Advanced' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'} font-black text-[8px] uppercase px-1.5 py-0.5 rounded-md border`}
                          >
                            {entry.status}
                          </Badge>
                          {entry.examsAttended > 0 && (
                            <ChevronRight size={12} className="text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
                          )}
                        </div>
                      </button>
                    </td>
                    <td className="px-6 py-2.5 font-sans font-semibold text-slate-700">{entry.rollNumber || '—'}</td>
                    <td className="px-6 py-2.5 text-center font-bold text-slate-850">{Math.round(entry.score)}</td>
                    <td className="px-6 py-2.5 text-center font-bold">
                      <span className="text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full text-xs">
                        {entry.percentile}%
                      </span>
                    </td>
                    <td className="px-6 py-2.5">
                      <div className="flex flex-col gap-0.5 text-left">
                        <span className="font-sans text-xs font-semibold text-slate-700">{entry.examsAttended} Attended</span>
                        <span
                          className={`text-[10px] font-bold ${entry.improvement.startsWith('+') ? 'text-emerald-600' : entry.improvement === '-' ? 'text-slate-400' : 'text-rose-600'}`}
                        >
                          {entry.improvement} {entry.improvement !== '-' && 'progress'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-2.5 text-right font-sans">
                      <span className="text-xs font-bold text-slate-400 bg-slate-100/100 border border-slate-200 shadow-xs px-2.5 py-0.5 rounded-md uppercase tracking-wider">
                        {entry.branch} Branch
                      </span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Dynamic Table Pagination Controls */}
          <div className="p-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/20">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(parseInt(e.target.value));
                  setPage(1);
                }}
                className="h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-705 outline-none cursor-pointer"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="text-xs font-bold text-slate-400 ml-4 font-mono">
                Showing {combinedRankings.length === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, combinedRankings.length)}{' '}
                of {combinedRankings.length}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
                className="h-9 px-4 rounded-xl border-slate-200 text-xs font-black uppercase tracking-wider bg-white"
              >
                Previous
              </Button>
              <div className="h-9 w-9 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center justify-center text-xs font-black text-indigo-700 select-none font-mono">
                {page}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={page * pageSize >= combinedRankings.length}
                onClick={() => setPage(page + 1)}
                className="h-9 px-4 rounded-xl border-slate-200 text-xs font-black uppercase tracking-wider bg-white"
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
