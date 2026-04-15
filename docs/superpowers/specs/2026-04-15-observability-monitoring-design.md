# Observability & Monitoring — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Author:** Hrushi + Claude

## Problem

Production incidents are invisible. The SNS topic has zero subscribers. Prometheus metrics exist but nothing scrapes them. No distributed tracing. If a user's call fails at 3am, we find out when they complain.

## Goal

End-to-end observability: any production issue triggers a Slack alert within 60 seconds, and the full trace (API request → LiveKit → egress → worker → transcription) is queryable in Grafana.

## Architecture

```
ECS Task (API / Worker)
  ├── Pino logs ──────────► Grafana Alloy sidecar ──► Grafana Cloud Loki
  ├── prom-client /metrics ► Grafana Alloy sidecar ──► Grafana Cloud Mimir
  └── OTel traces ─────────► Grafana Alloy sidecar ──► Grafana Cloud Tempo

CloudWatch Alarms ──► SNS ──► Lambda ──► Slack #alerts
Application errors ──► notifySlackError() ──► Slack #alerts
Grafana Cloud ──► Alert rules ──► Slack #alerts
```

**Backend:** Grafana Cloud free tier ($0/mo — 10k metric series, 50GB logs, 50GB traces, 14d retention)
**Collector:** Grafana Alloy sidecar in each ECS task (~256 CPU, 512MB RAM)
**Instrumentation:** OpenTelemetry SDK + auto-instrumentations + prom-client

## Phase 1: Metrics + Slack Alerting (Day 1-2)

### 1A. HTTP Request Metrics Middleware

Add Express middleware that records per-request metrics:

```
http_request_duration_seconds{method, route, status_code}  — Histogram
http_requests_total{method, route, status_code}            — Counter
```

Location: `apps/api/src/middleware/metrics.ts` (new file)
Mount in: `apps/api/src/middleware/setup.ts` (before routes)

### 1B. Worker Metrics

Add prom-client to the worker service:

```
worker_job_duration_seconds{queue, status}      — Histogram (buckets: 10,30,60,120,300,600)
worker_step_duration_seconds{step}              — Histogram (buckets: 1,5,10,30,60,120)
worker_jobs_total{queue, status}                — Counter (completed/failed)
worker_queue_depth{queue, state}                — Gauge (waiting/active/failed)
```

Location: `apps/workers/src/metrics.ts` (new file)
Expose: `/metrics` endpoint on a lightweight HTTP server (port 9090)

### 1C. Request ID Middleware

Generate UUID per incoming request, attach to Pino child logger:

```typescript
// apps/api/src/middleware/request-id.ts
req.id = req.headers['x-request-id'] || crypto.randomUUID();
req.log = logger.child({ requestId: req.id });
res.setHeader('x-request-id', req.id);
```

Propagate through BullMQ: include `requestId` in job data.

### 1D. Global Express Error Handler

```typescript
// apps/api/src/middleware/error-handler.ts
app.use((err, req, res, next) => {
  req.log.error({ err, stack: err.stack, method: req.method, path: req.path }, 'Unhandled error');
  notifySlackError({ type: 'api-error', error: err.message, path: req.path, requestId: req.id });
  res.status(err.status || 500).json({ error: 'Internal server error' });
});
```

### 1E. Slack Error Alerting

Create `apps/api/src/lib/slack.ts`:

```typescript
notifySlack(channel: 'alerts' | 'observability', blocks: Block[])
notifySlackError({ type, error, context })
```

Wire into:
- Worker: job permanent failure (after all retries)
- API: egress failure
- API: capture stuck in processing > 10 min
- Global error handler: any unhandled 500

Severity levels:
- P0 (red, @channel): task crash, egress failure, permanent job failure, RDS storage critical
- P1 (orange): 5xx spike, high latency, queue backlog, CPU >80%
- P2 (blue): informational (new signups — already done)

### 1F. SNS → Lambda → Slack

Lambda function (Node.js 20) that reads SNS event and POSTs to Slack webhook.
Terraform: `aws_lambda_function` + `aws_sns_topic_subscription`.
Activates the 5 existing CloudWatch alarms.

### 1G. Grafana Alloy Sidecar

Add sidecar container to both ECS task definitions in Terraform:
- Image: `grafana/alloy:latest`
- CPU: 256 units, Memory: 512MB
- essential: false
- Config: scrape localhost:8080/metrics (API) or localhost:9090/metrics (worker), forward to Grafana Cloud Mimir
- Secrets: GRAFANA_CLOUD_USER, GRAFANA_CLOUD_API_KEY, MIMIR_ENDPOINT, LOKI_ENDPOINT, TEMPO_ENDPOINT

API task: bump from 512→768 CPU, 1024→1536 MB memory
Worker task: bump from 1024→1280 CPU, 2048→2560 MB memory

## Phase 2: Distributed Tracing (Day 4-5)

### 2A. OpenTelemetry SDK

Add to both API and worker:
- `@opentelemetry/sdk-node`
- `@opentelemetry/auto-instrumentations-node` (Express, pg, ioredis, fetch)
- `@opentelemetry/instrumentation-pino` (auto-inject trace_id into logs)
- `@opentelemetry/exporter-trace-otlp-proto`

Config: export OTLP to Alloy sidecar at `http://localhost:4318`
Load via: `node --require ./instrumentation.js`

### 2B. Manual Spans for Worker Pipeline

Wrap each of the 10 audio pipeline steps in a span:
download → convert → align → upload-full → transcribe → slice → enhance → csv → utterances → save

### 2C. BullMQ Context Propagation

Inject `traceparent` into job data at enqueue time (API), extract at worker time.
Links API request trace → worker job trace end-to-end.

## Alerts Configuration

### P0 — Wake up (Slack @channel)
| Alert | Source | Condition |
|-------|--------|-----------|
| ECS task crash | CloudWatch → SNS → Lambda | Circuit breaker triggers |
| Egress failure | notifySlackError() | Any egress_failure_total increment |
| Job permanent failure | notifySlackError() | Worker retries exhausted |
| RDS storage critical | CloudWatch → SNS → Lambda | < 2GB free |
| API 5xx spike | Grafana alert rule | > 5% error rate for 5 min |

### P1 — Morning check (Slack, no mention)
| Alert | Source | Condition |
|-------|--------|-----------|
| API high latency | Grafana alert rule | p95 > 2s for 5 min |
| Queue backlog | Grafana alert rule | waiting > 20 for 10 min |
| High CPU | CloudWatch → SNS → Lambda | > 80% for 10 min |
| Redis memory | CloudWatch → SNS → Lambda | > 80% |

## Grafana Dashboards

### API Overview
- Request rate (by status code)
- Error rate (%)
- p50/p95/p99 latency
- Active captures gauge
- Egress success/failure rate

### Worker Pipeline
- Job throughput (completed vs failed)
- Step duration heatmap
- Queue depth (waiting/active/failed)
- Transcription duration (Deepgram + Gemini)

### Infrastructure
- ECS CPU/memory per task
- RDS connections + query latency
- Redis memory + hit rate
- S3 upload latency

## Cost Impact

| Item | Monthly Cost |
|------|-------------|
| Grafana Cloud free tier | $0 |
| Alloy sidecar compute (2 tasks) | ~$8 |
| Lambda for SNS→Slack | ~$0 (free tier) |
| **Total** | **~$8/mo** |

## Files to Create/Modify

### New Files
- `apps/api/src/middleware/metrics.ts` — HTTP metrics middleware
- `apps/api/src/middleware/request-id.ts` — Request ID generation
- `apps/api/src/middleware/error-handler.ts` — Global error handler
- `apps/api/src/lib/slack.ts` — Slack notification utility
- `apps/workers/src/metrics.ts` — Worker Prometheus metrics + HTTP server
- `packages/shared/src/instrumentation.ts` — OTel SDK setup (Phase 2)
- `infra/environments/prod/lambda/sns-to-slack.js` — SNS→Slack Lambda

### Modified Files
- `apps/api/src/middleware/setup.ts` — Mount new middleware
- `apps/api/src/server.ts` — Mount error handler
- `apps/api/src/lib/auth.ts` — Refactor notifySlackNewUser to use shared slack.ts
- `apps/workers/src/worker.ts` — Add metrics, Slack alerts on failure
- `apps/workers/src/processors/audio.ts` — Add step duration metrics
- `packages/queues/src/index.ts` — Export queue references for metrics
- `infra/environments/prod/main.tf` — Alloy sidecar, Lambda, SNS subscription, task resource bumps
