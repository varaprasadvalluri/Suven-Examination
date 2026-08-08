# Multi-stage build for ultra-small, fast production container
# Stage 1: Build stage
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (including devDependencies for compiling)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Firebase config is baked into the frontend bundle at build time (vite.config.ts), so these
# must be available as build args — pass them via `docker build --build-arg NAME=value`
# (cloudbuild.yaml wires these from Secret Manager / substitutions; see GCP_DEPLOYMENT.md).
ARG FIREBASE_PROJECT_ID
ARG FIRESTORE_DATABASE_ID
ARG FIREBASE_API_KEY
ARG FIREBASE_APP_ID
ARG FIREBASE_AUTH_DOMAIN
ARG FIREBASE_STORAGE_BUCKET
ARG FIREBASE_MESSAGING_SENDER_ID
ENV FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID \
    FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID \
    FIREBASE_API_KEY=$FIREBASE_API_KEY \
    FIREBASE_APP_ID=$FIREBASE_APP_ID \
    FIREBASE_AUTH_DOMAIN=$FIREBASE_AUTH_DOMAIN \
    FIREBASE_STORAGE_BUCKET=$FIREBASE_STORAGE_BUCKET \
    FIREBASE_MESSAGING_SENDER_ID=$FIREBASE_MESSAGING_SENDER_ID

# Run the unified build script (builds Vite frontend and compiles Express server via esbuild)
RUN npm run build

# Stage 2: Production stage
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Copy package manifests
COPY package*.json ./

# Install ONLY production dependencies to minimize image footprint
RUN npm ci --omit=dev

# Copy compiled files and built assets from builder stage. The server itself reads its
# Firebase config from env vars at runtime — set FIREBASE_PROJECT_ID/FIREBASE_API_KEY/etc.
# on the Cloud Run service (see GCP_DEPLOYMENT.md), same values as the build args above.
COPY --from=builder /usr/src/app/dist ./dist

# Expose port 3000 for server ingress routing
EXPOSE 3000

# Start command executes our bundled production CJS server
CMD ["node", "dist/server.cjs"]

