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

# Install ONLY production dependencies to minimize image footprint and security attack surface
RUN npm ci --only=production

# Copy compiled files and built assets from builder stage
COPY --from=builder /usr/src/app/dist ./dist
# If any extra server assets or parsers are needed in production, copy them here
COPY --from=builder /usr/src/app/firebase-applet-config.json ./ || true

# Expose port 3000 for server ingress routing
EXPOSE 3000

# Start command executes our bundled production CJS server
CMD ["node", "dist/server.cjs"]
