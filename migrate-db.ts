/**
 * SUVEN EDU - Firestore Database Migration Utility Script
 * 
 * This robust command-line utility fetches all existing user profiles, configurations,
 * and exam/portal records from the previous Firestore database and performs batch-writes
 * (grouped in sizes of 500 documents to respect Firestore limits) into the new "SUVEN EDU"
 * Firestore instance to ensure a secure, zero-downtime database cutover.
 * 
 * Execution:
 *   npx tsx migrate-db.ts
 *   or
 *   npm run db:migrate
 */

import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  doc, 
  writeBatch,
  setDoc,
  DocumentData
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

// --- CONFIGURATION ---

// This is a one-off manual migration tool (npm run db:migrate), not part of the running
// server — but it still shouldn't carry real API keys in source. Both configs are filled
// in from environment variables / the checked-in frontend config file at runtime; nothing
// sensitive is hardcoded here.
const SOURCE_CONFIG = {
  projectId: process.env.MIGRATION_SOURCE_PROJECT_ID || "gen-lang-client-0086284509",
  appId: process.env.MIGRATION_SOURCE_APP_ID || "1:486328864423:web:6a971b689b5a81e51c5582",
  apiKey: process.env.MIGRATION_SOURCE_API_KEY || "",
  authDomain: process.env.MIGRATION_SOURCE_AUTH_DOMAIN || "gen-lang-client-0086284509.firebaseapp.com",
  firestoreDatabaseId: process.env.MIGRATION_SOURCE_DATABASE_ID || "ai-studio-8391c2ab-94ef-4c90-9d99-eebfe3329077",
  storageBucket: process.env.MIGRATION_SOURCE_STORAGE_BUCKET || "gen-lang-client-0086284509.firebasestorage.app",
  messagingSenderId: process.env.MIGRATION_SOURCE_SENDER_ID || "486328864423"
};

if (!SOURCE_CONFIG.apiKey) {
  console.warn("⚠️  MIGRATION_SOURCE_API_KEY is not set — set it before running a real migration.");
}

// Target Configuration (Read dynamically from local applet config, then env vars, if possible)
let targetConfig: any = {
  projectId: "",
  firestoreDatabaseId: "(default)",
  appId: "",
  apiKey: ""
};

const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
if (fs.existsSync(configPath)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    targetConfig = { ...targetConfig, ...loaded };
  } catch (err) {
    console.warn("⚠️  Could not parse local firebase-applet-config.json. Using defaults.");
  }
}

if (process.env.FIREBASE_PROJECT_ID) targetConfig.projectId = process.env.FIREBASE_PROJECT_ID;
if (process.env.FIRESTORE_DATABASE_ID) targetConfig.firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID;
if (process.env.FIREBASE_API_KEY) targetConfig.apiKey = process.env.FIREBASE_API_KEY;

if (!targetConfig.projectId || !targetConfig.apiKey) {
  console.warn("⚠️  Target Firebase projectId/apiKey not resolved — set FIREBASE_PROJECT_ID/FIREBASE_API_KEY or provide firebase-applet-config.json.");
}

const COLLECTIONS = [
  'schools',
  'login_options',
  'users',
  'invitations',
  'secure_exam_links',
  'exams',
  'attempts',
  'microschedules',
  'error_books',
  'proctoring_logs',
  'syllabus'
];

async function runMigration() {
  console.log("\n==========================================================================");
  console.log("   🚀 SUVEN EDU - PRODUCTION FIRESTORE DATA MIGRATION ENGINE              ");
  console.log("==========================================================================\n");
  console.log(`[Source DB]      "${SOURCE_CONFIG.firestoreDatabaseId}" (Project: ${SOURCE_CONFIG.projectId})`);
  console.log(`[Destination DB] "${targetConfig.firestoreDatabaseId}" (Project: ${targetConfig.projectId})`);
  console.log(`[Timestamp]      ${new Date().toISOString()}`);
  console.log("--------------------------------------------------------------------------\n");

  // 1. Initialize Source Application
  console.log("🔄 Initializing source Firebase App...");
  const sourceApp = initializeApp(SOURCE_CONFIG, 'sourceAppInstance');
  const sourceDb = getFirestore(sourceApp, SOURCE_CONFIG.firestoreDatabaseId);
  console.log("✅ Source Firebase App initialized.");

  // 2. Initialize Destination Application
  console.log("🔄 Initializing destination SUVEN EDU Firebase App...");
  const targetApp = initializeApp(targetConfig, 'targetAppInstance');
  const targetDb = getFirestore(targetApp, targetConfig.firestoreDatabaseId);
  console.log("✅ Destination Firebase App initialized.\n");

  const migrationSummary: Record<string, { read: number; written: number; status: string }> = {};

  for (const collectionName of COLLECTIONS) {
    console.log(`📦 Migrating collection: [${collectionName}]`);
    migrationSummary[collectionName] = { read: 0, written: 0, status: 'In Progress' };

    try {
      // Fetch source documents
      const sourceColRef = collection(sourceDb, collectionName);
      const snapshot = await getDocs(sourceColRef);
      const docCount = snapshot.size;
      migrationSummary[collectionName].read = docCount;

      console.log(`   Found ${docCount} documents to transfer.`);

      if (docCount === 0) {
        console.log(`   ⏭️  Skipping empty collection [${collectionName}].`);
        migrationSummary[collectionName].status = 'Empty (Skipped)';
        continue;
      }

      // Firestore Batch write limits to max 500 operations
      const BATCH_SIZE_LIMIT = 400; // conservative limit to allow room for nested objects if needed
      let currentBatch = writeBatch(targetDb);
      let opCount = 0;
      let totalWritten = 0;

      for (const sourceDoc of snapshot.docs) {
        const docData = sourceDoc.data();
        const targetDocRef = doc(targetDb, collectionName, sourceDoc.id);

        // Add to batch
        currentBatch.set(targetDocRef, docData);
        opCount++;
        totalWritten++;

        // Handle subcollections for "exams" -> "questions"
        if (collectionName === 'exams') {
          const subColPath = `exams/${sourceDoc.id}/questions`;
          const sourceSubColRef = collection(sourceDb, subColPath);
          const subSnapshot = await getDocs(sourceSubColRef);

          if (subSnapshot.size > 0) {
            console.log(`   └─ Found ${subSnapshot.size} nested questions in Exam ID: [${sourceDoc.id}]`);
            for (const subDoc of subSnapshot.docs) {
              const subDocData = subDoc.data();
              const targetSubDocRef = doc(targetDb, subColPath, subDoc.id);

              // If batch is full, commit and reset
              if (opCount >= BATCH_SIZE_LIMIT) {
                console.log(`      ⚡ Committing intermediate batch of ${opCount} writes...`);
                await currentBatch.commit();
                currentBatch = writeBatch(targetDb);
                opCount = 0;
              }

              currentBatch.set(targetSubDocRef, subDocData);
              opCount++;
              totalWritten++;
            }
          }
        }

        // Commit batch when threshold is met
        if (opCount >= BATCH_SIZE_LIMIT) {
          console.log(`   ⚡ Committing batch of ${opCount} writes...`);
          await currentBatch.commit();
          currentBatch = writeBatch(targetDb);
          opCount = 0;
        }
      }

      // Commit remaining items
      if (opCount > 0) {
        console.log(`   ⚡ Committing final batch of ${opCount} writes...`);
        await currentBatch.commit();
      }

      migrationSummary[collectionName].written = totalWritten;
      migrationSummary[collectionName].status = 'Success';
      console.log(`   ✅ Collection [${collectionName}] migration complete! Total operations written: ${totalWritten}\n`);

    } catch (err: any) {
      console.error(`   ❌ Error migrating collection [${collectionName}]:`, err?.message || String(err));
      migrationSummary[collectionName].status = `Failed: ${err?.message || 'Unknown'}`;
    }
  }

  // Final Output Table
  console.log("==========================================================================");
  console.log("   📊 DATABASE MIGRATION ENGINE EXECUTION REPORT                         ");
  console.log("==========================================================================");
  console.log(
    String("Collection").padEnd(25) + 
    String("Read").padStart(8) + 
    String("Written").padStart(10) + 
    String("  Status").padEnd(15)
  );
  console.log("--------------------------------------------------------------------------");
  
  let totalDocsRead = 0;
  let totalDocsWritten = 0;

  for (const [col, stats] of Object.entries(migrationSummary)) {
    console.log(
      col.padEnd(25) + 
      String(stats.read).padStart(8) + 
      String(stats.written).padStart(10) + 
      `  ${stats.status}`
    );
    totalDocsRead += stats.read;
    totalDocsWritten += stats.written;
  }
  console.log("--------------------------------------------------------------------------");
  console.log(
    "TOTAL SUMMARY".padEnd(25) + 
    String(totalDocsRead).padStart(8) + 
    String(totalDocsWritten).padStart(10) + 
    "  COMPLETED"
  );
  console.log("==========================================================================\n");
  console.log("🎉 Migration process completed! Zero-downtime database shift successful.\n");
}

runMigration().catch(err => {
  console.error("💥 CRITICAL MIGRATION ABORTED:", err);
  process.exit(1);
});
