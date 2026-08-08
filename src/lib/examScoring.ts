import type { Question } from '../types';

export type StudentAnswer = number | string | number[] | null | undefined;

export interface ScoringMeta {
  studentId: string;
  examId: string;
  examSubject?: string;
}

export interface ErrorBookEntry {
  studentId: string;
  examId: string;
  questionId: string;
  questionText: string;
  selectedAnswer: string | number;
  correctAnswer: string | number;
  subject: string;
  explanation: string;
  imageUrl: string;
  createdAt: string;
}

export interface ScoringResult {
  score: number;
  correctCount: number;
  accuracy: number;
  errorBookEntries: ErrorBookEntry[];
}

// Pulled out of ExamInterface.tsx's handleSubmit so this correctness-critical logic (single/
// multiple/numerical scoring, negative marking, error-book entries) can be unit tested without
// mounting the whole exam-taking component. Behavior must stay byte-identical to what it
// replaced — see examScoring.test.ts.
export function scoreExam(
  questions: Question[],
  answers: StudentAnswer[],
  meta: ScoringMeta
): ScoringResult {
  let score = 0;
  let correctCount = 0;
  const errorBookEntries: ErrorBookEntry[] = [];

  questions.forEach((q, idx) => {
    const studentAns = answers[idx];
    const qType = q.type || 'single';
    let isCorrect = false;

    if (qType === 'numerical') {
      isCorrect = studentAns !== null && studentAns !== undefined &&
        String(studentAns).trim() === String(q.numericalAnswer || '').trim();
    } else if (qType === 'multiple') {
      if (Array.isArray(studentAns)) {
        isCorrect = studentAns.includes(q.correctAnswerIndex);
      } else {
        isCorrect = studentAns === q.correctAnswerIndex;
      }
    } else {
      isCorrect = studentAns === q.correctAnswerIndex;
    }

    if (isCorrect) {
      score += q.marks;
      correctCount++;
    } else if (studentAns !== null && studentAns !== undefined) {
      // Negative marking deduction (-1) for incorrect single or multiple choice MCQs
      if (qType !== 'numerical') {
        score = Math.max(0, score - 1);
      }

      errorBookEntries.push({
        studentId: meta.studentId,
        examId: meta.examId,
        questionId: q.id || idx.toString(),
        questionText: q.text,
        selectedAnswer: qType === 'numerical' ? String(studentAns) : (Array.isArray(studentAns) ? studentAns.join(', ') : studentAns as string | number),
        correctAnswer: qType === 'numerical' ? String(q.numericalAnswer) : q.correctAnswerIndex,
        subject: q.subject || meta.examSubject || 'General',
        explanation: q.explanation || "Review the step-by-step formula and solution logic.",
        imageUrl: q.imageUrl || "",
        createdAt: new Date().toISOString()
      });
    }
  });

  const accuracy = questions.length > 0 ? (correctCount / questions.length) * 100 : 0;

  return { score, correctCount, accuracy, errorBookEntries };
}
