# Voice Capture Platform

Record phone conversations between two numbers with per-speaker audio separation. Built for collecting ASR training datasets.

## Architecture

```
Frontend (Next.js)  →  Backend (Express)  →  LiveKit Cloud  →  Telnyx/Plivo (PSTN)
     :3000                 :3001              SIP Bridge          Phone calls
                              ↓
                        PostgreSQL (metadata)
                        Cloudflare R2 (recordings)
```

**How it works:**
1. You enter two phone numbers on the dashboard
2. Backend creates a LiveKit room + dials both numbers via SIP trunk
3. Both callers join the room and can hear each other
4. When both are connected, recording starts (mixed + per-speaker)
5. Call ends → recordings upload to Cloudflare R2
6. Dashboard shows 3 audio players: mixed, caller A, caller B

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Express + TypeScript, pino logging, zod validation |
| Frontend | Next.js App Router, shadcn/ui, Tailwind CSS |
| Telephony | LiveKit Cloud (rooms, SIP bridge, egress) |
| PSTN | Telnyx (SIP trunk to phone network) |
| Storage | Cloudflare R2 (S3-compatible, recordings) |
| Database | PostgreSQL + Drizzle ORM |
| CI/CD | GitHub Actions, Docker |

## Quick Start

### Prerequisites

- Node.js 22+
- PostgreSQL running locally
- Accounts: [LiveKit Cloud](https://cloud.livekit.io), [Telnyx](https://portal.telnyx.com), [Cloudflare R2](https://dash.cloudflare.com)

### Setup

```bash
# Clone
git clone https://github.com/HrushiBorhade/exploring-telephony.git
cd exploring-telephony

# Install
npm install

# Configure
cp .env.example .env
# Fill in credentials (see .env.example for docs)

# Database
createdb telephony
npm run db:push

# Run
npm run dev:api   # Terminal 1 — API on :3001
npm run dev:web   # Terminal 2 — UI on :3000
```

### Docker (Development)

No local Postgres needed — Docker spins up everything including migrations.

```bash
# Start API + Postgres (migrations run automatically on first start)
docker compose -f docker-compose.dev.yml up -d

# View logs
docker compose -f docker-compose.dev.yml logs -f api
```

### Docker (Production)

```bash
docker compose up -d
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/captures` | List all captures |
| POST | `/api/captures` | Create a capture |
| GET | `/api/captures/:id` | Get capture detail |
| POST | `/api/captures/:id/start` | Start the call |
| POST | `/api/captures/:id/end` | End the call |
| GET | `/health` | Liveness check |
| GET | `/ready` | Readiness check (DB connectivity) |
| POST | `/livekit/webhook` | LiveKit event receiver |

## Environment Variables

See [`.env.example`](.env.example) for all required variables with documentation.

## Project Structure

```
src/
├── server.ts      Express API + LiveKit webhook handler
├── env.ts         Zod environment validation
├── logger.ts      Pino structured logging
├── livekit.ts     LiveKit SDK clients
├── audio.ts       Recording file management
├── types.ts       TypeScript types
└── db/
    ├── schema.ts  Drizzle ORM schema
    ├── queries.ts Database operations
    └── index.ts   DB connection

web/
├── src/app/
│   ├── page.tsx              Redirect to /capture
│   └── capture/
│       ├── page.tsx          Dashboard (list + create)
│       ├── error.tsx         Error boundary
│       └── [id]/
│           ├── page.tsx      Capture detail (controls + audio)
│           └── error.tsx     Error boundary
└── src/components/ui/        shadcn/ui components
```

## Roadmap

See [PRODUCT_VISION.md](PRODUCT_VISION.md) for the 3-product roadmap:
1. **ASR Data Capture** (built) — record phone conversations
2. **Voice Agent Evaluation** (next) — test AI agents with human testers
3. **Voice AI Agent Builder** (future) — STT → LLM → TTS pipeline
