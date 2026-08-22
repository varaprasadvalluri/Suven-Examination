/**
 * One-off backfill: recomputes score/accuracy for every completed attempt using the current
 * scoreExam() rules (src/lib/examScoring.ts) — now negative-marking-free — and overwrites the
 * stored score/accuracy where they differ. Existing completed attempts were graded under the
 * old (buggy, then briefly quarter-mark) negative-marking rules and never get rescored on
 * their own; this is the one-time catch-up pass.
 *
 * IMPORTANT: `accuracy` (correctCount/totalQuestions) is NOT affected by negative marking at
 * all — it can only change here if the attempt's stored `answers` now pair with a DIFFERENT
 * set of questions than at grading time (orderQuestionsForAttempt reshuffles the exam's
 * CURRENT question list; if that exam's questions were added/removed/edited since the student
 * took it, the seeded order shifts and answers[idx] lines up with the wrong question). That is
 * a much bigger risk than a marking-policy fix — it means re-grading against a different exam
 * paper than the student actually sat. So by default this script only WRITES attempts whose
 * accuracy is unchanged (pure negative-marking fix, unambiguous); attempts where accuracy would
 * also move are always reported but never written unless --include-accuracy-changes is passed
 * explicitly, after you've confirmed why that exam's grading would differ.
 *
 * Defaults to a DRY RUN — reports every attempt whose score/accuracy would change, writes
 * nothing. Pass --apply to actually persist the corrected scores (accuracy-unchanged ones only).
 *
 * Usage:
 *   npx tsx backfill-attempt-scores.ts                          # dry run, report only
 *   npx tsx backfill-attempt-scores.ts --apply                  # write the safe (accuracy-unchanged) subset
 *   npx tsx backfill-attempt-scores.ts --apply --examId=EXAM_ID # scope to one exam
 *   npx tsx backfill-attempt-scores.ts --apply --include-accuracy-changes --examId=EXAM_ID
 *                                                                # also write accuracy-changed attempts, once reviewed
 */
import './server/loadEnv';
import { clientDb, clientCollection, clientQuery, clientWhere, clientGetDocs } from './server/firestoreClient';
import { enqueueWrite } from './server/db/writeQueue';
import { scoreExam } from './src/lib/examScoring';
import { orderQuestionsForAttempt } from './src/lib/examQuestionOrder';

const APPLY = process.argv.includes('--apply');
const INCLUDE_ACCURACY_CHANGES = process.argv.includes('--include-accuracy-changes');
const examIdArg = process.argv.find((a) => a.startsWith('--examId='));
const SCOPE_EXAM_ID = examIdArg ? examIdArg.split('=')[1] : undefined;

async function main() {
  console.log(`[backfill] Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (report only)'}${SCOPE_EXAM_ID ? `, scoped to examId=${SCOPE_EXAM_ID}` : ''}`);

  const constraints = [clientWhere('status', '==', 'completed')];
  if (SCOPE_EXAM_ID) constraints.push(clientWhere('examId', '==', SCOPE_EXAM_ID));
  const attemptsSnap = await clientGetDocs(clientQuery(clientCollection(clientDb, 'attempts'), ...constraints));
  const attempts = attemptsSnap.docs.map((d: any) => ({ id: d.id, data: d.data() }));
  console.log(`[backfill] Found ${attempts.length} completed attempt(s) to check.`);

  // Cache exam questions per examId — many attempts share the same exam, and re-fetching per
  // attempt would multiply Firestore reads by attempt count instead of exam count.
  const questionsByExam = new Map<string, any[]>();
  async function getQuestions(examId: string) {
    if (!questionsByExam.has(examId)) {
      const snap = await clientGetDocs(clientQuery(clientCollection(clientDb, 'questions'), clientWhere('examId', '==', examId)));
      questionsByExam.set(
        examId,
        snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
      );
    }
    return questionsByExam.get(examId)!;
  }

  let writtenSafe = 0;
  let reportedNeedsReview = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const attempt of attempts) {
    const data = attempt.data as any;
    const examId = data.examId;
    if (!examId) {
      skipped++;
      continue;
    }

    const questions = await getQuestions(examId);
    if (questions.length === 0) {
      skipped++;
      continue;
    }

    const orderedQuestions = orderQuestionsForAttempt(questions as any[], attempt.id);
    const result = scoreExam(orderedQuestions as any, data.answers || [], {
      studentId: data.studentId,
      examId,
      examSubject: data.examTitle
    });

    const oldScore = Number(data.score || 0);
    const oldAccuracy = Number(data.accuracy || 0);
    const scoreDiff = Math.abs(result.score - oldScore) > 0.001;
    const accuracyDiff = Math.abs(result.accuracy - oldAccuracy) > 0.001;

    if (!scoreDiff && !accuracyDiff) {
      unchanged++;
      continue;
    }

    const label = accuracyDiff ? 'NEEDS REVIEW (accuracy would also change — question set may have changed since grading)' : 'safe';
    console.log(
      `[backfill] [${label}] ${attempt.id} (student=${data.studentId}, exam=${examId}): score ${oldScore} -> ${result.score}, accuracy ${oldAccuracy.toFixed(1)} -> ${result.accuracy.toFixed(1)}`
    );

    if (accuracyDiff && !INCLUDE_ACCURACY_CHANGES) {
      reportedNeedsReview++;
      continue;
    }

    if (APPLY) {
      await enqueueWrite({
        type: 'update',
        collectionName: 'attempts',
        docId: attempt.id,
        data: { score: result.score, accuracy: result.accuracy }
      });
    }
    writtenSafe++;
  }

  console.log(
    `[backfill] Done. ${writtenSafe} ${APPLY ? 'written' : 'would be written'}, ${reportedNeedsReview} flagged for review (not written), ${unchanged} already correct, ${skipped} skipped (no examId/questions).`
  );
  if (!APPLY && writtenSafe > 0) {
    console.log('[backfill] Dry run only — re-run with --apply to persist these changes.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] Failed:', err);
    process.exit(1);
  });
