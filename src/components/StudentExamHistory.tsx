import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, doc, getDoc, collection, query, where, orderBy, limit, startAfter, getDocs, getCountFromServer, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, FileQuestion, Trophy } from 'lucide-react';

// Dedicated per-student exam history — split out from the ranking table's old inline
// expand-row (which held every exam a student ever took in browser memory at once, capped
// at 5 per row). This screen fetches one page of a single student's attempts at a time
// directly from Firestore, so it stays fast and correct no matter how many exams a student
// accumulates over years, instead of the old approach that couldn't scale a student's own
// history past a small in-memory slice.
export const StudentExamHistory: React.FC = () => {
  const { studentId } = useParams<{ studentId: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [studentProfile, setStudentProfile] = useState<any | null>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [lastVisibleDocs, setLastVisibleDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) return;
    getDoc(doc(db, 'users', studentId)).then(snap => {
      if (snap.exists()) setStudentProfile({ id: snap.id, ...snap.data() });
    }).catch(err => console.error('Failed to load student profile:', err));
  }, [studentId]);

  useEffect(() => {
    if (!studentId) return;
    setPage(1);
    setLastVisibleDocs([]);
  }, [studentId, pageSize]);

  useEffect(() => {
    if (!studentId) return;

    const loadPage = async () => {
      setLoading(true);
      setError(null);
      try {
        const countQ = query(
          collection(db, 'attempts'),
          where('studentId', '==', studentId),
          where('status', '==', 'completed')
        );
        const countSnap = await getCountFromServer(countQ);
        setTotalCount(countSnap.data().count);

        let attemptsQ = query(
          collection(db, 'attempts'),
          where('studentId', '==', studentId),
          where('status', '==', 'completed'),
          orderBy('endTime', 'desc'),
          limit(pageSize)
        );

        if (page > 1) {
          const cursorDoc = lastVisibleDocs[page - 2];
          if (cursorDoc) {
            attemptsQ = query(attemptsQ, startAfter(cursorDoc));
          }
        }

        const snap = await getDocs(attemptsQ);
        const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setAttempts(fetched);

        if (snap.docs.length > 0) {
          const lastDoc = snap.docs[snap.docs.length - 1];
          setLastVisibleDocs(prev => {
            const updated = [...prev];
            updated[page - 1] = lastDoc;
            return updated;
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'attempts');
        setError('Failed to load exam history.');
      } finally {
        setLoading(false);
      }
    };

    loadPage();
  }, [studentId, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="space-y-6 pb-16">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer"
      >
        <ArrowLeft size={14} /> Back to Merit List
      </button>

      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          <Trophy size={24} />
        </div>
        <div>
          <h2 className="text-2xl font-display font-black text-slate-900 tracking-tight">
            {studentProfile?.name || 'Student'} <span className="text-slate-400 font-medium">— Exam History</span>
          </h2>
          <p className="text-xs text-slate-500 font-semibold">
            {studentProfile?.rollNumber ? `Roll No. ${studentProfile.rollNumber}` : ''}
            {studentProfile?.rollNumber && studentProfile?.schoolName ? ' • ' : ''}
            {studentProfile?.schoolName || ''}
            {totalCount > 0 ? ` • ${totalCount} exam${totalCount === 1 ? '' : 's'} attended` : ''}
          </p>
        </div>
      </div>

      <Card className="shadow-2xl shadow-slate-200/50 border-0 rounded-[32px] overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50/70 border-b border-slate-100">
              <tr>
                <th className="px-6 py-3.5 text-left font-sans text-xs uppercase font-black tracking-wider text-slate-500">Exam</th>
                <th className="px-6 py-3.5 text-center font-sans text-xs uppercase font-black tracking-wider text-slate-500 w-28">Score</th>
                <th className="px-6 py-3.5 text-center font-sans text-xs uppercase font-black tracking-wider text-slate-500 w-32">Percentage</th>
                <th className="px-6 py-3.5 text-right font-sans text-xs uppercase font-black tracking-wider text-slate-500">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-indigo-500 mx-auto" />
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center text-rose-600 font-semibold text-sm">{error}</td>
                </tr>
              ) : attempts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center text-slate-400">
                    <FileQuestion className="h-8 w-8 mx-auto mb-2" />
                    <p className="text-sm font-semibold">No completed exams found.</p>
                  </td>
                </tr>
              ) : (
                attempts.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-3.5 font-sans font-bold text-slate-800 text-sm">{a.examTitle || 'Untitled Exam'}</td>
                    <td className="px-6 py-3.5 text-center font-bold text-slate-900">{Math.round(a.score || 0)}</td>
                    <td className="px-6 py-3.5 text-center">
                      <span className="text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full text-xs font-bold">
                        {Math.round(a.accuracy !== undefined ? a.accuracy : (a.score || 0))}%
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right text-slate-400 font-sans text-xs">
                      {a.endTime ? new Date(a.endTime).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-50/20">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Rows per page:</span>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="h-8 text-xs font-bold border border-slate-200 rounded-lg px-2 bg-white"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-100 cursor-pointer"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-100 cursor-pointer"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
};
