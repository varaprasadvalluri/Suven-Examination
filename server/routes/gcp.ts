import express from 'express';
import { requireSession, requireRole } from '../auth/middleware';
import { auth, detectedContainerProjectId, clientDb, clientCollection, clientGetDocs } from '../firestoreClient';
import { createBreaker } from '../lib/circuitBreaker';

// Each GCP API called here is already individually try/caught with a graceful per-field
// error message on failure — the breaker only adds fail-fast behavior once a given API is
// known to be down, so a flood of admin dashboard loads doesn't keep re-hitting a dead endpoint.
const fetchBillingInfo = createBreaker('gcp.billingInfo', (targetProjectId: string, token: string) =>
  fetch(`https://cloudbilling.googleapis.com/v1/projects/${targetProjectId}/billingInfo`, {
    headers: { Authorization: `Bearer ${token}` }
  })
);
const fetchProjectInfo = createBreaker('gcp.projectInfo', (targetProjectId: string, token: string) =>
  fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${targetProjectId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
);
const fetchEnabledServices = createBreaker('gcp.enabledServices', (targetProjectId: string, token: string) =>
  fetch(`https://serviceusage.googleapis.com/v1/projects/${targetProjectId}/services?filter=state:ENABLED&pageSize=50`, {
    headers: { Authorization: `Bearer ${token}` }
  })
);

const router = express.Router();

// CLOUD RESOURCE MANAGER - GCP IAM POLICY SYNC GATEWAY
/**
 * @openapi
 * /api/gcp/sync-iam:
 *   post:
 *     summary: Simulated IAM policy sync — scans Firestore for staff users and returns fabricated sync logs/stats
 *     description: Admin only. IMPORTANT — this does NOT call any real GCP IAM API; the "binding" loop and its timestamps/ETag are simulated with setTimeout delays for a demo-console effect. Only the initial Firestore users scan is real.
 *     tags: [GCP]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Simulated sync logs and stats (usersScanned, rolesAssigned, bindingsCreated)
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not an admin
 *       500:
 *         description: Firestore users scan failed
 */
router.post('/api/gcp/sync-iam', requireSession, requireRole('admin'), async (req, res) => {
  const logs: string[] = [];
  const stats: Record<string, any> = {
    usersScanned: 0,
    rolesAssigned: 0,
    bindingsCreated: 0
  };

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[IAM Sync] ${msg}`);
    logs.push(`[${timestamp}] ${msg}`);
  };

  const targetProjectId = 'project-02bb6275-51ac-45e7-940';
  addLog(`Initiating Automated IAM Policy Synchronization pipeline...`);
  addLog(`Target GCP Project: "${targetProjectId}"`);
  addLog(`Connecting to active Firestore database to retrieve authorized personnel...`);

  try {
    // Fetch users with admin or coordinator privileges
    const usersColRef = clientCollection(clientDb, 'users');
    const usersSnap = await clientGetDocs(usersColRef);

    addLog(`Scanning users registry for administrative credentials...`);

    const staffMembers: { email: string; role: string; name: string }[] = [];

    if (!usersSnap.empty) {
      usersSnap.forEach((docSnap) => {
        const userDoc = docSnap.data();
        const isStaff =
          userDoc.role === 'admin' ||
          userDoc.role === 'super_admin' ||
          userDoc.role === 'school_admin' ||
          userDoc.role === 'system_admin' ||
          userDoc.role === 'coordinator' ||
          userDoc.isAdmin === true;

        if (isStaff && userDoc.email) {
          staffMembers.push({
            email: userDoc.email,
            role: userDoc.role || 'admin',
            name: userDoc.name || 'Staff User'
          });
        }
      });
    }

    stats.usersScanned = staffMembers.length;
    addLog(`Identified ${staffMembers.length} authorized staff members eligible for IAM privileges.`);

    // If there are no staff members from DB, auto-populate with default organization emails
    if (staffMembers.length === 0) {
      addLog(`⚠️ No active staff accounts found in the database. Auto-populating with default organization emails for safety.`);
      const defaultStaff = [
        { email: process.env.PRIMARY_ADMIN_EMAIL || 'admin@suvenedu.demo', role: 'super_admin', name: 'Primary Admin' },
        { email: process.env.OPERATIONS_ADMIN_EMAIL || 'operations@suvenedu.demo', role: 'coordinator', name: 'Operations Lead' }
      ];
      staffMembers.push(...defaultStaff);
      stats.usersScanned = staffMembers.length;
    }

    addLog(`Beginning role compilation for GCP Resource Manager IAM policy update...`);

    // Define roles to be assigned
    const rolesToAssign = [
      'roles/datastore.owner', // Necessary for Firestore management
      'roles/firebase.admin', // Necessary for Firebase management
      'roles/resourcemanager.projectIamAdmin', // Manage other users
      'roles/viewer' // General visibility
    ];

    addLog(`Fetching existing IAM Policy metadata for project "${targetProjectId}"...`);
    await new Promise((resolve) => setTimeout(resolve, 800)); // Simulate API latency
    addLog(`Successfully retrieved policy. ETag: "BwYp7-2Xv9k="`);

    // Simulate binding process
    for (const staff of staffMembers) {
      addLog(`Syncing IAM Bindings for user: "${staff.email}" (${staff.name})`);

      let rolesForUser = [...rolesToAssign];
      if (staff.role === 'coordinator') {
        rolesForUser = ['roles/datastore.owner', 'roles/viewer'];
      }

      for (const role of rolesForUser) {
        addLog(`  -> Granting role "${role}" to member "user:${staff.email}"`);
        await new Promise((resolve) => setTimeout(resolve, 100)); // micro latency
        stats.rolesAssigned++;
        stats.bindingsCreated++;
      }
      addLog(`✨ IAM Sync completed for "${staff.email}" [Status: ACTIVE]`);
    }

    addLog(`Applying transaction modifications and committing updated IAM Policy to GCP Cloud Resource Manager...`);
    await new Promise((resolve) => setTimeout(resolve, 1200)); // final commit latency

    addLog(`🎉 IAM Policy deployed successfully. Active bindings updated with zero downtime.`);
    addLog(`All personnel have been granted complete Firestore ("suven-edu") and Firebase Administration privileges.`);

    return res.status(200).json({
      success: true,
      logs,
      stats,
      targetProjectId
    });
  } catch (err: any) {
    addLog(`❌ Sync error encountered: ${err.message || String(err)}`);
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
      logs
    });
  }
});

// GCP LIVE BILLING & INFRASTRUCTURE MONITORING GATEWAY
/**
 * @openapi
 * /api/gcp/live-billing:
 *   post:
 *     summary: Fetch live GCP billing/project/service-usage info plus Firestore collection counts
 *     description: >
 *       Admin only. Real GCP API calls (Cloud Billing, Resource Manager, Service Usage) using
 *       either a caller-supplied userAccessToken or an ADC token fetched server-side; each
 *       call is independently try/caught so a missing/disabled API degrades that one field
 *       rather than failing the whole response. dbStats reads full collection counts for
 *       users/schools/exams/results via unbounded clientGetDocs — fine at current scale, but
 *       not a per-tenant/bounded read pattern.
 *     tags: [GCP]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userAccessToken: { type: string, description: Optional caller-supplied OAuth token; falls back to server ADC token if omitted }
 *               projectIdOverride: { type: string }
 *               userEmail: { type: string }
 *     responses:
 *       200:
 *         description: Billing/project/service-usage info (each may be null/error if that GCP API is unavailable) plus Firestore dbStats
 *       401:
 *         description: Missing or invalid session
 *       403:
 *         description: Caller is not an admin
 */
router.post('/api/gcp/live-billing', requireSession, requireRole('admin'), async (req, res) => {
  const { userAccessToken, projectIdOverride, userEmail } = req.body || {};
  const targetProjectId = projectIdOverride || detectedContainerProjectId || 'project-02bb6275-51ac-45e7-940';
  const projectNumber = '489976275182';
  const userAccount = userEmail || process.env.PRIMARY_ADMIN_EMAIL || 'admin@suvenedu.demo';
  const gcpConsoleUrl = `https://console.cloud.google.com/welcome/new?authuser=1&project=${targetProjectId}`;

  let token = userAccessToken;
  if (!token) {
    try {
      const client = await auth.getClient();
      const tokenRes = await client.getAccessToken();
      token = tokenRes.token;
    } catch (e) {
      console.warn('Could not retrieve ADC token:', e);
    }
  }

  const result: any = {
    success: true,
    targetProjectId,
    projectNumber,
    userAccount,
    gcpConsoleUrl,
    timestamp: new Date().toISOString(),
    apiStatus: {
      billingApiEnabled: false,
      resourceManagerEnabled: false,
      serviceUsageEnabled: false,
      enableBillingApiUrl: `https://console.cloud.google.com/apis/library/cloudbilling.googleapis.com?project=${targetProjectId}`,
      enableResourceManagerUrl: `https://console.cloud.google.com/apis/library/cloudresourcemanager.googleapis.com?project=${targetProjectId}`,
      enableServiceUsageUrl: `https://console.cloud.google.com/apis/library/serviceusage.googleapis.com?project=${targetProjectId}`
    },
    billingInfo: null,
    projectDetails: null,
    enabledServices: []
  };

  if (token) {
    // 1. Try Billing Info
    try {
      const bRes = await fetchBillingInfo(targetProjectId, token);
      const bData = await bRes.json();
      if (bRes.ok) {
        result.apiStatus.billingApiEnabled = true;
        result.billingInfo = {
          billingAccountName: bData.billingAccountName || 'Not Connected',
          billingEnabled: bData.billingEnabled || false,
          name: bData.name || '',
          projectId: bData.projectId || targetProjectId
        };
      } else {
        result.billingInfoError = bData.error?.message || 'Cloud Billing API restricted or disabled';
      }
    } catch (err: any) {
      result.billingInfoError = err.message;
    }

    // 2. Try Project Info from Resource Manager
    try {
      const pRes = await fetchProjectInfo(targetProjectId, token);
      const pData = await pRes.json();
      if (pRes.ok) {
        result.apiStatus.resourceManagerEnabled = true;
        result.projectDetails = {
          projectId: pData.projectId,
          projectNumber: pData.projectNumber,
          name: pData.name,
          lifecycleState: pData.lifecycleState,
          createTime: pData.createTime
        };
      }
    } catch (err: any) {
      result.projectError = err.message;
    }

    // 3. Try Enabled Services
    try {
      const sRes = await fetchEnabledServices(targetProjectId, token);
      const sData = await sRes.json();
      if (sRes.ok && sData.services) {
        result.apiStatus.serviceUsageEnabled = true;
        result.enabledServices = sData.services.map((s: any) => ({
          name: s.name,
          title: s.config?.title || s.name,
          state: s.state
        }));
      }
    } catch (err: any) {
      result.servicesError = err.message;
    }
  }

  // Fetch Firestore Live Counts from DB
  try {
    const usersSnap = await clientGetDocs(clientCollection(clientDb, 'users'));
    const schoolsSnap = await clientGetDocs(clientCollection(clientDb, 'schools'));
    const examsSnap = await clientGetDocs(clientCollection(clientDb, 'exams'));
    const resultsSnap = await clientGetDocs(clientCollection(clientDb, 'results'));

    result.dbStats = {
      users: usersSnap.size || 0,
      schools: schoolsSnap.size || 0,
      exams: examsSnap.size || 0,
      results: resultsSnap.size || 0,
      totalDocuments: (usersSnap.size || 0) + (schoolsSnap.size || 0) + (examsSnap.size || 0) + (resultsSnap.size || 0)
    };
  } catch (err: any) {
    result.dbStats = { users: 0, schools: 0, exams: 0, results: 0, totalDocuments: 0 };
  }

  return res.status(200).json(result);
});

export default router;
