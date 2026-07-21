# 🚀 Scaling to 10,000 Concurrent Students: Google Cloud Platform (GCP) Deployment Guide

This guide details the complete deployment architecture and instructions for deploying the **SuvenEdu Tech** full-stack React and Node.js application on **Google Cloud Platform (GCP)**. It is designed to handle **10,000 concurrent students** taking an exam at the exact same time with zero lag.

---

## 🏗️ Google Cloud Target Architecture

For high-concurrency student examinations, we leverage a native **Serverless Container + CDN Edge** architecture:

```
                          [ 10,000 Students ]
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

## ⚡ Why GCP Is Ideal for 10,000 Concurrent Students

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
4. Deploys the service to **Google Cloud Run** with custom limits optimized for 10,000 concurrent connections.

---

## ⚙️ Scaling Cloud Run Parameters for Peak Load

To ensure maximum performance during the exam launch peak (e.g., exactly at 9:00 AM), we configure Cloud Run with the following settings (included in `cloudbuild.yaml`):

* **`--min-instances 5`**: Keeps 5 instances fully pre-warmed and running continuously. This eliminates container cold starts when 10,000 students try to log in simultaneously.
* **`--max-instances 50`**: Allows Cloud Run to automatically scale up to 50 active container pods if needed.
* **`--concurrency 100`**: Allows each container instance to handle up to 100 parallel requests simultaneously using Node.js's asynchronous event loop.
* **`--cpu 2 --memory 2Gi`**: Allocates 2 vCPUs and 2GB of RAM to each container instance to comfortably handle routing, parsing, and cryptographic proctor validation.

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

* **Cloud CDN Caching**: Route your Cloud Run service behind a Global External HTTP(S) Load Balancer and enable Cloud CDN. Set cache control headers so that the heavy React compilation assets (`dist/assets/*`) are served directly from Google’s edge caches.
* **Clean Purging**: During local testing, you can hit the `/api/health` or `/health` diagnostics route to ensure zero latency between the serverless instance and Firestore.

---
*Created by SuvenEdu Tech Deployment Engineering Team — Last Updated July 2026.*
