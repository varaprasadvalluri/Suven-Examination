import express from 'express';
import { requireSession } from '../../auth/middleware';
import { attemptDao } from '../../dao';
import { normalizePageParams, paginateInMemory } from '../../dao/pagination';
import { asyncHandler } from '../../middleware/errorHandler';
import { getAccessibleExamCandidates, getUpcomingListItems } from '../../services/StudentDashboardService';

const router = express.Router();

// Pure request/response glue — all business logic (which exams a student can see/attempt)
// lives in server/services/StudentDashboardService.ts. This controller only extracts
// params, enforces who's allowed to view what, and shapes the HTTP response.

// Self or admin only — deliberately NOT extended to 'school' the way AttemptController's
// single-attempt lookup is. This dashboard aggregates across a student's whole attempt/
// invitation history with no per-record schoolId check, so a blanket "school can view any
// studentId" here would let School A read School B's student's exam status by guessing an
// ID. Schools already have their own scoped monitoring views (StudentExamHistory,
// SchoolStudentOnboarding's per-student history dialog) — this endpoint is the student's
// own view of their own data.
function canView(req: any, studentId: string): boolean {
  return req.auth.role === 'admin' || req.auth.uid === studentId;
}

// The single exam the compact Dashboard view's "In Progress" card shows — just the top
// candidate from getAccessibleExamCandidates.
/**
 * @openapi
 * /api/v1/students/{studentId}/exams/status:
 *   get:
 *     summary: Get the top "in progress" exam candidate for a student's compact dashboard card
 *     description: >
 *       Self or admin only — deliberately not extended to the 'school' role, since this
 *       aggregates across a student's whole history with no per-record schoolId check.
 *     tags: [Student Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The top in-progress exam candidate, or null
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     inProgress: { type: object, nullable: true }
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Not this student's own dashboard and not admin
 */
router.get(
  '/api/v1/students/:studentId/exams/status',
  requireSession,
  asyncHandler(async (req: any, res) => {
    const { studentId } = req.params;
    if (!canView(req, studentId)) {
      return res.status(403).json({ error: 'Forbidden: you may only view your own dashboard' });
    }

    const candidates = await getAccessibleExamCandidates(studentId, req.auth.role === 'student' ? req.auth.schoolId : null);
    const topInProgressCandidate = candidates[0] || null;
    return res.status(200).json({ success: true, data: { inProgress: topInProgressCandidate } });
  })
);

// Full "My Exams" list (the Upcoming tab): triggered exams the student can actually attempt,
// PLUS a locked preview of exams published for their school that haven't been triggered yet
// — subject only, nothing else, and definitely no attempt access.
/**
 * @openapi
 * /api/v1/students/{studentId}/exams:
 *   get:
 *     summary: Full "My Exams" list for a student's dashboard (Upcoming tab), paginated
 *     description: >
 *       Self or admin only. Includes triggered exams the student can actually attempt, plus
 *       a locked preview (subject only) of exams published for their school but not yet
 *       triggered.
 *     tags: [Student Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of exam items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items: { type: array, items: { type: object } }
 *                     page: { type: integer }
 *                     pageSize: { type: integer }
 *                     total: { type: integer }
 *                     totalPages: { type: integer }
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Not this student's own dashboard and not admin
 */
router.get(
  '/api/v1/students/:studentId/exams',
  requireSession,
  asyncHandler(async (req: any, res) => {
    const { studentId } = req.params;
    if (!canView(req, studentId)) {
      return res.status(403).json({ error: 'Forbidden: you may only view your own exams' });
    }

    const { page, pageSize } = normalizePageParams(req.query);
    const schoolId = req.auth.role === 'student' ? req.auth.schoolId : null;

    const items = await getUpcomingListItems(studentId, schoolId);
    const paginatedUpcomingExams = paginateInMemory(items, { page, pageSize });
    return res.status(200).json({ success: true, data: paginatedUpcomingExams });
  })
);

// Paginated completed-exam history — the part of a student's dashboard that actually grows
// unbounded over their lifetime, so it's the one that needs real pagination.
/**
 * @openapi
 * /api/v1/students/{studentId}/attempts:
 *   get:
 *     summary: Paginated completed-attempt history for a student
 *     description: Self or admin only. The part of a student's dashboard that grows unbounded over their lifetime, so it's the one endpoint here with real (DB-level) pagination rather than in-memory.
 *     tags: [Student Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: Filter to a single attempt status, e.g. 'completed'.
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of attempts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     items: { type: array, items: { type: object } }
 *                     page: { type: integer }
 *                     pageSize: { type: integer }
 *                     total: { type: integer }
 *                     totalPages: { type: integer }
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Not this student's own dashboard and not admin
 */
router.get(
  '/api/v1/students/:studentId/attempts',
  requireSession,
  asyncHandler(async (req: any, res) => {
    const { studentId } = req.params;
    if (!canView(req, studentId)) {
      return res.status(403).json({ error: 'Forbidden: you may only view your own attempts' });
    }

    const { status } = req.query;
    const { page, pageSize } = normalizePageParams(req.query);

    const paginatedAttempts = await attemptDao.findByStudent(studentId, {
      status: typeof status === 'string' ? status : undefined,
      page,
      pageSize
    });
    return res.status(200).json({ success: true, data: paginatedAttempts });
  })
);

export default router;
