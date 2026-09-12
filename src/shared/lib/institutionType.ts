/**
 * What kind of organisation a tenant is.
 *
 * Every tenant used to be assumed to be a school: the onboarding form hardcoded an
 * `Affiliation Board` (CBSE/ICSE/…), which is meaningless for a coaching centre or a
 * corporate training department, and the UI said "School" everywhere.
 *
 * This deliberately does NOT rename the tenant key. `schoolId` appears 517 times across 60
 * files and in 5 composite Firestore indexes, and it identifies live records — renaming it
 * would be a migration over every user, attempt and invitation for no new capability. The
 * internal key stays stable; only the vocabulary shown to people is data-driven.
 */
export type InstitutionType = 'school' | 'college' | 'coaching' | 'corporate';

export interface InstitutionProfile {
  /** Singular noun for one tenant, e.g. "School". */
  label: string;
  /** Plural, for list and nav headings. */
  labelPlural: string;
  /** What this kind of tenant calls the people who sit exams. */
  memberLabel: string;
  /** Whether an affiliation board (CBSE/ICSE/IB/…) is a meaningful field here. */
  hasAffiliationBoard: boolean;
  /** Placeholder for the name field, so the example matches the kind of organisation. */
  namePlaceholder: string;
}

export const INSTITUTION_TYPES: Record<InstitutionType, InstitutionProfile> = {
  school: {
    label: 'School',
    labelPlural: 'Schools',
    memberLabel: 'Student',
    hasAffiliationBoard: true,
    namePlaceholder: 'e.g. Delhi Public School, R.K. Puram'
  },
  college: {
    label: 'College',
    labelPlural: 'Colleges',
    memberLabel: 'Student',
    // Colleges are affiliated to a university rather than a school board, and the existing
    // board list does not describe them — better to omit than to offer wrong options.
    hasAffiliationBoard: false,
    namePlaceholder: 'e.g. St. Xavier’s College, Mumbai'
  },
  coaching: {
    label: 'Coaching Centre',
    labelPlural: 'Coaching Centres',
    memberLabel: 'Candidate',
    hasAffiliationBoard: false,
    namePlaceholder: 'e.g. Aakash Institute, Kota'
  },
  corporate: {
    label: 'Organisation',
    labelPlural: 'Organisations',
    memberLabel: 'Candidate',
    hasAffiliationBoard: false,
    namePlaceholder: 'e.g. Infosys — Learning & Development'
  }
};

/**
 * Records created before institutionType existed carry no value at all, and every one of them
 * is a school. Defaulting here rather than backfilling keeps this a pure additive change.
 */
export const DEFAULT_INSTITUTION_TYPE: InstitutionType = 'school';

export function institutionProfile(type: InstitutionType | string | null | undefined): InstitutionProfile {
  return INSTITUTION_TYPES[(type as InstitutionType) ?? DEFAULT_INSTITUTION_TYPE] ?? INSTITUTION_TYPES[DEFAULT_INSTITUTION_TYPE];
}

/** Options for a type picker, in the order they are offered. */
export const INSTITUTION_TYPE_OPTIONS = (Object.keys(INSTITUTION_TYPES) as InstitutionType[]).map((value) => ({
  value,
  label: INSTITUTION_TYPES[value].label
}));
