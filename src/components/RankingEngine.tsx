import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { db, collection, query, where, onSnapshot, getDocs } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { 
  Trophy, 
  Search, 
  Filter, 
  Download, 
  TrendingUp, 
  Users,
  Target,
  Medal,
  ChevronsUp,
  ArrowUp,
  ArrowDown,
  ArrowUpDown
} from 'lucide-react';
import { motion } from 'motion/react';

export const RankingEngine: React.FC = () => {
  const { profile } = useAuth();
  const [filter, setFilter] = useState('');
  const [students, setStudents] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<'rank' | 'percentile'>('rank');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Load schools to map branch names dynamically for everyone
  useEffect(() => {
    getDocs(collection(db, 'schools')).then(snap => {
      setSchools(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }).catch(err => console.error("Error loading schools in Merit tracker:", err));
  }, []);

  // Listen to students and exam attempts dynamically based on user role and dropdown filter
  useEffect(() => {
    if (!profile) return;

    setLoading(true);

    let studentsQuery;
    let attemptsQuery;

    // Determine the active school ID filter based on RBAC rules
    const activeSchoolId = profile.role === 'admin' 
      ? selectedSchoolId 
      : (profile.schoolId || 'no-school-assigned');

    if (activeSchoolId && activeSchoolId !== 'all') {
      studentsQuery = query(
        collection(db, 'users'),
        where('role', '==', 'student'),
        where('schoolId', '==', activeSchoolId)
      );
      attemptsQuery = query(
        collection(db, 'attempts'),
        where('status', '==', 'completed'),
        where('schoolId', '==', activeSchoolId)
      );
    } else {
      studentsQuery = query(
        collection(db, 'users'),
        where('role', '==', 'student')
      );
      attemptsQuery = query(
        collection(db, 'attempts'),
        where('status', '==', 'completed')
      );
    }

    const unsubscribeStudents = onSnapshot(studentsQuery, (snapshot) => {
      const studs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setStudents(studs);
    }, (err) => {
      console.error("Error subscribing to students: ", err);
    });

    const unsubscribeAttempts = onSnapshot(attemptsQuery, (snapshot) => {
      const atts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAttempts(atts);
      setLoading(false);
    }, (err) => {
      console.error("Error subscribing to attempts: ", err);
      setLoading(false);
    });

    return () => {
      unsubscribeStudents();
      unsubscribeAttempts();
    };
  }, [profile, selectedSchoolId]);

  // Aggregate and parse student-level metrics dynamically
  const combinedRankings = useMemo(() => {
    // Group attempts by studentId
    const attemptsByStudent: { [studentId: string]: any[] } = {};
    attempts.forEach(att => {
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
    schools.forEach(s => {
      if (s.id) schoolNameMap[s.id] = s.name;
    });

    const processedStudentIds = new Set<string>();
    const list: any[] = [];

    // First process all registered candidates of the active partition
    students.forEach(stud => {
      const sId = stud.id || stud.uid;
      processedStudentIds.add(sId);

      const studAttempts = attemptsByStudent[sId] || [];
      const completedAttempts = studAttempts.filter(a => a.status === 'completed');
      
      const examsAttended = completedAttempts.length;
      
      let averagePercentage = 0;
      let averageScore = 0;
      
      if (examsAttended > 0) {
        const totalAccuracy = completedAttempts.reduce((sum, a) => sum + (a.accuracy !== undefined ? a.accuracy : (a.score || 0)), 0);
        averagePercentage = Number((totalAccuracy / examsAttended).toFixed(1));
        
        const totalScore = completedAttempts.reduce((sum, a) => sum + (a.score || 0), 0);
        averageScore = Number((totalScore / examsAttended).toFixed(1));
      }

      // Calculate trend/improvement dynamically based on difference between the two most recent attempts
      let improvement = '0.0%';
      if (examsAttended >= 2) {
        const sortedAtts = [...completedAttempts].sort((a, b) => {
          const tA = a.endTime ? new Date(a.endTime).getTime() : 0;
          const tB = b.endTime ? new Date(b.endTime).getTime() : 0;
          return tA - tB; // oldest to newest
        });
        const latest = sortedAtts[sortedAtts.length - 1];
        const prev = sortedAtts[sortedAtts.length - 2];
        const accuracyLatest = latest.accuracy !== undefined ? latest.accuracy : (latest.score || 0);
        const accuracyPrev = prev.accuracy !== undefined ? prev.accuracy : (prev.score || 0);
        const diff = accuracyLatest - accuracyPrev;
        improvement = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
      } else if (examsAttended === 1) {
        improvement = '+0.0%';
      } else {
        improvement = '-';
      }

      list.push({
        id: sId,
        name: stud.name || 'Autonomous Candidate',
        score: averageScore,
        percentile: averagePercentage,
        examsAttended,
        improvement,
        branch: stud.schoolName || schoolNameMap[stud.schoolId] || 'Autonomous Hub',
        schoolId: stud.schoolId || '',
        status: (averagePercentage >= 90) ? 'Elite' : (averagePercentage >= 75) ? 'Advanced' : 'Rising'
      });
    });

    // In case there are completed attempts for students we didn't receive user docs for directly
    attempts.forEach(att => {
      const sId = att.studentId;
      if (sId && !processedStudentIds.has(sId)) {
        processedStudentIds.add(sId);

        const studAttempts = attemptsByStudent[sId] || [];
        const completedAttempts = studAttempts.filter(a => a.status === 'completed');
        const examsAttended = completedAttempts.length;

        let averagePercentage = 0;
        let averageScore = 0;
        
        if (examsAttended > 0) {
          const totalAccuracy = completedAttempts.reduce((sum, a) => sum + (a.accuracy !== undefined ? a.accuracy : (a.score || 0)), 0);
          averagePercentage = Number((totalAccuracy / examsAttended).toFixed(1));
          
          const totalScore = completedAttempts.reduce((sum, a) => sum + (a.score || 0), 0);
          averageScore = Number((totalScore / examsAttended).toFixed(1));
        }

        let improvement = '0.0%';
        if (examsAttended >= 2) {
          const sortedAtts = [...completedAttempts].sort((a, b) => {
            const tA = a.endTime ? new Date(a.endTime).getTime() : 0;
            const tB = b.endTime ? new Date(b.endTime).getTime() : 0;
            return tA - tB;
          });
          const latest = sortedAtts[sortedAtts.length - 1];
          const prev = sortedAtts[sortedAtts.length - 2];
          const accuracyLatest = latest.accuracy !== undefined ? latest.accuracy : (latest.score || 0);
          const accuracyPrev = prev.accuracy !== undefined ? prev.accuracy : (prev.score || 0);
          const diff = accuracyLatest - accuracyPrev;
          improvement = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
        } else if (examsAttended === 1) {
          improvement = '+0.0%';
        } else {
          improvement = '-';
        }

        list.push({
          id: sId,
          name: att.studentName || 'Autonomous Candidate',
          score: averageScore,
          percentile: averagePercentage,
          examsAttended,
          improvement,
          branch: att.schoolName || schoolNameMap[att.schoolId] || 'Autonomous Hub',
          schoolId: att.schoolId || '',
          status: (averagePercentage >= 90) ? 'Elite' : (averagePercentage >= 75) ? 'Advanced' : 'Rising'
        });
      }
    });

    // Establish rank based on average accuracy percentage descending
    const sorted = [...list].sort((a, b) => b.percentile - a.percentile || b.score - a.score);

    // Apply query search filtering
    const filteredList = sorted.filter(candidate => 
      candidate.name.toLowerCase().includes(filter.toLowerCase())
    );

    // Map positional index/rank onto the objects
    const assigned = filteredList.map((cand) => {
      const originalIndex = sorted.findIndex(item => item.id === cand.id);
      const rank = originalIndex + 1;
      return {
        ...cand,
        rank
      };
    });

    // Sort according to grid selections
    return assigned.sort((a, b) => {
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

  // Compute live calculated stats summary panel cards
  const statsSummary = useMemo(() => {
    const totalCandidates = combinedRankings.length;
    const candidatesWithAttempts = combinedRankings.filter(c => c.examsAttended > 0);
    
    const sumAccuracy = candidatesWithAttempts.reduce((sum, item) => sum + item.percentile, 0);
    const meanPercentage = candidatesWithAttempts.length > 0 
      ? Number((sumAccuracy / candidatesWithAttempts.length).toFixed(1)) 
      : 0.0;

    const masteryCount = candidatesWithAttempts.filter(item => item.percentile >= 75).length;
    const masteryString = `${masteryCount}/${totalCandidates}`;

    return [
      { label: 'Total Candidates', value: totalCandidates.toLocaleString(), icon: <Users size={28} />, color: 'bg-indigo-50 text-indigo-600' },
      { label: 'Mean Percentage', value: `${meanPercentage}%`, icon: <TrendingUp size={28} />, color: 'bg-emerald-50 text-emerald-600' },
      { label: 'Mastery Quota (≥75%)', value: masteryString, icon: <Target size={28} />, color: 'bg-amber-50 text-amber-600' }
    ];
  }, [combinedRankings]);

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-1">
        <div>
          <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-100 font-black text-[10px] px-2 py-0.5 rounded-md uppercase tracking-wider mb-2">Merit Matrix</Badge>
          <h2 className="text-4xl font-display font-black text-slate-900 tracking-tight flex items-center gap-3">
            Ranking Engine <Trophy className="text-amber-500" size={32} />
          </h2>
          <p className="text-slate-500 font-medium mt-1">Cross-institutional consolidated merit analysis & ranking heuristics.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="border-slate-200 h-12 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 bg-white shadow-sm">
             <Download size={14} /> Export XLS
          </Button>
          <Button className="bg-slate-900 text-white h-12 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 shadow-xl shadow-slate-200">
             <Medal size={14} /> Award Certificates
          </Button>
        </div>
      </header>

      {/* Stats Summary Panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         {statsSummary.map((stat, i) => (
            <Card key={i} className="shadow-2xl shadow-slate-200/40 border-0 rounded-[32px] bg-white overflow-hidden group">
               <CardContent className="p-8 flex items-center gap-6">
                  <div className={`h-16 w-16 ${stat.color} rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110`}>
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

      <Card className="shadow-2xl shadow-slate-200/50 border-0 rounded-[40px] overflow-hidden bg-white">
        <CardHeader className="p-10 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <CardTitle className="text-2xl font-black text-slate-900 tracking-tighter uppercase">Consolidated Merit List</CardTitle>
            <CardDescription className="font-bold text-slate-400">Aggregated performance data across all branches and institutions.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-4 items-center">
            {profile?.role === 'admin' && schools.length > 0 && (
              <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                <SelectTrigger className="w-56 h-12 bg-white border-2 border-slate-300 rounded-xl font-bold text-sm text-slate-900 px-4 justify-between shadow-sm hover:border-indigo-500 transition-all">
                  <SelectValue placeholder="All Schools" />
                </SelectTrigger>
                <SelectContent className="bg-white rounded-xl border-2 border-slate-300 shadow-2xl p-1.5 z-50">
                  <SelectItem value="all" className="font-bold text-xs cursor-pointer hover:bg-slate-50 text-slate-800 py-1.5 px-3 rounded-lg">All Schools</SelectItem>
                  {schools.map(s => (
                    <SelectItem key={s.id} value={s.id} className="font-bold text-xs cursor-pointer hover:bg-indigo-50 text-slate-800 py-1.5 px-3 rounded-lg">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {profile?.role === 'school' && (
              <div className="bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-xl flex flex-col justify-center text-left">
                <span className="text-[9px] font-black uppercase text-indigo-500 tracking-wider">Your Institution</span>
                <span className="text-xs font-black text-indigo-900">
                  {schools.find(s => s.id === profile.schoolId)?.name || 'Your Assigned School'}
                </span>
              </div>
            )}
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input 
                placeholder="Search candidates..." 
                className="pl-10 h-12 bg-slate-50 border-0 rounded-xl font-bold text-sm"
                value={filter}
                onChange={e => setFilter(e.target.value)}
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
                            sortDirection === 'asc' ? <ArrowUp size={13} className="text-indigo-650 font-bold" /> : <ArrowDown size={13} className="text-indigo-650 font-bold" />
                          ) : (
                            <ArrowUpDown size={13} className="text-slate-400" />
                          )}
                        </div>
                      </th>
                      <th className="px-6 py-3.5 font-sans text-xs uppercase font-black tracking-wider text-slate-500">Candidate Profile</th>
                      <th className="px-6 py-3.5 font-sans text-xs uppercase font-black tracking-wider text-slate-500 text-center w-28">Score</th>
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
                            sortDirection === 'asc' ? <ArrowUp size={13} className="text-indigo-650 font-bold" /> : <ArrowDown size={13} className="text-indigo-650 font-bold" />
                          ) : (
                            <ArrowUpDown size={13} className="text-slate-400" />
                          )}
                        </div>
                      </th>
                      <th className="px-6 py-3.5 font-sans text-xs uppercase font-black tracking-wider text-slate-500 w-32">Exam Attendance</th>
                      <th className="px-6 py-3.5 font-sans text-xs uppercase font-black tracking-wider text-slate-500 text-right">Institutional Branch</th>
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
                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md font-bold text-center ${entry.rank <= 3 ? 'bg-amber-100 text-amber-800 border border-amber-200 font-extrabold' : 'bg-slate-100 text-slate-705 border border-slate-200'}`}>
                               #{entry.rank}
                            </span>
                         </td>
                         <td className="px-6 py-2.5 font-sans">
                            <div className="flex items-center gap-3">
                               <p className="text-xs font-black text-slate-800 uppercase tracking-tight">{entry.name}</p>
                               <Badge className={`${entry.status === 'Elite' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : entry.status === 'Advanced' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'} font-black text-[8px] uppercase px-1.5 py-0.5 rounded-md border`}>
                                  {entry.status}
                               </Badge>
                            </div>
                         </td>
                         <td className="px-6 py-2.5 text-center font-bold text-slate-850">
                            {Number(entry.score).toFixed(1)}
                         </td>
                         <td className="px-6 py-2.5 text-center font-bold">
                            <span className="text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full text-xs">
                               {entry.percentile}%
                            </span>
                         </td>
                         <td className="px-6 py-2.5">
                            <div className="flex flex-col gap-0.5 text-left">
                               <span className="font-sans text-xs font-semibold text-slate-700">{entry.examsAttended} Attended</span>
                               <span className={`text-[10px] font-bold ${entry.improvement.startsWith('+') ? 'text-emerald-600' : entry.improvement === '-' ? 'text-slate-400' : 'text-rose-600'}`}>
                                  {entry.improvement} {entry.improvement !== '-' && 'progress'}
                               </span>
                            </div>
                         </td>
                         <td className="px-6 py-2.5 text-right font-sans">
                            <span className="text-xs font-bold text-slate-400 bg-slate-100/100 border border-slate-200 shadow-xs px-2.5 py-0.5 rounded-md uppercase tracking-wider">{entry.branch} Branch</span>
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
                onChange={e => {
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
                Showing {combinedRankings.length === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, combinedRankings.length)} of {combinedRankings.length}
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
