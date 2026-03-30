# Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the codebase production-ready for deployment to AWS (EC2 + RDS), with proper monorepo structure, Docker, CI/CD, logging, and frontend performance.

**Priority Order:** P0 = deploy-blocking, P1 = needed before customers, P2 = nice to have

---

## Phase 1: Backend Production Hardening (P0 — deploy-blocking)

### Task 1: Structured logging with pino
**Files:** `apps/api/src/logger.ts`, modify `server.ts`

Replace all `console.log/error` with structured JSON logging:
- Request ID tracking
- Log levels (info, warn, error)
- Timestamp + context in every log
- HTTP request logging middleware
- Correlation IDs for webhook chains

```typescript
// src/logger.ts
import pino from "pino";
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "development"
    ? { target: "pino-pretty" } : undefined,
});
```

### Task 2: Health check endpoints (readiness + liveness)
**Files:** modify `server.ts`

- `GET /health` — liveness (is the process alive?)
- `GET /ready` — readiness (can it serve traffic? checks DB + LiveKit connectivity)
- Return structured JSON with component status

```typescript
app.get("/ready", async (req, res) => {
  const checks = {
    db: await checkDb(),
    livekit: await checkLiveKit(),
  };
  const healthy = Object.values(checks).every(c => c.status === "ok");
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ready" : "degraded", checks });
});
```

### Task 3: Graceful shutdown
**Files:** modify `server.ts`

- Handle SIGTERM/SIGINT
- Stop accepting new requests
- Wait for in-flight requests to complete (30s timeout)
- Close DB connections
- Log shutdown reason

### Task 4: Environment validation with zod
**Files:** `src/env.ts`, modify `server.ts`

- Validate ALL env vars at startup with zod schema
- Fail fast with clear error messages
- Type-safe env access throughout the codebase

```typescript
const envSchema = z.object({
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_SIP_TRUNK_ID: z.string().startsWith("ST_"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  DATABASE_URL: z.string().startsWith("postgresql://"),
  PORT: z.coerce.number().default(3001),
});
```

### Task 5: Request rate limiting
**Files:** modify `server.ts`

- Rate limit API endpoints (prevent abuse)
- Separate limits for webhooks (higher) vs user API (lower)
- Use `express-rate-limit` with in-memory store (Redis later)

### Task 6: CORS + security headers
**Files:** modify `server.ts`

- Proper CORS with allowlist (not `*`)
- Helmet for security headers
- Trust proxy for EC2 behind ALB

---

## Phase 2: Docker + CI/CD (P0 — deploy-blocking)

### Task 7: Dockerfile for backend
**Files:** `Dockerfile.api`

- Multi-stage build (build → runtime)
- Non-root user
- Health check instruction
- .dockerignore

### Task 8: docker-compose for local dev
**Files:** `docker-compose.yml`, `docker-compose.prod.yml`

- Services: api, web, postgres, (optional: redis for rate limiting)
- Dev: hot reload with volume mounts
- Prod: built images, RDS connection

### Task 9: GitHub Actions CI/CD
**Files:** `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

- CI: typecheck, lint, build on every PR
- CD: build Docker images, push to ECR, deploy to EC2
- Environment secrets management

---

## Phase 3: Monorepo Restructure (P1 — before scaling)

### Task 10: Restructure to turborepo monorepo

```
apps/api/          ← backend (Express)
apps/web/          ← frontend (Next.js)
packages/db/       ← shared Drizzle schema, queries, client
packages/types/    ← shared TypeScript types
packages/config/   ← shared tsconfig, eslint
```

- npm workspaces
- Turborepo for task orchestration (`turbo dev`, `turbo build`)
- Shared types eliminate duplication
- Shared DB package used by both API and future workers

### Task 11: Shared type system
**Files:** `packages/types/src/index.ts`

Single source of truth for `Capture`, API request/response types. Used by both backend and frontend.

---

## Phase 4: Frontend Performance (P1 — before customers)

### Task 12: TanStack Query for data fetching
**Files:** modify all frontend pages

- Replace `useState + useEffect + setInterval` with `useQuery`
- Automatic caching, deduplication, retry
- Background refetching (stale-while-revalidate)
- No more manual polling intervals

### Task 13: shadcn preset + layout polish
- Apply preset `--preset b5prMaInVA`
- Fix layout shifts between skeleton → content
- Consistent card heights and grid layouts

### Task 14: Error boundaries + Suspense
- Proper React Suspense boundaries
- Error boundaries per route segment (already partially done)
- Loading.tsx files for route-level suspense

---

## Phase 5: Observability (P2 — production monitoring)

### Task 15: OpenTelemetry tracing
- Trace requests from API → LiveKit → webhook
- Span correlation across the call lifecycle
- Export to Grafana/Datadog/CloudWatch

### Task 16: Metrics endpoint
- Prometheus-compatible `/metrics` endpoint
- Active captures, call duration histogram, egress success rate
- Webhook processing latency

---

## Execution Order

```
Week 1 (deploy-blocking):
  Tasks 1-6  (backend hardening)
  Tasks 7-9  (Docker + CI/CD)

Week 2 (before customers):
  Tasks 10-11 (monorepo restructure)
  Tasks 12-14 (frontend performance)

Week 3 (production monitoring):
  Tasks 15-16 (observability)
```
