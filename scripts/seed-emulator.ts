/**
 * Copies a slice of the real Firestore database into the local emulator.
 *
 * A freshly started emulator is empty, so the app comes up with no schools, no exams and no
 * students to sign in as. This pulls just enough to exercise the flows that matter locally —
 * above all exam entry, which is the one path that cannot run without an emulator or real
 * credentials (it opens a Firestore transaction; see server/config.ts's emulator note).
 *
 * READS the real project over the same unauthenticated REST + API key path the app itself uses
 * — which is allowed for plain document reads, and is why this needs no gcloud login. WRITES
 * only ever go to the emulator: the destination URL is built from FIRESTORE_EMULATOR_HOST and
 * the script refuses to run without it, so it cannot write to production even by mistake.
 *
 *   npm run emulator            # terminal 1
 *   npm run seed:emulator       # terminal 2, once
 *   npm run dev:emulator        # terminal 3
 *
 * Re-running overwrites the documents it copies and leaves anything else in the emulator alone.
 */
import '../server/loadEnv';
import { firebaseConfig, firestoreEmulatorHost, isFirestoreEmulated } from '../server/config';

// Per collection, how many documents to copy at most. The point is a working local dataset, not
// a clone — a few hundred documents is plenty to click through every screen.
const PER_COLLECTION_LIMIT = 300;

// Everything the exam-entry and dashboard flows touch. `questions` is the big one: an exam is
// unusable without its questions, so it gets a larger share of the budget.
const COLLECTIONS: { name: string; limit?: number }[] = [
  { name: 'schools' },
  { name: 'users' },
  { name: 'exams' },
  { name: 'questions', limit: 2000 },
  { name: 'invitations' },
  { name: 'secure_exam_links' },
  { name: 'attempts' },
  { name: 'login_options' },
  { name: 'syllabus' },
  { name: 'subject_categories' },
  { name: 'academic_levels' }
];

const SOURCE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
const TARGET = `http://${firestoreEmulatorHost}/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

/**
 * Reads a collection with `:runQuery`, the structured-query endpoint — NOT the plain
 * "list documents" endpoint.
 *
 * That distinction is the whole reason this works without credentials: the project's deployed
 * security rules refuse a bare collection listing (403 on every collection), while the same
 * data comes back fine through a structured query, which is the path the app's own db proxy
 * uses. Response is a streamed array of `{ document }` entries, with entries carrying no
 * document when the result set is empty.
 */
async function readCollection(collection: string, limit: number): Promise<any[]> {
  const response = await fetch(`${SOURCE}:runQuery?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], limit } })
  });
  if (!response.ok) {
    throw new Error(`read ${collection}: ${response.status} ${await response.text()}`);
  }

  const rows = (await response.json()) as { document?: any }[];
  return rows.filter((row) => row.document).map((row) => row.document);
}

// The emulator takes the same document shape back verbatim — `fields` is copied across as-is,
// so no value conversion is needed in either direction.
async function writeDoc(collection: string, docId: string, fields: any) {
  const response = await fetch(`${TARGET}/${collection}/${encodeURIComponent(docId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields })
  });
  if (!response.ok) {
    throw new Error(`write ${collection}/${docId}: ${response.status} ${await response.text()}`);
  }
}

async function copyCollection(collection: string, limit: number): Promise<number> {
  const documents = await readCollection(collection, limit);

  // Written in parallel batches: a few hundred sequential PATCHes against a local emulator is
  // slow for no reason, and the emulator handles concurrent writes fine.
  const BATCH = 25;
  for (let i = 0; i < documents.length; i += BATCH) {
    await Promise.all(
      documents.slice(i, i + BATCH).map((doc) => {
        const docId = String(doc.name).split('/').pop() as string;
        return writeDoc(collection, docId, doc.fields || {});
      })
    );
  }

  return documents.length;
}

async function main() {
  // The guard that makes this script safe to run without reading it first.
  if (!isFirestoreEmulated) {
    console.error('FIRESTORE_EMULATOR_HOST is not set — refusing to run so this can never write to the real database.');
    console.error('Start the emulator (npm run emulator), then: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed:emulator');
    process.exit(1);
  }
  if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
    console.error('FIREBASE_PROJECT_ID / FIREBASE_API_KEY must be set to read the source data. See .env.example.');
    process.exit(1);
  }

  console.log(
    `Seeding emulator at ${firestoreEmulatorHost} from project ${firebaseConfig.projectId}/${firebaseConfig.firestoreDatabaseId}\n`
  );

  let total = 0;
  for (const { name, limit } of COLLECTIONS) {
    try {
      const copied = await copyCollection(name, limit ?? PER_COLLECTION_LIMIT);
      total += copied;
      console.log(`  ${name.padEnd(20)} ${copied}`);
    } catch (err: any) {
      // One missing or unreadable collection should not abandon the rest of the seed — the
      // dataset is still useful without, say, syllabus.
      console.warn(`  ${name.padEnd(20)} skipped (${err?.message || err})`);
    }
  }

  console.log(`\nDone — ${total} documents. The emulator UI is at http://127.0.0.1:4000/firestore`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
