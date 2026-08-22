import { describe, it, expect } from 'vitest';
import { normalizePageParams, paginateInMemory, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination';

describe('normalizePageParams', () => {
  it('defaults to page 1 / DEFAULT_PAGE_SIZE when nothing is provided', () => {
    expect(normalizePageParams({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('passes through valid page/pageSize', () => {
    expect(normalizePageParams({ page: 3, pageSize: 25 })).toEqual({ page: 3, pageSize: 25 });
  });

  it('parses numeric strings (as arrive on req.query)', () => {
    expect(normalizePageParams({ page: '4', pageSize: '15' })).toEqual({ page: 4, pageSize: 15 });
  });

  it('falls back to page 1 for zero, negative, or non-numeric page', () => {
    expect(normalizePageParams({ page: 0 }).page).toBe(1);
    expect(normalizePageParams({ page: -5 }).page).toBe(1);
    expect(normalizePageParams({ page: 'not-a-number' }).page).toBe(1);
    expect(normalizePageParams({ page: undefined }).page).toBe(1);
  });

  it('falls back to DEFAULT_PAGE_SIZE for zero, negative, or non-numeric pageSize', () => {
    expect(normalizePageParams({ pageSize: 0 }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageParams({ pageSize: -10 }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageParams({ pageSize: 'nope' }).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it('caps pageSize at MAX_PAGE_SIZE — a client cannot ask for an unbounded page', () => {
    expect(normalizePageParams({ pageSize: 10000 }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(normalizePageParams({ pageSize: MAX_PAGE_SIZE }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(normalizePageParams({ pageSize: MAX_PAGE_SIZE + 1 }).pageSize).toBe(MAX_PAGE_SIZE);
  });
});

describe('paginateInMemory', () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1); // [1..25]

  it('slices the first page correctly', () => {
    const result = paginateInMemory(items, { page: 1, pageSize: 10 });
    expect(result).toEqual({ items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], page: 1, pageSize: 10, total: 25, totalPages: 3 });
  });

  it('slices a middle page correctly', () => {
    const result = paginateInMemory(items, { page: 2, pageSize: 10 });
    expect(result.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('slices the final, partial page correctly', () => {
    const result = paginateInMemory(items, { page: 3, pageSize: 10 });
    expect(result.items).toEqual([21, 22, 23, 24, 25]);
    expect(result.totalPages).toBe(3);
  });

  it('returns an empty items array for a page past the end, without erroring', () => {
    const result = paginateInMemory(items, { page: 10, pageSize: 10 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(25);
  });

  it('handles an empty input array — totalPages is 1, not 0, so callers can always render "page 1 of N"', () => {
    const result = paginateInMemory([], { page: 1, pageSize: 10 });
    expect(result).toEqual({ items: [], page: 1, pageSize: 10, total: 0, totalPages: 1 });
  });
});
