# Voice Agent Platform

**Telephony infrastructure for voice AI agents.** Bridge real phone calls, capture per-speaker audio, and deploy AI agents anywhere — built on LiveKit SIP + Telnyx.

> Currently: production-grade two-party call capture with per-speaker recordings.  
> Next: drop AI agents directly into phone calls as a first-class participant.

---

## Why this exists

Getting AI agents onto real phone calls is hard. You need:
- A SIP trunk to reach the PSTN
- A media server that can bridge calls, record them, and stream audio in real time
- Per-speaker track isolation so your ASR model isn't fighting mixed audio
- An egress pipeline that gets recordings into storage without managing infrastructure

LiveKit solves the media layer. Telnyx solves PSTN access. This platform wires them together and adds the application layer on top — auth, capture management, per-speaker recordings, and a dashboard to review everything.

---

## What it does today

```
Phone A ──┐                    ┌── Cloudflare R2
          ├── LiveKit Room ────┤   (mixed + per-speaker .ogg)
Phone B ──┘   (SIP bridge)     └── PostgreSQL
              │                    (metadata, status)
              └── Egress
                  (track recording)
```

1. Authenticated user creates a capture — enters a second phone number (their own number auto-fills from login)
2. Backend creates a LiveKit room and dials both numbers via Telnyx SIP trunk
3. Both parties join and can hear each other
4. Per-speaker track recording starts immediately
5. Call ends → recordings upload to Cloudflare R2
6. Dashboard shows the capture with 3 audio players: mixed, speaker A, speaker B

---

## Stack

| Layer | Technology |
|---|---|
| Telephony | [LiveKit Cloud](https://cloud.livekit.io) — rooms, SIP bridge, egress |
| PSTN | [Telnyx](https://portal.telnyx.com) — SIP trunk to phone network |
| Backend | Express + TypeScript, Drizzle ORM, pino, zod |
| Frontend | Next.js 16 App Router, shadcn/ui, TanStack Query, Motion |
| Auth | Better Auth — phone number OTP via Telnyx SMS |
| Storage | Cloudflare R2 (S3-compatible) |
| Database | PostgreSQL |
| Observability | OpenTelemetry traces + Prometheus metrics |

---

## Roadmap

- [x] Two-party call capture with per-speaker audio separation
- [x] Phone number authentication (OTP via SMS)
- [x] Per-user capture scoping
- [ ] Real-time audio streaming to ASR (Whisper / Deepgram)
- [ ] AI agent as a call participant (inject a bot into any room)
- [ ] Webhook-triggered outbound calls (deploy agents on demand)
- [ ] Multi-party rooms (>2 participants)
- [ ] Transcript viewer with speaker diarization
- [ ] Bring-your-own SIP trunk (Twilio, Vonage, Plivo)

---

## Architecture

```
apps/
  web/          Next.js 16 — dashboard, auth, capture management
  api/          Express — LiveKit orchestration, SIP calls, webhooks

packages/
  db/           Drizzle ORM schema + queries (shared)
  types/        Shared TypeScript types
```

The frontend proxies all `/api/*` calls to Express via Next.js rewrites, keeping everything on a single origin with no CORS complexity. Session cookies from Better Auth flow through automatically.

---

## Quick Start

### Prerequisites

- Node.js 22+ and pnpm
- PostgreSQL running locally (`createdb telephony`)
- [LiveKit Cloud](https://cloud.livekit.io) project with a SIP outbound trunk
- [Telnyx](https://portal.telnyx.com) account with a phone number and API key
- [Cloudflare R2](https://dash.cloudflare.com) bucket

### Setup

```bash
git clone https://github.com/HrushiBorhade/voice-agent-platform.git
cd voice-agent-platform
pnpm install
```

**`apps/api/.env`** (copy from `.env.example`):
```env
LIVEKIT_URL=wss://your-app.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_SIP_TRUNK_ID=ST_...
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=telephony-recordings
S3_ENDPOINT=https://....r2.cloudflarestorage.com
DATABASE_URL=postgresql://user@localhost:5432/telephony
PORT=3001
```

**`apps/web/.env.local`**:
```env
BETTER_AUTH_SECRET=          # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=postgresql://user@localhost:5432/telephony
TELNYX_API_KEY=KEY_...       # from portal.telnyx.com → API Keys
TELNYX_FROM_NUMBER=+1...     # your Telnyx number
```

### Run

```bash
# Apply DB schema
pnpm --filter @repo/db db:push

# Start both services
pnpm --filter api dev     # Express on :3001
pnpm --filter web dev     # Next.js on :3000
```

Open [http://localhost:3000](http://localhost:3000) — you'll be prompted to sign in with your phone number.

---

## LiveKit SIP Setup

You need a Telnyx SIP trunk connected to LiveKit. Follow [LiveKit's Telnyx guide](https://docs.livekit.io/agents/quickstarts/outbound-calls/) then note the trunk ID (`ST_...`) for your env file.

---

## Contributing

This is actively being developed toward a general-purpose voice agent deployment platform. Issues and PRs welcome — especially around ASR integration and agent participation patterns.
