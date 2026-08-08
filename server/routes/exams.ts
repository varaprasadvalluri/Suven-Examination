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
        schoolsToProvision = schoolsSnap.docs.map(d => d.id);
      }

      const expiresAt = endTime || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      for (const sId of schoolsToProvision) {
        const tokenDocId = `gen_${sId}_${examId}`;
        const tokenRef = clientDoc(clientDb, 'secure_exam_links', tokenDocId);
        const tokenSnap = await clientGetDoc(tokenRef);

        if (!tokenSnap.exists()) {
          const uuidToken = `tkn_${Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2)}`;
          await clientSetDoc(tokenRef, {
            id: uuidToken,
            examId,
            schoolId: sId,
            isActive: true,
            expiresAt,
            createdAt: new Date().toISOString()
          }, { merge: true });
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
    console.error("Error updating exam paper in Node:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

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
    execFile('python3', ['docx_parser.py', tempFilePath, examId, safeSubject], { env: { ...process.env } }, async (error, stdout, stderr) => {
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (cleanupErr) {
        console.error("Temp file cleanup failed:", cleanupErr);
      }

      if (error) {
        console.error("Python docx_parser exec error:", error);
        console.error("Python stderr:", stderr);
        return res.status(500).json({ error: 'Document parser execution failed.', details: stderr });
      }

      try {
        const result = JSON.parse(stdout.trim());
        if (!result.success) {
          return res.status(400).json({ error: result.error || 'Document parsing returned failure status.' });
        }

        // Save parsed questions using Node Client SDK Firestore Reference
        const questionsRef = clientCollection(clientDb, 'questions');
        let savedCount = 0;

        for (const q of result.questions || []) {
          const questionDoc = {
            text: q.text || "Untitled Question",
            options: q.options || [],
            correctAnswerIndex: Number(q.correctAnswerIndex) ?? 0,
            marks: Number(q.marks) || 4,
            examId: examId,
            subject: q.subject || subject || 'General',
            type: q.type || 'single',
            numericalAnswer: String(q.numericalAnswer || ''),
            explanation: q.explanation || ''
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
        console.error("Failed to parse Python parser output or save questions:", stdout);
        return res.status(500).json({
          error: 'Invalid response from document parser or save questions failure.',
          rawOutput: stdout,
          details: stderr
        });
      }
    });

  } catch (err: any) {
    console.error("Failed in document upload API handler:", err);
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (ignore) {}
    return res.status(550).json({ error: err.message || String(err) });
  }
});

export default router;
