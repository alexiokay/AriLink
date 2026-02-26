# ─── Stage 1: Build ───
FROM node:22-slim AS builder

WORKDIR /app

# Install build tools for native addons (better-sqlite3, ssh2)
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy root package files and install root deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy dashboard package files and install dashboard deps
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN cd dashboard && npm ci

# Rebuild native addons for Linux
RUN npm rebuild better-sqlite3
RUN cd dashboard && npm rebuild better-sqlite3 2>/dev/null; true

# Copy source code needed for build
COPY dashboard/ ./dashboard/
COPY core/ ./core/
COPY assistants/ ./assistants/
COPY tools/ ./tools/

# Build Nuxt (NUXT_BUILD=true skips engine bootstrap during prerender)
ENV NUXT_BUILD=true
RUN cd dashboard && npx nuxt build


# ─── Stage 2: Runtime ───
FROM node:22-slim

WORKDIR /app

# Install runtime deps for native addons + Docker CLI for sibling container management
RUN apt-get update && \
    apt-get install -y python3 make g++ docker.io && \
    rm -rf /var/lib/apt/lists/*

# Copy root node_modules (tsx, ari-client, better-sqlite3, ws, etc.)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copy dashboard build output + its node_modules (externalized deps)
COPY --from=builder /app/dashboard/.output ./dashboard/.output
COPY --from=builder /app/dashboard/node_modules ./dashboard/node_modules
COPY --from=builder /app/dashboard/package.json ./dashboard/package.json

# Copy runtime TypeScript sources (loaded via tsx at runtime)
COPY --from=builder /app/core ./core
COPY --from=builder /app/assistants ./assistants

# Copy tools needed at runtime
COPY --from=builder /app/tools/suppress-network-errors.cjs ./tools/suppress-network-errors.cjs

# Create data and logs directories
RUN mkdir -p /app/data /app/logs

# Default env vars for Docker networking
ENV NODE_ENV=production
ENV PBX_IP=asterisk
ENV TRANSCRIPTION_SERVICES=ws://parakeet:5000
ENV LISTENER_SERVER=0.0.0.0:8000
ENV EXTERNAL_HOST=arilink
ENV STASIS_APP_NAME=stasis-app
ENV AUTO_START_TRANSCRIPTION=false

EXPOSE 3011 8000/udp

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=30s \
  CMD node -e "fetch('http://localhost:3011').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dashboard/.output/server/index.mjs"]
