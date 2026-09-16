import express from 'express';
import * as XLSX from 'xlsx';
import { requireSession, requireRole } from '../middleware/requireSession';
import {
  clientDb,
  clientCollection,
  clientQuery,
  clientWhere,
  clientLimit,
  clientGetDocs,
  clientGetDoc,
  clientDoc,
  clientSelect
} from '../../../out/firestore/firestoreClient';
import { asyncHandler } from '../middleware/errorHandler';

const router = express.Router();

// Ceiling for a single export. Bounded so one request cannot try to hold an unbounded number
// of documents in memory; Firestore's REST runQuery applies `limit` server-side, so this is
// one bounded call per collection, not N.
//
// The number alone was never the whole story. An `attempts` document carries the student's
// entire `answers[]`, so at this cap the export was fetching, parsing and retaining hundreds
// of thousands of full answer sets — gigabytes in a 4Gi container — to compute an average
// score. Every query below is now PROJECTED to the handful of fields the report actually
// reads, which is what makes the cap survivable rather than merely stated.
const MAX_EXPORT_ROWS = 300000;

// Name lookups only, and only when the caller is exporting across every school. A school-role
// caller (and an admin who named one school) needs exactly one school document, not the
// collection — that read used to be unbounded regardless of scope.
const MAX_NAME_LOOKUP_ROWS = 5000;

/**
 * @openapi
 * /api/reports/merit-list-xlsx:
 *   post:
 *     summary: Export a consolidated merit-list ranking report as an XLSX file
 *     description: >
 *       Admin or school role. Computed entirely server-side from Firestore, bounded to
 *       MAX_EXPORT_ROWS (300,000) per collection — not dependent on whatever the browser's
 *       live ranking table currently has loaded. A 'school' caller is always scoped to their
 *       own schoolId regardless of what's sent in the request body; only 'admin' may pass an
 *       explicit schoolId (or omit it / pass 'all' for every school).
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               schoolId: { type: string, description: "Admin only. Omit or 'all' for every school." }
 *     responses:
 *       200:
 *         description: XLSX file stream (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not admin/school
 *       500:
 *         description: Server/Firestore error, or XLSX generation failure
 */
// Consolidated Merit List export. Computed entirely server-side, directly from Firestore —
// deliberately NOT dependent on whatever the browser currently has loaded (the on-screen
// ranking table caps what it fetches for its own live-listener performance; export needs to
// keep working even as total students grow well past what's safe to hold in a browser tab).
router.post(
  ['/api/v1/reports/merit-list', '/api/reports/merit-list-xlsx'],
  requireSession,
  requireRole('admin', 'school'),
  asyncHandler(async (req: any, res) => {
    // school role can only ever export their own school, regardless of what's sent —
    // same trust boundary authorizeWrite already applies to writes, applied here to reads.
    const requestedSchoolId = req.body?.schoolId;
    const effectiveSchoolId: string | undefined =
      req.auth.role === 'school' ? req.auth.schoolId : requestedSchoolId && requestedSchoolId !== 'all' ? requestedSchoolId : undefined;

    const schoolNameMap = new Map<string, string>();
    if (effectiveSchoolId) {
      const schoolSnap = await clientGetDoc(clientDoc(clientDb, 'schools', effectiveSchoolId));
      schoolNameMap.set(effectiveSchoolId, (schoolSnap.exists() ? (schoolSnap.data() as any)?.name : null) || effectiveSchoolId);
    } else {
      const schoolsSnap = await clientGetDocs(
        clientQuery(clientCollection(clientDb, 'schools'), clientSelect('name'), clientLimit(MAX_NAME_LOOKUP_ROWS))
      );
      schoolsSnap.docs.forEach((d: any) => schoolNameMap.set(d.id, (d.data() as any)?.name || d.id));
    }

    const studentConstraints = [clientWhere('role', '==', 'student')];
    if (effectiveSchoolId) studentConstraints.push(clientWhere('schoolId', '==', effectiveSchoolId));
    const studentsSnap = await clientGetDocs(
      clientQuery(
        clientCollection(clientDb, 'users'),
        ...studentConstraints,
        // Must list every field the row builder below reads — a projection silently returns
        // undefined for anything omitted, so a missing name here becomes a blank column in the
        // exported sheet rather than an error. 'section' feeds the Section column, 'schoolName'
        // the Branch column's first fallback.
        clientSelect('name', 'rollNumber', 'schoolId', 'class', 'section', 'schoolName'),
        clientLimit(MAX_EXPORT_ROWS)
      )
    );
    const students = studentsSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));

    const attemptConstraints = [clientWhere('status', '==', 'completed')];
    if (effectiveSchoolId) attemptConstraints.push(clientWhere('schoolId', '==', effectiveSchoolId));
    const attemptsSnap = await clientGetDocs(
      clientQuery(
        clientCollection(clientDb, 'attempts'),
        ...attemptConstraints,
        // Everything the aggregation below touches, and nothing else. Without the projection
        // each row also dragged in `answers[]`, `timePerQuestion` and the proctoring fields.
        clientSelect('studentId', 'examId', 'score', 'accuracy', 'endTime'),
        clientLimit(MAX_EXPORT_ROWS)
      )
    );
    const attempts = attemptsSnap.docs.map((d: any) => d.data() as any);

    const examsSnap = await clientGetDocs(
      clientQuery(clientCollection(clientDb, 'exams'), clientSelect('title'), clientLimit(MAX_NAME_LOOKUP_ROWS))
    );
    const examNameMap = new Map<string, string>();
    examsSnap.docs.forEach((d: any) => examNameMap.set(d.id, (d.data() as any)?.title || d.id));

    const attemptsByStudent = new Map<string, any[]>();
    attempts.forEach((a: any) => {
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
        const totalAccuracy = studAttempts.reduce((sum, a) => sum + (a.accuracy !== undefined ? a.accuracy : a.score || 0), 0);
        averagePercentage = Math.round(totalAccuracy / examsAttended);
        const totalScore = studAttempts.reduce((sum, a) => sum + (a.score || 0), 0);
        averageScore = Math.round(totalScore / examsAttended);
      }

      let improvement = '-';
      if (examsAttended >= 2) {
        const sorted = [...studAttempts].sort((a, b) => {
          const endTimeA = a.endTime ? new Date(a.endTime).getTime() : 0;
          const endTimeB = b.endTime ? new Date(b.endTime).getTime() : 0;
          return endTimeA - endTimeB;
        });
        const latest = sorted[sorted.length - 1];
        const prev = sorted[sorted.length - 2];
        const accLatest = latest.accuracy !== undefined ? latest.accuracy : latest.score || 0;
        const accPrev = prev.accuracy !== undefined ? prev.accuracy : prev.score || 0;
        const diff = Math.round(accLatest - accPrev);
        improvement = `${diff >= 0 ? '+' : ''}${diff}%`;
      } else if (examsAttended === 1) {
        improvement = '+0%';
      }

      const examNames = studAttempts
        .map((a) => examNameMap.get(a.examId) || a.examId)
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

    rows.sort((a: any, b: any) => b.percentile - a.percentile || b.score - a.score);

    const sheetRows = rows.map((r: any, i: number) => ({
      Rank: i + 1,
      Name: r.name,
      'Roll No.': r.rollNumber,
      Class: r.className,
      Section: r.section,
      Score: r.score,
      Percentage: r.percentile,
      'Exams Attended': r.examsAttended,
      'Exam Names': r.examNames,
      Trend: r.improvement,
      Branch: r.branch,
      Status: r.status
    }));

    const worksheet = XLSX.utils.json_to_sheet(sheetRows);
    worksheet['!cols'] = [
      { wch: 6 },
      { wch: 28 },
      { wch: 14 },
      { wch: 8 },
      { wch: 8 },
      { wch: 8 },
      { wch: 12 },
      { wch: 15 },
      { wch: 40 },
      { wch: 10 },
      { wch: 24 },
      { wch: 12 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Merit List');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const filename = `Consolidated_Merit_List_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(buffer);
  })
);

export default router;
