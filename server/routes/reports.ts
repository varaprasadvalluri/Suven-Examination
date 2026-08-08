import express from 'express';
import * as XLSX from 'xlsx';
import { requireSession, requireRole } from '../auth/middleware';
import { clientDb, clientCollection, clientQuery, clientWhere, clientLimit, clientGetDocs } from '../firestoreClient';

const router = express.Router();

// Generous ceiling for a single export — well above realistic near-term scale, but bounded
// so one request can't try to hold an unbounded number of docs in memory. Firestore's REST
// runQuery applies `limit` server-side (as long as no startAfter cursor is combined with
// it — see firestoreClient.ts), so this is one bounded call per collection, not N.
const MAX_EXPORT_ROWS = 300000;

// Consolidated Merit List export. Computed entirely server-side, directly from Firestore —
// deliberately NOT dependent on whatever the browser currently has loaded (the on-screen
// ranking table caps what it fetches for its own live-listener performance; export needs to
// keep working even as total students grow well past what's safe to hold in a browser tab).
router.post('/api/reports/merit-list-xlsx', requireSession, requireRole('admin', 'school'), async (req: any, res) => {
  // school role can only ever export their own school, regardless of what's sent —
  // same trust boundary authorizeWrite already applies to writes, applied here to reads.
  const requestedSchoolId = req.body?.schoolId;
  const effectiveSchoolId: string | undefined =
    req.auth.role === 'school' ? req.auth.schoolId : (requestedSchoolId && requestedSchoolId !== 'all' ? requestedSchoolId : undefined);

  try {
    const schoolsSnap = await clientGetDocs(clientCollection(clientDb, 'schools'));
    const schoolNameMap = new Map<string, string>();
    schoolsSnap.docs.forEach(d => schoolNameMap.set(d.id, (d.data() as any)?.name || d.id));

    const studentConstraints = [clientWhere('role', '==', 'student')];
    if (effectiveSchoolId) studentConstraints.push(clientWhere('schoolId', '==', effectiveSchoolId));
    const studentsSnap = await clientGetDocs(clientQuery(
      clientCollection(clientDb, 'users'),
      ...studentConstraints,
      clientLimit(MAX_EXPORT_ROWS)
    ));
    const students = studentsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

    const attemptConstraints = [clientWhere('status', '==', 'completed')];
    if (effectiveSchoolId) attemptConstraints.push(clientWhere('schoolId', '==', effectiveSchoolId));
    const attemptsSnap = await clientGetDocs(clientQuery(
      clientCollection(clientDb, 'attempts'),
      ...attemptConstraints,
      clientLimit(MAX_EXPORT_ROWS)
    ));
    const attempts = attemptsSnap.docs.map(d => (d.data() as any));

    const examsSnap = await clientGetDocs(clientCollection(clientDb, 'exams'));
    const examNameMap = new Map<string, string>();
    examsSnap.docs.forEach(d => examNameMap.set(d.id, (d.data() as any)?.title || d.id));

    const attemptsByStudent = new Map<string, any[]>();
    attempts.forEach(a => {
      if (!a.studentId) return;
      const list = attemptsByStudent.get(a.studentId) || [];
      list.push(a);
      attemptsByStudent.set(a.studentId, list);
    });

    // Same aggregation as RankingEngine.tsx's combinedRankings (average score/percentage,
    // trend between the two most recent attempts) — kept in sync deliberately, this is the
    // one other place that logic lives.
    const rows = students.map((stud: any) => {
      const studAttempts = attemptsByStudent.get(stud.id) || [];
      const examsAttended = studAttempts.length;

      let averagePercentage = 0;
      let averageScore = 0;
      if (examsAttended > 0) {
        const totalAccuracy = studAttempts.reduce((sum, a) => sum + (a.accuracy !== undefined ? a.accuracy : (a.score || 0)), 0);
        averagePercentage = Math.round(totalAccuracy / examsAttended);
        const totalScore = studAttempts.reduce((sum, a) => sum + (a.score || 0), 0);
        averageScore = Math.round(totalScore / examsAttended);
      }

      let improvement = '-';
      if (examsAttended >= 2) {
        const sorted = [...studAttempts].sort((a, b) => {
          const tA = a.endTime ? new Date(a.endTime).getTime() : 0;
          const tB = b.endTime ? new Date(b.endTime).getTime() : 0;
          return tA - tB;
        });
        const latest = sorted[sorted.length - 1];
        const prev = sorted[sorted.length - 2];
        const accLatest = latest.accuracy !== undefined ? latest.accuracy : (latest.score || 0);
        const accPrev = prev.accuracy !== undefined ? prev.accuracy : (prev.score || 0);
        const diff = Math.round(accLatest - accPrev);
        improvement = `${diff >= 0 ? '+' : ''}${diff}%`;
      } else if (examsAttended === 1) {
        improvement = '+0%';
      }

      const examNames = studAttempts
        .map(a => examNameMap.get(a.examId) || a.examId)
        .filter(Boolean)
        .join(', ');

      return {
        name: stud.name || 'Autonomous Candidate',
        rollNumber: stud.rollNumber || '',
        className: stud.class || '',
        section: stud.section || '',
        score: averageScore,
        percentile: averagePercentage,
        examsAttended,
        examNames,
        improvement,
        branch: stud.schoolName || schoolNameMap.get(stud.schoolId) || 'Autonomous Hub',
        status: averagePercentage >= 90 ? 'Elite' : averagePercentage >= 75 ? 'Advanced' : 'Rising'
      };
    });

    rows.sort((a, b) => b.percentile - a.percentile || b.score - a.score);

    const sheetRows = rows.map((r, i) => ({
      'Rank': i + 1,
      'Name': r.name,
      'Roll No.': r.rollNumber,
      'Class': r.className,
      'Section': r.section,
      'Score': r.score,
      'Percentage': r.percentile,
      'Exams Attended': r.examsAttended,
      'Exam Names': r.examNames,
      'Trend': r.improvement,
      'Branch': r.branch,
      'Status': r.status
    }));

    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    worksheet['!cols'] = [
      { wch: 6 }, { wch: 28 }, { wch: 14 }, { wch: 8 }, { wch: 8 },
      { wch: 8 }, { wch: 12 }, { wch: 15 }, { wch: 40 }, { wch: 10 }, { wch: 24 }, { wch: 12 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Merit List');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const filename = `Consolidated_Merit_List_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(buffer);
  } catch (err: any) {
    console.error('[Merit List Export] Failed to generate XLSX:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
