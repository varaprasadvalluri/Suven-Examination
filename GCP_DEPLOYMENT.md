# 🚀 Scaling to 50,000 Concurrent Students: Google Cloud Platform (GCP) Deployment Guide

This guide details the complete deployment architecture and instructions for deploying the **SuvenEdu Tech** full-stack React and Node.js application on **Google Cloud Platform (GCP)**. It is designed to handle **50,000 concurrent students** taking an exam at the exact same time with zero lag.

---

## 🏗️ Google Cloud Target Architecture

For high-concurrency student examinations, we leverage a native **Serverless Container + CDN Edge** architecture:

```
                          [ 50,000 Students ]
                                   │
                                   ▼
                         [ Google Cloud CDN ]   ───(Caches and serves all static React assets instantly)
                                   │
                                   ▼
                    [ Global External HTTP(S) LB ]
                                   │
                                   ▼
                    [ Serverless NEG (Cloud Run) ]
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
 [ Cloud Run Pod 1 ]        [ Cloud Run Pod 2 ]        [ Cloud Run Pod 3 ]
 (Autoscales up to 50+ vCPUs, running our optimized Docker image)
        │                          │                          │
        └──────────────────────────┼──────────────────────────┘
             │                                   │
             ▼                                   ▼
  [ Cloud Memorystore (Redis) ]       [ Firestore DB (Native Mode) ]
   (Active cache checking)             (Private backend low-latency link)
```

---

## ⚡ Why GCP Is Ideal for 50,000 Concurrent Students

1. **Ultra-Low DB Latency**: Your Node.js backend is running on Cloud Run in the same region as your **Firestore** database. Database requests communicate over Google’s private high-speed fiber backplane, reducing latency to single-digit milliseconds.
2. **Instant Horizontal Scaling**: Unlike traditional servers that take minutes to spin up, **Google Cloud Run** scales container instances horizontally in seconds.
3. **Optimized DB Write Aggregation**: The React client uses our engineered `examAnswerQueue` system (batching Firestore writes every 4 seconds in the background), keeping DB operations light even under extreme concurrency.
4. **Active Wellness Monitoring**: The `/health` endpoint validates both Firestore and Redis connection lifespans. This allows Google's load balancers to safely drain traffic from degraded nodes instantly.

---

## 🛠️ Deployment Steps

We use **Google Cloud Run** with a custom **Cloud Build** trigger to deploy in seconds.

### Step 1: Install & Authenticate the Google Cloud SDK

Ensure you have the [Google Cloud CLI](https://cloud.google.com/sdk/gcloud) installed, then run:

```bash
# Authenticate with your Google Account
gcloud auth login

# Set your active GCP Project ID
gcloud config set project ai-studio-8391c2ab-94ef-4c90-9d99-eebfe3329077
```

### Step 2: Enable Google Cloud API Nodes

To support containerized builds, database queries, and managed scaling, enable these essential service APIs:

```bash
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    containerregistry.googleapis.com \
    redis.googleapis.com
```

### Step 3: Build & Deploy via Google Cloud Build (One Command)

We provided a pre-configured `cloudbuild.yaml` file. Deploying your entire application is as simple as running:

```bash
gcloud builds submit --config cloudbuild.yaml .
```

This single command:

1. Compresses your codebase and securely uploads it to Cloud Build.
2. Builds the multi-stage, production-ready **Docker** container.
3. Pushes the optimized runner image to **Google Container Registry**.
4. Deploys the service to **Google Cloud Run** with custom limits optimized for 50,000 concurrent connections.

---

## ⚙️ Scaling Cloud Run Parameters for Peak Load

To ensure maximum performance during the exam launch peak (e.g., exactly at 9:00 AM), we configure Cloud Run with the following settings (included in `cloudbuild.yaml`):

- **`--min-instances 5`**: Keeps 5 instances fully pre-warmed and running continuously. This eliminates container cold starts when 50,000 students try to log in simultaneously.
- **`--max-instances 100`**: region CPU quota ceiling at cpu=2 per instance — gcloud rejects a higher value with "Max instances must be set to 100 or fewer" without a quota increase (https://cloud.google.com/run/quotas). Capacity instead comes from concurrency below.
- **`--concurrency 500`**: 100 instances * 500 = 50,000 capacity, compensating for the max-instances ceiling above. Higher per-instance concurrency than typical, relies on Node's async I/O model since Firestore calls are non-blocking.
- **`--cpu 2 --memory 4Gi`**: 4GB (raised from 2GB) so 500 concurrent in-flight requests per instance have enough headroom to avoid OOM.

---

## 🔑 Required: Session Signing Secret (`JWT_SECRET`)

Because multiple Cloud Run instances run simultaneously (`--min-instances 5`, up to `--max-instances 100`), every instance **must share the same `JWT_SECRET`** — it's what signs/verifies student and staff session tokens. If it isn't set, each instance generates its own random secret at boot, and users will get random 401 errors as their requests land on different instances. This must be set **once** before (or right after) the first deploy — `gcloud run deploy` preserves existing environment variables/secrets across future deploys, so `cloudbuild.yaml` doesn't need to reference it.

**Recommended (Secret Manager):**

```bash
openssl rand -hex 48 | gcloud secrets create jwt-secret --data-file=-

gcloud run services update suvenedu-service \
    --region=us-central1 \
    --set-secrets=JWT_SECRET=jwt-secret:latest
```

**Simpler alternative (plain env var, fine for smaller deployments):**

```bash
gcloud run services update suvenedu-service \
    --region=us-central1 \
    --update-env-vars JWT_SECRET=$(openssl rand -hex 48)
```

Losing/rotating this secret invalidates every active session (everyone gets logged out) — that's expected, not a bug, if you ever need to rotate it.

---

## 🔥 Firebase Config: One Source, No Checked-In File

There is no `firebase-applet-config.json` in the repo anymore. `server.ts`, `migrate-db.ts`, and the frontend build (via `vite.config.ts`'s `define` block, same pattern already used for `GEMINI_API_KEY`) all read the same seven env vars: `FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`. One set of values, no duplication between server and frontend, no drift.

**Local dev**: put these in a `.env` file (gitignored) — see `.env.example` for the full list. `npm run dev` and `npm run build` both pick it up automatically.

**Production build (Cloud Build)**: because Vite bakes these into the frontend bundle at _build_ time, not runtime, `cloudbuild.yaml` passes them as Docker `--build-arg`s — non-secret values (project ID, database ID, app ID, etc.) come from `substitutions` at the bottom of `cloudbuild.yaml`, and `FIREBASE_API_KEY` comes from Secret Manager via `availableSecrets`/`secretEnv`. One-time setup:

```bash
gcloud secrets create firebase-api-key --data-file=- <<< "YOUR_FIREBASE_WEB_API_KEY"

# Cloud Build's own service account needs read access to the secret:
gcloud secrets add-iam-policy-binding firebase-api-key \
    --member="serviceAccount:$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')@cloudbuild.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

**Production runtime (the running Cloud Run container)**: the server process also needs these at runtime for its own Firestore REST calls — bind them the same way as `JWT_SECRET` above:

```bash
gcloud run services update suvenedu-service \
    --region=us-central1 \
    --set-secrets=FIREBASE_API_KEY=firebase-api-key:latest \
    --update-env-vars FIREBASE_PROJECT_ID=your-project-id,FIRESTORE_DATABASE_ID=your-database-id
```

Note: a Firebase _web_ API key isn't a traditional secret — it ships to every browser in the frontend bundle regardless, and Firebase's own security model relies on Firestore rules / server-side auth, not on this value being hidden. Using Secret Manager for it here is about having one clean source of truth, not closing an exposure — the real secrets in this app are `JWT_SECRET`, `CLOUDINARY_API_SECRET`, and `REDIS_PASSWORD`, which should always go through Secret Manager.

---

## 🧠 Optional: Deploying Google Cloud Memorystore (Redis)

If you configure a Redis cluster to coordinate proctoring state or rate limits, spin up a Cloud Memorystore instance:

1. **Create the Redis Instance**:

```bash
gcloud redis instances create suvenedu-redis \
    --size=2 \
    --region=us-central1 \
    --redis-version=redis_7_0
```

2. **Link Redis to Cloud Run**:
   Find the IP address of your Redis instance and update the Cloud Run service environment variables:

```bash
gcloud run deploy suvenedu-service \
    --image=gcr.io/ai-studio-8391c2ab-94ef-4c90-9d99-eebfe3329077/suvenedu-service:latest \
    --update-env-vars REDIS_HOST=YOUR_REDIS_IP,REDIS_PORT=6379
```

Once linked, the `/health` endpoint will automatically detect the Redis parameters, run active ping checks, and display status logs on your dashboard.

---

## 🎯 Pro-Tips for Google Cloud Deployment

- **Cloud CDN Caching**: Route your Cloud Run service behind a Global External HTTP(S) Load Balancer and enable Cloud CDN. Set cache control headers so that the heavy React compilation assets (`dist/assets/*`) are served directly from Google’s edge caches.
- **Clean Purging**: During local testing, you can hit the `/api/health` or `/health` diagnostics route to ensure zero latency between the serverless instance and Firestore.

---

## 📟 Monitoring & Alerting

The app has no built-in alerting — the only way to know something's wrong today is a user
reporting it. Set this up once (~10 min) so problems surface via email before students hit
them.

### 1. Uptime check on `/api/health`

`/api/health` already returns a non-200 status whenever Firestore is misconfigured or
unreachable (verified: it caught the `RESOURCE_PROJECT_INVALID` and missing-env-var issues
during initial deployment).

Console → **Monitoring** → **Uptime checks** → **Create Uptime Check**

- Protocol: HTTPS, Resource type: URL
- Hostname: your Cloud Run service's hostname (e.g. `suven-examination-<hash>-<region>.a.run.app`)
- Path: `/api/health`
- Check frequency: 1 minute
- On the same screen, add an **Alert** → notification channel → **Email**

### 2. Alert on repeated 401s (session/auth breakage)

Console → **Logging** → **Logs Explorer**, filter:

```
resource.type="cloud_run_revision"
resource.labels.service_name="suven-examination"
httpRequest.status=401
```

Run once to confirm matches, then **Create Alert** → condition: count > 20 within 5 minutes →
same email notification channel.

A burst of 401s across otherwise-working sessions usually means a `JWT_SECRET` mismatch
between Cloud Run revisions/instances (this happened during a rapid string of redeploys) —
this alert catches that class of issue specifically.

### 3. Alert on 5xx errors (server/Firestore failures)

Same Logs Explorer, filter:

```
resource.type="cloud_run_revision"
resource.labels.service_name="suven-examination"
httpRequest.status>=500
```

**Create Alert** → condition: count > 10 within 5 minutes → same email notification channel.

---

_Created by SuvenEdu Tech Deployment Engineering Team — Last Updated July 2026._
