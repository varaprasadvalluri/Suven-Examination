import { describe, it, expect } from 'vitest';
import { buildNewExamDocument } from './examDocument';

const NOW = new Date('2026-09-12T08:00:00.000Z');

describe('buildNewExamDocument', () => {
  it('persists an unset release window as null, not an empty string', () => {
    const doc = buildNewExamDocument({ startTime: '', endTime: '', assignedSchoolIds: [] }, 'specific', 'admin-1', NOW);
    expect(doc.startTime).toBeNull();
    expect(doc.endTime).toBeNull();
  });

  // Which students can see an exam depends on this, so it is the field worth pinning.
  it('clears assignedSchoolIds for a global exam even if the form still holds selections', () => {
    const doc = buildNewExamDocument({ assignedSchoolIds: ['school-a', 'school-b'] }, 'global', 'admin-1', NOW);
    expect(doc.assignedSchoolIds).toEqual([]);
  });

  it('keeps the selected schools for a specific-cluster exam', () => {
    const doc = buildNewExamDocument({ assignedSchoolIds: ['school-a'] }, 'specific', 'admin-1', NOW);
    expect(doc.assignedSchoolIds).toEqual(['school-a']);
  });

  it('stamps creator, creation time and draft status', () => {
    const doc = buildNewExamDocument({ assignedSchoolIds: [] }, 'specific', 'admin-7', NOW);
    expect(doc).toMatchObject({ creatorId: 'admin-7', createdAt: NOW.toISOString(), status: 'draft' });
  });

  it('carries through the rest of the draft untouched', () => {
    const doc = buildNewExamDocument({ title: 'Physics', totalMarks: 50, assignedSchoolIds: [] }, 'specific', 'a', NOW);
    expect(doc).toMatchObject({ title: 'Physics', totalMarks: 50 });
  });
});
