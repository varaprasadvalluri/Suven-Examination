import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { db, doc, getDoc, collection, query, where, getDocs, deleteDoc } from '../lib/firebase';
import { attemptsService } from '../services/api';
import { Attempt, Exam } from '../types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { ArrowLeft, Download, Users, TrendingUp, Award, Brain, AlertTriangle, ShieldAlert, Sparkles, Clock, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { ConfirmationDialog } from './ConfirmationDialog';
import { orderQuestionsForAttempt } from '../lib/examQuestionOrder';

export const AdminResults: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<Exam | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Pagination State
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { profile } = useAuth();
  const canViewResults = profile?.permissions?.includes('view_results');

  // Additional states for millions scale pagination and sample analytics
  const [totalAttemptsCount, setTotalAttemptsCount] = useState<number>(0);
  const [analyticsAttempts, setAnalyticsAttempts] = useState<Attempt[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Re-attempt / Reset attempt states
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [attemptToReset, setAttemptToReset] = useState<Attempt | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    if (!canViewResults) return;
    const fetchBaseData = async () => {
      if (!examId) return;
      try {
        const examRef = doc(db, 'exams', examId);
        const examSnap = await getDoc(examRef);

        if (examSnap.exists()) {
          setExam({ id: examSnap.id, ...examSnap.data() } as Exam);
        } else {
          toast.error('Exam not found');
        }

        // Fetch questions corresponding to target exam for precision metrics
        const qQs = query(collection(db, 'questions'), where('examId', '==', examId));
        const qsSnap = await getDocs(qQs);
        setQuestions(qsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));

        // One call gets both the exact total (for the participants badge/pagination) and a
        // 200-row sample (sorted by score) for question-analytics/average-score calculations —
        // replaces the old separate getCountFromServer + getDocs(limit(200)) round trips.
        const sample = await attemptsService.list({
          examId,
          status: 'completed',
          schoolId: profile?.schoolId || undefined,
          sortBy: 'score',
          page: 1,
          pageSize: 200
        });
        setTotalAttemptsCount(sample.total);
        setAnalyticsAttempts(sample.items.map((item) => ({ id: item.id, ...item.data }) as Attempt));
      } catch (error) {
        console.error('Error loading exam statistics: ', error);
        toast.error('Failed to load results metadata and metrics');
      } finally {
        setLoading(false);
      }
    };
    fetchBaseData();
  }, [examId, canViewResults, profile, refreshTrigger]);

  // Paginated List Loader for Roll-Sheet table
  useEffect(() => {
    if (!canViewResults || !examId) return;

    const fetchListPage = async () => {
      setLoadingList(true);
      try {
        const listPage = await attemptsService.list({
          examId,
          status: 'completed',
          schoolId: profile?.schoolId || undefined,
          sortBy: 'score',
          page,
          pageSize
        });
        setAttempts(listPage.items.map((item) => ({ id: item.id, ...item.data }) as Attempt));
      } catch (error) {
        console.error('Error fetching list page:', error);
        toast.error('Failed to load page of results');
      } finally {
        setLoadingList(false);
      }
    };

    fetchListPage();
  }, [examId, page, pageSize, canViewResults, profile, refreshTrigger]);

  const handleExport = () => {
    if (attempts.length === 0) {
      toast.error('No results to export');
      return;
    }

    const exportData = attempts.map((attempt) => ({
      'Student Name': attempt.studentName,
      Date: attempt.endTime ? new Date(attempt.endTime).toLocaleDateString() : 'N/A',
      Time: attempt.endTime ? new Date(attempt.endTime).toLocaleTimeString() : 'N/A',
      Score: attempt.score,
      'Total Marks': exam?.totalMarks || 0,
      Percentage: `${Math.round((attempt.score / (exam?.totalMarks || 1)) * 100)}%`
    }));

    const resultsWorksheet = XLSX.utils.json_to_sheet(exportData);
    const resultsWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(resultsWorkbook, resultsWorksheet, 'Exam Results');
    XLSX.writeFile(resultsWorkbook, `${exam?.title}_Results.xlsx`);
    toast.success('Spreadsheet generated successfully');
  };

  const handleResetAttempt = async () => {
    if (!attemptToReset) return;
    setIsResetting(true);
    try {
      const attemptId = attemptToReset.id;
      const studentId = attemptToReset.studentId;

      // 1. Delete the primary attempt document
      const attemptRef = doc(db, 'attempts', attemptId);
      await deleteDoc(attemptRef);

      // 2. Delete related proctoring logs for this attempt
      const logsQuery = query(collection(db, 'proctoring_logs'), where('attemptId', '==', attemptId));
      const logsSnap = await getDocs(logsQuery);
      for (const logDoc of logsSnap.docs) {
        await deleteDoc(doc(db, 'proctoring_logs', logDoc.id));
      }

      // 3. Delete related error book entries for this student & exam. Collection is
      // 'error_books' (plural) — everywhere else in the app (ExamInterface.tsx's writer,
      // idGenerator.ts, StudentController/SchoolController's cascade-delete) already agrees on
      // that name; this read+delete previously targeted the singular 'error_book', which no
      // writer ever used, so reset-attempt cleanup silently never deleted the real entries.
      if (studentId && examId) {
        const errorBookQuery = query(collection(db, 'error_books'), where('studentId', '==', studentId), where('examId', '==', examId));
        const errorBookSnap = await getDocs(errorBookQuery);
        for (const ebDoc of errorBookSnap.docs) {
          await deleteDoc(doc(db, 'error_books', ebDoc.id));
        }
      }

      toast.success(`Successfully cleared attempt for ${attemptToReset.studentName}. They can now retake this exam.`);
      setResetDialogOpen(false);
      setAttemptToReset(null);

      // Increment refresh trigger to reload lists reactively
      setRefreshTrigger((prev) => prev + 1);
    } catch (error: any) {
      console.error('Error resetting student attempt:', error);
      toast.error(`Failed to reset attempt: ${error.message || String(error)}`);
    } finally {
      setIsResetting(false);
    }
  };

  // Each attempt's answers/timePerQuestion are indexed by that STUDENT's own shuffled
  // question order (seeded per attempt id), not by a shared position — two students can
  // have "index 3" mean two different questions. Build a per-attempt questionId->index
  // map once so the analytics below compare each attempt's answer to the right question.
  const attemptQuestionIndexMaps = React.useMemo(() => {
    const maps = new Map<string, Map<string, number>>();
    if (questions.length === 0) return maps;
    analyticsAttempts.forEach((att) => {
      const ordered = orderQuestionsForAttempt(questions, att.id);
      const idxMap = new Map<string, number>();
      ordered.forEach((q, idx) => idxMap.set(q.id, idx));
      maps.set(att.id, idxMap);
    });
    return maps;
  }, [questions, analyticsAttempts]);

  // MODULE 5: Question-Level Analytics Aggregator
  const questionAnalytics = React.useMemo(() => {
    if (questions.length === 0 || analyticsAttempts.length === 0) return [];

    return questions.map((q) => {
      let attemptsCount = 0;
      let passes = 0;
      let fails = 0;
      let totalTime = 0;

      analyticsAttempts.forEach((att) => {
        const idx = attemptQuestionIndexMaps.get(att.id)?.get(q.id);
        if (idx === undefined) return;
        const studentAns = att.answers?.[idx];
        if (studentAns === undefined || studentAns === null) return;

        attemptsCount++;
        const qType = q.type || 'single';
        let isCorrect = false;

        if (qType === 'numerical') {
          isCorrect = String(studentAns).trim() === String(q.numericalAnswer || '').trim();
        } else if (qType === 'multiple') {
          if (Array.isArray(studentAns)) {
            isCorrect = studentAns.includes(q.correctAnswerIndex);
          } else {
            isCorrect = studentAns === q.correctAnswerIndex;
          }
        } else {
          isCorrect = studentAns === q.correctAnswerIndex;
        }

        if (isCorrect) passes++;
        else fails++;

        const timeSpent = att.timePerQuestion?.[idx] || 0;
        totalTime += timeSpent;
      });

      const passRatio = attemptsCount > 0 ? passes / attemptsCount : 0;
      const failRatio = 1 - passRatio;
      const avgTime = attemptsCount > 0 ? totalTime / attemptsCount : 0;

      // Classify Anomalies according to Lead Architect specifications
      let status: 'normal' | 'anomaly-hard' | 'anomaly-easy' | 'anomaly-leak' = 'normal';
      let reason = '';

      if (attemptsCount >= 1) {
        if (failRatio > 0.7) {
          status = 'anomaly-hard';
          reason = `High Failure Rate (${Math.round(failRatio * 100)}% Failed)`;
        } else if (passRatio > 0.85 && avgTime < 10) {
          status = 'anomaly-leak';
          reason = `Rapid Solve Anomalous (Avg solve ${Math.round(avgTime)}s, Pass rate: ${Math.round(passRatio * 100)}%)`;
        } else if (passRatio > 0.95) {
          status = 'anomaly-easy';
          reason = `High Success Rate (${Math.round(passRatio * 100)}% Pass)`;
        }
      }

      return {
        id: q.id,
        text: q.text,
        subject: q.subject || exam?.subject || 'General',
        attemptsCount,
        passes,
        fails,
        passRatio,
        avgTime,
        status,
        reason
      };
    });
  }, [questions, analyticsAttempts, exam]);

  if (!canViewResults)
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in duration-500">
        <div className="bg-red-50 p-6 rounded-full mb-6">
          <Users className="h-12 w-12 text-red-500" />
        </div>
        <h3 className="text-2xl font-bold text-slate-900">Access Restricted</h3>
        <p className="text-slate-500 mt-2 max-w-sm">
          You do not have the necessary <code>view_results</code> permission to access analytics for this examination.
        </p>
        <Button variant="outline" className="mt-8" onClick={() => navigate('/')}>
          Return to Dashboard
        </Button>
      </div>
    );

  if (loading) return <div>Loading exam reports...</div>;
  if (!exam) return <div>Exam not found</div>;

  const averageScore =
    analyticsAttempts.length > 0 ? Math.round(analyticsAttempts.reduce((acc, a) => acc + a.score, 0) / analyticsAttempts.length) : 0;

  const topScore = analyticsAttempts.length > 0 ? Math.max(...analyticsAttempts.map((a) => a.score)) : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Dashboard
        </Link>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" /> Export XLS
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-display font-bold">{exam.title} - Results</h1>
        <p className="text-muted-foreground">Comprehensive student performance report.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center">
              <Users className="h-5 w-5 text-indigo-600" />
            </div>
            <span className="text-sm font-medium text-slate-500 uppercase tracking-wider font-bold text-[10px]">Participants</span>
          </div>
          <div className="text-3xl font-display font-bold text-slate-900">{totalAttemptsCount}</div>
          <div className="text-xs text-slate-400 mt-1">Students completed</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <span className="text-sm font-medium text-slate-500 uppercase tracking-wider font-bold text-[10px]">Average Score</span>
          </div>
          <div className="text-3xl font-display font-bold text-slate-900">
            {averageScore} <span className="text-sm font-normal opacity-50">/ {exam.totalMarks}</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">{Math.round((averageScore / exam.totalMarks) * 100)}% Success Rate</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center">
              <Award className="h-5 w-5 text-amber-600" />
            </div>
            <span className="text-sm font-medium text-slate-500 uppercase tracking-wider font-bold text-[10px]">Highest Score</span>
          </div>
          <div className="text-3xl font-display font-bold text-slate-900">
            {topScore} <span className="text-sm font-normal opacity-50">/ {exam.totalMarks}</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">Outstanding performer</div>
        </div>
      </div>

      {/* Question-Level Anomalies & Metrics. This used to sit alongside a "bulk PDF ZIP
          export" panel that was entirely fake — a setInterval-driven fake progress bar
          ending in a download link pointing at a literal example.com placeholder, no real
          PDF or ZIP ever generated. Removed outright: this app has no real PDF-generation
          pipeline (no library, no server endpoint) to make it real, and a fabricated
          "success" state for a destructive-looking export is actively misleading. */}
      <div className="my-8">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="text-base font-black tracking-tight text-slate-950 leading-tight">Question Item-Response Analytics</h3>
              <p className="text-xs text-slate-400 font-medium">
                Statistical anomalies indicator covering pass ratios, response latency patterns, and potential leak signals.
              </p>
            </div>
            <span className="flex items-center gap-1 bg-indigo-50 border border-indigo-150 text-indigo-700 text-[9px] font-black uppercase tracking-wider px-3 py-1 rounded-full font-mono w-fit">
              <Brain size={11} /> Mapped Items count: {questionAnalytics.length}
            </span>
          </div>

          {questionAnalytics.length === 0 ? (
            <div className="p-12 text-center bg-slate-50 border border-dashed rounded-3xl text-slate-400 text-xs font-semibold">
              Waiting for complete exam responses to process aggregation data.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {questionAnalytics.map((q, qIndex) => {
                const isAnomaly = q.status !== 'normal';

                return (
                  <div
                    key={q.id || qIndex}
                    className={`p-5 rounded-2xl border transition-all ${isAnomaly ? (q.status === 'anomaly-leak' ? 'bg-orange-50/40 border-orange-200 text-orange-950 shadow-md ring-1 ring-orange-100' : q.status === 'anomaly-hard' ? 'bg-rose-50/30 border-rose-200 text-rose-950' : 'bg-green-50/15 border-green-200 text-green-950') : 'bg-white border-slate-200 shadow-sm hover:border-slate-350'}`}
                  >
                    <div className="flex justify-between items-start gap-3">
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md font-mono">
                        Q-{qIndex + 1} &bull; {q.subject}
                      </span>

                      {q.status === 'anomaly-hard' && (
                        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest bg-rose-100/90 text-rose-800 border border-rose-200">
                          <AlertTriangle size={10} /> High Difficulty
                        </span>
                      )}
                      {q.status === 'anomaly-leak' && (
                        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest bg-orange-100/90 text-orange-850 border border-orange-250 animate-pulse">
                          <ShieldAlert size={10} /> Leak Suspicion
                        </span>
                      )}
                      {q.status === 'anomaly-easy' && (
                        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest bg-green-100/90 text-green-800 border border-green-200">
                          <Sparkles size={10} /> High Pass Ratio
                        </span>
                      )}
                      {q.status === 'normal' && (
                        <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest bg-slate-50 text-slate-500 border border-slate-150 font-mono">
                          Steady
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-800 font-bold line-clamp-2 mt-2.5 leading-snug">{q.text}</p>

                    <div className="grid grid-cols-3 gap-2 border-t border-slate-100 mt-3 pt-3 text-center text-[10px] font-mono leading-none">
                      <div className="p-1.5 bg-slate-50 border border-slate-100/40 rounded-lg">
                        <span className="text-[8px] text-slate-450 uppercase block font-sans mb-1 font-semibold">Checks</span>
                        <span className="font-extrabold text-slate-800">{q.attemptsCount}</span>
                      </div>
                      <div className="p-1.5 bg-slate-50 border border-slate-100/40 rounded-lg">
                        <span className="text-[8px] text-slate-450 uppercase block font-sans mb-1 font-semibold">Success</span>
                        <span className="font-extrabold text-slate-800">{Math.round(q.passRatio * 100)}%</span>
                      </div>
                      <div className="p-1.5 bg-slate-50 border border-slate-100/40 rounded-lg">
                        <span className="text-[8px] text-slate-450 uppercase block font-sans mb-1 font-semibold">Latency</span>
                        <span className="font-extrabold text-slate-800 flex items-center justify-center gap-0.5">
                          <Clock size={10} className="text-slate-400" /> {Math.round(q.avgTime)}s
                        </span>
                      </div>
                    </div>

                    {isAnomaly && (
                      <div className="text-[9px] font-semibold text-slate-600 mt-2.5 bg-slate-50 border border-slate-150 p-2 rounded-lg leading-normal flex items-start gap-1">
                        <AlertTriangle size={10} className="text-indigo-500 shrink-0 mt-0.5" />
                        <span>
                          <strong>Evaluation:</strong> {q.reason}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="pt-2">
        <h3 className="text-lg font-black tracking-tight text-slate-950 uppercase font-display leading-none">
          Student Roll-Sheet Rankings
        </h3>
        <p className="text-xs text-slate-500 font-medium">Section metrics sorted by score output.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="uppercase text-[10px] font-bold tracking-widest text-slate-500 py-4">Student Name</TableHead>
              <TableHead className="uppercase text-[10px] font-bold tracking-widest text-slate-500 py-4">Date & Time</TableHead>
              <TableHead className="text-right uppercase text-[10px] font-bold tracking-widest text-slate-500 py-4">Score</TableHead>
              <TableHead className="text-right uppercase text-[10px] font-bold tracking-widest text-slate-500 py-4">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attempts.map((a) => (
              <TableRow key={a.id} className="hover:bg-slate-50/50 transition-colors">
                <TableCell className="font-semibold text-slate-900 py-4">{a.studentName}</TableCell>
                <TableCell className="text-sm text-slate-500 py-4">{a.endTime ? new Date(a.endTime).toLocaleString() : 'N/A'}</TableCell>
                <TableCell className="text-right py-4">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${a.score / exam.totalMarks >= 0.4 ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}
                  >
                    {a.score} / {exam.totalMarks}
                  </span>
                </TableCell>
                <TableCell className="text-right py-4">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                      onClick={() => navigate(`/result/${a.id}`)}
                    >
                      View Details
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200 gap-1 font-bold text-xs cursor-pointer"
                      onClick={() => {
                        setAttemptToReset(a);
                        setResetDialogOpen(true);
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset Attempt
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {attempts.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="h-40 text-center text-slate-400 bg-slate-50/30">
                  No results found for this exam yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {totalAttemptsCount > 0 && (
          <div className="p-4 bg-slate-50 border-t border-slate-150 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="text-xs text-slate-500 font-bold">
              Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, totalAttemptsCount)} of {totalAttemptsCount} rankings
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-bold rounded-lg border-slate-200 cursor-pointer"
                disabled={page === 1 || loadingList}
                onClick={() => setPage(page - 1)}
              >
                Back
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-bold rounded-lg border-slate-200 cursor-pointer"
                disabled={page * pageSize >= totalAttemptsCount || loadingList}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Re-attempt Double-Verification Reset Dialog */}
      <ConfirmationDialog
        isOpen={resetDialogOpen}
        onClose={() => {
          setResetDialogOpen(false);
          setAttemptToReset(null);
        }}
        onConfirm={handleResetAttempt}
        title="Allow Re-attempt / Reset Exam"
        description={`This will permanently delete the current exam submission and all logged proctoring logs for ${attemptToReset?.studentName || 'this student'}. The student will be allowed to immediately take the exam again from scratch.`}
        itemName="RESET"
        confirmKeyword="RESET"
        isLoading={isResetting}
      />
    </div>
  );
};
