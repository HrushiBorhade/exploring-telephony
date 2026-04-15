# Observability & Monitoring

Production observability stack for the ASR Voice Capture Platform.

## Architecture

```
ECS Task (API / Worker)
  ├── Pino structured logs ──► CloudWatch Logs (+ trace_id via OTel)
  ├── prom-client /metrics ──► Grafana Alloy sidecar ──► Grafana Cloud Mimir
  └── OTel traces ───────────► Grafana Alloy sidecar ──► Grafana Cloud Tempo

CloudWatch Alarms ──► SNS ──► Lambda ──► Slack #alerts
Application errors ──► notifySlackError() ──► Slack #alerts
New user signup ──► notifySlackNewUser() ──► Slack #new-signups
Onboarding complete ──► notifySlack() ──► Slack #new-signups
User session analytics ──► Microsoft Clarity (prod-only)
```

## Quick Access

| System | URL |
|--------|-----|
| Grafana Cloud | https://grafana.com (your org dashboard) |
| CloudWatch Logs (API) | AWS Console → CloudWatch → Log groups → `/aws/ecs/telephony-api/api` |
| CloudWatch Logs (Worker) | AWS Console → CloudWatch → Log groups → `/aws/ecs/background-worker/worker` |
| CloudWatch Logs (Alloy API) | Log group → `/aws/ecs/telephony-api/alloy` |
| CloudWatch Logs (Alloy Worker) | Log group → `/aws/ecs/background-worker/alloy` |
| Microsoft Clarity | https://clarity.microsoft.com (project: wc0nmzsp87) |
| Slack #alerts | P0/P1 production alerts |
| Slack #new-signups | User signup + onboarding notifications |

## Metrics (Prometheus → Grafana Cloud Mimir)

### API Metrics (`/metrics` on port 8080)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_request_duration_seconds` | Histogram | method, route, status_code | Request latency (buckets: 5ms–5s) |
| `http_requests_total` | Counter | method, route, status_code | Total request count |
| `capture_total` | Counter | — | Total captures created |
| `capture_active` | Gauge | — | Currently active captures |
| `call_duration_seconds` | Histogram | — | Call durations (buckets: 10s–600s) |
| `egress_success_total` | Counter | type (mixed, caller_a, caller_b) | Successful egress starts |
| `egress_failure_total` | Counter | — | Failed egress starts |
| `webhook_duration_ms` | Histogram | event | Webhook processing time |
| `queue_depth` | Gauge | queue, state (waiting, active, failed) | BullMQ queue depths |
| Node.js defaults | Various | — | Memory, CPU, event loop, GC |

### Worker Metrics (`/metrics` on port 9090)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `worker_job_duration_seconds` | Histogram | queue, status | Total job processing time |
| `worker_step_duration_seconds` | Histogram | step | Individual pipeline step duration |
| `worker_jobs_total` | Counter | queue, status | Jobs processed (completed/failed) |
| `worker_queue_depth` | Gauge | queue, state | Queue depth from worker perspective |
| `worker_*` Node.js defaults | Various | — | Memory, CPU, event loop, GC |

### Querying Metrics in Grafana

Go to **Grafana Cloud → Explore → select Mimir** as datasource.

Example queries:
```promql
# Request rate (per second)
rate(http_requests_total[5m])

# Error rate (%)
sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100

# P95 API latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Active captures
capture_active

# Queue backlog
queue_depth{state="waiting"}

# Worker job failure rate
rate(worker_jobs_total{status="failed"}[5m])
```

## Logs (Pino → CloudWatch / Grafana Loki)

### Structure

Every log line is structured JSON with:
```json
{
  "level": 30,
  "time": 1776248697526,
  "service": "telephony-api",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "trace_id": "abc123...",
  "span_id": "def456...",
  "msg": "[CAPTURE] Created: abc123"
}
```

### Key Fields

| Field | Source | Description |
|-------|--------|-------------|
| `service` | Pino base config | `telephony-api` or `audio-worker` |
| `requestId` | Request ID middleware | UUID per API request (returned in `x-request-id` header) |
| `trace_id` | OTel Pino instrumentation | Links log to distributed trace in Tempo |
| `span_id` | OTel Pino instrumentation | Links log to specific span |
| `captureId` | Application code | Capture being processed |
| `jobId` | Worker child logger | BullMQ job ID |

### Searching Logs

**CloudWatch Logs Insights** (AWS Console → CloudWatch → Logs Insights):
```sql
-- Find all errors for a capture
fields @timestamp, @message
| filter @message like "abc123"
| sort @timestamp desc

-- Find all 500 errors in last hour
fields @timestamp, @message
| filter @message like "error" and @message like "500"
| sort @timestamp desc
| limit 50

-- Find slow webhook processing (>500ms)
fields @timestamp, @message
| filter @message like "webhook_duration_ms"
| sort @timestamp desc
```

**AWS CLI**:
```bash
# Search API logs for a capture
aws logs filter-log-events \
  --log-group-name /aws/ecs/telephony-api/api \
  --filter-pattern "CAPTURE_ID_HERE" \
  --region ap-south-1 \
  --query 'events[*].message' --output json | jq -r '.[]'

# Search worker logs
aws logs filter-log-events \
  --log-group-name /aws/ecs/background-worker/worker \
  --filter-pattern "CAPTURE_ID_HERE" \
  --region ap-south-1 \
  --query 'events[*].message' --output json | jq -r '.[]'
```

## Traces (OpenTelemetry → Grafana Cloud Tempo)

### What's Instrumented (Auto)

- **Express HTTP** — every incoming API request
- **PostgreSQL (pg)** — every database query
- **Redis (ioredis)** — every Redis command
- **fetch** — every outgoing HTTP call (Deepgram, Gemini, S3, LiveKit, AuthKey)

### Trace Context Propagation

API → BullMQ job → Worker traces are linked via `_trace` field in job data:
```
API: webhook received → save recording URL → enqueue job (inject traceparent)
                                                    ↓
Worker: pick up job (extract traceparent) → download → convert → transcribe → ...
```

### Viewing Traces in Grafana

1. Go to **Grafana Cloud → Explore → select Tempo**
2. Search by:
   - **Service name**: `telephony-api` or `audio-worker`
   - **Trace ID**: from a log line's `trace_id` field
   - **Duration**: find slow traces (e.g., `duration > 5s`)
3. Click a trace to see the full waterfall view

### Log → Trace Correlation

Every Pino log line includes `trace_id` (injected by `@opentelemetry/instrumentation-pino`). In Grafana:
1. Find the log in Loki
2. Click the `trace_id` value
3. Jump directly to the trace in Tempo

## Alerts

### Slack Channels

| Channel | What | Severity |
|---------|------|----------|
| `#alerts` | Production errors, failures, alarms | P0/P1 |
| `#new-signups` | User signups, onboarding completions | Informational |

### P0 — Immediate (Slack @channel)

| Alert | Source | Trigger |
|-------|--------|---------|
| ECS task crash | CloudWatch → SNS → Lambda | Circuit breaker rollback |
| ALB 5xx spike | CloudWatch → SNS → Lambda | >10 errors in 5 min |
| RDS storage critical | CloudWatch → SNS → Lambda | <2GB free storage |
| Worker job permanent failure | `notifySlackError()` in worker | All 3 retries exhausted |
| Egress failure | `notifySlackError()` in API | Recording at risk |

### P1 — Warning (Slack, no mention)

| Alert | Source | Trigger |
|-------|--------|---------|
| ECS CPU high | CloudWatch → SNS → Lambda | >80% for 10 min |
| RDS CPU high | CloudWatch → SNS → Lambda | >80% for 10 min |
| Redis CPU high | CloudWatch → SNS → Lambda | >80% for 10 min |

### Informational

| Notification | Channel | Trigger |
|-------------|---------|---------|
| New user signup | `#new-signups` | `databaseHooks.user.create.after` |
| Onboarding complete | `#new-signups` | `PUT /api/profile/languages` success |

## Infrastructure

### Grafana Alloy Sidecar

Runs alongside both API and worker ECS tasks:

| Config | API | Worker |
|--------|-----|--------|
| Scrape target | `localhost:8080/metrics` | `localhost:9090/metrics` |
| Scrape interval | 15s | 15s |
| OTLP receiver | `0.0.0.0:4317` (gRPC), `0.0.0.0:4318` (HTTP) | Same |
| CPU | 256 units | 256 units |
| Memory | 512 MB | 512 MB |
| Image | `grafana/alloy:v1.9.1` | Same |

### SNS → Lambda → Slack

- **Lambda**: `telephony-sns-to-slack` (Node.js 20, 128 MB)
- **SNS Topic**: `telephony-alerts`
- **Subscribers**: Lambda function (auto-invoked)
- **Format**: Block Kit card with alarm name, state, reason, timestamp (IST)

### Grafana Cloud (Free Tier)

| Limit | Value | Our Usage |
|-------|-------|-----------|
| Metrics series | 10,000/mo | ~1,000 |
| Logs volume | 50 GB/mo | ~1 GB |
| Traces volume | 50 GB/mo | ~1 GB |
| Retention | 14 days | Sufficient |

## 3AM Incident Workflow

When something breaks at 3AM:

### 1. Slack Alert Arrives
You get a Slack notification in `#alerts` with:
- Error type (job-failure, egress-failure, CloudWatch alarm)
- Context (captureId, jobId, alarm name)
- Timestamp (IST)

### 2. Check Metrics (Is This Widespread?)
Go to **Grafana Cloud → Explore → Mimir**:
```promql
# Is there an error spike?
rate(http_requests_total{status_code=~"5.."}[5m])

# Is the queue backed up?
queue_depth{state="waiting"}

# Are jobs failing?
rate(worker_jobs_total{status="failed"}[5m])
```

### 3. Find the Logs (What Exactly Failed?)
**CloudWatch Logs** → filter by the captureId from the Slack alert:
```bash
aws logs filter-log-events \
  --log-group-name /aws/ecs/telephony-api/api \
  --filter-pattern "CAPTURE_ID" \
  --region ap-south-1 \
  --query 'events[*].message' --output json | jq -r '.[]'
```

### 4. Trace the Request (Where Did It Fail?)
From the log, grab the `trace_id` → Go to **Grafana Cloud → Explore → Tempo** → paste trace ID → see the full waterfall:
- API request → webhook processing → DB query → BullMQ enqueue
- Worker → S3 download → ffmpeg → Deepgram API → Gemini API → S3 upload

### 5. Check Infrastructure (Is AWS Healthy?)
```bash
# ECS services
aws ecs describe-services --cluster telephony-cluster \
  --services telephony-api background-worker \
  --region ap-south-1 \
  --query 'services[*].{name:serviceName,running:runningCount,desired:desiredCount}'

# API health
curl -s https://asr-api.annoteapp.com/health | jq .
```

### 6. Recover if Needed
```bash
# Check S3 for recordings
aws s3 ls s3://telephony-recordings-prod-475568920420/recordings/CAPTURE_ID --region ap-south-1

# Manually enqueue a stuck capture (via ECS Exec)
aws ecs execute-command --cluster telephony-cluster \
  --task TASK_ID --container api --interactive \
  --command "node -e \"...\""
```

## File Reference

| File | Purpose |
|------|---------|
| `apps/api/src/instrumentation.ts` | OTel SDK setup for API (Express, pg, ioredis, fetch, Pino) |
| `apps/workers/src/instrumentation.ts` | OTel SDK setup for Worker |
| `apps/api/src/metrics.ts` | Prometheus metrics definitions (API) |
| `apps/workers/src/metrics.ts` | Prometheus metrics definitions + HTTP server (Worker) |
| `apps/api/src/middleware/metrics.ts` | HTTP request duration/count middleware |
| `apps/api/src/middleware/request-id.ts` | UUID per request, Pino child logger |
| `apps/api/src/middleware/error-handler.ts` | Global Express error handler with stack traces |
| `packages/shared/src/slack.ts` | Slack notification utility (alerts + default channels) |
| `packages/shared/src/tracing.ts` | BullMQ trace context propagation |
| `infra/lambda/sns-to-slack/index.mjs` | SNS → Slack Lambda bridge |
| `infra/environments/prod/main.tf` | Alloy sidecars, Lambda, SNS subscription, CloudWatch alarms |
| `apps/web/src/app/layout.tsx` | Microsoft Clarity (prod-only) |
