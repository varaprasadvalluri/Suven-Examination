import { scoreExam, StudentAnswer } from '../../shared/examScoring';
import { orderQuestionsForAttempt } from '../../shared/examQuestionOrder';
import { clientDb, clientCollection, clientQuery, clientWhere, clientGetDocs, clientDoc, clientGetDoc } from '../firestoreClient';
import { logger } from './logger';

// ANSWER-KEY CACHE — the difference between grading an exam and re-reading it once per student.
//
// Every attempt used to re-query the full question set for its exam. Grading runs as a burst
// immediately after an exam window closes, and every attempt in that burst belongs to one of a
// handful of exams, so a 100-question paper sat by 100,000 students cost 10,000,000 document
// reads to grade — all of them re-reading the same hundred documents.
//
// A question paper is immutable while its attempts are being graded (admins author exams, and
// editing one mid-grading would invalidate the grades regardless), so a short TTL is safe here
// in a way it would not be for student data.
const ANSWER_KEY_TTL_MS = 5 * 60 * 1000;

interface AnswerKeyEntry {
  expiry: number;
  questions: any[];
}

const answerKeyCache = new Map<string, AnswerKeyEntry>();
// In-flight requests are shared, not just completed ones. Without this, the first moment of a
// grading burst is a stampede: several hundred tasks all miss the empty cache in the same tick
// and each fires its own identical query before any of them has an answer to store.
const answerKeyInFlight = new Map<string, Promise<any[]>>();

async function getAnswerKey(examId: string): Promise<any[]> {
  const cached = answerKeyCache.get(examId);
  if (cached && cached.expiry > Date.now()) return cached.questions;

  const alreadyFetching = answerKeyInFlight.get(examId);
  if (alreadyFetching) return alreadyFetching;

  const fetchPromise = (async () => {
    const questionsSnap = await clientGetDocs(clientQuery(clientCollection(clientDb, 'questions'), clientWhere('examId', '==', examId)));
    const questions = questionsSnap.docs.map((questionDoc: any) => ({ id: questionDoc.id, ...questionDoc.data() }));
    answerKeyCache.set(examId, { expiry: Date.now() + ANSWER_KEY_TTL_MS, questions });
    return questions;
  })();

  answerKeyInFlight.set(examId, fetchPromise);
  try {
    return await fetchPromise;
  } catch (err) {
    // Nothing was cached, so the next caller retries rather than inheriting this failure.
    logger.warn('Answer-key fetch failed', { examId, error: err });
    throw err;
  } finally {
    answerKeyInFlight.delete(examId);
  }
}

// Exported for tests, and usable as an operational escape hatch if a question paper genuinely
// has to be corrected while its attempts are still being graded.
export function __resetAnswerKeyCache() {
  answerKeyCache.clear();
  answerKeyInFlight.clear();
}

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

  const questions = await getAnswerKey(examId);
  const orderedQuestions = orderQuestionsForAttempt(questions as any[], attemptDocId);

  return scoreExam(orderedQuestions as any, answers, {
    studentId: attemptData.studentId,
    examId,
    examSubject: attemptData.examTitle
  });
}
