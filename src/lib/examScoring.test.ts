import { describe, it, expect } from 'vitest';
import { scoreExam } from './examScoring';
import type { Question } from '../types';

function q(overrides: Partial<Question> & { id: string }): Question {
  return {
    text: 'Q',
    options: ['A', 'B', 'C', 'D'],
    correctAnswerIndex: 0,
    marks: 4,
    type: 'single',
    ...overrides
  };
}

const meta = { studentId: 'stu1', examId: 'exam1', examSubject: 'Physics' };

describe('scoreExam', () => {
  it('awards marks and counts correct for a right single-choice answer', () => {
    const questions = [q({ id: 'q1', correctAnswerIndex: 2, marks: 4 })];
    const result = scoreExam(questions, [2], meta);
    expect(result.score).toBe(4);
    expect(result.correctCount).toBe(1);
    expect(result.errorBookEntries).toHaveLength(0);
    expect(result.accuracy).toBe(100);
  });

  it('applies -1 negative marking for a wrong single-choice answer and logs an error-book entry', () => {
    const questions = [q({ id: 'q1', correctAnswerIndex: 2, marks: 4 })];
    const result = scoreExam(questions, [0], meta);
    expect(result.score).toBe(0); // clamped at 0, started at 0 - 1
    expect(result.correctCount).toBe(0);
    expect(result.errorBookEntries).toHaveLength(1);
    expect(result.errorBookEntries[0]).toMatchObject({
      questionId: 'q1',
      selectedAnswer: 0,
      correctAnswer: 2,
      subject: 'Physics'
    });
  });

  it('never lets score go negative even with several wrong answers in a row', () => {
    const questions = [
      q({ id: 'q1', correctAnswerIndex: 0 }),
      q({ id: 'q2', correctAnswerIndex: 0 }),
      q({ id: 'q3', correctAnswerIndex: 0 })
    ];
    const result = scoreExam(questions, [1, 1, 1], meta);
    expect(result.score).toBe(0);
    expect(result.errorBookEntries).toHaveLength(3);
  });

  it('does not penalize or log an unanswered question', () => {
    const questions = [q({ id: 'q1', correctAnswerIndex: 0, marks: 4 })];
    const result = scoreExam(questions, [null], meta);
    expect(result.score).toBe(0);
    expect(result.correctCount).toBe(0);
    expect(result.errorBookEntries).toHaveLength(0);
  });

  it('scores a multiple-choice question correct when the answer array includes the correct index', () => {
    const questions = [q({ id: 'q1', type: 'multiple', correctAnswerIndex: 1, marks: 4 })];
    const result = scoreExam(questions, [[0, 1, 3]], meta);
    expect(result.score).toBe(4);
    expect(result.correctCount).toBe(1);
  });

  it('scores a multiple-choice question incorrect and joins the selected answers for the error book', () => {
    const questions = [q({ id: 'q1', type: 'multiple', correctAnswerIndex: 1, marks: 4 })];
    const result = scoreExam(questions, [[0, 2]], meta);
    expect(result.score).toBe(0);
    expect(result.errorBookEntries[0].selectedAnswer).toBe('0, 2');
  });

  it('scores a numerical answer correct via trimmed string comparison', () => {
    const questions = [q({ id: 'q1', type: 'numerical', numericalAnswer: '3.14', marks: 4 })];
    const result = scoreExam(questions, ['  3.14  '], meta);
    expect(result.score).toBe(4);
    expect(result.correctCount).toBe(1);
  });

  it('does not apply negative marking to a wrong numerical answer', () => {
    const questions = [q({ id: 'q1', type: 'numerical', numericalAnswer: '3.14', marks: 4 })];
    const result = scoreExam(questions, ['2.71'], meta);
    expect(result.score).toBe(0);
    expect(result.errorBookEntries).toHaveLength(1);
  });

  it('computes accuracy as percent of questions answered correctly, and 0 for an empty question set', () => {
    const questions = [q({ id: 'q1', correctAnswerIndex: 0 }), q({ id: 'q2', correctAnswerIndex: 0 })];
    const result = scoreExam(questions, [0, 1], meta);
    expect(result.accuracy).toBe(50);
    expect(scoreExam([], [], meta).accuracy).toBe(0);
  });
});
