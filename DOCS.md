# Voice Capture Platform — Technical Documentation

## Overview

Phone-to-phone call recording platform built on LiveKit + Telnyx. Records conversations as 3 separate audio files (mixed + per-speaker) and stores them in Cloudflare R2 for offline ASR processing.

---

## Architecture

```
┌────────────┐            ┌──────────────┐           ┌──────────────┐
│  Next.js   │  REST API  │   Express    │  SDK      │  LiveKit     │
│  Frontend  │ ──────────→│   Backend    │ ─────────→│  Cloud       │
│  :3000     │            │   :3001      │           │              │
└────────────┘            └──────┬───────┘           │  SIP Bridge  │
                                 │                    │  Egress      │
                          ┌──────▼───────┐           │  Rooms       │
                          │  PostgreSQL  │           └──────┬───────┘
                          │  (metadata)  │                  │ SIP
                          └──────────────┘           ┌──────▼───────┐
                                                     │   Telnyx     │
                          ┌──────────────┐           │   PSTN       │
                          │ Cloudflare   │           └──────┬───────┘
                          │ R2 (audio)   │                  │
                          └──────────────┘           Phone A ↔ Phone B
```

## Call Flow

1. User creates a capture (name, phone A, phone B)
2. `POST /api/captures/:id/start` → backend creates LiveKit room
3. Backend dials Phone A via `createSipParticipant` (LiveKit → Telnyx → PSTN)
4. 2s delay → dials Phone B
5. Both answer → join LiveKit room → can hear each other
6. `participant_joined` webhook fires → backend tracks callers
7. When both callers in room → starts 3 egresses:
   - Room Composite (mixed audio, both callers)
   - Participant Egress for caller_a (Phone A only)
   - Participant Egress for caller_b (Phone B only)
8. Call ends (hangup or "End Call" button) → room deleted
9. LiveKit uploads recordings to Cloudflare R2
10. `egress_ended` webhook → backend saves URLs to Postgres
11. Frontend polls → shows 3 audio players

## Recordings

Each capture produces 3 files in R2:

| File | Content | Use |
|------|---------|-----|
| `{id}-mixed.mp4` | Both callers combined | Playback review |
| `{id}-caller_a.mp4` | Phone A only | ASR training data |
| `{id}-caller_b.mp4` | Phone B only | ASR training data |

Per-speaker files are ideal for ASR because no speaker diarization is needed.

## API Reference

### Captures

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| GET | `/api/captures` | — | `Capture[]` |
| POST | `/api/captures` | `{ name, phoneA, phoneB, language }` | `Capture` |
| GET | `/api/captures/:id` | — | `Capture` |
| POST | `/api/captures/:id/start` | — | `{ roomName, egressId }` |
| POST | `/api/captures/:id/end` | — | `{ status, durationSeconds }` |

### Health

| Method | Endpoint | Response |
|--------|----------|----------|
| GET | `/health` | `{ status, uptime, activeCaptures }` |
| GET | `/ready` | `{ status: "ready" }` or `503` |

### Webhooks

| Method | Endpoint | Source |
|--------|----------|--------|
| POST | `/livekit/webhook` | LiveKit Cloud (participant events, egress completion) |

## Database Schema

Single table: `captures_v2`

| Column | Type | Description |
|--------|------|-------------|
| id | varchar(12) | Primary key |
| name | text | Capture name |
| phone_a | varchar(20) | First phone number |
| phone_b | varchar(20) | Second phone number |
| language | varchar(10) | Language code (en, hi, kn, etc.) |
| status | varchar(20) | created → calling → active → ended → completed |
| room_name | varchar(100) | LiveKit room name |
| egress_id | varchar(50) | Mixed recording egress ID |
| recording_url | text | Mixed recording R2 URL |
| recording_url_a | text | Caller A recording R2 URL |
| recording_url_b | text | Caller B recording R2 URL |
| local_recording_path | text | Local file path (if downloaded) |
| duration_seconds | integer | Call duration |
| created_at | timestamptz | Creation time |
| started_at | timestamptz | Call start time |
| ended_at | timestamptz | Call end time |

## Production Features

- **Structured logging** — pino (JSON in production, pretty in dev)
- **Environment validation** — zod schema validates all env vars at startup
- **Security headers** — helmet (XSS, HSTS, etc.)
- **Rate limiting** — 60 req/min production, 1000 dev
- **CORS** — origin allowlist in production
- **Health checks** — `/health` (liveness) + `/ready` (DB check)
- **Graceful shutdown** — SIGTERM/SIGINT with 30s timeout
- **Docker** — multi-stage build, non-root user, health check
- **CI/CD** — GitHub Actions (typecheck, build, docker)
- **Error boundaries** — React error boundaries on all routes
- **Loading states** — skeleton UI, button spinners, optimistic updates

## Environment Variables

See [`.env.example`](.env.example) — all variables documented with setup instructions.

| Variable | Source |
|----------|--------|
| `LIVEKIT_URL` | LiveKit Cloud → project URL |
| `LIVEKIT_API_KEY` | LiveKit Cloud → Settings → API Keys |
| `LIVEKIT_API_SECRET` | Same |
| `LIVEKIT_SIP_TRUNK_ID` | `lk sip outbound create` output |
| `S3_ACCESS_KEY` | Cloudflare R2 → API Tokens |
| `S3_SECRET_KEY` | Same |
| `S3_BUCKET` | R2 bucket name |
| `S3_ENDPOINT` | R2 → S3 API endpoint |
| `DATABASE_URL` | PostgreSQL connection string |

## Deployment

### Docker Compose (recommended)

```bash
docker compose up -d
```

### EC2 + RDS

1. Build Docker image → push to ECR
2. Create RDS PostgreSQL instance
3. Set `DATABASE_URL` to RDS endpoint
4. Run container on EC2 with env vars
5. Set LiveKit webhook URL to EC2 public IP/domain

### Cost Estimates

| Volume | Monthly Cost |
|--------|-------------|
| 10 calls/day × 5 min | ~$100 |
| 100 calls/day × 5 min | ~$1,000 |
| 1000 calls/day × 5 min | ~$8,000 |

Breakdown: Telnyx PSTN (70%), LiveKit (20%), R2 storage (negligible).
Switch from Telnyx to Plivo for India calls to save 76%.
