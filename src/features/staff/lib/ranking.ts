/**
 * Per-student aggregation behind the merit list.
 *
 * RankingEngine builds its table from two passes — registered candidates, then students who
 * only appear via a completed attempt — and each pass carried its own copy of this maths:
 * the averages, the improvement trend, and the tier thresholds. Three numbers that decide a
 * published merit position, duplicated, is the shape of a ranking that disagrees with itself
 * depending on which pass a student happened to arrive through.
 */

export interface RankableAttempt {
  status?: string;
  score?: number;
  accuracy?: number;
  endTime?: string | number | Date | null;
}

export interface StudentPerformance {
  examsAttended: number;
  averageScore: number;
  averagePercentage: number;
  /** Signed percentage-point change between the two most recent attempts, e.g. "+4%". */
  improvement: string;
  status: 'Elite' | 'Advanced' | 'Rising';
}

// An attempt records `accuracy` once graded; older rows only carry `score`, so score is the
// documented fallback rather than an accident.
function accuracyOf(attempt: RankableAttempt): number {
  return attempt.accuracy !== undefined ? attempt.accuracy : attempt.score || 0;
}

function tierFor(averagePercentage: number): StudentPerformance['status'] {
  if (averagePercentage >= 90) return 'Elite';
  if (averagePercentage >= 75) return 'Advanced';
  return 'Rising';
}

export function summarisePerformance(attempts: RankableAttempt[]): StudentPerformance {
  const completed = attempts.filter((a) => a.status === 'completed');
  const examsAttended = completed.length;

  let averagePercentage = 0;
  let averageScore = 0;
  if (examsAttended > 0) {
    averagePercentage = Math.round(completed.reduce((sum, a) => sum + accuracyOf(a), 0) / examsAttended);
    averageScore = Math.round(completed.reduce((sum, a) => sum + (a.score || 0), 0) / examsAttended);
  }

  let improvement = '-';
  if (examsAttended >= 2) {
    const oldestFirst = [...completed].sort((a, b) => {
      const timeA = a.endTime ? new Date(a.endTime).getTime() : 0;
      const timeB = b.endTime ? new Date(b.endTime).getTime() : 0;
      return timeA - timeB;
    });
    const diff = Math.round(accuracyOf(oldestFirst[oldestFirst.length - 1]) - accuracyOf(oldestFirst[oldestFirst.length - 2]));
    improvement = `${diff >= 0 ? '+' : ''}${diff}%`;
  } else if (examsAttended === 1) {
    improvement = '+0%';
  }

  return { examsAttended, averageScore, averagePercentage, improvement, status: tierFor(averagePercentage) };
}
