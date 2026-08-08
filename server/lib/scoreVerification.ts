import { scoreExam, StudentAnswer } from '../../src/lib/examScoring';
import { clientDb, clientCollection, clientQuery, clientWhere, clientGetDocs, clientDoc, clientGetDoc } from '../firestoreClient';

// Recomputes score/accuracy server-side from the real answer key on every exam submission, so
// the persisted grade is never just whatever the client sent — a student's browser (or a direct
// API call) cannot be trusted to self-report its own score. Reuses scoreExam() (the same
// function ExamInterface.tsx calls client-side for the student's own live result view) rather
// than reimplementing scoring rules, so behavior stays identical to what examScoring.test.ts
// already covers. Trusts the client's submitted `answers` themselves — a student legitimately
// picking a wrong option isn't tampering — only the grading output derived from them.
export async function recomputeAttemptScore(attemptDocId: string, answers: StudentAnswer[]) {
  const attemptSnap = await clientGetDoc(clientDoc(clientDb, 'attempts', attemptDocId));
  if (!attemptSnap.exists()) {
    throw new Error('Cannot verify score: attempt does not exist');
  }
  const attemptData = attemptSnap.data() as any;
  const examId = attemptData.examId;

  const questionsSnap = await clientGetDocs(
    clientQuery(clientCollection(clientDb, 'questions'), clientWhere('examId', '==', examId))
  );
  const questions = questionsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

  return scoreExam(questions as any, answers, {
    studentId: attemptData.studentId,
    examId,
    examSubject: attemptData.examTitle
  });
}
