import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { requireSession } from '../auth/middleware';
import {
  clientDb,
  clientCollection,
  clientDoc,
  clientGetDoc,
  clientGetDocs,
  clientSetDoc,
  clientUpdateDoc,
  clientAddDoc
} from '../firestoreClient';

const router = express.Router();

/**
 * @openapi
 * /api/exams/{examId}:
 *   put:
 *     summary: Update an exam paper's metadata/schedule, and (if published) provision secure exam-entry links for its assigned schools
 *     description: Admin only.
 *     tags: [Exams]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: examId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               subject: { type: string }
 *               difficulty: { type: string }
 *               duration: { type: number }
 *               totalMarks: { type: number }
 *               startTime: { type: string, format: date-time, nullable: true }
 *               endTime: { type: string, format: date-time, nullable: true }
 *               assignedSchoolIds: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Exam updated (and secure links provisioned if the exam is published)
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not an admin
 *       404:
 *         description: Exam paper not found
 *       500:
 *         description: Server/Firestore error
 */
router.put('/api/exams/:examId', requireSession, async (req: any, res) => {
  const { examId } = req.params;
  const { title, description, subject, difficulty, duration, totalMarks, startTime, endTime, assignedSchoolIds } = req.body;

  try {
    const examRef = clientDoc(clientDb, 'exams', examId);
    const examSnap = await clientGetDoc(examRef);

    if (!examSnap.exists()) {
      return res.status(404).json({ error: 'Exam paper not found.' });
    }

    // Schools view exams/question papers only; only admins author them.
    if (req.auth.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: only admins may modify exams' });
    }

    const updateData: any = {
      title,
      description,
      subject,
      difficulty,
      duration: Number(duration) || 30,
      totalMarks: Number(totalMarks) || 100,
      startTime: startTime || null,
      endTime: endTime || null,
      assignedSchoolIds: assignedSchoolIds || []
    };

    await clientUpdateDoc(examRef, updateData);

    const examData = examSnap.data();
    if (examData?.status === 'published') {
      let schoolsToProvision = assignedSchoolIds || [];

      if (schoolsToProvision.length === 0) {
        const schoolsSnap = await clientGetDocs(clientCollection(clientDb, 'schools'));
        schoolsToProvision = schoolsSnap.docs.map((d) => d.id);
      }

      const expiresAt = endTime || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      for (const sId of schoolsToProvision) {
        const tokenDocId = `gen_${sId}_${examId}`;
        const tokenRef = clientDoc(clientDb, 'secure_exam_links', tokenDocId);
        const tokenSnap = await clientGetDoc(tokenRef);

        if (!tokenSnap.exists()) {
          const uuidToken = `tkn_${Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2)}`;
          await clientSetDoc(
            tokenRef,
            {
              id: uuidToken,
              examId,
              schoolId: sId,
              isActive: true,
              expiresAt,
              createdAt: new Date().toISOString()
            },
            { merge: true }
          );
        } else {
          await clientUpdateDoc(tokenRef, {
            expiresAt,
            isActive: true
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Exam paper, dates, and institutional cluster associations updated successfully.',
      updatedFields: updateData
    });
  } catch (err: any) {
    console.error('Error updating exam paper in Node:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

/**
 * @openapi
 * /api/exams/{examId}/import-doc:
 *   post:
 *     summary: Import questions into an exam from an uploaded .docx file (parsed via a python3 subprocess)
 *     description: Admin only. Server writes the decoded file to a temp path, runs `docx_parser.py` on it via execFile (args passed literally, no shell), then saves the parsed questions.
 *     tags: [Exams]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: examId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [base64Data, fileName]
 *             properties:
 *               base64Data: { type: string, description: Base64-encoded .docx file contents }
 *               fileName: { type: string }
 *               subject: { type: string }
 *     responses:
 *       200:
 *         description: Number of questions imported
 *       400:
 *         description: Missing base64Data/fileName, or the parser reported a failure
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not an admin
 *       404:
 *         description: Exam paper not found
 *       500:
 *         description: Parser execution failed, or its output couldn't be parsed/saved, or an unhandled error in the upload handler itself
 */
router.post('/api/exams/:examId/import-doc', requireSession, async (req: any, res) => {
  const { examId } = req.params;
  const { base64Data, fileName, subject } = req.body;

  if (!base64Data || !fileName) {
    return res.status(400).json({ error: 'Missing required parameters: base64Data or fileName.' });
  }

  const examSnapForAuth = await clientGetDoc(clientDoc(clientDb, 'exams', examId));
  if (!examSnapForAuth.exists()) {
    return res.status(404).json({ error: 'Exam paper not found.' });
  }
  // Schools view exams/question papers only; only admins author them.
  if (req.auth.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: only admins may modify exams' });
  }

  const tempDir = os.tmpdir ? os.tmpdir() : '/tmp';
  const uniqueName = `upload_${Date.now()}_${path.basename(fileName)}`;
  const tempFilePath = path.join(tempDir, uniqueName);

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempFilePath, buffer);

    const safeSubject = (subject || 'General').replace(/["'\\]/g, '');

    // execFile (not exec) passes each argument literally — no shell parsing, so examId/
    // fileName/subject can never break out into shell metacharacters (command injection).
    execFile(
      'python3',
      ['docx_parser.py', tempFilePath, examId, safeSubject],
      { env: { ...process.env } },
      async (error, stdout, stderr) => {
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (cleanupErr) {
          console.error('Temp file cleanup failed:', cleanupErr);
        }

        if (error) {
          console.error('Python docx_parser exec error:', error);
          console.error('Python stderr:', stderr);
          return res.status(500).json({ error: 'Document parser execution failed.', details: stderr });
        }

        try {
          const parsedDocResult = JSON.parse(stdout.trim());
          if (!parsedDocResult.success) {
            return res.status(400).json({ error: parsedDocResult.error || 'Document parsing returned failure status.' });
          }

          // Save parsed questions using Node Client SDK Firestore Reference
          const questionsRef = clientCollection(clientDb, 'questions');
          let savedCount = 0;

          for (const parsedQuestion of parsedDocResult.questions || []) {
            // `Number(x)` never actually returns null/undefined (missing/malformed input
            // becomes NaN instead), so `Number(parsedQuestion.correctAnswerIndex) ?? 0` never
            // falls back to 0 the way it looks like it should — a malformed import silently
            // stored NaN as the correct-answer index, making that question ungradeable-correct
            // for every student. Number.isFinite() is the actual check needed here.
            const parsedCorrectAnswerIndex = Number(parsedQuestion.correctAnswerIndex);
            const questionDoc = {
              text: parsedQuestion.text || 'Untitled Question',
              options: parsedQuestion.options || [],
              correctAnswerIndex: Number.isFinite(parsedCorrectAnswerIndex) ? parsedCorrectAnswerIndex : 0,
              marks: Number(parsedQuestion.marks) || 4,
              examId: examId,
              subject: parsedQuestion.subject || subject || 'General',
              type: parsedQuestion.type || 'single',
              numericalAnswer: String(parsedQuestion.numericalAnswer || ''),
              explanation: parsedQuestion.explanation || ''
            };
            await clientAddDoc(questionsRef, questionDoc);
            savedCount++;
          }

          return res.status(200).json({
            success: true,
            count: savedCount,
            message: `Successfully imported ${savedCount} questions to assessment.`
          });
        } catch (parseErr) {
          console.error('Failed to parse Python parser output or save questions:', stdout);
          return res.status(500).json({
            error: 'Invalid response from document parser or save questions failure.',
            rawOutput: stdout,
            details: stderr
          });
        }
      }
    );
  } catch (err: any) {
    console.error('Failed in document upload API handler:', err);
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (cleanupErr) {
      // Best-effort cleanup — a leftover temp file isn't worth failing the request over,
      // but silently swallowing it made a real disk/permissions problem invisible.
      console.warn('Failed to clean up temp upload file:', tempFilePath, cleanupErr);
    }
    return res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
