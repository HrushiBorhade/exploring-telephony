# ── Build stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate && \
    npm install -g esbuild

# Copy workspace manifests and lockfile first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY packages/queues/package.json ./packages/queues/

RUN pnpm install --frozen-lockfile

# Copy source + migration files
COPY apps/api/ ./apps/api/
COPY packages/ ./packages/
COPY drizzle/ ./drizzle/

# Bundle API + workspace packages into a single JS file.
# --packages=external keeps node_modules as require() calls.
RUN esbuild apps/api/src/server.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --outfile=dist/server.js \
    --packages=external \
    --alias:@repo/db=./packages/db/src/index.ts \
    --alias:@repo/types=./packages/types/src/index.ts \
    --alias:@repo/queues=./packages/queues/src/index.ts \
    --sourcemap

# Create pruned production deps for the API
RUN pnpm --filter @repo/api deploy --prod --legacy /app/pruned

# ── Runtime stage ────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

# Copy pruned production node_modules (all transitive deps resolved)
COPY --from=builder /app/pruned/node_modules ./node_modules

# Copy the single bundled JS file + migration SQL files
COPY --from=builder /app/dist/server.js ./dist/server.js
COPY --from=builder /app/dist/server.js.map ./dist/server.js.map
COPY --from=builder /app/drizzle ./drizzle

RUN mkdir -p recordings && chown app:app recordings

USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

EXPOSE 8080
ENV NODE_ENV=production
CMD ["node", "--enable-source-maps", "dist/server.js"]
