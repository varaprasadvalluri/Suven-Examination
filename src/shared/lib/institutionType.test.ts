import { describe, it, expect } from 'vitest';
import { institutionProfile, INSTITUTION_TYPE_OPTIONS, INSTITUTION_TYPES, DEFAULT_INSTITUTION_TYPE } from './institutionType';

describe('institutionProfile', () => {
  // Every school record predates this field. They must keep reading as schools rather than
  // falling through to something blank, which is why there is a default at all.
  it.each([undefined, null, '', 'nonsense'])('falls back to school for %p', (value) => {
    expect(institutionProfile(value as string).label).toBe('School');
  });

  it('resolves each known type to its own vocabulary', () => {
    expect(institutionProfile('college').label).toBe('College');
    expect(institutionProfile('coaching').memberLabel).toBe('Candidate');
    expect(institutionProfile('corporate').labelPlural).toBe('Organisations');
  });

  // The affiliation board is a school-board concept; offering CBSE/ICSE to a coaching centre
  // is the assumption this whole module exists to remove.
  it('only schools have an affiliation board', () => {
    expect(institutionProfile('school').hasAffiliationBoard).toBe(true);
    for (const type of ['college', 'coaching', 'corporate']) {
      expect(institutionProfile(type).hasAffiliationBoard).toBe(false);
    }
  });

  it('offers every defined type as a pickable option', () => {
    expect(INSTITUTION_TYPE_OPTIONS.map((o) => o.value)).toEqual(Object.keys(INSTITUTION_TYPES));
    expect(INSTITUTION_TYPE_OPTIONS[0].value).toBe(DEFAULT_INSTITUTION_TYPE);
  });
});
