# ── Build stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate && \
    npm install -g esbuild

# Copy workspace manifests and lockfile first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/workers/package.json ./apps/workers/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY packages/queues/package.json ./packages/queues/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/workers/ ./apps/workers/
COPY packages/ ./packages/

# Bundle worker + workspace packages into a single JS file
RUN esbuild apps/workers/src/worker.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --outfile=dist/worker.js \
    --packages=external \
    --alias:@repo/db=./packages/db/src/index.ts \
    --alias:@repo/types=./packages/types/src/index.ts \
    --alias:@repo/queues=./packages/queues/src/index.ts \
    --alias:@repo/shared=./packages/shared/src/index.ts \
    --sourcemap && \
    esbuild apps/workers/src/instrumentation.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --outfile=dist/instrumentation.js \
    --packages=external \
    --sourcemap

# Create pruned production deps for the worker
RUN pnpm --filter @repo/workers deploy --prod --legacy /app/pruned

# ── Runtime stage ────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app && \
    apk add --no-cache ffmpeg

# Copy pruned production node_modules
COPY --from=builder /app/pruned/node_modules ./node_modules

# Copy the single bundled JS file
COPY --from=builder /app/dist/worker.js ./dist/worker.js
COPY --from=builder /app/dist/worker.js.map ./dist/worker.js.map
COPY --from=builder /app/dist/instrumentation.js ./dist/instrumentation.js

USER app

EXPOSE 0
ENV NODE_ENV=production
CMD ["node", "--require", "./dist/instrumentation.js", "--enable-source-maps", "dist/worker.js"]
