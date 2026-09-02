import { describe, it, expect, beforeEach } from 'vitest';
import { mockLoadTestStore } from './loadTestStore';

beforeEach(() => {
  mockLoadTestStore.clear();
});

describe('mockLoadTestStore', () => {
  it('stores and returns what a load-test write put there', () => {
    mockLoadTestStore.set('attempts_att_1', { status: 'started' });
    expect(mockLoadTestStore.get('attempts_att_1')).toEqual({ status: 'started' });
    expect(mockLoadTestStore.get('attempts_missing')).toBeUndefined();
  });

  it('stops growing once it is full, instead of holding every identity a run ever created', () => {
    // A 50k-student run writes two entries per student — a profile and an attempt — and the
    // bare Map this replaced never dropped any of them, so the store stayed resident on every
    // worker the run touched, competing for memory with the write queue's own backlog.
    for (let i = 0; i < 60000; i++) {
      mockLoadTestStore.set(`users_std_${i}`, { uid: `std_${i}` });
    }

    expect(mockLoadTestStore.size).toBe(50000);
    // Oldest-first: a load test only ever cares about the identities it is currently driving.
    expect(mockLoadTestStore.get('users_std_0')).toBeUndefined();
    expect(mockLoadTestStore.get('users_std_59999')).toEqual({ uid: 'std_59999' });
  });

  it('keeps an identity alive while it is still being written to', () => {
    mockLoadTestStore.set('users_hot', { uid: 'hot' });
    for (let i = 0; i < 49999; i++) {
      mockLoadTestStore.set(`users_cold_${i}`, { uid: `cold_${i}` });
    }
    // Re-writing moves it to the newest position, so an in-flight simulated student cannot age
    // out from under the run that is still driving it.
    mockLoadTestStore.set('users_hot', { uid: 'hot', updated: true });
    for (let i = 0; i < 10000; i++) {
      mockLoadTestStore.set(`users_later_${i}`, { uid: `later_${i}` });
    }

    expect(mockLoadTestStore.get('users_hot')).toEqual({ uid: 'hot', updated: true });
  });
});
