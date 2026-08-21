import { scoreExam, StudentAnswer } from '../../src/lib/examScoring';
import { orderQuestionsForAttempt } from '../../src/lib/examQuestionOrder';
import { clientDb, clientCollection, clientQuery, clientWhere, clientGetDocs, clientDoc, clientGetDoc } from '../firestoreClient';

// Single stateless operation — there's no shared/mutable state here to encapsulate, so this
// class exists only for consistency with the other server/lib and server/services modules
// (which do have real state or multiple related operations to group). If this file ever
// grows a second related operation or its own state, this is where it'd go.
class ScoreVerificationService {
  // Recomputes score/accuracy server-side from the real answer key on every exam submission, so
  // the persisted grade is never just whatever the client sent — a student's browser (or a direct
  // API call) cannot be trusted to self-report its own score. Reuses scoreExam() (the same
  // function ExamInterface.tsx calls client-side for the student's own live result view) rather
  // than reimplementing scoring rules, so behavior stays identical to what examScoring.test.ts
  // already covers. Trusts the client's submitted `answers` themselves — a student legitimately
  // picking a wrong option isn't tampering — only the grading output derived from them.
  //
  // Must run the fetched questions through orderQuestionsForAttempt before scoring — scoreExam
  // pairs answers[idx] with questions[idx] purely by array position, and `answers` was recorded
  // against the student's per-attempt SHUFFLED question order (ExamInterface.tsx), not Firestore's
  // arbitrary/undefined query order. Skipping this reorder (as this function used to) pairs each
  // answer with a different, unrelated question — silently producing wrong scores: real correct
  // answers marked wrong, real wrong answers marked correct, depending on how the shuffle and
  // Firestore's returned order happen to diverge for that attempt.
  async recomputeAttemptScore(attemptDocId: string, answers: StudentAnswer[]) {
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
}

export const scoreVerificationService = new ScoreVerificationService();

// Backward-compatible named export — every existing call site keeps working unchanged.
export const recomputeAttemptScore = scoreVerificationService.recomputeAttemptScore.bind(scoreVerificationService);
