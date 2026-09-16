import { describe, it, expect } from 'vitest';
import { summarisePerformance } from './ranking';

const at = (over: Partial<Record<string, unknown>> = {}) => ({ status: 'completed', score: 50, accuracy: 50, ...over });

describe('summarisePerformance', () => {
  it('ignores attempts that are not completed', () => {
    const perf = summarisePerformance([at(), at({ status: 'in-progress', accuracy: 100 })]);
    expect(perf.examsAttended).toBe(1);
    expect(perf.averagePercentage).toBe(50);
  });

  it('averages accuracy and score independently', () => {
    const perf = summarisePerformance([at({ accuracy: 80, score: 40 }), at({ accuracy: 60, score: 20 })]);
    expect(perf.averagePercentage).toBe(70);
    expect(perf.averageScore).toBe(30);
  });

  // Older attempt rows predate the `accuracy` field; score is the documented fallback.
  it('falls back to score when accuracy is absent', () => {
    const perf = summarisePerformance([{ status: 'completed', score: 42 }]);
    expect(perf.averagePercentage).toBe(42);
  });

  it('reports improvement between the two most recent attempts, oldest-first ordered', () => {
    const perf = summarisePerformance([
      at({ accuracy: 90, endTime: '2026-03-02T00:00:00Z' }),
      at({ accuracy: 70, endTime: '2026-03-01T00:00:00Z' })
    ]);
    expect(perf.improvement).toBe('+20%');
  });

  it('signs a decline negatively', () => {
    const perf = summarisePerformance([
      at({ accuracy: 60, endTime: '2026-03-02T00:00:00Z' }),
      at({ accuracy: 75, endTime: '2026-03-01T00:00:00Z' })
    ]);
    expect(perf.improvement).toBe('-15%');
  });

  it.each([
    [0, '-'],
    [1, '+0%']
  ])('reports %i completed attempts as improvement %s', (count, expected) => {
    expect(summarisePerformance(Array.from({ length: count }, () => at())).improvement).toBe(expected);
  });

  it.each([
    [95, 'Elite'],
    [90, 'Elite'],
    [80, 'Advanced'],
    [75, 'Advanced'],
    [74, 'Rising'],
    [0, 'Rising']
  ])('tiers an average of %i%% as %s', (avg, tier) => {
    expect(summarisePerformance([at({ accuracy: avg })]).status).toBe(tier);
  });
});
