import express from 'express';
import { requireSession, requireRole } from '../auth/middleware';
import { firebaseConfig } from '../config';
import { clientDb, clientCollection, clientDoc, clientGetDocs, clientSetDoc, clientWriteBatch } from '../firestoreClient';
import { asyncHandler } from '../middleware/errorHandler';
import { InternalServerError } from '../lib/errors';

const router = express.Router();

// CLOUD DATABASE FIRESTORE MIGRATION GATEWAY
/**
 * @openapi
 * /api/db/migrate:
 *   post:
 *     summary: Migrate Firestore collections (schools, users, exams, attempts, etc., including nested exam questions) from a source project to this app's current database
 *     description: >
 *       Admin only. NOTE — this route currently has pre-existing TypeScript errors
 *       (getApps/initializeClientApp/getClientFirestore are referenced but not imported),
 *       unrelated to this documentation pass and not fixed here; the route as written will
 *       not compile/run until that's addressed.
 *     tags: [Admin DB]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sourceConfigOverride:
 *                 type: object
 *                 description: Optional Firebase config for the source project; defaults to a hardcoded legacy project config if omitted
 *     responses:
 *       200:
 *         description: Migration logs and per-collection document counts
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not an admin
 *       500:
 *         description: Migration failed
 */
router.post(
  '/api/db/migrate',
  requireSession,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { sourceConfigOverride } = req.body;

    // Default to the previous Firebase configuration details
    const sourceConfig = sourceConfigOverride || {
      projectId: 'gen-lang-client-0086284509',
      appId: '1:486328864423:web:6a971b689b5a81e51c5582',
      apiKey: 'AIzaSyD-AzMGuVYnFwhFLOStoerl21LSD7vkIvc',
      authDomain: 'gen-lang-client-0086284509.firebaseapp.com',
      firestoreDatabaseId: 'ai-studio-8391c2ab-94ef-4c90-9d99-eebfe3329077',
      storageBucket: 'gen-lang-client-0086284509.firebasestorage.app',
      messagingSenderId: '486328864423'
    };

    const logs: string[] = [];
    const stats: Record<string, number> = {};

    const addLog = (msg: string) => {
      const timestamp = new Date().toLocaleTimeString();
      console.log(`[Migration] ${msg}`);
      logs.push(`[${timestamp}] ${msg}`);
    };

    addLog(`Starting migration of Firestore database data...`);
    addLog(`Source Database: "${sourceConfig.firestoreDatabaseId}" (Project: "${sourceConfig.projectId}")`);
    addLog(`Destination Database: "${firebaseConfig.firestoreDatabaseId}" (Project: "${firebaseConfig.projectId}")`);

    try {
      // 1. Initialize source app if not already initialized
      let sourceApp;
      const existingApps = getApps();
      const sourceAppName = 'sourceMigrationApp';
      const existingSourceApp = existingApps.find((app) => app.name === sourceAppName);

      if (existingSourceApp) {
        sourceApp = existingSourceApp;
        addLog(`Re-using existing source Firebase app instance.`);
      } else {
        sourceApp = initializeClientApp(sourceConfig, sourceAppName);
        addLog(`Initialized new source Firebase app instance.`);
      }

      const sourceDb = getClientFirestore(sourceApp, sourceConfig.firestoreDatabaseId);

      // 2. Collections to migrate
      const collectionsToMigrate = [
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

      for (const colName of collectionsToMigrate) {
        addLog(`Scanning collection "${colName}"...`);
        stats[colName] = 0;

        try {
          const sourceColRef = clientCollection(sourceDb, colName);
          const sourceSnap = await clientGetDocs(sourceColRef);

          addLog(`Found ${sourceSnap.size} documents in source collection "${colName}".`);

          let currentBatch = clientWriteBatch(clientDb);
          let batchOpCount = 0;

          for (const sourceDoc of sourceSnap.docs) {
            const docData = sourceDoc.data();
            const targetDocRef = clientDoc(clientDb, colName, sourceDoc.id);

            currentBatch.set(targetDocRef, docData);
            batchOpCount++;
            stats[colName]++;

            // If this is an exam, migrate nested questions subcollection
            if (colName === 'exams') {
              const subColPath = `exams/${sourceDoc.id}/questions`;
              const sourceSubColRef = clientCollection(sourceDb, subColPath);
              const sourceSubSnap = await clientGetDocs(sourceSubColRef);

              if (sourceSubSnap.size > 0) {
                addLog(`  Found ${sourceSubSnap.size} nested questions for Exam [${sourceDoc.id}]. Migrating subcollection...`);
                for (const subDoc of sourceSubSnap.docs) {
                  const subData = subDoc.data();
                  const targetSubDocRef = clientDoc(clientDb, subColPath, subDoc.id);

                  if (batchOpCount >= 400) {
                    await currentBatch.commit();
                    currentBatch = clientWriteBatch(clientDb);
                    batchOpCount = 0;
                  }

                  currentBatch.set(targetSubDocRef, subData);
                  batchOpCount++;
                }
              }
            }

            if (batchOpCount >= 400) {
              await currentBatch.commit();
              currentBatch = clientWriteBatch(clientDb);
              batchOpCount = 0;
            }
          }

          if (batchOpCount > 0) {
            await currentBatch.commit();
          }

          addLog(`Collection "${colName}" migration completed. Total migrated: ${stats[colName]}`);
        } catch (colErr: any) {
          addLog(`⚠️ ERROR migrating collection "${colName}": ${colErr.message || String(colErr)}`);
        }
      }

      addLog(`Firestore data migration completed successfully!`);
      return res.status(200).json({
        success: true,
        logs,
        stats
      });
    } catch (err: any) {
      addLog(`❌ CRITICAL FAILURE during migration: ${err.message || String(err)}`);
      throw new InternalServerError(err.message || String(err), { success: false, logs });
    }
  })
);

// --- FRESH DATABASE BOOTSTRAPPER & SEEDER GATEWAY ---
/**
 * @openapi
 * /api/db/seed:
 *   post:
 *     summary: Seed a fresh Firestore database with demo schools, login options, syllabus maps, and two sample exams with questions
 *     description: Admin only. Intended for bootstrapping a new/empty environment with demo data (hardcoded school/exam/question fixtures), not for production data changes.
 *     tags: [Admin DB]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Seed logs and per-collection counts (schools, login_options, syllabus, exams, questions)
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not an admin
 *       500:
 *         description: Seeding failed
 */
router.post(
  '/api/db/seed',
  requireSession,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const logs: string[] = [];
    const stats: Record<string, number> = {
      schools: 0,
      login_options: 0,
      syllabus: 0,
      exams: 0,
      questions: 0
    };

    const addLog = (msg: string) => {
      const timestamp = new Date().toLocaleTimeString();
      console.log(`[Seeder] ${msg}`);
      logs.push(`[${timestamp}] ${msg}`);
    };

    addLog('Starting clean slate database bootstrapping...');
    addLog(`Targeting Firestore Database: "${firebaseConfig.firestoreDatabaseId}"`);

    try {
      // 1. Seed Schools
      addLog('[INFO] Initializing collection: "schools"...');
      const schoolsToSeed = [
        {
          id: 'school-1',
          name: 'Narayana CO Hyderabad',
          city: 'Hyderabad',
          state: 'Telangana',
          code: 'NCOH-01',
          adminEmail: process.env.SEED_SCHOOL1_ADMIN_EMAIL || 'admin@suvenedu.demo',
          createdAt: new Date().toISOString()
        },
        {
          id: 'school-2',
          name: 'Narayana IIT Academy Bangalore',
          city: 'Bangalore',
          state: 'Karnataka',
          code: 'NCOH-02',
          adminEmail: 'school@suvenedu.demo',
          createdAt: new Date().toISOString()
        }
      ];

      for (const school of schoolsToSeed) {
        const docRef = clientDoc(clientDb, 'schools', school.id);
        await clientSetDoc(docRef, school);
        stats.schools++;
        addLog(`[Success] Seeded school node: "${school.name}" (${school.id})`);
      }

      // 2. Seed Login Options
      addLog('[INFO] Initializing collection: "login_options"...');
      const loginOption = {
        id: 'default-options',
        allowEmailPassword: true,
        allowGoogle: true,
        defaultSchoolId: 'school-1',
        title: 'Narayana Campus Login Portal'
      };

      const loginOptionRef = clientDoc(clientDb, 'login_options', loginOption.id);
      await clientSetDoc(loginOptionRef, loginOption);
      stats.login_options++;
      addLog(`[Success] Seeded login portals configuration: "${loginOption.title}"`);

      // 3. Seed Syllabus Maps
      addLog('[INFO] Initializing collection: "syllabus"...');
      const syllabusToSeed = [
        {
          id: 'maths-jee',
          name: 'Mathematics - JEE Advanced',
          subject: 'Mathematics',
          topics: ['Limits & Continuity', 'Differentiation', 'Integration', 'Matrices & Determinants', 'Probability', 'Vectors & 3D']
        },
        {
          id: 'physics-jee',
          name: 'Physics - JEE Advanced',
          subject: 'Physics',
          topics: ['Classical Mechanics', 'Electrostatics', 'Magnetism', 'Optics', 'Thermodynamics', 'Modern Physics']
        },
        {
          id: 'chemistry-jee',
          name: 'Chemistry - JEE Advanced',
          subject: 'Chemistry',
          topics: ['Organic Chemistry', 'Inorganic Chemistry', 'Physical Chemistry', 'Chemical Kinetics']
        }
      ];

      for (const syllabus of syllabusToSeed) {
        const docRef = clientDoc(clientDb, 'syllabus', syllabus.id);
        await clientSetDoc(docRef, syllabus);
        stats.syllabus++;
        addLog(`[Success] Seeded syllabus mapping: "${syllabus.name}"`);
      }

      // 4. Seed Exams & Nested Questions
      addLog('[INFO] Initializing collection: "exams" & nested questions...');

      // A. JEE Advanced Mock Exam
      const examJee = {
        title: 'JEE Advanced Mock Exam 1',
        description: 'Calculus & Mechanics Comprehensive practice and diagnostic assessment.',
        duration: 180, // minutes
        maxMarks: 24,
        subject: 'JEE Advanced',
        status: 'published',
        schoolId: 'school-1',
        createdAt: new Date().toISOString(),
        totalQuestions: 6
      };

      const examJeeRef = clientDoc(clientDb, 'exams', 'exam-jee-adv-1');
      await clientSetDoc(examJeeRef, examJee);
      stats.exams++;
      addLog(`[Success] Seeded Assessment: "${examJee.title}"`);

      const jeeQuestions = [
        {
          id: 'q-jee-1',
          text: "If f(x) = x^3 + 3x^2 + 6x + 2 sin(x), what is the value of f'(0)?",
          options: ['6', '8', '10', '12'],
          correctAnswerIndex: 1,
          marks: 4,
          subject: 'Mathematics',
          type: 'single',
          explanation: "f'(x) = 3x^2 + 6x + 6 + 2 cos(x). At x = 0, f'(0) = 0 + 0 + 6 + 2(1) = 8."
        },
        {
          id: 'q-jee-2',
          text: 'Evaluate the limit of (sin x - x) / x^3 as x approaches 0.',
          options: ['-1/6', '1/6', '0', '1/3'],
          correctAnswerIndex: 0,
          marks: 4,
          subject: 'Mathematics',
          type: 'single',
          explanation: 'Using Taylor expansion: sin x = x - x^3/6 + ..., so (sin x - x)/x^3 = -1/6 + ... Approaching 0, the limit is -1/6.'
        },
        {
          id: 'q-jee-3',
          text: 'A particle of mass m is moving in a circular path of constant radius r such that its centripetal acceleration a_c varies with time t as a_c = k^2 r t^2. What is the power delivered to the particle by the forces acting on it?',
          options: ['m k^2 r^2 t', 'm k^2 r^2 t^3', 'm k^2 r t', '0'],
          correctAnswerIndex: 0,
          marks: 4,
          subject: 'Physics',
          type: 'single',
          explanation:
            'a_c = v^2/r = k^2 r t^2 => v = k r t. Tangential acceleration a_t = dv/dt = k r. Power P = F_t * v = (m a_t) * v = m k^2 r^2 t.'
        },
        {
          id: 'q-jee-4',
          text: "A block of mass m is placed on a smooth wedge of inclination theta. The wedge is accelerated horizontally with an acceleration 'a' so that the block remains stationary with respect to the wedge. What is the value of 'a'?",
          options: ['g sin theta', 'g cos theta', 'g tan theta', 'g / tan theta'],
          correctAnswerIndex: 2,
          marks: 4,
          subject: 'Physics',
          type: 'single',
          explanation:
            'In the wedge frame, pseudo force ma acts horizontally. Balancing along the incline: ma cos theta = mg sin theta => a = g tan theta.'
        },
        {
          id: 'q-jee-5',
          text: 'What is the product of the reaction between Propene and HBr in the presence of organic peroxides?',
          options: ['1-Bromopropane', '2-Bromopropane', '1,2-Dibromopropane', 'Allyl bromide'],
          correctAnswerIndex: 0,
          marks: 4,
          subject: 'Chemistry',
          type: 'single',
          explanation: 'Anti-Markovnikov addition of HBr in the presence of peroxides yields 1-Bromopropane (Kharasch effect).'
        },
        {
          id: 'q-jee-6',
          text: 'What is the value of the integral from 0 to pi/2 of ln(sin x) dx?',
          options: ['-pi/2 ln 2', 'pi/2 ln 2', '-pi ln 2', 'pi ln 2'],
          correctAnswerIndex: 0,
          marks: 4,
          subject: 'Mathematics',
          type: 'single',
          explanation: 'Using properties of definite integrals, the value is evaluated as -(pi/2) ln 2.'
        }
      ];

      for (const q of jeeQuestions) {
        const qRef = clientDoc(clientDb, 'exams/exam-jee-adv-1/questions', q.id);
        await clientSetDoc(qRef, q);
        stats.questions++;
      }
      addLog(`[Success] Seeded 6 comprehensive questions into "${examJee.title}"`);

      // B. NEET Grand Mock Test
      const examNeet = {
        title: 'NEET Biology & Organic Chemistry Grand Test',
        description: 'Simulated grand assessment covering full-length syllabus biology and organic chemistry modules.',
        duration: 180,
        maxMarks: 24,
        subject: 'NEET',
        status: 'published',
        schoolId: 'school-1',
        createdAt: new Date().toISOString(),
        totalQuestions: 6
      };

      const examNeetRef = clientDoc(clientDb, 'exams', 'exam-neet-1');
      await clientSetDoc(examNeetRef, examNeet);
      stats.exams++;
      addLog(`[Success] Seeded Assessment: "${examNeet.title}"`);

      const neetQuestions = [
        {
          id: 'q-neet-1',
          text: 'Which of the following is correct sequence of stages in prophase I of meiosis?',
          options: [
            'Leptotene -> Zygotene -> Pachytene -> Diplotene -> Diakinesis',
            'Zygotene -> Leptotene -> Pachytene -> Diplotene -> Diakinesis',
            'Leptotene -> Pachytene -> Zygotene -> Diplotene -> Diakinesis',
            'Leptotene -> Zygotene -> Diplotene -> Pachytene -> Diakinesis'
          ],
          correctAnswerIndex: 0,
          marks: 4,
          subject: 'Biology',
          type: 'single',
          explanation: 'The correct sequence is Leptotene, Zygotene, Pachytene, Diplotene, followed by Diakinesis.'
        },
        {
          id: 'q-neet-2',
          text: 'Which phytohormone is primarily responsible for apical dominance in plants?',
          options: ['Auxin', 'Gibberellin', 'Cytokinin', 'Abscisic acid'],
          correctAnswerIndex: 0,
          marks: 4,
          subject: 'Biology',
          type: 'single',
          explanation: 'Auxin produced in the shoot apex inhibits lateral buds, thereby promoting apical dominance.'
        },
        {
          id: 'q-neet-3',
          text: 'The primary carbon dioxide acceptor in C4 plants is:',
          options: ['Phosphoenolpyruvate (PEP)', 'Ribulose-1,5-bisphosphate (RuBP)', 'Oxaloacetate (OAA)', 'Phosphoglyceric acid (PGA)'],
          correctAnswerIndex: 0,
          marks: 4,
          subject: 'Biology',
          type: 'single',
          explanation: 'Phosphoenolpyruvate (PEP) is the primary carbon dioxide acceptor in mesophyll cells of C4 plants.'
        },
        {
          id: 'q-neet-4',
          text: 'Which of the following elements is required in the synthesis of chlorophyll?',
          options: ['Magnesium', 'Iron', 'Manganese', 'Copper'],
          correctAnswerIndex: 0,
          marks: 4,
          subject: 'Biology',
          type: 'single',
          explanation: 'Magnesium acts as the central ring atom in chlorophyll structure.'
        },
        {
          id: 'q-neet-5',
          text: 'The reaction of an alkyl halide with sodium in dry ether to form a symmetrical alkane is called:',
          options: ['Wurtz reaction', 'Fittig reaction', 'Friedel-Crafts reaction', 'Reimer-Tiemann reaction'],
          correctAnswerIndex: 0,
          marks: 4,
          subject: 'Chemistry',
          type: 'single',
          explanation: 'Wurtz reaction uses sodium in dry ether to couple alkyl groups together into a symmetrical higher alkane.'
        },
        {
          id: 'q-neet-6',
          text: 'Which nitrogenous base is present in RNA but absent in DNA?',
          options: ['Uracil', 'Thymine', 'Adenine', 'Cytosine'],
          correctAnswerIndex: 0,
          marks: 4,
          subject: 'Biology',
          type: 'single',
          explanation: 'Uracil replaces thymine as a base inside RNA.'
        }
      ];

      for (const q of neetQuestions) {
        const qRef = clientDoc(clientDb, 'exams/exam-neet-1/questions', q.id);
        await clientSetDoc(qRef, q);
        stats.questions++;
      }
      addLog(`[Success] Seeded 6 grand questions into "${examNeet.title}"`);

      addLog('Firestore database bootstrapping completed successfully!');
      return res.status(200).json({
        success: true,
        logs,
        stats
      });
    } catch (err: any) {
      addLog(`❌ CRITICAL FAILURE during database seed: ${err.message || String(err)}`);
      throw new InternalServerError(err.message || String(err), { success: false, logs });
    }
  })
);

export default router;
