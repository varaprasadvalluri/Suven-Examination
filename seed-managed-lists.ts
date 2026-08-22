/**
 * One-off seed for the two new admin-managed named lists (subject_categories,
 * academic_levels) — see server/dao/createNamedListDao.ts. Both collections start empty in
 * production; without seeding, AdminCreateExam/AdminExams/ExamQuestions' Subject dropdown and
 * SchoolStudentOnboarding/SchoolCandidateOnboarding's Academic Level dropdown would render
 * empty on first load post-deploy, blocking admin/school from creating exams or onboarding
 * students. Idempotent — skips any name already present (case-insensitive), safe to re-run.
 *
 * Defaults to a DRY RUN. Pass --apply to actually persist.
 *
 * Usage:
 *   npx tsx seed-managed-lists.ts            # dry run, report only
 *   npx tsx seed-managed-lists.ts --apply     # actually write the seed values
 */
import './server/loadEnv';
import { clientDb, clientCollection, clientGetDocs } from './server/firestoreClient';
import { enqueueWrite } from './server/db/writeQueue';

const APPLY = process.argv.includes('--apply');

// The 7 values previously hardcoded in AdminCreateExam.tsx's SUBJECT_ICONS (the richer/
// canonical of the two conflicting hardcoded subject lists that existed before this feature).
const SUBJECT_CATEGORIES = ['Mathematics', 'Physics', 'Computer Science', 'English', 'General Knowledge', 'Psychology', 'Other'];

// The 15 values previously hardcoded as ACADEMIC_LEVELS in SchoolStudentOnboarding.tsx.
const ACADEMIC_LEVELS = [
  'Play Class',
  'LKG',
  'UKG',
  '1st Grade',
  '2nd Grade',
  '3rd Grade',
  '4th Grade',
  '5th Grade',
  '6th Grade',
  '7th Grade',
  '8th Grade',
  '9th Grade',
  '10th Grade',
  'Intermediate 1st Year',
  'Intermediate 2nd Year'
];

async function seedCollection(collectionName: string, names: string[]) {
  const snap = await clientGetDocs(clientCollection(clientDb, collectionName));
  const existingNames = new Set(snap.docs.map((d: any) => String(d.data()?.name || '').toLowerCase()));

  let created = 0;
  let skipped = 0;
  for (const name of names) {
    if (existingNames.has(name.toLowerCase())) {
      skipped++;
      continue;
    }
    console.log(`[seed] ${collectionName}: would create "${name}"`);
    if (APPLY) {
      await enqueueWrite({ type: 'add', collectionName, data: { name, createdAt: new Date().toISOString() } });
      created++;
    }
  }
  console.log(`[seed] ${collectionName}: ${APPLY ? `${created} created` : `${names.length - skipped} would be created`}, ${skipped} already present.`);
}

async function main() {
  console.log(`[seed] Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (report only)'}`);
  await seedCollection('subject_categories', SUBJECT_CATEGORIES);
  await seedCollection('academic_levels', ACADEMIC_LEVELS);
  if (!APPLY) {
    console.log('[seed] Dry run only — re-run with --apply to persist these values.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  });
