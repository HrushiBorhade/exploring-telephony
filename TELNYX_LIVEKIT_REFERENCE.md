# Telnyx + LiveKit: Complete Technical Reference

This document is a deep-dive reference for building telephony platforms with Telnyx and LiveKit. It covers both independently and how they combine.

---

## Glossary — Every Term Explained From First Principles

Before diving in, here's every technical term you'll encounter, explained like you're hearing it for the first time.

### Telephony Fundamentals

**PSTN (Public Switched Telephone Network)**
The global network of phone lines, cell towers, and switches that connects every phone number in the world. When you call +91-XXXX from your phone, PSTN routes it. It's the "internet" but for phone calls — been around since the 1800s. Companies like Telnyx and Twilio connect YOUR software to the PSTN so you can make/receive calls programmatically.

**SIP (Session Initiation Protocol)**
The language that phone systems use to talk to each other over the internet. When a call is made, SIP handles:
- "Hey, I want to call this number" → SIP INVITE message
- "OK, ringing..." → SIP 180 Ringing
- "They picked up!" → SIP 200 OK
- "Call ended" → SIP BYE

Think of SIP as HTTP but for phone calls. Just like a browser sends HTTP requests to web servers, phone systems send SIP messages to establish calls.

**SIP Trunk**
A virtual phone line that connects your software to the PSTN via SIP. Instead of plugging a physical phone line into a wall, you configure a "trunk" (a connection) between your server and a telecom provider (Telnyx). One trunk can handle multiple simultaneous calls.

```
Your Server ←──SIP Trunk──→ Telnyx ←──PSTN──→ Real Phone Numbers
```

**SIP INVITE**
The specific SIP message that starts a phone call. When Telnyx calls someone on your behalf, it sends an INVITE to the carrier network. When someone calls your Telnyx number, Telnyx receives an INVITE and forwards it to your server (or LiveKit's SIP bridge).

**SIP Bridge**
A piece of software that translates between SIP (phone world) and another protocol (like WebRTC). LiveKit's SIP bridge takes phone calls and brings them into LiveKit rooms where they become regular audio participants.

```
Phone Call (SIP) → LiveKit SIP Bridge → LiveKit Room (WebRTC)
```

**DTMF (Dual-Tone Multi-Frequency)**
The tones you hear when you press buttons on your phone keypad. Each button produces two frequencies mixed together:
- Pressing "1" = 697 Hz + 1209 Hz
- Pressing "5" = 770 Hz + 1336 Hz

When an IVR says "Press 1 for English," it's listening for DTMF tones. In our code, Telnyx/Twilio detects these and sends them as events.

**IVR (Interactive Voice Response)**
The automated phone menu system. "Press 1 for sales, Press 2 for support..." That's an IVR. It's built by combining speech (`<Say>`) with DTMF detection (`<Gather>`).

### Audio Fundamentals

**Codec (Coder-Decoder)**
A codec compresses audio for transmission and decompresses it on the other end. Different codecs trade off between quality, bandwidth, and latency:
- **mulaw (G.711u)**: The standard telephone codec since 1972. 8kHz sample rate, 64kbps. "Phone quality" — good enough to understand speech, not great for music.
- **PCM (L16)**: Raw uncompressed audio. Perfect quality but uses more bandwidth. Best for ASR because there are no compression artifacts.
- **G.722**: "HD Voice" — 16kHz in the same 64kbps as mulaw. Sounds noticeably better. Many modern phones support it.
- **Opus**: Adaptive codec used in WebRTC. Can go from 6kbps to 510kbps. Adjusts quality based on network conditions.

**Sample Rate**
How many times per second audio is measured. Higher = better quality:
- 8,000 Hz (8kHz) = telephone quality. Can reproduce sounds up to 4kHz. Speech is intelligible but "tinny."
- 16,000 Hz (16kHz) = wideband / HD voice. Can reproduce sounds up to 8kHz. Noticeably clearer.
- 44,100 Hz (44.1kHz) = CD quality.
- 48,000 Hz (48kHz) = professional audio.

For ASR, **16kHz is the sweet spot** — much better accuracy than 8kHz, without the bandwidth cost of 44.1kHz.

**mulaw (μ-law)**
A specific audio encoding algorithm used in North American and Japanese telephone networks. It compresses 16-bit audio samples to 8-bit using a logarithmic curve — quiet sounds get more bits (better resolution) while loud sounds get fewer. This matches how human hearing works.

In our code, Twilio/Telnyx sends audio as mulaw-encoded, base64-wrapped chunks over WebSocket. We decode the base64, get raw mulaw bytes, and send them to Deepgram.

**Base64**
A way to encode binary data (like audio bytes) as text characters (A-Z, a-z, 0-9, +, /). WebSocket messages are often JSON text, so binary audio needs to be base64-encoded to travel inside JSON:
```
Raw audio bytes: [0xFF, 0x7F, 0x00, 0x3C, ...]
Base64 encoded:  "/38APP..."
```
Our server decodes: `Buffer.from(payload, "base64")` → raw audio bytes → send to Deepgram.

**Track**
In telephony/media, a "track" is one stream of audio from one direction:
- **Inbound track**: Audio coming FROM the caller (what they say into their phone)
- **Outbound track**: Audio going TO the caller (what they hear)
- **Both tracks**: Both directions mixed together

When we set `track: "inbound_track"` on a media stream, we get ONLY what that specific caller is saying — perfect for per-speaker ASR.

### AI Voice Pipeline Terms

**ASR / STT (Automatic Speech Recognition / Speech-to-Text)**
Converting spoken audio into written text. Deepgram, Google STT, Whisper are ASR engines. In our system, we pipe phone audio through ASR to get transcripts.

**TTS (Text-to-Speech)**
The opposite of ASR — converting written text into spoken audio. ElevenLabs, Cartesia, Google TTS are TTS engines. Used when building voice AI agents that need to "speak" to callers.

**Barge-in / Interruption Handling**
When a human interrupts an AI agent while it's speaking. Good voice agents detect this and stop talking immediately. Bad ones keep talking over the human. This is one of the hardest problems in voice AI.

**Endpointing**
Detecting when someone has FINISHED speaking. Deepgram's `endpointing: 300` means "if there's 300ms of silence, consider the current utterance done." Too low = words get cut off. Too high = awkward pauses before the agent responds.

**Utterance**
One continuous chunk of speech from one speaker. "Hello, I want to know about home loans" is one utterance. A pause (silence) separates utterances. Each utterance becomes one transcript entry.

**Interim vs Final Results**
ASR engines send results as they hear audio:
- **Interim**: "I want to kn..." → "I want to know ab..." → "I want to know about ho..." (updates every ~200ms, may change)
- **Final**: "I want to know about home loans." (Deepgram is confident, won't change)

We display interim results for real-time feel but only STORE final results in the database.

**Word-Level Timestamps**
Deepgram returns the exact start/end time (in seconds) for every word:
```json
{ "word": "hello", "start": 0.10, "end": 0.45, "confidence": 0.99 }
{ "word": "I",     "start": 0.50, "end": 0.60, "confidence": 0.98 }
```
This lets you click on any word and seek the audio to that exact moment.

**Confidence Score**
A number from 0 to 1 indicating how sure the ASR engine is about a word. 0.99 = very confident. 0.5 = guessing. We flag words below 0.8 with yellow underlines in the UI so humans can verify them.

### LiveKit-Specific Terms

**Room**
LiveKit's fundamental container. A virtual space where participants meet. Like a Zoom meeting room but programmatic. Each room has a name, and participants join by room name.

**Participant**
Anyone or anything in a LiveKit room:
- **STANDARD**: A human joining via browser/mobile (WebRTC)
- **SIP**: A phone caller bridged in via the SIP bridge
- **AGENT**: An AI agent running server-side
- **EGRESS**: A recording/streaming service

**Egress**
The process of getting media OUT of a LiveKit room. "Egress" literally means "exit." Types:
- **Room Composite Egress**: Record the entire room (all participants mixed) to a file
- **Track Egress**: Export a single participant's audio/video track to a WebSocket or file
- **Web Egress**: Render a web page that shows the room, record that

In our system, we use egress to record calls and to stream audio to our ASR service.

**Ingress**
The opposite of egress — getting media INTO a LiveKit room from an external source. Example: streaming a pre-recorded audio file into a room, or bringing in an RTMP stream.

**Agent Dispatch**
Telling LiveKit to start an AI agent in a specific room. A "dispatch rule" maps conditions (like "a SIP participant joined") to agents (like "start the evaluation agent"). When the condition is met, LiveKit automatically spins up the agent.

**WebRTC (Web Real-Time Communication)**
A browser technology for real-time audio/video without plugins. LiveKit is built on WebRTC. When someone joins a LiveKit room from a browser, they use WebRTC. Phone callers use SIP instead, but the SIP bridge translates between them.

**Krisp**
AI-powered noise cancellation specifically for telephony. When you enable `krispEnabled: true` on a SIP participant, LiveKit removes background noise (traffic, keyboard, TV) from the phone audio before sending it to other participants or your ASR engine. Improves transcription accuracy significantly.

### Data & Storage Terms

**WAV**
A file format for storing raw audio. Contains a header (describing the format) followed by raw audio bytes. We write mulaw WAV files from the audio chunks we receive via WebSocket.

**Dual-Channel Recording**
One audio file with two separate tracks inside (like stereo). Channel 1 = Caller A, Channel 2 = Caller B. Useful because you can isolate each speaker without AI-based speaker diarization.

**Speaker Diarization**
AI technique that figures out "who spoke when" from a mixed audio file. Unnecessary in our system because we already have separate audio streams per speaker.

---

## Table of Contents

1. [TELNYX](#telnyx)
   - [Overview & NPM Setup](#telnyx-overview--npm-setup)
   - [Call Control API (Voice API)](#call-control-api-voice-api)
   - [TeXML](#texml)
   - [TeXML vs Call Control: When to Use Which](#texml-vs-call-control-when-to-use-which)
   - [Conferencing](#telnyx-conferencing)
   - [Media Streaming (WebSocket)](#media-streaming-websocket)
   - [Recording](#telnyx-recording)
2. [LIVEKIT](#livekit)
   - [Overview & NPM Setup](#livekit-overview--npm-setup)
   - [Rooms](#livekit-rooms)
   - [Participants & Tokens](#participants--tokens)
   - [SIP Bridge (Telephony)](#sip-bridge-telephony)
   - [Egress / Recording](#egress--recording)
   - [Agents Framework](#agents-framework)
3. [COMBINED ARCHITECTURE: Telnyx + LiveKit](#combined-architecture-telnyx--livekit)
   - [Architecture Diagram](#architecture-diagram)
   - [Audio Flow](#audio-flow)
   - [Setting Up Telnyx as SIP Provider for LiveKit](#setting-up-telnyx-as-sip-provider-for-livekit)
   - [Complete Code: Bridge Two Phone Numbers via LiveKit Room](#complete-code-bridge-two-phone-numbers-via-livekit-room)
   - [Complete Code: Voice AI Agent Handling Phone Calls](#complete-code-voice-ai-agent-handling-phone-calls)

---

# TELNYX

## Telnyx Overview & NPM Setup

**npm package:** `telnyx`

```bash
npm install telnyx
```

```typescript
import Telnyx from 'telnyx';
const telnyx = new Telnyx('YOUR_API_KEY');
```

**Authentication:** All API calls use Bearer token auth with your API V2 key from the Telnyx Mission Control Portal.

**Base URL:** `https://api.telnyx.com/v2`

**Core concepts:**
- **Connection:** A Voice API Application (or FQDN connection, or Credential connection) that defines how calls are handled
- **connection_id:** Links your phone number to a voice application
- **call_control_id:** Unique ID for each call leg, used to send commands to that call

---

## Call Control API (Voice API)

The Call Control API (now officially called "Voice API") is Telnyx's **webhook-driven, REST-command** system for controlling voice calls in real-time.

### How It Works

The Call Control API uses a **bidirectional webhook-command pattern:**

1. An event occurs (incoming call, call answered, DTMF pressed, etc.)
2. Telnyx sends a **webhook** (HTTP POST) to your server with event details
3. Your server processes the event and sends **REST API commands** back to Telnyx
4. Telnyx executes the command and sends the next webhook

This creates a "ping-pong" interaction model. Every webhook MUST be replied to with a 200 OK.

### Call Lifecycle

```
Inbound Call:
  call.initiated → (you answer) → call.answered → (you interact) → call.hangup

Outbound Call:
  POST /v2/calls → call.initiated → call.answered → (you interact) → call.hangup
```

### Making an Outbound Call

```typescript
import axios from 'axios';

const response = await axios.post('https://api.telnyx.com/v2/calls', {
  to: '+14155551234',
  from: '+12125559876',      // Your Telnyx number
  connection_id: 'your_connection_id',
  webhook_url: 'https://yourdomain.com/webhooks/telnyx',
}, {
  headers: { 'Authorization': 'Bearer YOUR_API_KEY' }
});

// Response includes call_control_id and call_leg_id
const callControlId = response.data.data.call_control_id;
```

### Webhook Event Payloads

**call.initiated:**
```json
{
  "event_type": "call.initiated",
  "payload": {
    "call_control_id": "v3:RzaeMnE9ebpGCCfKdbNOC...",
    "connection_id": "1684641123236054244",
    "direction": "outgoing",
    "from": "+12182950349",
    "state": "bridging",
    "to": "+48661133089"
  }
}
```

**call.answered:**
```json
{
  "event_type": "call.answered",
  "payload": {
    "call_control_id": "v3:RzaeMnE9ebpGCCfKdbNOC...",
    "start_time": "2025-09-02T09:17:44.596122Z",
    "from": "+12182950349",
    "to": "+48661133089"
  }
}
```

**call.hangup:**
```json
{
  "event_type": "call.hangup",
  "payload": {
    "call_control_id": "v3:RzaeMnE9ebpGCCfKdbNOC...",
    "hangup_cause": "normal_clearing",
    "hangup_source": "callee",
    "end_time": "2025-09-02T09:18:06.396120Z"
  }
}
```

### Answering a Call

```typescript
// Using REST directly
await axios.post(
  `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
  { client_state: Buffer.from('my-state').toString('base64') },
  { headers: { 'Authorization': `Bearer ${API_KEY}` } }
);
```

### All Available Call Control Commands

| Command | Endpoint | Purpose |
|---------|----------|---------|
| `answer` | `/calls/{id}/actions/answer` | Answer an incoming call |
| `hangup` | `/calls/{id}/actions/hangup` | Terminate the call |
| `bridge` | `/calls/{id}/actions/bridge` | Bridge two call legs |
| `transfer` | `/calls/{id}/actions/transfer` | Transfer to another number |
| `speak` | `/calls/{id}/actions/speak` | Text-to-speech |
| `playback_start` | `/calls/{id}/actions/playback_start` | Play audio file |
| `gather` | `/calls/{id}/actions/gather` | Collect DTMF/speech input |
| `record_start` | `/calls/{id}/actions/record_start` | Start recording |
| `record_stop` | `/calls/{id}/actions/record_stop` | Stop recording |
| `streaming_start` | `/calls/{id}/actions/streaming_start` | Start media streaming |
| `streaming_stop` | `/calls/{id}/actions/streaming_stop` | Stop media streaming |
| `create_conf` | `/calls/{id}/actions/create_conf` | Create a conference from this call |
| `join` | `/calls/{id}/actions/join` | Join an existing conference |
| `send_dtmf` | `/calls/{id}/actions/send_dtmf` | Send DTMF tones |

### Complete Webhook Handler (Node.js/Express)

```typescript
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

const API_KEY = process.env.TELNYX_API_KEY!;
const BASE_URL = 'https://api.telnyx.com/v2';

app.post('/webhooks/telnyx', async (req, res) => {
  // IMPORTANT: Always respond 200 to every webhook
  res.sendStatus(200);

  const event = req.body.data;
  const eventType = event.event_type;
  const callControlId = event.payload.call_control_id;

  console.log(`Event: ${eventType}, Call: ${callControlId}`);

  switch (eventType) {
    case 'call.initiated':
      // Answer the incoming call
      if (event.payload.direction === 'incoming') {
        await axios.post(
          `${BASE_URL}/calls/${callControlId}/actions/answer`,
          {},
          { headers: { 'Authorization': `Bearer ${API_KEY}` } }
        );
      }
      break;

    case 'call.answered':
      // Start recording and speak a greeting
      await axios.post(
        `${BASE_URL}/calls/${callControlId}/actions/record_start`,
        { format: 'mp3', channels: 'dual' },
        { headers: { 'Authorization': `Bearer ${API_KEY}` } }
      );
      await axios.post(
        `${BASE_URL}/calls/${callControlId}/actions/speak`,
        {
          payload: 'Welcome to our service. How can I help you?',
          voice: 'female',
          language: 'en-US',
        },
        { headers: { 'Authorization': `Bearer ${API_KEY}` } }
      );
      break;

    case 'call.hangup':
      console.log(`Call ended: ${event.payload.hangup_cause}`);
      break;
  }
});

app.listen(3001, () => console.log('Telnyx webhook server running on :3001'));
```

### Webhook Signature Verification

Telnyx signs webhooks with ED25519 signatures. Headers to check:
- `telnyx-signature-ed25519`
- `telnyx-timestamp`

```typescript
import { verify } from '@noble/ed25519';

function verifyTelnyxWebhook(payload: string, signature: string, timestamp: string) {
  const publicKey = process.env.TELNYX_PUBLIC_KEY!;
  const message = `${timestamp}|${payload}`;
  return verify(signature, message, publicKey);
}
```

---

## TeXML

TeXML is Telnyx's **XML-based language** for managing voice calls. It is modeled after TwiML (Twilio's XML) and provides drop-in compatibility for many TwiML verbs.

### How TeXML Works

1. A call comes in to your Telnyx number (or you make an outbound call)
2. Telnyx makes an HTTP request to your webhook URL
3. Your server responds with **TeXML instructions** (XML)
4. Telnyx executes those instructions
5. When the instructions complete, Telnyx requests more (via action URLs)

### TeXML Verbs

| Verb | Purpose |
|------|---------|
| `<Say>` | Text-to-speech |
| `<Play>` | Play an audio file |
| `<Gather>` | Collect DTMF/speech input |
| `<Dial>` | Connect to another party |
| `<Conference>` | Join a conference room |
| `<Record>` | Record the caller |
| `<Stream>` | Stream media to WebSocket |
| `<Redirect>` | Redirect to new TeXML URL |
| `<Hangup>` | End the call |
| `<Pause>` | Wait N seconds |
| `<Reject>` | Reject the call |
| `<Queue>` | Place in a queue |

### TeXML Conference Example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>You are joining the conference now.</Say>
  <Dial>
    <Conference
      beep="true"
      startConferenceOnEnter="true"
      endConferenceOnExit="false"
      record="record-from-start"
      statusCallback="https://yourdomain.com/conference-events"
      statusCallbackEvent="start end join leave">
      my-conference-room
    </Conference>
  </Dial>
</Response>
```

### TeXML Stream (Media Streaming)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://yourdomain.com/media-stream" track="both_tracks" />
  </Start>
  <Dial>
    <Conference>my-room</Conference>
  </Dial>
</Response>
```

---

## TeXML vs Call Control: When to Use Which

| Aspect | TeXML | Call Control (Voice API) |
|--------|-------|------------------------|
| **Model** | Declarative XML responses | Imperative REST commands + webhooks |
| **Complexity** | Lower -- XML scripts define flow | Higher -- full programmatic control |
| **Real-time logic** | Limited -- predefined flow | Full -- respond to events dynamically |
| **Migration from Twilio** | Easy -- nearly 1:1 TwiML compatible | Requires rewrite |
| **AI agent integration** | Harder | Ideal -- dynamic, event-driven |
| **Use case** | IVRs, simple forwarding, voicemail | AI voice agents, complex routing, real-time decisions |
| **Latency** | XML fetch adds a round-trip | Direct REST commands |
| **Learning curve** | Low (especially if you know TwiML) | Medium-high |

**Rule of thumb:**
- **TeXML** = "I want simple call flows with minimal code, especially migrating from Twilio"
- **Call Control** = "I need full real-time control, building AI agents, complex routing logic"

**IMPORTANT:** Do NOT mix TeXML and Call Control in the same application. They are two separate paradigms and mixing them leads to unpredictable behavior.

---

## Telnyx Conferencing

### Conference Lifecycle

```
1. First call arrives → answer → create conference (conference is created from an active call leg)
2. Second call arrives → answer → join existing conference
3. Participants can be muted, held, or removed
4. When last participant leaves, conference ends
```

### Creating a Conference (Node.js)

```typescript
import superagent from 'superagent';

const API_KEY = process.env.TELNYX_API_KEY!;
const BASE_URL = 'https://api.telnyx.com/v2';

// Step 1: Create conference from first answered call
async function createConference(callControlId: string, conferenceName: string): Promise<string> {
  const response = await superagent
    .post(`${BASE_URL}/conferences`)
    .set('Authorization', `Bearer ${API_KEY}`)
    .set('Content-Type', 'application/json')
    .send({
      call_control_id: callControlId,
      name: conferenceName,
      beep_enabled: 'always',
    });

  return response.body.data.id; // conference_id
}

// Step 2: Join another call to the conference
async function joinConference(callControlId: string, conferenceId: string): Promise<void> {
  await superagent
    .post(`${BASE_URL}/conferences/${conferenceId}/actions/join`)
    .set('Authorization', `Bearer ${API_KEY}`)
    .set('Content-Type', 'application/json')
    .send({
      call_control_id: callControlId,
    });
}

// Step 3: Mute a participant
async function muteParticipant(conferenceId: string, callControlIds: string[]): Promise<void> {
  await superagent
    .post(`${BASE_URL}/conferences/${conferenceId}/actions/mute`)
    .set('Authorization', `Bearer ${API_KEY}`)
    .set('Content-Type', 'application/json')
    .send({
      call_control_ids: callControlIds,
    });
}

// Step 4: Hold a participant (with hold music)
async function holdParticipant(
  conferenceId: string,
  callControlIds: string[],
  audioUrl: string
): Promise<void> {
  await superagent
    .post(`${BASE_URL}/conferences/${conferenceId}/actions/hold`)
    .set('Authorization', `Bearer ${API_KEY}`)
    .set('Content-Type', 'application/json')
    .send({
      call_control_ids: callControlIds,
      audio_url: audioUrl,
    });
}
```

### Complete Conference Webhook Handler

```typescript
const conferences = new Map<string, string>(); // name -> conferenceId
const participants = new Map<string, string>(); // callControlId -> conferenceName

app.post('/webhooks/conference', async (req, res) => {
  res.sendStatus(200);

  const event = req.body.data;
  const eventType = event.event_type;
  const callControlId = event.payload.call_control_id;

  switch (eventType) {
    case 'call.initiated':
      // Answer the call
      await axios.post(
        `${BASE_URL}/calls/${callControlId}/actions/answer`,
        {},
        { headers: { Authorization: `Bearer ${API_KEY}` } }
      );
      break;

    case 'call.answered': {
      const confName = 'my-conference';

      if (!conferences.has(confName)) {
        // First participant -- create conference
        const response = await axios.post(
          `${BASE_URL}/conferences`,
          {
            call_control_id: callControlId,
            name: confName,
            beep_enabled: 'always',
          },
          { headers: { Authorization: `Bearer ${API_KEY}` } }
        );
        const confId = response.data.data.id;
        conferences.set(confName, confId);
        participants.set(callControlId, confName);

        // Put first caller on hold until someone else joins
        await axios.post(
          `${BASE_URL}/conferences/${confId}/actions/hold`,
          {
            call_control_ids: [callControlId],
            audio_url: 'https://example.com/hold-music.mp3',
          },
          { headers: { Authorization: `Bearer ${API_KEY}` } }
        );
      } else {
        // Subsequent participants -- join existing conference
        const confId = conferences.get(confName)!;
        await axios.post(
          `${BASE_URL}/conferences/${confId}/actions/join`,
          { call_control_id: callControlId },
          { headers: { Authorization: `Bearer ${API_KEY}` } }
        );
        participants.set(callControlId, confName);

        // Unhold everyone
        await axios.post(
          `${BASE_URL}/conferences/${confId}/actions/unhold`,
          {
            call_control_ids: Array.from(participants.keys()),
          },
          { headers: { Authorization: `Bearer ${API_KEY}` } }
        );
      }
      break;
    }

    case 'call.hangup':
      participants.delete(callControlId);
      break;
  }
});
```

### Conference Webhook Events

| Event | When |
|-------|------|
| `conference.created` | Conference room is ready |
| `conference.participant.joined` | Someone enters |
| `conference.participant.left` | Someone leaves |
| `conference.ended` | Last participant left |

---

## Media Streaming (WebSocket)

Media streaming forks call audio to a WebSocket in near-realtime without degrading the call.

### Starting a Stream

You can start streaming in three ways:

**1. When dialing:**
```bash
curl -X POST https://api.telnyx.com/v2/calls \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+18005550199",
    "from": "+18005550100",
    "connection_id": "your_connection_id",
    "stream_url": "wss://yourdomain.com/media-stream",
    "stream_track": "both_tracks"
  }'
```

**2. When answering:**
```bash
curl -X POST https://api.telnyx.com/v2/calls/{call_control_id}/actions/answer \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "stream_url": "wss://yourdomain.com/media-stream",
    "stream_track": "both_tracks"
  }'
```

**3. Mid-call via streaming_start:**
```bash
curl -X POST https://api.telnyx.com/v2/calls/{call_control_id}/actions/streaming_start \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "stream_url": "wss://yourdomain.com/media-stream",
    "stream_track": "inbound_track"
  }'
```

### stream_track Options

| Value | Description |
|-------|-------------|
| `inbound_track` | Audio from the caller (default) |
| `outbound_track` | Audio going to the caller |
| `both_tracks` | Both directions |

### Audio Codec / Format Options

| Codec | Sample Rate | Notes |
|-------|------------|-------|
| `PCMU` (G.711u) | 8000 Hz | Default, widely compatible |
| `PCMA` (G.711a) | 8000 Hz | European standard |
| `G722` | 16000 Hz | HD voice |
| `OPUS` | 16000 Hz | Modern, efficient |
| `AMR-WB` | 16000 Hz | Mobile networks |
| `L16` | Various | **Recommended for AI** -- raw linear PCM, no transcoding overhead |

### WebSocket Event Flow

When your WebSocket server receives a connection from Telnyx, events arrive in this order:

**1. Connected:**
```json
{
  "event": "connected",
  "version": "1.0.0"
}
```

**2. Start (stream metadata):**
```json
{
  "event": "start",
  "sequence_number": "1",
  "start": {
    "user_id": "3E6F995F-85F7-4705-9741-53B116D28237",
    "call_control_id": "v2:T02llQxI...",
    "call_session_id": "ff55a038-6f5d-11ef-9692-02420aeffb1f",
    "from": "+13122010094",
    "to": "+13122123456",
    "media_format": {
      "encoding": "PCMU",
      "sample_rate": 8000,
      "channels": 1
    }
  },
  "stream_id": "32DE0DEA-53CB-4B21-89A4-9E1819C043BC"
}
```

**3. Media (audio chunks -- repeating):**
```json
{
  "event": "media",
  "sequence_number": "4",
  "media": {
    "track": "inbound",
    "chunk": "2",
    "timestamp": "5",
    "payload": "<base64-encoded-audio>"
  },
  "stream_id": "32DE0DEA-53CB-4B21-89A4-9E1819C043BC"
}
```

**4. Stop:**
```json
{
  "event": "stop",
  "sequence_number": "5",
  "stop": {
    "user_id": "3E6F995F-85F7-4705-9741-53B116D28237",
    "call_control_id": "v2:T02llQxI..."
  },
  "stream_id": "32DE0DEA-53CB-4B21-89A4-9E1819C043BC"
}
```

**DTMF Event:**
```json
{
  "event": "dtmf",
  "stream_id": "32DE0DEA...",
  "occurred_at": "2025-06-05T08:54:19.698408Z",
  "sequence_number": "5",
  "dtmf": { "digit": "1" }
}
```

**IMPORTANT:** Event ordering is NOT guaranteed. Use the `chunk` number to reorder audio events.

### Bidirectional Streaming (Send Audio Back)

Enable bidirectional mode to send audio from your server back into the call:

```bash
curl -X POST https://api.telnyx.com/v2/calls \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "to": "+18005550199",
    "from": "+18005550100",
    "connection_id": "uuid",
    "stream_url": "wss://yourdomain.com/media-stream",
    "stream_track": "both_tracks",
    "stream_bidirectional_mode": "rtp",
    "stream_bidirectional_codec": "L16"
  }'
```

**Send audio back to the caller:**
```json
{
  "event": "media",
  "media": {
    "payload": "<base64-encoded-audio-rtp>"
  }
}
```

**Send MP3 file:**
```json
{
  "event": "media",
  "media": {
    "payload": "<base64-encoded-mp3>"
  }
}
```

**Clear audio queue (interrupt):**
```json
{
  "event": "clear"
}
```

**Mark messages (track playback completion):**
```json
{
  "event": "mark",
  "mark": { "name": "greeting-end" }
}
```
When the audio before this mark finishes playing, you receive the mark event back.

### Bidirectional Constraints

- Chunk size: 20ms to 30 seconds
- Only 1 bidirectional stream per call
- Only MP3 for file playback (max 1 submission/sec)
- L16 codec recommended for AI integrations (no transcoding overhead)
- Transcoding occurs if your codec differs from call codec (quality loss)

### Complete WebSocket Server (Node.js)

```typescript
import { WebSocketServer, WebSocket } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws: WebSocket) => {
  console.log('Telnyx media stream connected');

  let streamId: string;
  let callControlId: string;
  let mediaFormat: { encoding: string; sample_rate: number; channels: number };

  ws.on('message', (data: Buffer) => {
    const message = JSON.parse(data.toString());

    switch (message.event) {
      case 'connected':
        console.log('Stream connected, version:', message.version);
        break;

      case 'start':
        streamId = message.stream_id;
        callControlId = message.start.call_control_id;
        mediaFormat = message.start.media_format;
        console.log(`Stream started: ${streamId}`);
        console.log(`Format: ${mediaFormat.encoding} @ ${mediaFormat.sample_rate}Hz`);
        console.log(`From: ${message.start.from} To: ${message.start.to}`);
        break;

      case 'media': {
        const audioBuffer = Buffer.from(message.media.payload, 'base64');
        const track = message.media.track; // 'inbound' or 'outbound'
        const chunk = parseInt(message.media.chunk, 10);

        // Process audio here:
        // - Send to STT service (Deepgram, Google, etc.)
        // - Send to AI model (OpenAI Realtime, etc.)
        // - Buffer for analysis
        console.log(`Audio chunk ${chunk} from ${track}: ${audioBuffer.length} bytes`);

        // To send audio back (bidirectional mode):
        // ws.send(JSON.stringify({
        //   event: 'media',
        //   media: { payload: responseAudioBase64 }
        // }));
        break;
      }

      case 'dtmf':
        console.log(`DTMF digit pressed: ${message.dtmf.digit}`);
        break;

      case 'mark':
        console.log(`Mark reached: ${message.mark.name}`);
        break;

      case 'stop':
        console.log(`Stream stopped: ${message.stream_id}`);
        break;

      case 'error':
        console.error(`Stream error: ${message.payload.title} - ${message.payload.detail}`);
        break;
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
  });
});

console.log('Media streaming WebSocket server running on :8080');
```

### Error Codes

| Code | Title | Description |
|------|-------|-------------|
| 100002 | unknown_error | Stream processing failure |
| 100003 | malformed_frame | Incorrectly formatted frame |
| 100004 | invalid_media | Non-base64 encoded media |
| 100005 | rate_limit_reached | Excessive request frequency |

---

## Telnyx Recording

### Start Recording (Node.js)

```typescript
// Using axios
await axios.post(
  `https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`,
  {
    format: 'mp3',        // 'mp3' or 'wav'
    channels: 'dual',     // 'single' (mixed) or 'dual' (separate legs)
  },
  { headers: { Authorization: `Bearer ${API_KEY}` } }
);

// Using superagent (from official demos)
function call_control_record_start(apiKey: string, callControlId: string) {
  superagent
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${apiKey}`)
    .post(`https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`)
    .send({ format: 'mp3', channels: 'dual' })
    .then((response) => console.log(response.body))
    .catch((error) => console.log(error));
}
```

### Stop Recording

```typescript
await axios.post(
  `https://api.telnyx.com/v2/calls/${callControlId}/actions/record_stop`,
  {},
  { headers: { Authorization: `Bearer ${API_KEY}` } }
);
```

Recording also automatically stops on call hangup.

### Conference Recording

```bash
# Start conference recording
curl -X POST https://api.telnyx.com/v2/conferences/{conference_id}/actions/record_start \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"format": "mp3", "channels": "dual"}'

# Stop conference recording
curl -X POST https://api.telnyx.com/v2/conferences/{conference_id}/actions/record_stop \
  -H "Authorization: Bearer $API_KEY"
```

### Recording Webhook

When recording completes, Telnyx sends a `call.recording.saved` webhook with the recording URL.

---

# LIVEKIT

## LiveKit Overview & NPM Setup

LiveKit is an **open-source, real-time communication platform** built on WebRTC. It provides rooms where participants can exchange audio, video, and data. Its key differentiator is the **SIP bridge** (connecting phone calls to rooms) and the **Agents framework** (AI participants in rooms).

### NPM Packages

**Server SDK (backend -- room management, tokens, SIP):**
```bash
npm install livekit-server-sdk
```

**Client SDK (frontend -- connecting to rooms):**
```bash
npm install livekit-client
```

**Agents framework (AI agents):**
```bash
npm install @livekit/agents
```

**Agent plugins:**
```bash
npm install @livekit/agents-plugin-openai      # LLM, TTS, STT
npm install @livekit/agents-plugin-deepgram     # STT, TTS
npm install @livekit/agents-plugin-google       # LLM, TTS
npm install @livekit/agents-plugin-elevenlabs   # TTS
npm install @livekit/agents-plugin-cartesia     # TTS
npm install @livekit/agents-plugin-silero       # VAD (Voice Activity Detection)
npm install @livekit/agents-plugin-livekit      # End-of-utterance detection
npm install @livekit/noise-cancellation-node    # Noise cancellation
```

**Environment variables:**
```bash
export LIVEKIT_URL="wss://your-project.livekit.cloud"
export LIVEKIT_API_KEY="your-api-key"
export LIVEKIT_API_SECRET="your-api-secret"
```

---

## LiveKit Rooms

A **Room** is the fundamental container for a LiveKit session. Participants join rooms and exchange audio/video/data tracks.

- Rooms close automatically when the last participant leaves (after a configurable timeout)
- Rooms can be created explicitly or implicitly (auto-created when first participant joins)

### Room Management (Node.js)

```typescript
import { Room, RoomServiceClient } from 'livekit-server-sdk';

const livekitHost = 'https://your-project.livekit.cloud';
const roomService = new RoomServiceClient(
  livekitHost,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

// Create a room
const room = await roomService.createRoom({
  name: 'my-conference-room',
  emptyTimeout: 10 * 60,    // Close after 10 min if empty (seconds)
  maxParticipants: 20,
});
console.log('Room created:', room.name, room.sid);

// List all rooms
const rooms = await roomService.listRooms();
console.log('Active rooms:', rooms.map(r => r.name));

// Delete a room (disconnects all participants)
await roomService.deleteRoom('my-conference-room');
```

---

## Participants & Tokens

### Participant Types

| Kind | Description |
|------|-------------|
| `STANDARD` | Regular end-user |
| `AGENT` | AI agent (via Agents framework) |
| `SIP` | Phone call participant |
| `EGRESS` | Recording process |
| `INGRESS` | Media ingestion process |

### Generating Access Tokens

```typescript
import { AccessToken, VideoGrant, SIPGrant } from 'livekit-server-sdk';

// Basic token for a room participant
const token = new AccessToken('api-key', 'secret-key', {
  identity: 'user-123',
  ttl: '6h',  // Default is 6 hours
});
token.addGrant({
  roomJoin: true,
  room: 'my-room',
  canPublish: true,
  canSubscribe: true,
  canPublishData: true,
});
const jwt = await token.toJwt();

// Subscribe-only token (observer)
const observerToken = new AccessToken('api-key', 'secret-key', {
  identity: 'observer-1',
});
observerToken.addGrant({
  roomJoin: true,
  room: 'my-room',
  canPublish: false,
  canSubscribe: true,
  canPublishData: false,
});

// Admin token with SIP grants
const adminToken = new AccessToken('api-key', 'secret-key', {
  identity: 'admin',
});
const sipGrant: SIPGrant = { admin: true, call: true };
const videoGrant: VideoGrant = {
  roomCreate: true,
  roomList: true,
  roomAdmin: true,
  roomRecord: true,
};
adminToken.addGrant(sipGrant);
adminToken.addGrant(videoGrant);
```

### Video Grant Permissions

| Permission | Type | Purpose |
|------------|------|---------|
| `roomCreate` | boolean | Create/delete rooms |
| `roomList` | boolean | List rooms |
| `roomJoin` | boolean | Join a room |
| `roomAdmin` | boolean | Moderate (mute, remove, etc.) |
| `roomRecord` | boolean | Use Egress service |
| `room` | string | Room name to join |
| `canPublish` | boolean | Publish audio/video tracks |
| `canPublishData` | boolean | Publish data messages |
| `canSubscribe` | boolean | Subscribe to others' tracks |
| `canPublishSources` | string[] | Restrict sources: `camera`, `microphone`, `screen_share`, `screen_share_audio` |
| `hidden` | boolean | Invisible to other participants |

### Managing Participants (Server-Side)

```typescript
import { RoomServiceClient } from 'livekit-server-sdk';

const roomService = new RoomServiceClient(host, apiKey, apiSecret);

// List participants in a room
const participants = await roomService.listParticipants('my-room');

// Get a specific participant
const participant = await roomService.getParticipant('my-room', 'user-123');

// Update participant permissions mid-session
await roomService.updateParticipant('my-room', 'user-123', undefined, {
  canPublish: true,
  canSubscribe: true,
  canPublishData: true,
});

// Mute a participant's track
await roomService.mutePublishedTrack('my-room', 'user-123', 'track-sid', true);

// Remove a participant
await roomService.removeParticipant('my-room', 'user-123');
```

### Webhooks

```typescript
import { WebhookReceiver } from 'livekit-server-sdk';

const receiver = new WebhookReceiver('api-key', 'api-secret');

// Express middleware (IMPORTANT: use raw body)
app.use('/livekit-webhook', express.raw({ type: 'application/webhook+json' }));

app.post('/livekit-webhook', async (req, res) => {
  const event = await receiver.receive(req.body, req.get('Authorization'));
  console.log('LiveKit event:', event.event); // 'room_started', 'participant_joined', etc.
  res.sendStatus(200);
});
```

---

## SIP Bridge (Telephony)

LiveKit's SIP bridge connects traditional phone calls (PSTN/SIP) to LiveKit rooms. Phone callers become regular room participants.

### Architecture

```
Phone (PSTN) → SIP Provider (Telnyx) → LiveKit SIP Bridge → LiveKit Room
                                                                ↕
                                                          Your Agent / Other Participants
```

### Key Components

1. **SIP Trunk (Inbound):** Accepts incoming calls from a SIP provider
2. **SIP Trunk (Outbound):** Places outgoing calls via a SIP provider
3. **Dispatch Rules:** Route inbound calls to rooms
4. **SIP Participants:** Phone callers represented as room participants

### Creating an Inbound Trunk (Node.js)

```typescript
import { SipClient } from 'livekit-server-sdk';

const sipClient = new SipClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

// Create an inbound trunk for your Telnyx number
const inboundTrunk = await sipClient.createSipInboundTrunk(
  'Telnyx Inbound',                // name
  ['+15105550100'],                // phone numbers
  {
    krispEnabled: true,            // Enable noise cancellation
  },
);
console.log('Inbound trunk created:', inboundTrunk);
```

### Creating a Dispatch Rule (Node.js)

Dispatch rules control how inbound calls are routed to rooms.

```typescript
import { SipClient } from 'livekit-server-sdk';
import { RoomConfiguration, RoomAgentDispatch } from '@livekit/protocol';

const sipClient = new SipClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

// Route each incoming call to its own room with "call-" prefix
const dispatchRule = await sipClient.createSipDispatchRule(
  {
    type: 'individual',
    roomPrefix: 'call-',           // Each call gets "call-<unique>"
  },
  {
    name: 'My dispatch rule',
    roomConfig: new RoomConfiguration({
      agents: [
        new RoomAgentDispatch({
          agentName: 'inbound-agent',
          metadata: 'dispatch metadata',
        }),
      ],
    }),
  },
);
console.log('Dispatch rule created:', dispatchRule);
```

### Creating an Outbound Trunk (Node.js)

```typescript
const outboundTrunk = await sipClient.createSipOutboundTrunk(
  'Telnyx Outbound',               // name
  'sip.telnyx.com',                // SIP provider address
  ['+15105550100'],                // your phone numbers
  {
    auth_username: '<telnyx-username>',
    auth_password: '<telnyx-password>',
  },
);
console.log('Outbound trunk ID:', outboundTrunk.sipTrunkId);
```

### Making an Outbound Call (Node.js)

```typescript
import { SipClient } from 'livekit-server-sdk';

const sipClient = new SipClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

// Create a SIP participant in a room (dials the phone number)
const sipParticipant = await sipClient.createSipParticipant(
  'ST_outbound_trunk_id',          // outbound trunk ID
  '+14155551234',                  // phone number to call
  'my-room',                      // LiveKit room name
  {
    participantIdentity: 'phone-user',
    participantName: 'John Doe',
    waitUntilAnswered: true,       // Block until call is answered
  },
);
console.log('SIP participant:', sipParticipant);
```

### Supported SIP Features

| Feature | Supported |
|---------|-----------|
| SIP over UDP/TCP/TLS | Yes |
| DTMF (RFC 2833/4733) | Yes |
| Cold call transfer (REFER) | Yes |
| Warm call transfer (agent-assisted) | Yes |
| Caller ID | Yes |
| RTP / SRTP | Yes |
| SIP OPTIONS | Yes |
| SIP Registration (REGISTER) | No |
| SIPRECT | No |
| Video over SIP | No |

### Tested SIP Providers

Twilio, **Telnyx**, Exotel, Plivo, Wavix

---

## Egress / Recording

LiveKit Egress exports room sessions or individual tracks as recordings.

### Egress Types

| Type | What it records | Use case |
|------|----------------|----------|
| **RoomComposite** | Entire room (all participants) | Meeting recordings |
| **Participant** | One participant's audio + video | Speaker isolation |
| **TrackComposite** | Specific audio + video tracks | Post-production |
| **Track** | Single track (no transcoding) | Streaming audio to STT |
| **Web** | Any web page | Restreaming |

### Auto Egress (automatic recording on room creation)

Configure when creating a room to automatically record:

```typescript
const room = await roomService.createRoom({
  name: 'recorded-room',
  emptyTimeout: 600,
  egress: {
    room: {
      // Room composite egress config
      fileOutputs: [{
        filepath: 'recordings/{room_name}/{time}.mp4',
      }],
    },
    tracks: {
      // Track egress for each published track
      fileOutputs: [{
        filepath: 'tracks/{room_name}/{track_id}.ogg',
      }],
    },
  },
});
```

### Track Egress to WebSocket (streaming audio to external service)

Useful for sending live audio to a captioning or STT service:

```typescript
import { EgressClient, TrackEgressRequest } from 'livekit-server-sdk';

const egressClient = new EgressClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

// Stream a track to a WebSocket endpoint
const egress = await egressClient.startTrackEgress(
  'my-room',
  {
    wsUrl: 'wss://yourdomain.com/audio-stream',
  },
  'TR_audio_track_sid',
);
```

---

## Agents Framework

The LiveKit Agents framework lets you add **AI-powered participants** to rooms. Agents can listen, speak, process audio through STT-LLM-TTS pipelines, and interact naturally.

### Architecture

```
User speaks → WebRTC Audio Track → Agent subscribes
  → STT (Speech-to-Text) → Text
    → LLM (Language Model) → Response text
      → TTS (Text-to-Speech) → Audio
        → Agent publishes → WebRTC Audio Track → User hears
```

### Key Concepts

- **Agent:** An LLM-based application with defined instructions
- **AgentSession:** Container managing interactions between agent and user
- **entrypoint (entry):** Starting point for the agent (like a request handler)
- **Worker:** Coordinates job scheduling and launches agents
- **JobContext:** Provides room access and participant management

### Voice Agent (Node.js/TypeScript)

**agent.ts:**
```typescript
import { voice } from '@livekit/agents';

export class Agent extends voice.Agent {
  constructor() {
    super({
      instructions: `You are a helpful voice AI assistant.
        Your responses are concise and without complex formatting.
        You are curious, friendly, and have a sense of humor.`,
    });
  }
}
```

**index.ts (entrypoint):**
```typescript
import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  voice,
} from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
import * as livekit from '@livekit/agents-plugin-livekit';
import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Agent } from './agent';

dotenv.config({ path: '.env.local' });

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    // Preload VAD model before any job
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    const vad = ctx.proc.userData.vad! as silero.VAD;

    const session = new voice.AgentSession({
      vad,
      stt: 'deepgram/nova-3:multi',
      llm: 'openai/gpt-4.1-mini',
      tts: 'cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc',
      turnDetection: new livekit.turnDetector.MultilingualModel(),
    });

    await session.start({
      agent: new Agent(),
      room: ctx.room,
      inputOptions: {
        // For telephony, use TelephonyBackgroundVoiceCancellation
        noiseCancellation: BackgroundVoiceCancellation(),
      },
    });

    await ctx.connect();

    // Generate initial greeting
    const handle = session.generateReply({
      instructions: 'Greet the user and offer your assistance.',
    });
    await handle.waitForPlayout();
  },
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: 'my-agent',
}));
```

### Running the Agent

```bash
# Development mode (auto-restarts)
node dist/index.js dev

# Production mode
node dist/index.js start
```

### Required Environment Variables

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-key
LIVEKIT_API_SECRET=your-secret
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...
CARTESIA_API_KEY=...
```

### Agent Pipeline Nodes (Customization Points)

| Node | Input | Output | Purpose |
|------|-------|--------|---------|
| `stt_node()` | AudioFrame stream | SpeechEvent stream | Custom STT or preprocessing |
| `llm_node()` | ChatContext + tools | ChatChunk stream | Custom LLM or RAG injection |
| `tts_node()` | Text stream | AudioFrame stream | Custom TTS or audio processing |
| `on_user_turn_completed()` | -- | -- | Modify messages before LLM, add RAG context |
| `realtime_audio_output_node()` | AudioFrame stream | AudioFrame stream | Audio post-processing |

### Realtime Model Agent (Lower Latency)

Using OpenAI's Realtime API (combined STT+LLM+TTS):

```typescript
import * as openai from '@livekit/agents-plugin-openai';

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const session = new voice.AgentSession({
      llm: new openai.realtime.RealtimeModel({
        voice: 'coral',
      }),
    });

    await session.start({
      agent: new Agent(),
      room: ctx.room,
      inputOptions: {
        noiseCancellation: BackgroundVoiceCancellation(),
      },
    });

    await ctx.connect();

    session.generateReply({
      instructions: 'Greet the user and offer your assistance.',
    });
  },
});
```

---

# COMBINED ARCHITECTURE: Telnyx + LiveKit

## Architecture Diagram

```
                        PSTN / Phone Network
                              │
                              ▼
                    ┌──────────────────┐
                    │   Telnyx SIP     │
                    │   Provider       │
                    │                  │
                    │  - Phone Numbers │
                    │  - SIP Trunking  │
                    │  - FQDN Routing  │
                    └────────┬─────────┘
                             │ SIP (UDP/TCP/TLS)
                             ▼
                    ┌──────────────────┐
                    │  LiveKit SIP     │
                    │  Bridge          │
                    │                  │
                    │  - Trunk Auth    │
                    │  - Dispatch      │
                    │  - SIP↔WebRTC    │
                    └────────┬─────────┘
                             │ WebRTC
                             ▼
                    ┌──────────────────┐
                    │  LiveKit Room    │◄────── Your Agent (AI)
                    │                  │◄────── Other Participants
                    │  - Audio Tracks  │◄────── Recording (Egress)
                    │  - Data Channels │◄────── Web Dashboard
                    │  - SIP Participant│
                    └──────────────────┘
```

## Audio Flow

**Inbound call (phone → your code):**
```
1. User dials your Telnyx phone number
2. Telnyx receives the call via PSTN
3. Telnyx routes SIP INVITE to LiveKit's SIP endpoint (configured via FQDN)
4. LiveKit SIP bridge authenticates the trunk
5. Dispatch rule matches → creates/joins a LiveKit room
6. SIP participant is created (represents the phone caller)
7. Audio is transcoded: RTP (SIP) ↔ WebRTC (LiveKit)
8. Your agent/app subscribes to the SIP participant's audio track
9. Your agent publishes audio back → transcoded to RTP → sent to caller
```

**Outbound call (your code → phone):**
```
1. Your app calls CreateSIPParticipant API
2. LiveKit sends SIP INVITE via outbound trunk to Telnyx
3. Telnyx places the call to the phone number
4. Phone rings, user answers
5. Audio flows: User → Telnyx → LiveKit SIP → Room → Your Agent
6. Agent responds: Agent → Room → LiveKit SIP → Telnyx → User's phone
```

**Audio codec chain:**
```
Phone (G.711) → Telnyx (G.711/G.722) → LiveKit SIP Bridge (Opus/WebRTC) → Room → Agent
```

---

## Setting Up Telnyx as SIP Provider for LiveKit

### Prerequisites

- Paid Telnyx account (not trial)
- Telnyx phone number purchased
- LiveKit Cloud project (or self-hosted with SIP service)

### Step 1: Create FQDN Connection on Telnyx

```bash
export TELNYX_API_KEY="<your_api_v2_key>"

# For inbound + outbound, first create an outbound voice profile:
curl -L 'https://api.telnyx.com/v2/outbound_voice_profiles' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -d '{
    "name": "LiveKit outbound voice profile",
    "traffic_type": "conversational",
    "service_plan": "global"
  }'
# Note the outbound_voice_profile_id from the response

# Create FQDN connection with credentials:
curl -L 'https://api.telnyx.com/v2/fqdn_connections' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -d '{
    "active": true,
    "anchorsite_override": "Latency",
    "connection_name": "LiveKit trunk",
    "user_name": "<choose-a-username>",
    "password": "<choose-a-password>",
    "inbound": {
      "ani_number_format": "+E.164",
      "dnis_number_format": "+e164"
    },
    "outbound": {
      "outbound_voice_profile_id": "<voice_profile_id>"
    },
    "transport_protocol": "TCP"
  }'
# Note the connection_id from the response
```

### Step 2: Create FQDN Record Pointing to LiveKit

```bash
# Your LiveKit SIP endpoint (from your LiveKit Cloud dashboard)
# Example: vjnxecm0tjk.sip.livekit.cloud

curl -L 'https://api.telnyx.com/v2/fqdns' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -d '{
    "connection_id": "<connection_id>",
    "fqdn": "<your-livekit-sip-endpoint>",
    "port": 5060,
    "dns_record_type": "a"
  }'
```

### Step 3: Associate Phone Number with FQDN Connection

```bash
# Get your phone number ID
curl -L 'https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=5105550100' \
  -H "Authorization: Bearer $TELNYX_API_KEY"

# Attach connection to phone number
curl -L -X PATCH "https://api.telnyx.com/v2/phone_numbers/<phone_number_id>" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -d '{
    "connection_id": "<connection_id>"
  }'
```

### Step 4: Create LiveKit SIP Trunks

```typescript
import { SipClient } from 'livekit-server-sdk';
import { RoomConfiguration, RoomAgentDispatch } from '@livekit/protocol';

const sipClient = new SipClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

// Inbound trunk (receives calls from Telnyx)
const inboundTrunk = await sipClient.createSipInboundTrunk(
  'Telnyx Inbound',
  ['+15105550100'],   // Your Telnyx phone number
  { krispEnabled: true },
);
console.log('Inbound trunk ID:', inboundTrunk.sipTrunkId);

// Dispatch rule (route calls to individual rooms with an agent)
const dispatchRule = await sipClient.createSipDispatchRule(
  {
    type: 'individual',
    roomPrefix: 'call-',
  },
  {
    name: 'Route to agent',
    roomConfig: new RoomConfiguration({
      agents: [
        new RoomAgentDispatch({
          agentName: 'voice-agent',
          metadata: 'inbound-call',
        }),
      ],
    }),
  },
);

// Outbound trunk (make calls through Telnyx)
const outboundTrunk = await sipClient.createSipOutboundTrunk(
  'Telnyx Outbound',
  'sip.telnyx.com',
  ['+15105550100'],
  {
    auth_username: '<telnyx-username>',
    auth_password: '<telnyx-password>',
    headers_to_attributes: {
      'X-Telnyx-Username': '<telnyx-username>',
    },
  },
);
console.log('Outbound trunk ID:', outboundTrunk.sipTrunkId);
```

### Step 5 (Optional): Enable HD Voice

In Telnyx portal, enable G.722 codec on the SIP trunk for HD voice. Keep G.711U for compatibility fallback.

---

## Complete Code: Bridge Two Phone Numbers via LiveKit Room

This bridges two phone callers together through a LiveKit room so you can record, transcribe, or add AI participants.

```typescript
// bridge-calls.ts
import { SipClient, RoomServiceClient } from 'livekit-server-sdk';

const sipClient = new SipClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

const roomService = new RoomServiceClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

const OUTBOUND_TRUNK_ID = process.env.SIP_OUTBOUND_TRUNK_ID!; // "ST_..."

async function bridgeTwoNumbers(
  phoneNumber1: string,
  phoneNumber2: string,
  roomName: string,
) {
  // Step 1: Create a LiveKit room
  const room = await roomService.createRoom({
    name: roomName,
    emptyTimeout: 300,        // 5 min empty timeout
    maxParticipants: 10,
  });
  console.log(`Room created: ${room.name} (${room.sid})`);

  // Step 2: Dial phone number 1 into the room
  console.log(`Dialing ${phoneNumber1}...`);
  const participant1 = await sipClient.createSipParticipant(
    OUTBOUND_TRUNK_ID,
    phoneNumber1,
    roomName,
    {
      participantIdentity: 'caller-1',
      participantName: 'Caller One',
      waitUntilAnswered: true,
    },
  );
  console.log(`Caller 1 connected: ${participant1.participantIdentity}`);

  // Step 3: Dial phone number 2 into the same room
  console.log(`Dialing ${phoneNumber2}...`);
  const participant2 = await sipClient.createSipParticipant(
    OUTBOUND_TRUNK_ID,
    phoneNumber2,
    roomName,
    {
      participantIdentity: 'caller-2',
      participantName: 'Caller Two',
      waitUntilAnswered: true,
    },
  );
  console.log(`Caller 2 connected: ${participant2.participantIdentity}`);

  // Both callers are now in the same LiveKit room
  // They can hear each other through WebRTC audio tracks
  // You can also add an AI agent, recording, etc.

  console.log('Both callers bridged in room:', roomName);
  return { room, participant1, participant2 };
}

// Usage
bridgeTwoNumbers('+14155551234', '+12125556789', 'bridge-room-001')
  .then(() => console.log('Bridge established'))
  .catch(console.error);
```

### Adding Recording to the Bridge

```typescript
import { EgressClient, EncodedFileOutput, S3Upload } from 'livekit-server-sdk';

const egressClient = new EgressClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

// Record the entire room (both participants mixed)
const egress = await egressClient.startRoomCompositeEgress(
  'bridge-room-001',
  {
    file: new EncodedFileOutput({
      filepath: 'recordings/bridge-{room_name}-{time}.mp4',
      output: {
        case: 's3',
        value: new S3Upload({
          accessKey: process.env.AWS_ACCESS_KEY!,
          secret: process.env.AWS_SECRET_KEY!,
          bucket: 'my-recordings-bucket',
          region: 'us-east-1',
        }),
      },
    }),
  },
);
console.log('Recording started:', egress.egressId);
```

---

## Complete Code: Voice AI Agent Handling Phone Calls

This is a complete LiveKit Agent that handles inbound phone calls from Telnyx.

**agent.ts:**
```typescript
import { voice, llm } from '@livekit/agents';
import { z } from 'zod';

export class PhoneAgent extends voice.Agent {
  constructor() {
    super({
      instructions: `You are a helpful phone assistant for Acme Corp.
        You help callers with scheduling, questions, and general support.
        Keep responses conversational and brief since this is a phone call.
        Always confirm important details by repeating them back.`,
      tools: [
        llm.tool({
          name: 'transfer_call',
          description: 'Transfer the caller to a specific department',
          schema: z.object({
            department: z.enum(['sales', 'support', 'billing']),
            reason: z.string(),
          }),
          handler: async ({ department, reason }) => {
            console.log(`Transferring to ${department}: ${reason}`);
            return `Transferring you to ${department} now. Please hold.`;
          },
        }),
        llm.tool({
          name: 'lookup_account',
          description: 'Look up a customer account by phone number',
          schema: z.object({
            phone: z.string(),
          }),
          handler: async ({ phone }) => {
            // Your database lookup here
            return `Found account for ${phone}: John Doe, Premium plan.`;
          },
        }),
      ],
    });
  }
}
```

**index.ts:**
```typescript
import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  voice,
} from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
import * as livekit from '@livekit/agents-plugin-livekit';
import { BackgroundVoiceCancellation } from '@livekit/noise-cancellation-node';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PhoneAgent } from './agent';

dotenv.config({ path: '.env.local' });

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    const vad = ctx.proc.userData.vad! as silero.VAD;

    const session = new voice.AgentSession({
      vad,
      stt: 'deepgram/nova-3:multi',
      llm: 'openai/gpt-4.1-mini',
      tts: 'cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc',
      turnDetection: new livekit.turnDetector.MultilingualModel(),
    });

    await session.start({
      agent: new PhoneAgent(),
      room: ctx.room,
      inputOptions: {
        // Use telephony-optimized noise cancellation for SIP participants
        noiseCancellation: BackgroundVoiceCancellation(),
      },
    });

    await ctx.connect();

    // Greet the caller
    const handle = session.generateReply({
      instructions: 'Greet the caller warmly. Ask how you can help them today.',
    });
    await handle.waitForPlayout();
  },
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: 'voice-agent',   // Must match dispatch rule agentName
}));
```

**Run:**
```bash
# Install dependencies
npm install @livekit/agents @livekit/agents-plugin-silero \
  @livekit/agents-plugin-livekit @livekit/agents-plugin-openai \
  @livekit/noise-cancellation-node dotenv zod

# Build and run
npx tsc && node dist/index.js dev
```

Now when someone calls your Telnyx number:
1. Telnyx routes the SIP INVITE to LiveKit
2. LiveKit creates room "call-<unique-id>" (from dispatch rule)
3. LiveKit dispatches "voice-agent" into the room
4. The agent greets the caller and begins conversing

---

## Comparison: Telnyx-Only vs Telnyx+LiveKit

| Aspect | Telnyx Only (Call Control) | Telnyx + LiveKit |
|--------|---------------------------|------------------|
| **Audio access** | Media streaming WebSocket | WebRTC tracks in room |
| **Multi-party** | Telnyx Conferences | LiveKit Rooms |
| **AI agent** | Build custom via WebSocket | LiveKit Agents framework |
| **Recording** | Telnyx recording API | LiveKit Egress |
| **Scalability** | Telnyx handles it | LiveKit Cloud auto-scales |
| **Complexity** | Medium (webhook/REST) | Higher setup, but more powerful |
| **Latency** | Direct (Telnyx WebSocket) | Extra hop through SIP bridge |
| **Best for** | Simple IVRs, direct AI integration via WebSocket | Multi-modal rooms, multiple participants, complex agent workflows |

### When to use Telnyx alone:
- Simple 1:1 call with AI agent via media streaming
- Basic conference bridging
- You want minimal infrastructure

### When to add LiveKit:
- You need multiple participants (phone + web + AI agent) in one room
- You want the Agents framework for STT-LLM-TTS pipeline
- You need recording/egress with cloud storage
- You want web-based dashboards showing the call in real-time
- You need to mix phone calls with WebRTC browser participants

---
---

# PART 2: PRODUCT-SPECIFIC INFRASTRUCTURE

This section maps Telnyx + LiveKit to the two products we are building:
1. **ASR Data Capture Platform** — Record phone conversations, transcribe with word-level timestamps, export as training datasets
2. **Voice Agent Evaluation Platform** — Test voice AI agents with scripted human testers, score agent performance

---

## Product 1: ASR Data Capture Platform

### What It Does

```
┌─────────┐     Telnyx PSTN     ┌─────────────┐     Audio Stream      ┌──────────┐
│ Phone A  │ ←────────────────→ │   Telnyx     │ ────WebSocket────→   │ ASR      │
│ (+91)    │                    │   Conference │                      │ Engine   │
│          │                    │   + Media    │                      │ (DG/     │
│ Phone B  │ ←────────────────→ │   Streaming  │ ────WebSocket────→   │  Sarvam) │
│ (+91)    │                    │              │                      │          │
└─────────┘                    │   Recording  │                      └────┬─────┘
                                └──────┬───────┘                           │
                                       │                                    │
                                       ▼                                    ▼
                              ┌────────────────┐              ┌──────────────────┐
                              │ Local WAV files │              │ Postgres          │
                              │ per-speaker     │              │ - transcripts     │
                              └─────────────────┘              │ - word timestamps │
                                                               │ - confidence      │
                                                               └──────────────────┘
```

### Architecture: Telnyx-Only (Recommended for ASR Capture)

No LiveKit needed. Telnyx alone provides everything:

```typescript
import Telnyx from 'telnyx';
import { WebSocketServer } from 'ws';
import express from 'express';

const telnyx = new Telnyx(process.env.TELNYX_API_KEY);
const app = express();

// ── Step 1: Create a conference and dial both phones ────────────────

async function startCapture(phoneA: string, phoneB: string) {
  // Create outbound call to Phone A
  const callA = await telnyx.calls.create({
    connection_id: process.env.TELNYX_SIP_CONNECTION_ID,
    to: phoneA,
    from: process.env.TELNYX_PHONE_NUMBER,
    webhook_url: `${BASE_URL}/telnyx/events`,
    stream_url: `wss://${WS_HOST}/audio-stream`,  // Media streaming!
    stream_track: 'inbound_track',                 // Phone A's voice only
  });

  // Create outbound call to Phone B (with delay)
  await new Promise(r => setTimeout(r, 2000));

  const callB = await telnyx.calls.create({
    connection_id: process.env.TELNYX_SIP_CONNECTION_ID,
    to: phoneB,
    from: process.env.TELNYX_PHONE_NUMBER,
    webhook_url: `${BASE_URL}/telnyx/events`,
    stream_url: `wss://${WS_HOST}/audio-stream`,
    stream_track: 'inbound_track',
  });

  return { callA, callB };
}

// ── Step 2: Handle Telnyx webhooks ──────────────────────────────────

app.post('/telnyx/events', async (req, res) => {
  const event = req.body.data;
  const callId = event.payload.call_control_id;

  switch (event.event_type) {
    case 'call.answered':
      // Join both calls into the same conference
      await telnyx.calls.join({
        call_control_id: callId,
        conference_id: `capture-${captureId}`,
        start_conference_on_create: true,
        // Enable recording at conference level
      });
      break;

    case 'call.hangup':
      // One party hung up — end the conference
      console.log('Call ended:', callId);
      break;

    case 'conference.recording.saved':
      // Telnyx gives us the recording URL
      const recordingUrl = event.payload.recording_urls.mp3;
      console.log('Recording saved:', recordingUrl);
      break;
  }

  res.sendStatus(200);
});
```

### Audio Codec Selection for ASR Quality

Telnyx supports 6 codecs for media streaming. The choice directly impacts ASR accuracy:

```
┌──────────────────────────────────────────────────────────────────┐
│                    CODEC COMPARISON FOR ASR                       │
├──────────┬───────────┬──────────┬────────┬──────────────────────┤
│ Codec    │ Bandwidth │ Quality  │ Latency│ ASR Recommendation   │
├──────────┼───────────┼──────────┼────────┼──────────────────────┤
│ PCMU     │ 64 kbps   │ Phone    │ Low    │ OK — standard        │
│ (mulaw)  │ 8 kHz     │ quality  │        │ telephony, all ASR   │
│          │           │          │        │ engines support it    │
├──────────┼───────────┼──────────┼────────┼──────────────────────┤
│ L16      │ 256 kbps  │ CD-like  │ Low    │ BEST — uncompressed  │
│ (PCM)    │ 16 kHz    │          │        │ 16kHz, highest ASR   │
│          │           │          │        │ accuracy possible    │
├──────────┼───────────┼──────────┼────────┼──────────────────────┤
│ G722     │ 64 kbps   │ HD Voice │ Low    │ GREAT — wideband     │
│          │ 16 kHz    │          │        │ 16kHz in 64kbps,     │
│          │           │          │        │ best bandwidth/      │
│          │           │          │        │ quality tradeoff     │
├──────────┼───────────┼──────────┼────────┼──────────────────────┤
│ OPUS     │ 6-510kbps │ Adaptive │ Low    │ GREAT — adaptive,    │
│          │ up to     │          │        │ wideband, good for   │
│          │ 48 kHz    │          │        │ variable networks    │
├──────────┼───────────┼──────────┼────────┼──────────────────────┤
│ PCMA     │ 64 kbps   │ Phone    │ Low    │ OK — A-law variant,  │
│ (alaw)   │ 8 kHz     │ quality  │        │ used in Europe/India │
├──────────┼───────────┼──────────┼────────┼──────────────────────┤
│ AMR-WB   │ 6-24 kbps │ Good     │ Medium │ DECENT — mobile-     │
│          │ 16 kHz    │          │        │ optimized wideband   │
└──────────┴───────────┴──────────┴────────┴──────────────────────┘

RECOMMENDATION FOR ASR DATASETS:
  1st choice: L16 (16kHz PCM) — cleanest signal, no compression artifacts
  2nd choice: G722 — HD quality at low bandwidth
  3rd choice: PCMU — if ASR engine only supports 8kHz (older models)
```

### Telnyx Media Stream WebSocket — Complete Message Protocol

```typescript
// ── All WebSocket messages from Telnyx ──────────────────────────

// 1. CONNECTED — WebSocket is established
{
  "event": "connected",
  "version": "1.0.0",
  "protocol": "Call"
}

// 2. START — Stream metadata (once per stream)
{
  "event": "start",
  "sequence_number": "1",
  "start": {
    "user_id": "user-id",
    "call_control_id": "v3:xxxx",
    "client_state": "base64-encoded-state",
    "media_format": {
      "encoding": "audio/x-mulaw",  // or audio/x-l16, audio/x-g722, etc.
      "sample_rate": 8000,           // 8000 or 16000
      "channels": 1
    }
  },
  "stream_id": "stream-xxxx"
}

// 3. MEDIA — Audio data (every 20ms)
{
  "event": "media",
  "sequence_number": "42",
  "media": {
    "track": "inbound",     // or "outbound"
    "chunk": "42",
    "timestamp": "820",     // milliseconds from stream start
    "payload": "base64encodedaudio..."
  },
  "stream_id": "stream-xxxx"
}

// 4. DTMF — Keypress detected
{
  "event": "dtmf",
  "sequence_number": "100",
  "dtmf": {
    "digit": "5"
  },
  "stream_id": "stream-xxxx"
}

// 5. STOP — Stream ended
{
  "event": "stop",
  "sequence_number": "500",
  "stream_id": "stream-xxxx"
}
```

### Piping Telnyx Audio to Deepgram (our current pattern, adapted)

```typescript
// Telnyx uses the SAME WebSocket event protocol as Twilio!
// The migration is almost zero-effort.

import { WebSocketServer, WebSocket } from 'ws';

const mediaWss = new WebSocketServer({ noServer: true });

mediaWss.on('connection', (ws) => {
  let dgWs: WebSocket | null = null;
  const audioChunks: Buffer[] = [];

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    switch (msg.event) {
      case 'start': {
        // Read the codec from Telnyx (may differ from Twilio!)
        const encoding = msg.start.media_format.encoding;
        const sampleRate = msg.start.media_format.sample_rate;

        // Map Telnyx encoding to Deepgram parameter
        const dgEncoding = {
          'audio/x-mulaw': 'mulaw',
          'audio/x-l16': 'linear16',
          'audio/x-g722': 'g722',
          'audio/x-opus': 'opus',
        }[encoding] ?? 'mulaw';

        // Connect to Deepgram with matching codec
        const params = new URLSearchParams({
          model: 'nova-3',
          encoding: dgEncoding,
          sample_rate: String(sampleRate),
          channels: '1',
          interim_results: 'true',
          smart_format: 'true',
          utterance_end_ms: '1000',
          endpointing: '300',
        });

        dgWs = new WebSocket(
          `wss://api.deepgram.com/v1/listen?${params}`,
          { headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` } }
        );

        dgWs.on('message', (data) => {
          const result = JSON.parse(data.toString());
          if (result.type === 'Results') {
            const words = result.channel?.alternatives?.[0]?.words ?? [];
            const transcript = result.channel?.alternatives?.[0]?.transcript;
            if (transcript) {
              // Broadcast to frontend, persist to DB...
            }
          }
        });
        break;
      }

      case 'media': {
        const audio = Buffer.from(msg.media.payload, 'base64');
        audioChunks.push(audio);
        dgWs?.send(audio);
        break;
      }

      case 'stop': {
        dgWs?.close();
        // Write local WAV file from audioChunks
        break;
      }
    }
  });
});
```

### Telnyx Conference Recording — All Options

```typescript
// ── Option 1: Record at conference level (mixed audio) ──────────

await telnyx.conferences.record({
  conference_id: 'capture-abc123',
  channels: 'dual',           // 'single' or 'dual'
  format: 'wav',              // 'mp3' or 'wav'
  play_beep: false,
});

// Recording URL delivered via webhook: conference.recording.saved

// ── Option 2: Record individual call legs ───────────────────────

await telnyx.calls.record_start({
  call_control_id: callA.data.call_control_id,
  channels: 'single',         // just this caller
  format: 'wav',
});

// Recording URL delivered via webhook: call.recording.saved

// ── Option 3: Download recording ────────────────────────────────

// Telnyx recording URLs look like:
// https://api.telnyx.com/v2/recordings/{recording_id}/actions/download

// Download with auth:
const response = await fetch(
  `https://api.telnyx.com/v2/recordings/${recordingId}/actions/download`,
  { headers: { Authorization: `Bearer ${TELNYX_API_KEY}` } }
);
const audioBuffer = await response.arrayBuffer();
fs.writeFileSync(`recordings/${captureId}-mixed.wav`, Buffer.from(audioBuffer));
```

### Migration from Twilio to Telnyx — Exact Changes

```
┌────────────────────────────────────────────────────────────────┐
│              MIGRATION CHECKLIST: Twilio → Telnyx              │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  1. CREDENTIALS                                                │
│     Twilio: ACCOUNT_SID + AUTH_TOKEN                           │
│     Telnyx: API_KEY + SIP_CONNECTION_ID                        │
│                                                                │
│  2. PHONE NUMBERS                                              │
│     Twilio: Buy via Console/API                                │
│     Telnyx: Buy via Mission Control Portal/API                 │
│     - Can port existing Twilio numbers to Telnyx              │
│                                                                │
│  3. CALL INITIATION                                            │
│     Twilio: client.calls.create({ to, from, url })            │
│     Telnyx: telnyx.calls.create({                             │
│       connection_id, to, from, webhook_url,                   │
│       stream_url, stream_track                                │
│     })                                                        │
│     NOTE: stream_url replaces separate <Stream> TwiML         │
│                                                                │
│  4. TWIML → TEXML                                              │
│     Almost 1:1. Change namespace URL only:                    │
│     <Response xmlns="http://www.twilio.com/...">              │
│     → <Response xmlns="http://www.telnyx.com/...">            │
│     Most verbs identical: Say, Dial, Conference, Record,      │
│     Start, Stream, Gather, Play, Pause, Hangup               │
│                                                                │
│  5. WEBHOOKS                                                   │
│     Twilio: POST with form-encoded body (CallSid, etc.)      │
│     Telnyx: POST with JSON body (event_type, payload)         │
│     - Different field names but same concepts                 │
│     - Twilio: req.body.CallSid                                │
│     - Telnyx: req.body.data.payload.call_control_id           │
│                                                                │
│  6. MEDIA STREAM WEBSOCKET                                     │
│     Protocol is IDENTICAL:                                    │
│     connected → start → media (base64 chunks) → stop          │
│     Only difference: Telnyx adds codec in start.media_format  │
│     and supports more codecs (L16, G722, OPUS)               │
│                                                                │
│  7. RECORDING                                                  │
│     Twilio: record=true on call, or <Record> TwiML           │
│     Telnyx: record_start/record_stop API, or TeXML <Record>  │
│     - Telnyx supports dual-channel natively                   │
│     - Download URL format different (needs API key auth)      │
│                                                                │
│  8. CONFERENCE                                                 │
│     Twilio: <Dial><Conference>room-name</Conference></Dial>   │
│     Telnyx: Same in TeXML, or calls.join API                  │
│     - Telnyx conferences are created implicitly (same as      │
│       Twilio) or explicitly via API                           │
│                                                                │
│  ESTIMATED MIGRATION TIME: 1-2 days for our codebase          │
│  (mostly changing webhook parsing + credentials)              │
└────────────────────────────────────────────────────────────────┘
```

---

## Product 2: Voice Agent Evaluation Platform

### What It Does

```
┌──────────────┐                    ┌──────────────┐
│ Human Tester  │   Phone Call      │ Voice AI      │
│ (follows      │ ←──────────────→ │ Agent         │
│  script)      │                   │ (under test)  │
└──────┬────────┘                   └──────────────┘
       │                                    │
       │    Both audio streams              │
       ▼                                    ▼
┌──────────────────────────────────────────────────┐
│              EVALUATION ENGINE                     │
│                                                    │
│  1. Real-time transcript (who said what, when)     │
│  2. Script adherence (did tester follow prompts?)  │
│  3. Agent accuracy scoring:                        │
│     - Did agent answer correctly?                  │
│     - Response latency (time between Q and A)      │
│     - Sentiment / tone analysis                    │
│     - Language correctness                         │
│     - Escalation handling                          │
│  4. Generate evaluation report                     │
│  5. Send to client (Kotak Bank, etc.)              │
└──────────────────────────────────────────────────┘
```

### Architecture with LiveKit (Recommended for Eval)

LiveKit adds value here because:
- **Agents Framework** can run the evaluation logic in real-time
- **Room events** let you observe the call without being in it
- **Track subscriptions** give you separate audio per participant

```typescript
import {
  WorkerOptions,
  defineAgent,
  cli
} from '@livekit/agents';
import { SIPParticipant } from '@livekit/agents/sip';

// ── The Evaluation Agent — joins the room as an invisible observer ──

const evaluationAgent = defineAgent({
  entry: async (ctx) => {
    // Wait for both participants to join
    await ctx.waitForParticipant((p) => p.attributes?.role === 'tester');
    await ctx.waitForParticipant((p) => p.attributes?.role === 'agent');

    const testerTrack = await ctx.waitForTrack(
      (track) => track.participant.attributes?.role === 'tester'
    );
    const agentTrack = await ctx.waitForTrack(
      (track) => track.participant.attributes?.role === 'agent'
    );

    // Subscribe to both audio tracks for ASR
    const testerStream = await ctx.subscribeAudio(testerTrack);
    const agentStream = await ctx.subscribeAudio(agentTrack);

    // Process audio through ASR (Deepgram/Sarvam)
    // Compare against test script
    // Score the agent's responses
    // Generate evaluation report
  },
});
```

### How LiveKit Agents Framework Works — From First Principles

```
┌─────────────────────────────────────────────────────────────────┐
│                   LIVEKIT AGENTS FRAMEWORK                       │
│                                                                  │
│  An "Agent" is a server-side process that:                      │
│  1. Joins a LiveKit room as a special participant                │
│  2. Subscribes to audio/video tracks from other participants     │
│  3. Processes the media (ASR, LLM, TTS, etc.)                  │
│  4. Publishes results back (audio, data, etc.)                  │
│                                                                  │
│  The framework provides a PIPELINE abstraction:                  │
│                                                                  │
│  Audio In → [STT] → Text → [LLM] → Text → [TTS] → Audio Out   │
│                                                                  │
│  Each stage is a pluggable component:                            │
│  - STT: Deepgram, Google, Azure, Whisper, AssemblyAI            │
│  - LLM: OpenAI, Anthropic, Google, local models                 │
│  - TTS: ElevenLabs, Cartesia, OpenAI, Google, Azure             │
│                                                                  │
│  For our EVALUATION use case, we don't need TTS output.         │
│  We only need: Audio In → STT → Evaluation Logic                │
└─────────────────────────────────────────────────────────────────┘
```

### Agent Pipeline — STT Only (for Evaluation)

```typescript
import { pipeline, AgentSession } from '@livekit/agents';
import { DeepgramSTT } from '@livekit/agents-plugin-deepgram';

// Create an STT-only pipeline for evaluation
const sttPipeline = pipeline({
  stt: new DeepgramSTT({
    model: 'nova-3',
    language: 'en',
    // Word-level timestamps enabled by default
  }),
  // No LLM — we don't need to generate responses
  // No TTS — we don't need to speak
});

// In your agent entry:
const session = new AgentSession({
  pipeline: sttPipeline,
});

// Listen for transcription events
session.on('transcription', (event) => {
  console.log(`[${event.participant.identity}] ${event.text}`);
  console.log('Words:', event.words); // word-level timestamps

  // Score against expected script
  evaluateUtterance(event);
});
```

### LiveKit STT Plugin — Available Providers

```
┌──────────────────────────────────────────────────────────────────┐
│             LIVEKIT STT PLUGINS (npm packages)                    │
├─────────────────────────────┬────────────────────────────────────┤
│ Package                     │ Provider                           │
├─────────────────────────────┼────────────────────────────────────┤
│ @livekit/agents-plugin-     │ Deepgram Nova-3                    │
│ deepgram                    │ Best for telephony, 50+ languages  │
│                             │ Word-level timestamps              │
│                             │ $0.0043/min (mono)                 │
├─────────────────────────────┼────────────────────────────────────┤
│ @livekit/agents-plugin-     │ Google Cloud STT                   │
│ google                      │ chirp_telephony model for calls    │
│                             │ Good Indian language support       │
│                             │ $0.016/min                         │
├─────────────────────────────┼────────────────────────────────────┤
│ @livekit/agents-plugin-     │ Azure Cognitive Services           │
│ azure                       │ Good for enterprise                │
│                             │ Hindi, Tamil, Telugu, Kannada      │
│                             │ $0.016/min                         │
├─────────────────────────────┼────────────────────────────────────┤
│ @livekit/agents-plugin-     │ OpenAI Whisper                     │
│ openai                      │ 100+ languages                     │
│                             │ Higher latency (~1-3s)             │
│                             │ $0.006/min                         │
├─────────────────────────────┼────────────────────────────────────┤
│ @livekit/agents-plugin-     │ AssemblyAI Universal               │
│ assemblyai                  │ Smart endpointing                  │
│                             │ Growing language support            │
│                             │ $0.0075/min                        │
└─────────────────────────────┴────────────────────────────────────┘
```

### LiveKit TTS Plugins (for future voice agent building)

```
┌──────────────────────────────────────────────────────────────────┐
│             LIVEKIT TTS PLUGINS (npm packages)                    │
├─────────────────────────────┬────────────────────────────────────┤
│ Package                     │ Provider                           │
├─────────────────────────────┼────────────────────────────────────┤
│ @livekit/agents-plugin-     │ ElevenLabs                         │
│ elevenlabs                  │ Best voice quality                 │
│                             │ Voice cloning                      │
│                             │ $0.18/1K chars ($0.003/min approx) │
│                             │ 29 languages                       │
├─────────────────────────────┼────────────────────────────────────┤
│ @livekit/agents-plugin-     │ Cartesia (Sonic)                   │
│ cartesia                    │ Ultra-low latency (<100ms)         │
│                             │ Streaming word-level timestamps    │
│                             │ $0.042/min                         │
├─────────────────────────────┼────────────────────────────────────┤
│ @livekit/agents-plugin-     │ OpenAI TTS                         │
│ openai                      │ Good quality, simple               │
│                             │ 6 built-in voices                  │
│                             │ $0.015/1K chars                    │
├─────────────────────────────┼────────────────────────────────────┤
│ @livekit/agents-plugin-     │ Google Cloud TTS                   │
│ google                      │ WaveNet voices                     │
│                             │ Excellent Indian language support   │
│                             │ $0.016/1M chars                    │
├─────────────────────────────┼────────────────────────────────────┤
│ @livekit/agents-plugin-     │ Azure Speech Services              │
│ azure                       │ Neural voices                      │
│                             │ Hindi, Tamil, Telugu, Kannada TTS   │
│                             │ $0.016/1M chars                    │
└─────────────────────────────┴────────────────────────────────────┘
```

---

## Product Infrastructure Map

### How Telnyx + LiveKit Serves BOTH Products

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SHARED INFRASTRUCTURE                              │
│                                                                      │
│  ┌──────────────┐                                                    │
│  │    TELNYX     │ ← Handles ALL phone connectivity                  │
│  │              │   - Buy phone numbers                             │
│  │  - PSTN      │   - Outbound calls to India (+91)                 │
│  │  - SIP trunk │   - Conference bridging                           │
│  │  - Recording │   - Media streaming (WebSocket)                   │
│  │  - Streaming │   - Call recording (mixed + dual-channel)         │
│  └──────┬───────┘                                                    │
│         │                                                            │
│         │  SIP                                                       │
│         ▼                                                            │
│  ┌──────────────┐                                                    │
│  │   LIVEKIT    │ ← Handles room management + AI agents             │
│  │              │   - SIP bridge (phone → room)                     │
│  │  - Rooms     │   - Track subscriptions (per-speaker audio)       │
│  │  - SIP       │   - Agents framework (STT-LLM-TTS pipeline)      │
│  │  - Agents    │   - Recording/Egress to cloud storage             │
│  │  - Egress    │   - Web dashboard participants (observe calls)    │
│  └──────┬───────┘                                                    │
│         │                                                            │
│         ▼                                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    YOUR APPLICATION                             │  │
│  │                                                                 │  │
│  │  PRODUCT 1: ASR Data Capture                                    │  │
│  │  ┌─────────────────────────────────────────────────────┐       │  │
│  │  │ Telnyx conference + media stream → Deepgram ASR     │       │  │
│  │  │ → Word timestamps + local WAV → Postgres → Export   │       │  │
│  │  │ (Telnyx-only, no LiveKit needed)                    │       │  │
│  │  └─────────────────────────────────────────────────────┘       │  │
│  │                                                                 │  │
│  │  PRODUCT 2: Voice Agent Evaluation                              │  │
│  │  ┌─────────────────────────────────────────────────────┐       │  │
│  │  │ Telnyx calls → LiveKit room → Eval agent observes   │       │  │
│  │  │ → Score agent responses → Generate report           │       │  │
│  │  │ (Telnyx + LiveKit)                                  │       │  │
│  │  └─────────────────────────────────────────────────────┘       │  │
│  │                                                                 │  │
│  │  PRODUCT 3 (FUTURE): Voice AI Agent Builder                     │  │
│  │  ┌─────────────────────────────────────────────────────┐       │  │
│  │  │ Telnyx calls → LiveKit room → Your AI agent         │       │  │
│  │  │ → STT (Deepgram) → LLM (Claude) → TTS (ElevenLabs)│       │  │
│  │  │ (Telnyx + LiveKit + Full pipeline)                  │       │  │
│  │  └─────────────────────────────────────────────────────┘       │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### When Each Product Uses What

| Component | ASR Capture | Agent Eval | Voice Agent (future) |
|-----------|:-----------:|:----------:|:-------------------:|
| **Telnyx PSTN** | Yes | Yes | Yes |
| **Telnyx Conference** | Yes | Optional | No |
| **Telnyx Media Stream** | Yes | Optional | Optional |
| **LiveKit Rooms** | No | Yes | Yes |
| **LiveKit SIP Bridge** | No | Yes | Yes |
| **LiveKit Agents** | No | Yes | Yes |
| **LiveKit Egress** | No | Yes | Yes |
| **Deepgram STT** | Yes | Yes | Yes |
| **LLM (Claude/GPT)** | No | Scoring | Yes |
| **TTS (ElevenLabs)** | No | No | Yes |
| **Postgres** | Yes | Yes | Yes |

---

## Complete Code: Telnyx-Only ASR Capture (Migration from Current Twilio Code)

This is what our `src/server.ts` would look like after migrating from Twilio to Telnyx:

```typescript
// ── Key differences from current Twilio implementation ──────────

// BEFORE (Twilio):
import twilio from 'twilio';
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

const call = await client.calls.create({
  to: phoneA,
  from: TWILIO_NUMBER,
  url: `${BASE_URL}/twiml/capture-a/${id}`,    // TwiML webhook
  statusCallback: `${BASE_URL}/webhooks/status`,
});

// TwiML endpoint:
app.post('/twiml/capture-a/:id', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say('Recording...');
  const start = twiml.start();
  start.stream({ url: `wss://.../media-stream`, track: 'inbound_track' });
  const dial = twiml.dial();
  dial.conference({ record: 'record-from-start' }, `cap-${id}`);
  res.type('text/xml').send(twiml.toString());
});


// AFTER (Telnyx Call Control API):
import Telnyx from 'telnyx';
const telnyx = new Telnyx(TELNYX_API_KEY);

const call = await telnyx.calls.create({
  connection_id: SIP_CONNECTION_ID,
  to: phoneA,
  from: TELNYX_NUMBER,
  webhook_url: `${BASE_URL}/telnyx/events`,     // Single webhook for all events
  stream_url: `wss://.../media-stream`,          // Media stream URL at creation!
  stream_track: 'inbound_track',
});

// Event handler (replaces TwiML):
app.post('/telnyx/events', (req, res) => {
  const { event_type, payload } = req.body.data;

  switch (event_type) {
    case 'call.initiated':
      // Auto-answered by Telnyx, or:
      telnyx.calls.answer({ call_control_id: payload.call_control_id });
      break;

    case 'call.answered':
      // Speak, then join conference
      telnyx.calls.speak({
        call_control_id: payload.call_control_id,
        payload: 'This call is being recorded.',
        language: 'en-US',
        voice: 'female',
      });
      break;

    case 'call.speak.ended':
      // After announcement, join conference
      telnyx.conferences.create({
        call_control_id: payload.call_control_id,
        name: `cap-${captureId}`,
        start_conference_on_create: true,
        record_conference: true,
        record_format: 'wav',
        record_channels: 'dual',
      });
      break;

    case 'call.hangup':
      console.log('Call ended');
      break;

    case 'conference.recording.saved':
      const recordingUrl = payload.recording_urls.wav;
      // Download and save locally
      break;
  }

  res.sendStatus(200);
});


// MEDIA STREAM WEBSOCKET — IDENTICAL to current Twilio code!
// Same events: connected, start, media (base64), stop
// Only difference: msg.start.media_format tells you the codec
// Current code works as-is with minor adjustments
```

### What Changes in Our Codebase (Exact Files)

```
┌────────────────────────────────────────────────────────────────────┐
│          FILES THAT CHANGE WHEN MIGRATING TO TELNYX                │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  src/server.ts                                                     │
│  ├── Replace: import twilio → import Telnyx                        │
│  ├── Replace: client.calls.create() → telnyx.calls.create()       │
│  ├── Remove: TwiML endpoints (/twiml/capture-a, /twiml/capture-b) │
│  ├── Add: Telnyx event handler (/telnyx/events)                    │
│  ├── Keep: WebSocket media stream handler (identical!)             │
│  ├── Keep: Deepgram ASR connection (identical!)                    │
│  ├── Keep: Client WebSocket broadcasting (identical!)              │
│  └── Keep: All DB persistence (identical!)                         │
│                                                                    │
│  .env                                                              │
│  ├── Remove: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN                 │
│  ├── Add: TELNYX_API_KEY, TELNYX_SIP_CONNECTION_ID                 │
│  └── Replace: TWILIO_PHONE_NUMBER → TELNYX_PHONE_NUMBER            │
│                                                                    │
│  package.json                                                      │
│  ├── Remove: twilio                                                │
│  └── Add: telnyx                                                   │
│                                                                    │
│  Everything else stays the same:                                   │
│  ✓ src/db/* (schema, queries, index)                              │
│  ✓ src/audio.ts                                                    │
│  ✓ src/types.ts                                                    │
│  ✓ web/* (entire frontend)                                         │
│  ✓ drizzle.config.ts                                               │
└────────────────────────────────────────────────────────────────────┘
```

---

## Complete Code: LiveKit Room with Two Phone Callers + Eval Agent

```typescript
import { RoomServiceClient } from 'livekit-server-sdk';
import { SipClient } from 'livekit-server-sdk';

const roomService = new RoomServiceClient(
  process.env.LIVEKIT_URL!,       // e.g. wss://your-app.livekit.cloud
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

const sipClient = new SipClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

async function startEvalSession(
  captureId: string,
  phoneA: string,
  phoneB: string,
) {
  const roomName = `eval-${captureId}`;

  // Step 1: Create a LiveKit room
  await roomService.createRoom({
    name: roomName,
    emptyTimeout: 300,      // close after 5min if empty
    maxParticipants: 5,     // tester + agent + eval-agent + observers
  });

  // Step 2: Dial Phone A into the room via SIP
  // Requires: Telnyx SIP outbound trunk configured in LiveKit
  // API: createSipParticipant(trunkId, phoneNumber, roomName, options)
  const participantA = await sipClient.createSipParticipant(
    process.env.LIVEKIT_SIP_TRUNK_ID!,  // Telnyx outbound trunk
    phoneA,                              // phone number to dial
    roomName,                            // LiveKit room to join
    {
      participantIdentity: 'tester',
      participantName: 'Human Tester',
      krispEnabled: true,                // telephony noise cancellation
      waitUntilAnswered: true,           // block until phone is picked up
    },
  );

  // Step 3: Dial Phone B into the same room
  await new Promise(r => setTimeout(r, 2000)); // stagger calls

  const participantB = await sipClient.createSipParticipant(
    process.env.LIVEKIT_SIP_TRUNK_ID!,
    phoneB,
    roomName,
    {
      participantIdentity: 'voice-agent',
      participantName: 'Voice AI Agent',
      krispEnabled: true,
      waitUntilAnswered: true,
    },
  );

  // Step 4: Start recording (egress)
  const egressClient = new EgressClient(
    process.env.LIVEKIT_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  );

  await egressClient.startRoomCompositeEgress(roomName, {
    file: {
      filepath: `recordings/eval-${captureId}.mp4`,
      disableVideo: true,   // audio only
    },
  });

  // Step 5: The evaluation agent auto-dispatches into the room
  // (configured via dispatch rules — see agents framework setup)

  return { roomName, participantA, participantB };
}
```

### LiveKit Evaluation Agent (Complete)

```typescript
// eval-agent.ts — Runs as a separate process
import { WorkerOptions, defineAgent, cli } from '@livekit/agents';
import { DeepgramSTT } from '@livekit/agents-plugin-deepgram';

const agent = defineAgent({
  entry: async (ctx) => {
    console.log(`Evaluation agent joined room: ${ctx.room.name}`);

    // Wait for both participants
    const tester = await ctx.waitForParticipant(
      (p) => p.attributes?.role === 'tester'
    );
    const voiceAgent = await ctx.waitForParticipant(
      (p) => p.attributes?.role === 'agent'
    );

    console.log('Both participants in room. Starting evaluation...');

    // Set up separate ASR streams for each participant
    const stt = new DeepgramSTT({
      model: 'nova-3',
      language: 'en',
      smartFormat: true,
      interimResults: true,
      utteranceEndMs: 1000,
    });

    const transcript: Array<{
      speaker: string;
      text: string;
      words: Array<{ word: string; start: number; end: number; confidence: number }>;
      timestamp: number;
    }> = [];

    // Subscribe to tester's audio
    const testerTrack = await ctx.waitForTrack(
      (t) => t.participant.identity === 'tester' && t.source === 'MICROPHONE'
    );

    const testerStream = stt.stream();
    testerStream.on('transcript', (event) => {
      if (event.isFinal && event.text) {
        transcript.push({
          speaker: 'tester',
          text: event.text,
          words: event.words,
          timestamp: Date.now(),
        });
        console.log(`[TESTER] ${event.text}`);

        // Broadcast to frontend via data channel
        ctx.room.localParticipant.publishData(
          JSON.stringify({ type: 'transcript', speaker: 'tester', text: event.text }),
          { reliable: true }
        );
      }
    });

    // Subscribe to agent's audio
    const agentTrack = await ctx.waitForTrack(
      (t) => t.participant.identity === 'voice-agent' && t.source === 'MICROPHONE'
    );

    const agentStream = stt.stream();
    agentStream.on('transcript', (event) => {
      if (event.isFinal && event.text) {
        transcript.push({
          speaker: 'agent',
          text: event.text,
          words: event.words,
          timestamp: Date.now(),
        });
        console.log(`[AGENT] ${event.text}`);

        ctx.room.localParticipant.publishData(
          JSON.stringify({ type: 'transcript', speaker: 'agent', text: event.text }),
          { reliable: true }
        );
      }
    });

    // Wait for call to end
    ctx.room.on('participantDisconnected', async (participant) => {
      console.log(`${participant.identity} left the room`);

      // If either party left, generate evaluation report
      if (participant.identity === 'tester' || participant.identity === 'voice-agent') {
        const report = generateEvalReport(transcript);

        // Publish report via data channel
        ctx.room.localParticipant.publishData(
          JSON.stringify({ type: 'eval_report', report }),
          { reliable: true }
        );

        // Persist to database
        await saveEvalReport(ctx.room.name, report);
      }
    });
  },
});

function generateEvalReport(transcript: any[]) {
  const testerUtterances = transcript.filter(t => t.speaker === 'tester');
  const agentUtterances = transcript.filter(t => t.speaker === 'agent');

  // Calculate metrics
  const avgConfidence = transcript
    .flatMap(t => t.words)
    .reduce((sum, w) => sum + w.confidence, 0) /
    transcript.flatMap(t => t.words).length;

  // Calculate response latency (time between tester question and agent response)
  const latencies: number[] = [];
  for (let i = 0; i < transcript.length - 1; i++) {
    if (transcript[i].speaker === 'tester' && transcript[i+1].speaker === 'agent') {
      latencies.push(transcript[i+1].timestamp - transcript[i].timestamp);
    }
  }
  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;

  return {
    totalUtterances: transcript.length,
    testerUtterances: testerUtterances.length,
    agentUtterances: agentUtterances.length,
    avgAsrConfidence: avgConfidence,
    avgAgentResponseLatencyMs: avgLatency,
    transcript,
    generatedAt: new Date().toISOString(),
  };
}

// Run the agent worker
cli.runApp(
  new WorkerOptions({
    agent,
    workerType: 'room',
  })
);
```

---

## Environment Variables — Complete List for Both Products

```env
# ── TELNYX (replaces Twilio) ─────────────────────────────────────
TELNYX_API_KEY=KEY_xxxxxxxxxxxxx
TELNYX_SIP_CONNECTION_ID=xxxxxxxxxxxx
TELNYX_PHONE_NUMBER=+1xxxxxxxxxx

# ── LIVEKIT (for agent eval + future products) ───────────────────
LIVEKIT_URL=wss://your-app.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxx
LIVEKIT_SIP_TRUNK_ID=ST_xxxxxxxxxxxxx

# ── DEEPGRAM (ASR) ──────────────────────────────────────────────
DEEPGRAM_API_KEY=xxxxxxxxxxxxxxxxxxxx

# ── ELEVENLABS (TTS — future) ───────────────────────────────────
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxxxxxx

# ── DATABASE ─────────────────────────────────────────────────────
DATABASE_URL=postgresql://user@localhost:5432/telephony

# ── SERVER ───────────────────────────────────────────────────────
BASE_URL=https://your-domain.com
PORT=3001
```

---

## Summary: Infrastructure Decision Matrix

```
┌─────────────────────────────────────────────────────────────────┐
│                    WHAT TO USE WHEN                               │
├──────────────────┬──────────────────────────────────────────────┤
│ Building what?   │ Infrastructure needed                        │
├──────────────────┼──────────────────────────────────────────────┤
│ ASR data capture │ Telnyx only                                  │
│ (record + trans- │ - Conference + Media Stream + Recording      │
│ cribe phone      │ - Pipe to Deepgram for ASR                   │
│ calls)           │ - Store in Postgres                          │
│                  │ Cost: ~$2.50/hr                              │
├──────────────────┼──────────────────────────────────────────────┤
│ Voice agent eval │ Telnyx + LiveKit                             │
│ (test AI agents  │ - Telnyx for PSTN calls                     │
│ with human       │ - LiveKit room for multi-party               │
│ testers)         │ - LiveKit Agent for real-time evaluation     │
│                  │ - Deepgram via LiveKit STT plugin            │
│                  │ Cost: ~$3.50/hr                              │
├──────────────────┼──────────────────────────────────────────────┤
│ Voice AI agent   │ Telnyx + LiveKit + LLM + TTS                │
│ (build your own  │ - Telnyx for PSTN                            │
│ phone agent)     │ - LiveKit Agent with full pipeline           │
│                  │ - Deepgram STT → Claude/GPT → ElevenLabs TTS│
│                  │ Cost: ~$5-8/hr (mostly LLM + TTS)           │
├──────────────────┼──────────────────────────────────────────────┤
│ MVP / prototype  │ Twilio only (CURRENT — already built!)      │
│ (what we have    │ - Quick to test, well-documented             │
│ right now)       │ - Migrate to Telnyx when revenue comes      │
│                  │ Cost: ~$5/hr                                 │
└──────────────────┴──────────────────────────────────────────────┘
```
