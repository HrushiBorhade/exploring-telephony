# ── Build stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/ ./apps/api/
COPY packages/ ./packages/
RUN npm ci --ignore-scripts
RUN cd apps/api && npx tsc

# ── Runtime stage ────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/ ./packages/

RUN mkdir -p recordings && chown app:app recordings

USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "apps/api/dist/server.js"]
