import { scoreExam, StudentAnswer } from '../../shared/examScoring';
import { orderQuestionsForAttempt } from '../../shared/examQuestionOrder';
import { clientDb, clientCollection, clientQuery, clientWhere, clientGetDocs, clientDoc, clientGetDoc } from '../firestoreClient';

/**
 * Recomputes score/accuracy server-side from the real answer key on every exam submission, so
 * the persisted grade is never just whatever the client sent — a student's browser (or a direct
 * API call) cannot be trusted to self-report its own score. Reuses scoreExam() (the same
 * function ExamInterface.tsx calls client-side for the student's own live result view) rather
 * than reimplementing scoring rules, so behavior stays identical to what examScoring.test.ts
 * already covers. Trusts the client's submitted `answers` themselves — a student legitimately
 * picking a wrong option isn't tampering — only the grading output derived from them.
 *
 * Must run the fetched questions through orderQuestionsForAttempt before scoring — scoreExam
 * pairs answers[idx] with questions[idx] purely by array position, and `answers` was recorded
 * against the student's per-attempt SHUFFLED question order (ExamInterface.tsx), not Firestore's
 * arbitrary/undefined query order. Skipping this reorder (as this function used to) pairs each
 * answer with a different, unrelated question — silently producing wrong scores: real correct
 * answers marked wrong, real wrong answers marked correct, depending on how the shuffle and
 * Firestore's returned order happen to diverge for that attempt.
 *
 * This is a plain exported function, not a class. It has no state to encapsulate and no
 * interface to satisfy, so wrapping it in a `ScoreVerificationService` and then immediately
 * unwrapping it again with `.bind()` was ceremony in both directions. AuthorizationService and
 * QueryCacheService keep their classes because they own real mutable state (the owner-
 * verification cache, the query cache) — a stateless operation doesn't need one.
 */
export async function recomputeAttemptScore(attemptDocId: string, answers: StudentAnswer[]) {
  const attemptSnap = await clientGetDoc(clientDoc(clientDb, 'attempts', attemptDocId));
  if (!attemptSnap.exists()) {
    throw new Error('Cannot verify score: attempt does not exist');
  }
  const attemptData = attemptSnap.data() as any;
  const examId = attemptData.examId;

  const questionsSnap = await clientGetDocs(clientQuery(clientCollection(clientDb, 'questions'), clientWhere('examId', '==', examId)));
  const questions = questionsSnap.docs.map((questionDoc: any) => ({ id: questionDoc.id, ...questionDoc.data() }));
  const orderedQuestions = orderQuestionsForAttempt(questions as any[], attemptDocId);

  return scoreExam(orderedQuestions as any, answers, {
    studentId: attemptData.studentId,
    examId,
    examSubject: attemptData.examTitle
  });
}
