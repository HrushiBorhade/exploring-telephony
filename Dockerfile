# ── Build stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src/ ./src/
RUN npm ci --ignore-scripts
RUN npx tsc

# ── Runtime stage ────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Non-root user for security
RUN addgroup -S app && adduser -S app -G app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled JS from builder
COPY --from=builder /app/dist ./dist

# Create recordings directory
RUN mkdir -p recordings && chown app:app recordings

USER app

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
