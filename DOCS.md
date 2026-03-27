# Voice Agent Testing Platform — Documentation

## Overview

Two-mode telephony platform for testing voice AI agents and collecting ASR training data.

### Mode 1: Agent Testing
Bridge a human tester with a voice AI agent. Live-transcribe the conversation, prompt the tester with a script, and record everything for evaluation.

### Mode 2: ASR Data Capture
Bridge two phone numbers (person-to-person). Record and transcribe the conversation. Export as structured JSON datasets for ASR model training.

---

## Architecture

```
┌────────────┐  :3000       ┌──────────────┐  :3001       ┌──────────┐
│  Next.js   │ ──REST API─► │  Express     │ ──REST API─► │  Twilio  │
│  Frontend  │              │  Backend     │              │  API     │
│  (shadcn)  │ ◄──WS────── │  + WebSocket │ ◄──WS────── │  Media   │
└────────────┘              └──────┬───────┘  Streams     └──────────┘
                                   │
                            ┌──────▼───────┐
                            │  Deepgram    │
                            │  Nova-3 ASR  │
                            └──────────────┘
```

### Data Flow

1. **User creates a session** (test or capture) via the web dashboard
2. **User clicks "Start Call"** → backend calls both phones via Twilio REST API
3. **Both phones answer** → Twilio fetches TwiML from our server
4. **TwiML instructs Twilio** to:
   - Start a `<Stream>` (fork audio to our WebSocket server)
   - Join a `<Conference>` (bridge both parties)
   - `record="record-from-start"` (Twilio records the mixed audio)
5. **Twilio sends audio chunks** (base64 mulaw/8kHz) to our `/media-stream` WebSocket
6. **Backend decodes and forwards** audio to Deepgram's streaming ASR
7. **Deepgram returns transcripts** (interim + final) → broadcast to frontend via WebSocket
8. **Frontend displays** live transcript, script prompts (agent testing mode), call events
9. **Call ends** → Twilio sends recording webhook → backend stores URL
10. **User can export** transcript as JSON dataset (capture mode)

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Backend | Express + TypeScript | REST API, TwiML webhooks, WebSocket server |
| Frontend | Next.js + shadcn/ui | Dashboard, live session views |
| Telephony | Twilio Voice API | Call initiation, conferencing, recording |
| ASR | Deepgram Nova-3 | Real-time speech-to-text (50+ languages) |
| Tunneling | ngrok | Expose localhost to Twilio webhooks |
| WebSocket | `ws` package | Twilio media streams + frontend live updates |

---

## Project Structure

```
exploring-telephony/
├── .env.example                 ← Template for credentials
├── .env                         ← Your actual credentials (gitignored)
├── package.json                 ← Backend dependencies + scripts
├── tsconfig.json                ← Backend TypeScript config
├── src/
│   ├── types.ts                 ← Shared types (Session, Capture, etc.)
│   └── server.ts                ← Complete backend (Express + WebSocket)
│       ├── REST API endpoints   ← /api/sessions/*, /api/captures/*
│       ├── TwiML endpoints      ← /twiml/tester/*, /twiml/capture-a/*
│       ├── Webhook handlers     ← /webhooks/call-status/*, /webhooks/recording/*
│       ├── Media stream WS      ← /media-stream (Twilio → Deepgram)
│       └── Client WS            ← /ws/session/:id (backend → frontend)
├── web/                         ← Next.js frontend
│   ├── src/app/
│   │   ├── page.tsx             ← Agent testing dashboard
│   │   ├── session/[id]/page.tsx ← Live test session view
│   │   ├── capture/page.tsx     ← ASR data capture dashboard
│   │   └── capture/[id]/page.tsx ← Live capture view
│   ├── src/lib/
│   │   ├── types.ts             ← Frontend type definitions
│   │   └── use-session-socket.ts ← WebSocket hook for live updates
│   └── src/components/ui/       ← shadcn/ui components
└── DOCS.md                      ← This file
```

---

## Setup

### Prerequisites

1. **Node.js 20+**
2. **Twilio account** (free trial: ~$15 credit) — https://twilio.com/try-twilio
3. **Deepgram account** (free: $200 credit) — https://deepgram.com
4. **ngrok** — `brew install ngrok`

### Steps

```bash
# 1. Install dependencies
npm install
cd web && npm install && cd ..

# 2. Create .env from template
cp .env.example .env
# Fill in your credentials (see .env.example for format)

# 3. Start ngrok (Terminal 1)
ngrok http 3001
# Copy the https URL → paste into .env as BASE_URL

# 4. Start backend (Terminal 2)
npm run dev:backend

# 5. Start frontend (Terminal 3)
npm run dev:frontend

# 6. Open http://localhost:3000
```

### Environment Variables

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxx     # Twilio Console → Dashboard
TWILIO_AUTH_TOKEN=xxxxxxxx         # Twilio Console → Dashboard
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx  # Your Twilio number
DEEPGRAM_API_KEY=dg_xxxxxxxx      # Deepgram Console → API Keys
BASE_URL=https://xxxx.ngrok-free.app  # ngrok forwarding URL
PORT=3001                          # Backend port
```

---

## API Reference

### Agent Testing Mode

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List all test sessions |
| POST | `/api/sessions` | Create a test session |
| GET | `/api/sessions/:id` | Get session detail + transcript |
| POST | `/api/sessions/:id/start` | Initiate the call (both phones) |
| POST | `/api/sessions/:id/end` | End the call |
| POST | `/api/sessions/:id/advance-script` | Move to next script step |

**Create session body:**
```json
{
  "scenario": {
    "name": "Kotak Home Loan Inquiry",
    "persona": "Kannada-speaking user",
    "agentPhone": "+91XXXXXXXXXX",
    "script": [
      { "id": 1, "prompt": "Ask about home loan options" },
      { "id": 2, "prompt": "Ask about interest rates" }
    ]
  },
  "testerPhone": "+91XXXXXXXXXX"
}
```

### ASR Data Capture Mode

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/captures` | List all captures |
| POST | `/api/captures` | Create a capture |
| GET | `/api/captures/:id` | Get capture detail + transcript |
| POST | `/api/captures/:id/start` | Initiate the call |
| POST | `/api/captures/:id/end` | End the call |
| GET | `/api/captures/:id/export` | Download transcript as JSON dataset |

**Create capture body:**
```json
{
  "name": "Customer Service Call - Hindi",
  "phoneA": "+91XXXXXXXXXX",
  "phoneB": "+91XXXXXXXXXX",
  "language": "hi"
}
```

**Export dataset format:**
```json
{
  "id": "abc123",
  "name": "Customer Service Call - Hindi",
  "language": "hi",
  "phoneA": "+91...",
  "phoneB": "+91...",
  "duration": 180,
  "recordingUrl": "https://api.twilio.com/.../Recordings/RE123.mp3",
  "transcript": [
    { "speaker": "caller_a", "text": "Hello, I need help", "isFinal": true, "timestamp": 1711234567890 },
    { "speaker": "caller_b", "text": "Sure, how can I help?", "isFinal": true, "timestamp": 1711234569000 }
  ],
  "metadata": {
    "createdAt": "2026-03-27T10:00:00.000Z",
    "startedAt": "2026-03-27T10:00:05.000Z",
    "endedAt": "2026-03-27T10:03:05.000Z",
    "totalUtterances": 42
  }
}
```

### WebSocket

| Endpoint | Direction | Description |
|----------|-----------|-------------|
| `ws://localhost:3001/ws/session/:id` | Backend → Frontend | Live transcript + status updates |
| `ws://localhost:3001/media-stream` | Twilio → Backend | Raw audio stream (internal) |

### Supported Languages (Deepgram Nova-3)

`en`, `hi`, `kn`, `ta`, `te`, `mr`, `bn`, `ur`, `ml`, `gu`, `pa`, `multi` (auto-detect), and 40+ more.

---

## Twilio Free Trial Limitations

- Can only call **verified phone numbers** (add them in Console → Verified Caller IDs)
- Calls play a "trial account" message before connecting
- Max **10 min** per call, **5 concurrent** calls
- **One Twilio number** only
- Upgrade for ~$20 to remove all restrictions

---

## Future Enhancements

- [ ] WebRTC in browser (no phone needed for tester)
- [ ] Auto-advance script based on ASR keyword matching
- [ ] AI-powered evaluation reports (LLM scoring of agent responses)
- [ ] Persistent storage (PostgreSQL instead of in-memory)
- [ ] Multi-language auto-detection per utterance
- [ ] Webhook for real-time transcript delivery to external systems
- [ ] Batch capture mode (queue multiple recordings)
