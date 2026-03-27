# Twilio Voice API - Telephony Prototype Research

> Compiled: 2026-03-27

---

## Table of Contents

1. [Architecture Flow](#1-architecture-flow)
2. [Authentication](#2-authentication)
3. [Making Outbound Calls (REST API)](#3-making-outbound-calls-rest-api)
4. [TwiML - Call Flow Control](#4-twiml---call-flow-control)
5. [Node.js / TypeScript SDK](#5-nodejs--typescript-sdk)
6. [Webhooks](#6-webhooks)
7. [Call Recording](#7-call-recording)
8. [Pricing](#8-pricing)
9. [Twilio vs Plivo Comparison](#9-twilio-vs-plivo-comparison)
10. [Prototype Architecture Recommendation](#10-prototype-architecture-recommendation)
11. [Twilio Media Streams - Real-Time Audio Streaming](#11-twilio-media-streams---real-time-audio-streaming)
    - [Two Types of Media Streams](#two-types-of-media-streams)
    - [Audio Format](#audio-format)
    - [`<Stream>` TwiML Verb Reference](#stream-twiml-verb---complete-reference)
    - [TwiML Examples](#twiml-examples)
    - [WebSocket Protocol - Message Types](#websocket-protocol---message-types)
    - [Stream Resource REST API](#stream-resource-rest-api)
    - [Node.js Implementation Examples](#nodejs-implementation-examples)
    - [Conference + Media Streams Architecture](#conference--media-streams-architecture)
    - [Key Limitations and Gotchas](#key-limitations-and-gotchas)
    - [Mu-law Transcoding Reference](#mu-law-transcoding-reference)

---

## 1. Architecture Flow

```
Your Server                          Twilio                        Phone Network
    |                                  |                                |
    |--- POST /Calls (To, From, Url) ->|                                |
    |                                  |--- Initiate call ------------->|
    |                                  |<-- Call connects --------------|
    |                                  |                                |
    |<-- GET/POST to Url (webhook) ----|                                |
    |--- Return TwiML (XML) --------->|                                |
    |                                  |--- Execute TwiML ------------->|
    |                                  |    (Say, Gather, Record, etc.) |
    |                                  |                                |
    |<-- StatusCallback (completed) ---|                                |
    |<-- RecordingStatusCallback ------|                                |
```

**How it works:**

1. Your server sends a REST API request to Twilio to initiate an outbound call.
2. Twilio dials the recipient's phone number.
3. When the call connects, Twilio makes an HTTP request to the `Url` you specified (your webhook endpoint).
4. Your server responds with TwiML (XML) instructions that control what happens on the call.
5. Twilio executes the TwiML instructions (speak text, gather input, record, dial another party, etc.).
6. Twilio sends status callbacks to your server as the call progresses and when it completes.
7. If recording was enabled, Twilio sends a recording status callback with the recording URL when processing finishes.

---

## 2. Authentication

Twilio uses **HTTP Basic Authentication** with two credentials:

| Credential | Description | Format |
|------------|-------------|--------|
| **Account SID** | Your account identifier | `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| **Auth Token** | Your secret key | 32-character hex string |

Both are found in the [Twilio Console](https://console.twilio.com/).

**Best practice:** Store as environment variables, never commit to source control.

```bash
export TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export TWILIO_AUTH_TOKEN=your_auth_token
```

For API requests, these are sent as Basic Auth credentials. The Node.js SDK handles this automatically.

---

## 3. Making Outbound Calls (REST API)

### Endpoint

```
POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Calls.json
```

### Required Parameters

| Parameter | Description |
|-----------|-------------|
| `To` | Destination phone number in E.164 format (e.g., `+16175551212`), SIP address, or Client identifier |
| `From` | Your Twilio phone number in E.164 format (e.g., `+15555556789`) |
| `Url` **or** `Twiml` | Either a webhook URL that returns TwiML, or inline TwiML string |

### Key Optional Parameters

| Parameter | Description |
|-----------|-------------|
| `Method` | HTTP method for fetching the `Url` (`GET` or `POST`, default `POST`) |
| `Record` | `true` to record the entire call |
| `StatusCallback` | URL to receive call status updates |
| `StatusCallbackMethod` | HTTP method for status callbacks (`GET` or `POST`) |
| `StatusCallbackEvent` | Array of events: `initiated`, `ringing`, `answered`, `completed` |
| `RecordingStatusCallback` | URL to receive recording completion notifications |
| `RecordingStatusCallbackEvent` | Events: `in-progress`, `completed`, `absent`, `failed` |
| `Timeout` | Seconds to wait for answer before giving up (default 60) |
| `MachineDetection` | `Enable` for answering machine detection |

### Call Status Values

`queued` -> `ringing` -> `in-progress` -> `completed`

Other terminal states: `busy`, `failed`, `no-answer`, `canceled`

### Rate Limits

Default accounts: **1 CPS** (Call Per Second). Calls exceeding this are queued automatically. Higher CPS available on request.

---

## 4. TwiML - Call Flow Control

TwiML (Twilio Markup Language) is XML that tells Twilio what to do during a call. Your webhook endpoint returns TwiML.

### Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <!-- TwiML verbs go here, executed top-to-bottom -->
</Response>
```

### Key Verbs

#### `<Say>` - Text-to-Speech

```xml
<Say voice="alice" language="en-US">Hello, thanks for calling.</Say>
```

Attributes: `voice` (alice, man, woman, Polly voices), `language`, `loop`

#### `<Gather>` - Collect DTMF / Speech Input

```xml
<Gather numDigits="1" action="/handle-input" method="POST" input="dtmf speech" timeout="5">
    <Say>Press 1 for sales, 2 for support.</Say>
</Gather>
<Say>We didn't receive any input. Goodbye.</Say>
```

Attributes: `numDigits`, `action` (URL to send digits to), `method`, `timeout`, `finishOnKey` (default `#`), `input` (`dtmf`, `speech`, `dtmf speech`)

When input is received, Twilio POSTs to the `action` URL with a `Digits` parameter. If no input, execution falls through to the next verb.

#### `<Record>` - Record Audio

```xml
<Record maxLength="120" timeout="5" action="/handle-recording" method="POST"
        transcribe="true" transcribeCallback="/transcription"/>
```

Attributes: `maxLength` (seconds, default 3600), `timeout` (silence before stopping), `finishOnKey`, `action` (URL receiving recording details), `transcribe`, `transcribeCallback`, `playBeep`

After recording, Twilio POSTs to `action` with `RecordingUrl`, `RecordingSid`, `RecordingDuration`.

#### `<Dial>` - Connect to Another Party

```xml
<Dial callerId="+15555556789" timeout="30" record="record-from-answer"
      action="/dial-complete" method="POST">
    <Number>+15555551234</Number>
</Dial>
```

Nouns (nested elements): `<Number>`, `<Client>`, `<Conference>`, `<Queue>`, `<Sip>`

Attributes: `callerId`, `timeout`, `action`, `method`, `record` (`do-not-record`, `record-from-answer`, `record-from-ringing`, `record-from-answer-dual`, `record-from-ringing-dual`)

#### `<Play>` - Play Audio File

```xml
<Play loop="2">https://example.com/hold-music.mp3</Play>
```

#### `<Pause>` - Wait Silently

```xml
<Pause length="3"/>
```

#### `<Redirect>` - Transfer to Different TwiML

```xml
<Redirect method="POST">https://example.com/next-step</Redirect>
```

#### `<Hangup>` - End the Call

```xml
<Hangup/>
```

#### `<Reject>` - Decline Incoming Call (No Charge)

```xml
<Reject reason="busy"/>
```

### Execution Rules

- Verbs are **case-sensitive** (`<Say>` not `<say>`)
- Verbs execute **top-to-bottom** unless redirected by `action` URLs or `<Redirect>`
- Must respond within **15 seconds** with `Content-Type: application/xml`
- Nested verbs (like `<Say>` inside `<Gather>`) execute while the parent verb is active

---

## 5. Node.js / TypeScript SDK

### Installation

```bash
npm install twilio
# TypeScript types are included
```

### Initialize Client

```typescript
import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(accountSid, authToken);
```

### Make an Outbound Call

```typescript
// Option A: Using a webhook URL for TwiML
const call = await client.calls.create({
  to: '+15555551234',
  from: '+15555556789',
  url: 'https://your-server.com/twiml/outbound',
  statusCallback: 'https://your-server.com/call-status',
  statusCallbackMethod: 'POST',
  statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  record: true,
  timeout: 60
});
console.log(`Call SID: ${call.sid}`);
console.log(`Status: ${call.status}`);

// Option B: Using inline TwiML
const call2 = await client.calls.create({
  to: '+15555551234',
  from: '+15555556789',
  twiml: '<Response><Say voice="alice">Hello, this is an automated call.</Say></Response>'
});
```

### Generate TwiML Programmatically

```typescript
import twilio from 'twilio';
const VoiceResponse = twilio.twiml.VoiceResponse;

const twiml = new VoiceResponse();

twiml.say({ voice: 'alice', language: 'en-US' }, 'Thank you for calling.');

const gather = twiml.gather({
  input: ['dtmf', 'speech'],
  timeout: 5,
  numDigits: 1,
  action: '/handle-input',
  method: 'POST'
});
gather.say('Press 1 for sales, 2 for support.');

twiml.say('We did not receive any input. Goodbye.');

// Returns XML string
const xml = twiml.toString();
```

### Update a Live Call

```typescript
// Redirect to new TwiML
await client.calls('CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
  .update({
    twiml: '<Response><Say>This call has been updated.</Say><Hangup/></Response>'
  });

// End a call
await client.calls('CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
  .update({ status: 'completed' });
```

### Fetch Call Details

```typescript
const call = await client.calls('CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx').fetch();
console.log(`Duration: ${call.duration} seconds`);
console.log(`Price: ${call.price} ${call.priceUnit}`);
console.log(`Status: ${call.status}`);
```

### List Recordings

```typescript
const recordings = await client.recordings.list({ limit: 20 });
for (const recording of recordings) {
  console.log(`SID: ${recording.sid}`);
  console.log(`Call SID: ${recording.callSid}`);
  console.log(`Duration: ${recording.duration}s`);
  console.log(`URL: https://api.twilio.com${recording.uri.replace('.json', '.mp3')}`);
}
```

### Error Handling

```typescript
import twilio from 'twilio';

try {
  const call = await client.calls.create({ /* ... */ });
} catch (error) {
  if (error instanceof twilio.RestException) {
    console.error(`Twilio Error ${error.code}: ${error.message}`);
    console.error(`HTTP Status: ${error.status}`);
    // Common codes: 21211 (invalid number), 21608 (unverified in trial), 20003 (auth failed)
  }
}
```

---

## 6. Webhooks

### Three Types of Voice Webhooks

#### 1. TwiML Webhook (Call Control)

When a call connects (inbound or outbound), Twilio sends an HTTP request to your URL and expects TwiML back.

**Parameters Twilio sends to your endpoint:**

| Parameter | Description |
|-----------|-------------|
| `CallSid` | Unique identifier for this call |
| `AccountSid` | Your Twilio account SID |
| `From` | Caller's phone number |
| `To` | Called phone number |
| `CallStatus` | Current status (`ringing`, `in-progress`, etc.) |
| `Direction` | `inbound` or `outbound-api` |
| `ForwardedFrom` | Number that forwarded the call (if applicable) |
| `CallerName` | Caller's name (if available via CNAM lookup) |

**Express.js example:**

```typescript
import express from 'express';
import twilio from 'twilio';

const app = express();
app.use(express.urlencoded({ extended: false }));

const VoiceResponse = twilio.twiml.VoiceResponse;

app.post('/twiml/outbound', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say({ voice: 'alice' }, 'Hello! This is your automated notification.');
  twiml.pause({ length: 1 });
  twiml.say('Goodbye.');

  res.type('text/xml');
  res.send(twiml.toString());
});
```

#### 2. Status Callback (Call Progress)

Asynchronous notifications about call state changes. Does NOT require TwiML in response.

**Events:** `initiated`, `ringing`, `answered`, `completed`

**Additional parameters on completion:**

| Parameter | Description |
|-----------|-------------|
| `CallDuration` | Duration in seconds |
| `RecordingUrl` | URL to recording (if `Record=true`) |
| `RecordingSid` | Recording SID |

```typescript
app.post('/call-status', (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  console.log(`Call ${CallSid}: ${CallStatus} (${CallDuration}s)`);
  res.sendStatus(204); // No TwiML needed
});
```

#### 3. Recording Status Callback

Sent when a recording finishes processing.

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `RecordingSid` | Recording identifier |
| `RecordingUrl` | Base URL (append `.mp3` or `.wav`) |
| `RecordingStatus` | `completed`, `failed`, `absent` |
| `RecordingDuration` | Length in seconds |
| `RecordingChannels` | Number of audio channels |

```typescript
app.post('/recording-status', (req, res) => {
  const { RecordingSid, RecordingUrl, RecordingDuration } = req.body;
  const mp3Url = `${RecordingUrl}.mp3`;
  console.log(`Recording ready: ${mp3Url} (${RecordingDuration}s)`);
  // Store mp3Url in your database
  res.sendStatus(204);
});
```

### Webhook Security

- Always use **HTTPS** endpoints
- Validate requests using Twilio's request signature (X-Twilio-Signature header)
- The Node.js SDK provides `twilio.validateRequest()` for signature verification

### Local Development

For local development, use a tunnel to expose your server:
- **ngrok**: `ngrok http 3000` gives you a public HTTPS URL
- Update your Twilio webhook URLs to point to the ngrok URL

---

## 7. Call Recording

### Three Ways to Record

#### Method 1: `Record` Parameter on API Call (Record entire call)

```typescript
const call = await client.calls.create({
  to: '+15555551234',
  from: '+15555556789',
  url: 'https://your-server.com/twiml/outbound',
  record: true,
  recordingStatusCallback: 'https://your-server.com/recording-status',
  recordingStatusCallbackMethod: 'POST',
  recordingStatusCallbackEvent: ['completed']
});
```

This records the entire call from connection to hangup.

#### Method 2: `<Record>` TwiML Verb (Record a segment)

```typescript
const twiml = new VoiceResponse();
twiml.say('Please leave a message after the beep.');
twiml.record({
  maxLength: 120,
  timeout: 5,
  action: '/handle-recording',
  transcribe: true,
  transcribeCallback: '/transcription-ready'
});
twiml.say('We did not receive a recording. Goodbye.');
twiml.hangup();
```

#### Method 3: `record` Attribute on `<Dial>` (Record a bridged call)

```xml
<Dial record="record-from-answer-dual" recordingStatusCallback="/recording-status">
    <Number>+15555551234</Number>
</Dial>
```

Options: `do-not-record`, `record-from-answer`, `record-from-ringing`, `record-from-answer-dual`, `record-from-ringing-dual`

The `-dual` variants create a dual-channel recording (each party on separate channels).

### Retrieving Recordings

**Via Recording Status Callback (recommended):**
Twilio POSTs to your `RecordingStatusCallback` URL with `RecordingUrl` when ready.

**Via REST API:**
```typescript
// List all recordings
const recordings = await client.recordings.list({ limit: 20 });

// Get a specific recording
const recording = await client.recordings('RExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx').fetch();

// Recording media URL pattern:
// https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Recordings/{RecordingSid}.mp3
// https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Recordings/{RecordingSid}.wav
```

**Via Twilio Console:**
Navigate to Monitor > Logs > Call Recordings.

### Recording Properties

| Property | Description |
|----------|-------------|
| `sid` | `RExxxxxxxx...` unique recording ID |
| `callSid` | Associated call SID |
| `duration` | Length in seconds |
| `status` | `in-progress`, `paused`, `stopped`, `processing`, `completed`, `absent`, `deleted` |
| `channels` | Number of audio channels (1 = mono, 2 = dual) |
| `source` | How recording was initiated |
| `mediaUrl` | Direct URL to audio file |

### Delete a Recording

```typescript
await client.recordings('RExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx').remove();
```

---

## 8. Pricing

### Twilio Voice Pricing (US)

| Service | Cost |
|---------|------|
| **Outbound call (local/toll-free)** | $0.014/min |
| **Outbound call (browser/SIP)** | $0.004/min |
| **Inbound call (local number)** | $0.0085/min |
| **Inbound call (toll-free)** | $0.022/min |
| **Local phone number** | $1.15/mo (volume: $0.575/mo) |
| **Toll-free number** | $2.15/mo (volume: $1.613/mo) |
| **Call recording** | $0.0025/min |
| **Recording storage** | $0.0005/min/mo |
| **Transcription** | $0.05/min |

### Cost Estimate for a Prototype

For a prototype making ~100 outbound calls/month averaging 2 minutes each:
- Phone number: ~$1.15/mo
- Call minutes (200 min x $0.014): ~$2.80/mo
- Recording (200 min x $0.0025): ~$0.50/mo
- **Total: ~$4.45/mo**

Twilio offers a **free trial** with credit (no credit card required initially).

---

## 9. Twilio vs Plivo Comparison

| Feature | Twilio | Plivo | Notes |
|---------|--------|-------|-------|
| **Outbound US voice** | $0.014/min | $0.010/min | Plivo 29% cheaper |
| **Inbound US (local)** | $0.0085/min | $0.0055/min | Plivo 35% cheaper |
| **Inbound US (toll-free)** | $0.022/min | $0.018/min | Plivo 18% cheaper |
| **Local number rental** | $1.15/mo | $0.50/mo | Plivo 57% cheaper |
| **Toll-free rental** | $2.15/mo | $1.00/mo | Plivo 53% cheaper |
| **Call recording** | $0.0025/min | Free | Plivo includes recording |
| **Recording storage** | $0.0005/min/mo | Free | Plivo includes storage |
| **SDK quality (Node.js)** | Excellent | Good | Twilio has better docs |
| **Documentation** | Extensive | Good | Twilio is the gold standard |
| **TwiML equivalent** | TwiML | Plivo XML | Similar concept, different syntax |
| **API ecosystem** | Massive (Voice, SMS, Video, Email, Auth) | Voice + SMS focused | Twilio much broader |
| **Community/Stack Overflow** | Very large | Smaller | Twilio easier to debug |
| **Countries supported** | 180+ | 200+ | Both have strong global coverage |
| **WebRTC/Browser calls** | $0.004/min | $0.003/min | Plivo 25% cheaper |

### Recommendation

- **Choose Twilio** for prototyping: superior documentation, larger community, easier to debug, more code examples, broader ecosystem. The price premium is negligible at prototype scale.
- **Choose Plivo** for production at scale: 30-50% cost savings add up significantly with volume, and free recording/storage is a major advantage. The API is comparable but documentation is thinner.

---

## 10. Prototype Architecture Recommendation

### Minimal Viable Setup

```
┌─────────────────────────────────┐
│  Next.js App (or Express)       │
│                                 │
│  POST /api/call/initiate        │ --> Twilio REST API (create call)
│  POST /api/twiml/outbound       │ <-- Twilio fetches TwiML here
│  POST /api/call/status          │ <-- Twilio sends status updates
│  POST /api/call/recording       │ <-- Twilio sends recording URL
│                                 │
│  Environment Variables:         │
│    TWILIO_ACCOUNT_SID           │
│    TWILIO_AUTH_TOKEN            │
│    TWILIO_PHONE_NUMBER          │
└─────────────────────────────────┘
         |
         | ngrok tunnel (dev) or deployed URL (prod)
         v
┌─────────────────────────────────┐
│  Twilio Platform                │
│  - Initiates calls              │
│  - Fetches TwiML from your URL  │
│  - Executes call flow           │
│  - Sends status callbacks       │
│  - Records & stores audio       │
└─────────────────────────────────┘
```

### Complete Prototype Code (Express + TypeScript)

```typescript
// server.ts
import express from 'express';
import twilio from 'twilio';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER!;
const client = twilio(accountSid, authToken);
const VoiceResponse = twilio.twiml.VoiceResponse;

// 1. Initiate an outbound call
app.post('/api/call/initiate', async (req, res) => {
  try {
    const { to, message } = req.body;
    const call = await client.calls.create({
      to,
      from: twilioNumber,
      url: `${process.env.BASE_URL}/api/twiml/outbound?message=${encodeURIComponent(message)}`,
      statusCallback: `${process.env.BASE_URL}/api/call/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      record: true,
      recordingStatusCallback: `${process.env.BASE_URL}/api/call/recording`,
    });
    res.json({ callSid: call.sid, status: call.status });
  } catch (error) {
    if (error instanceof twilio.RestException) {
      res.status(400).json({ error: error.message, code: error.code });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// 2. TwiML endpoint - Twilio fetches this when call connects
app.post('/api/twiml/outbound', (req, res) => {
  const message = req.query.message as string || 'Hello, this is an automated call.';
  const twiml = new VoiceResponse();

  twiml.say({ voice: 'alice' }, message);

  const gather = twiml.gather({
    numDigits: 1,
    action: '/api/twiml/handle-input',
    method: 'POST',
    timeout: 5,
  });
  gather.say({ voice: 'alice' }, 'Press 1 to confirm, or 2 to repeat.');

  // Fallback if no input
  twiml.say({ voice: 'alice' }, 'No input received. Goodbye.');

  res.type('text/xml');
  res.send(twiml.toString());
});

// 3. Handle DTMF input
app.post('/api/twiml/handle-input', (req, res) => {
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();

  if (digit === '1') {
    twiml.say({ voice: 'alice' }, 'Confirmed. Thank you. Goodbye.');
  } else if (digit === '2') {
    twiml.redirect({ method: 'POST' }, '/api/twiml/outbound');
  } else {
    twiml.say({ voice: 'alice' }, 'Invalid input. Goodbye.');
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// 4. Status callback - track call progress
app.post('/api/call/status', (req, res) => {
  const { CallSid, CallStatus, CallDuration, From, To } = req.body;
  console.log(`[Status] Call ${CallSid}: ${CallStatus} | ${From} -> ${To} | Duration: ${CallDuration || 'N/A'}s`);
  // TODO: Store in database
  res.sendStatus(204);
});

// 5. Recording callback - get recording URL
app.post('/api/call/recording', (req, res) => {
  const { RecordingSid, RecordingUrl, RecordingDuration, RecordingStatus } = req.body;
  const mp3Url = `${RecordingUrl}.mp3`;
  console.log(`[Recording] ${RecordingSid}: ${RecordingStatus} | ${RecordingDuration}s | ${mp3Url}`);
  // TODO: Store recording URL in database, or download and store in S3
  res.sendStatus(204);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

### Setup Checklist

1. Create Twilio account at https://www.twilio.com/try-twilio
2. Get a voice-capable phone number from the Console
3. Note your Account SID and Auth Token
4. `npm install twilio express`
5. Set environment variables (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, BASE_URL)
6. For local dev: `npx ngrok http 3000` and set BASE_URL to the ngrok HTTPS URL
7. Run server and POST to `/api/call/initiate` with `{ "to": "+1...", "message": "Hello" }`

---

---

## 11. Twilio Media Streams - Real-Time Audio Streaming

> Added: 2026-03-27

Media Streams provides access to the **raw audio** from a Programmable Voice call by streaming it over **WebSockets** in near real-time. This enables real-time transcription, sentiment analysis, voice authentication, AI voice agents, and more.

### Two Types of Media Streams

| Feature | Unidirectional | Bidirectional |
|---------|---------------|---------------|
| **TwiML** | `<Start><Stream>` | `<Connect><Stream>` |
| **Direction** | Receive audio only | Send AND receive audio |
| **Tracks** | `inbound_track`, `outbound_track`, or `both_tracks` | `inbound_track` only |
| **Max per call** | 4 tracks | 1 stream |
| **DTMF support** | No | Yes (inbound only) |
| **Blocking** | Non-blocking (next TwiML executes) | Blocking (holds the call) |
| **REST API start** | Yes (Stream resource) | No (TwiML only) |
| **How to stop** | `<Stop><Stream>`, REST API, or end call | Close WebSocket or end call |

---

### Audio Format

Twilio sends and expects audio in a **single fixed format**:

| Property | Value |
|----------|-------|
| **Encoding** | `audio/x-mulaw` (G.711 mu-law) |
| **Sample Rate** | 8000 Hz |
| **Channels** | 1 (mono) |
| **Payload encoding** | Base64 |

When sending audio back (bidirectional), the payload must also be `audio/x-mulaw` at 8000 Hz, base64 encoded. **Do not include audio file type header bytes** in the payload -- raw PCM mu-law samples only.

---

### `<Stream>` TwiML Verb - Complete Reference

#### Attributes

| Attribute | Values | Default | Notes |
|-----------|--------|---------|-------|
| `url` | Absolute or relative URL | none (required) | Must use `wss://` protocol. No query params -- use `<Parameter>` instead |
| `name` | String | none | Unique per call. Needed to stop by name |
| `track` | `inbound_track`, `outbound_track`, `both_tracks` | `inbound_track` | Only `inbound_track` for bidirectional |
| `statusCallback` | Absolute URL | none | Receives `stream-started`, `stream-stopped`, `stream-error` |
| `statusCallbackMethod` | `GET`, `POST` | `POST` | |

#### statusCallback Parameters

When a stream starts or stops, Twilio sends:

| Parameter | Description |
|-----------|-------------|
| `AccountSid` | Account identifier |
| `CallSid` | Call identifier |
| `StreamSid` | Stream identifier |
| `StreamName` | Name if set, otherwise StreamSid |
| `StreamEvent` | `stream-started`, `stream-stopped`, `stream-error` |
| `StreamError` | Error message if applicable |
| `Timestamp` | ISO 8601 timestamp |

#### Custom Parameters

Pass custom key-value pairs to your WebSocket via `<Parameter>` nouns (max 500 chars per name+value):

```xml
<Start>
    <Stream url="wss://your-server.com/stream">
        <Parameter name="CallType" value="outbound-sales" />
        <Parameter name="AgentId" value="agent-42" />
    </Stream>
</Start>
```

These arrive in the WebSocket `start` message under `start.customParameters`.

---

### TwiML Examples

#### Unidirectional: Stream + Continue Call

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Start>
        <Stream name="my-audio-stream" url="wss://your-server.com/audio-stream"
                track="both_tracks"
                statusCallback="https://your-server.com/stream-status">
            <Parameter name="CallType" value="inbound" />
        </Stream>
    </Start>
    <Say>The stream has started. Your call is being analyzed in real-time.</Say>
    <Dial>+15555551234</Dial>
</Response>
```

The `<Start><Stream>` is non-blocking -- Twilio starts streaming and immediately moves to `<Say>` and then `<Dial>`. The stream continues running alongside the call.

#### Bidirectional: AI Voice Agent

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Please wait while we connect you to the AI assistant.</Say>
    <Pause length="1"/>
    <Connect>
        <Stream url="wss://your-server.com/media-stream">
            <Parameter name="SessionId" value="sess-abc123" />
        </Stream>
    </Connect>
    <Say>The assistant has disconnected. Goodbye.</Say>
</Response>
```

`<Connect><Stream>` is blocking -- Twilio holds the call on the stream. The `<Say>` after `<Connect>` only executes after your WebSocket server closes the connection.

#### Stream Audio from a Conference Participant

There is **no `<Stream>` inside `<Conference>`** -- they are separate TwiML elements. Instead, use `<Start><Stream>` BEFORE `<Conference>` to fork the participant's audio:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Start>
        <Stream name="conf-participant-stream"
                url="wss://your-server.com/conference-stream"
                track="both_tracks">
            <Parameter name="ConferenceName" value="my-room" />
            <Parameter name="ParticipantRole" value="agent" />
        </Stream>
    </Start>
    <Dial>
        <Conference>my-room</Conference>
    </Dial>
</Response>
```

This streams the participant's inbound AND outbound (conference mix) audio to your WebSocket while they are in the conference. Each participant joining with this TwiML gets their own stream.

**Alternative: REST API approach** -- Start a stream on an existing call via the Stream resource:

```
POST /2010-04-01/Accounts/{AccountSid}/Calls/{CallSid}/Streams.json

Url=wss://your-server.com/conference-stream
Track=both_tracks
Name=conf-stream-participant1
```

#### Stop a Unidirectional Stream

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stop>
        <Stream name="my-audio-stream" />
    </Stop>
    <Say>The stream has stopped.</Say>
</Response>
```

---

### WebSocket Protocol - Message Types

#### Messages FROM Twilio (all stream types)

##### 1. `connected` -- First message on WebSocket open

```json
{
  "event": "connected",
  "protocol": "Call",
  "version": "1.0.0"
}
```

##### 2. `start` -- Stream metadata (sent once)

```json
{
  "event": "start",
  "sequenceNumber": "1",
  "start": {
    "accountSid": "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "streamSid": "MZXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "callSid": "CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "tracks": ["inbound"],
    "mediaFormat": {
      "encoding": "audio/x-mulaw",
      "sampleRate": 8000,
      "channels": 1
    },
    "customParameters": {
      "CallType": "outbound-sales",
      "AgentId": "agent-42"
    }
  },
  "streamSid": "MZXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

##### 3. `media` -- Raw audio chunks (continuous)

```json
{
  "event": "media",
  "sequenceNumber": "4",
  "media": {
    "track": "inbound",
    "chunk": "2",
    "timestamp": "5",
    "payload": "no+JhoaJjpzS..."
  },
  "streamSid": "MZXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

- `media.track`: `"inbound"` or `"outbound"`
- `media.chunk`: Incrementing chunk number starting at `"1"`
- `media.timestamp`: Milliseconds from stream start
- `media.payload`: Base64-encoded mu-law audio

##### 4. `dtmf` -- Touch-tone input (bidirectional only)

```json
{
  "event": "dtmf",
  "streamSid": "MZXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "sequenceNumber": "5",
  "dtmf": {
    "track": "inbound_track",
    "digit": "1"
  }
}
```

##### 5. `stop` -- Stream ended

```json
{
  "event": "stop",
  "sequenceNumber": "5",
  "stop": {
    "accountSid": "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "callSid": "CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
  },
  "streamSid": "MZXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

##### 6. `mark` -- Playback complete notification (bidirectional only)

```json
{
  "event": "mark",
  "sequenceNumber": "4",
  "streamSid": "MZXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "mark": {
    "name": "my label"
  }
}
```

Twilio sends this when audio you sent has finished playing, using the same `mark.name` you specified.

#### Messages TO Twilio (bidirectional only)

##### Send audio back

```json
{
  "event": "media",
  "streamSid": "MZXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "media": {
    "payload": "a3242sa..."
  }
}
```

Audio is buffered and played in order. Payload must be `audio/x-mulaw`, 8000 Hz, base64 encoded, no file headers.

##### Send a mark (to track playback)

```json
{
  "event": "mark",
  "streamSid": "MZXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "mark": {
    "name": "utterance-1-end"
  }
}
```

Send after a media message. Twilio echoes it back when playback completes.

##### Send a clear (interrupt playback)

```json
{
  "event": "clear",
  "streamSid": "MZXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

Empties the audio buffer immediately. All pending `mark` messages are sent back. Use this to interrupt the AI when the user starts speaking (barge-in).

---

### Stream Resource REST API

Start/stop unidirectional streams on existing calls without TwiML:

#### Create a Stream

```
POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Calls/{CallSid}/Streams.json
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `Url` | Yes | WebSocket URL (`wss://...`) |
| `Name` | No | Unique name for the stream |
| `Track` | No | `inbound_track` (default), `outbound_track`, `both_tracks` |
| `StatusCallback` | No | URL for stream status events |
| `StatusCallbackMethod` | No | `GET` or `POST` (default) |
| `Parameter1.Name` / `Parameter1.Value` | No | Custom params (up to 99) |

#### Stop a Stream

```
POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Calls/{CallSid}/Streams/{StreamSid}.json

Status=stopped
```

You can use the `StreamSid` or the `Name` you assigned.

#### Node.js SDK (REST API)

```typescript
import twilio from 'twilio';

const client = twilio(accountSid, authToken);

// Start a stream on an existing call
const stream = await client.calls('CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
  .streams.create({
    url: 'wss://your-server.com/audio-stream',
    track: 'both_tracks',
    name: 'realtime-analysis',
    statusCallback: 'https://your-server.com/stream-status',
  });

console.log(`Stream SID: ${stream.sid}`);

// Stop the stream
await client.calls('CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
  .streams(stream.sid)
  .update({ status: 'stopped' });
```

---

### Node.js Implementation Examples

#### Example 1: Unidirectional Stream Receiver (Basic)

Uses the `websocket` npm package. Receives and logs audio from a Twilio call.

```javascript
"use strict";

const http = require('http');
const WebSocketServer = require('websocket').server;

const HTTP_SERVER_PORT = 8080;
const server = http.createServer();

const wsServer = new WebSocketServer({
  httpServer: server,
  autoAcceptConnections: true,
});

wsServer.on('connect', function (connection) {
  console.log('Media WS: Connection accepted');
  let messageCount = 0;
  let hasSeenMedia = false;

  connection.on('message', function (message) {
    if (message.type === 'utf8') {
      const data = JSON.parse(message.utf8Data);

      switch (data.event) {
        case 'connected':
          console.log('Connected:', data);
          break;

        case 'start':
          console.log('Stream started:', JSON.stringify(data.start, null, 2));
          console.log('Tracks:', data.start.tracks);
          console.log('Format:', data.start.mediaFormat);
          console.log('Custom params:', data.start.customParameters);
          break;

        case 'media':
          if (!hasSeenMedia) {
            console.log('First media message:', {
              track: data.media.track,
              chunk: data.media.chunk,
              timestamp: data.media.timestamp,
              payloadLength: data.media.payload.length,
            });
            hasSeenMedia = true;
          }
          messageCount++;

          // Decode the audio payload
          const audioBuffer = Buffer.from(data.media.payload, 'base64');
          // audioBuffer contains raw mu-law 8kHz mono samples
          // Process it: send to transcription API, write to file, analyze, etc.
          break;

        case 'stop':
          console.log(`Stream stopped. Total messages: ${messageCount}`);
          console.log('Stop details:', data.stop);
          break;
      }
    }
  });

  connection.on('close', function (reasonCode, description) {
    console.log(`Connection closed: ${reasonCode} - ${description}`);
  });
});

server.listen(HTTP_SERVER_PORT, () => {
  console.log(`WebSocket server listening on port ${HTTP_SERVER_PORT}`);
});
```

#### Example 2: Bidirectional Stream with Echo (using `ws` package)

A complete Fastify + `ws` server that receives audio from Twilio and sends it back (echo), demonstrating bidirectional streaming.

```javascript
import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

const fastify = Fastify({ logger: true });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

const PORT = process.env.PORT || 5050;
const ECHO_DELAY_CHUNKS = 50; // Buffer N chunks before echoing

// TwiML endpoint -- Twilio fetches this when call connects
fastify.all('/incoming-call', async (request, reply) => {
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say>Connected. Everything you say will be echoed back to you.</Say>
      <Pause length="1"/>
      <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
      </Connect>
    </Response>`;

  reply.type('text/xml').send(twimlResponse);
});

// WebSocket endpoint -- receives and sends audio
fastify.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, (connection, req) => {
    console.log('Twilio connected to WebSocket');

    let streamSid = null;
    let audioBuffer = [];
    let chunkCount = 0;

    connection.on('message', (message) => {
      const data = JSON.parse(message.toString());

      switch (data.event) {
        case 'connected':
          console.log('Twilio media stream connected');
          break;

        case 'start':
          streamSid = data.start.streamSid;
          console.log(`Stream started: ${streamSid}`);
          console.log('Format:', data.start.mediaFormat);
          break;

        case 'media':
          // Store incoming audio
          audioBuffer.push(data.media.payload);
          chunkCount++;

          // When we have enough chunks, echo them back
          if (audioBuffer.length >= ECHO_DELAY_CHUNKS) {
            const combinedPayload = Buffer.concat(
              audioBuffer.map(p => Buffer.from(p, 'base64'))
            ).toString('base64');

            // Send audio back to caller
            connection.send(JSON.stringify({
              event: 'media',
              streamSid: streamSid,
              media: { payload: combinedPayload }
            }));

            // Send a mark to track when playback completes
            connection.send(JSON.stringify({
              event: 'mark',
              streamSid: streamSid,
              mark: { name: `echo-${chunkCount}` }
            }));

            audioBuffer = [];
          }
          break;

        case 'mark':
          console.log(`Playback complete: ${data.mark.name}`);
          break;

        case 'dtmf':
          console.log(`DTMF received: ${data.dtmf.digit}`);
          // Example: close on '#' key
          if (data.dtmf.digit === '#') {
            console.log('User pressed #, closing stream');
            connection.close(1000, 'User requested close');
          }
          break;

        case 'stop':
          console.log('Stream stopped');
          break;
      }
    });

    connection.on('close', () => {
      console.log('WebSocket closed');
    });
  });
});

fastify.listen({ port: PORT }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`Server listening on port ${PORT}`);
});
```

#### Example 3: Bidirectional Stream with AI (OpenAI Realtime API)

The production pattern for connecting Twilio to an AI voice agent. This bridges two WebSockets: Twilio <-> your server <-> OpenAI Realtime API.

```javascript
import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

dotenv.config();

const { OPENAI_API_KEY } = process.env;
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

const SYSTEM_MESSAGE = 'You are a helpful AI assistant on a phone call.';
const VOICE = 'alloy';
const PORT = process.env.PORT || 5050;

// TwiML: Connect incoming call to bidirectional stream
fastify.all('/incoming-call', async (request, reply) => {
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say voice="Google.en-US-Chirp3-HD-Aoede">
        Please wait while we connect you to the AI assistant.
      </Say>
      <Pause length="1"/>
      <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
      </Connect>
    </Response>`;
  reply.type('text/xml').send(twimlResponse);
});

// WebSocket handler: Bridge Twilio <-> OpenAI
fastify.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, (connection, req) => {
    console.log('Twilio connected');

    // Open WebSocket to OpenAI Realtime API
    const openAiWs = new WebSocket(
      'wss://api.openai.com/v1/realtime?model=gpt-realtime',
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );

    let streamSid = null;

    // Configure OpenAI session once connected
    openAiWs.on('open', () => {
      console.log('Connected to OpenAI Realtime API');
      setTimeout(() => {
        openAiWs.send(JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            model: 'gpt-realtime',
            output_modalities: ['audio'],
            audio: {
              input: {
                format: { type: 'audio/pcmu' },
                turn_detection: { type: 'server_vad' }
              },
              output: {
                format: { type: 'audio/pcmu' },
                voice: VOICE
              },
            },
            instructions: SYSTEM_MESSAGE,
          },
        }));
      }, 250);
    });

    // OpenAI -> Twilio: Forward AI audio to caller
    openAiWs.on('message', (data) => {
      try {
        const response = JSON.parse(data);

        if (response.type === 'response.output_audio.delta' && response.delta) {
          connection.send(JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: Buffer.from(response.delta, 'base64').toString('base64')
            }
          }));
        }
      } catch (error) {
        console.error('Error processing OpenAI message:', error);
      }
    });

    // Twilio -> OpenAI: Forward caller audio to AI
    connection.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case 'media':
            if (openAiWs.readyState === WebSocket.OPEN) {
              openAiWs.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: data.media.payload
              }));
            }
            break;

          case 'start':
            streamSid = data.start.streamSid;
            console.log('Stream started:', streamSid);
            break;
        }
      } catch (error) {
        console.error('Error parsing Twilio message:', error);
      }
    });

    // Cleanup
    connection.on('close', () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      console.log('Twilio disconnected');
    });

    openAiWs.on('close', () => console.log('OpenAI disconnected'));
    openAiWs.on('error', (error) => console.error('OpenAI WS error:', error));
  });
});

fastify.listen({ port: PORT }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`Server listening on port ${PORT}`);
});
```

#### TwiML Generation with Node.js SDK

```typescript
import twilio from 'twilio';
const VoiceResponse = twilio.twiml.VoiceResponse;

// Unidirectional stream
function generateUnidirectionalTwiml() {
  const response = new VoiceResponse();
  const start = response.start();
  const stream = start.stream({
    name: 'realtime-transcription',
    url: 'wss://your-server.com/transcription-stream',
    track: 'both_tracks',
    statusCallback: 'https://your-server.com/stream-events',
  });
  stream.parameter({ name: 'Language', value: 'en-US' });
  stream.parameter({ name: 'Model', value: 'deepgram-nova' });

  response.say('Your call is now being transcribed.');
  response.dial('+15555551234');

  return response.toString();
}

// Bidirectional stream
function generateBidirectionalTwiml(host: string) {
  const response = new VoiceResponse();
  response.say('Connecting you to the AI agent.');
  response.pause({ length: 1 });
  const connect = response.connect();
  const stream = connect.stream({ url: `wss://${host}/media-stream` });
  stream.parameter({ name: 'AgentId', value: 'voice-bot-1' });

  return response.toString();
}

// Conference with stream
function generateConferenceWithStreamTwiml(conferenceName: string) {
  const response = new VoiceResponse();
  const start = response.start();
  start.stream({
    name: `stream-${conferenceName}`,
    url: 'wss://your-server.com/conference-stream',
    track: 'both_tracks',
  });

  const dial = response.dial();
  dial.conference(conferenceName);

  return response.toString();
}
```

---

### Conference + Media Streams Architecture

Twilio does not support `<Stream>` inside `<Conference>` directly. Here are the approaches:

#### Approach 1: TwiML -- `<Start><Stream>` before `<Conference>`

Each participant's TwiML starts a stream before joining the conference. The stream captures that participant's inbound audio AND the conference mix (outbound).

```
Caller A                    Twilio                     Your Server
  |                           |                            |
  |-- Dials in -------------->|                            |
  |                           |-- Fetches TwiML ---------->|
  |                           |<-- <Start><Stream> + <Conference>
  |                           |                            |
  |                           |== WebSocket (audio) ======>|
  |                           |                            |
  |<== In conference ========>|                            |
```

Each participant joining with `<Start><Stream>` gets their own WebSocket. With `track="both_tracks"`, you get:
- `inbound` track = what that participant is saying
- `outbound` track = the conference mix they hear (all other participants)

#### Approach 2: REST API -- Add Stream to Existing Conference Participant

If a participant is already in a conference, use the Stream REST API to start streaming their audio:

```typescript
// Get conference participants
const participants = await client
  .conferences('CFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
  .participants.list();

// Start a stream on each participant's call
for (const participant of participants) {
  await client.calls(participant.callSid)
    .streams.create({
      url: 'wss://your-server.com/conference-stream',
      track: 'both_tracks',
      name: `conf-stream-${participant.callSid}`,
    });
}
```

#### Approach 3: Conference Recording + Real-time

For simpler use cases (transcription after the fact), use conference recording instead:

```xml
<Dial>
    <Conference record="record-from-start"
                recordingStatusCallback="/recording-done">
        my-room
    </Conference>
</Dial>
```

---

### Key Limitations and Gotchas

1. **No `<Stream>` inside `<Conference>` or `<Dial>` as a noun** -- `<Stream>` only works under `<Start>` or `<Connect>`, never nested inside `<Dial>` or `<Conference>`.

2. **Bidirectional = 1 per call** -- You can only have one bidirectional stream per call. For unidirectional, up to 4 tracks.

3. **No bidirectional via REST API** -- Bidirectional streams can only be started via `<Connect><Stream>` TwiML.

4. **Audio format is fixed** -- Always mu-law, 8kHz, mono. You cannot change this. If your AI/transcription service needs a different format (like PCM16, 16kHz), you must transcode.

5. **No query strings on WebSocket URL** -- Use `<Parameter>` nouns instead.

6. **Firewall requirements** -- Allow TCP 443 from any public IP for secure WebSocket connections.

7. **`<Connect><Stream>` is blocking** -- No TwiML after it executes until the WebSocket closes.

8. **Validate `X-Twilio-Signature`** -- Verify that the stream is from an authentic Twilio source.

9. **Payload = raw samples only** -- When sending audio to Twilio, do not include WAV/MP3 headers in the payload. Raw mu-law bytes only.

10. **Regional availability** -- Media Streams available in US1 (default), IE1 (Ireland), and AU1 (Australia).

---

### Mu-law Transcoding Reference

If you need to convert between mu-law and PCM (e.g., for an AI API that expects linear PCM):

```javascript
// mu-law to 16-bit linear PCM (decode)
function mulawToLinear(mulawByte) {
  const MULAW_BIAS = 33;
  let sign, exponent, mantissa, sample;

  mulawByte = ~mulawByte;
  sign = (mulawByte & 0x80);
  exponent = (mulawByte >> 4) & 0x07;
  mantissa = mulawByte & 0x0F;

  sample = (mantissa << (exponent + 3)) + MULAW_BIAS;
  sample <<= (exponent);

  if (sign !== 0) sample = -sample;
  return sample;
}

// Decode a full buffer of mu-law to PCM16
function decodeMulaw(mulawBuffer) {
  const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2);
  for (let i = 0; i < mulawBuffer.length; i++) {
    const sample = mulawToLinear(mulawBuffer[i]);
    pcmBuffer.writeInt16LE(sample, i * 2);
  }
  return pcmBuffer;
}

// Usage with Twilio media message
function processMediaMessage(data) {
  const mulawBytes = Buffer.from(data.media.payload, 'base64');
  const pcm16 = decodeMulaw(mulawBytes);
  // pcm16 is now 16-bit signed integer PCM at 8kHz mono
  // Send to Deepgram, Whisper, Google STT, etc.
}
```

---

### Package Dependencies

```json
{
  "dependencies": {
    "fastify": "^5.x",
    "@fastify/formbody": "^8.x",
    "@fastify/websocket": "^11.x",
    "ws": "^8.x",
    "twilio": "^5.x",
    "dotenv": "^16.x"
  }
}
```

Alternative if using the older `websocket` package (as in Twilio's official examples):

```json
{
  "dependencies": {
    "httpdispatcher": "^2.x",
    "websocket": "^1.x"
  }
}
```

---

## Sources

- [Twilio Voice Quickstart (Server-Side)](https://www.twilio.com/docs/voice/quickstart/server)
- [Twilio Call Resource API](https://www.twilio.com/docs/voice/api/call-resource)
- [TwiML for Programmable Voice](https://www.twilio.com/docs/voice/twiml)
- [Twilio Recordings API](https://www.twilio.com/docs/voice/api/recording)
- [Twilio Voice Webhooks](https://www.twilio.com/docs/usage/webhooks/voice-webhooks)
- [Record Phone Calls in Node.js](https://www.twilio.com/docs/voice/tutorials/how-to-record-phone-calls/node)
- [Make Outbound Phone Calls Tutorial](https://www.twilio.com/docs/voice/tutorials/how-to-make-outbound-phone-calls)
- [Twilio Voice Pricing](https://www.twilio.com/en-us/voice/pricing)
- [Plivo vs Twilio Price Comparison](https://www.plivo.com/twilio-alternative/price-comparison/)
- [Plivo vs Twilio Feature Comparison](https://getvoip.com/blog/plivo-vs-twilio/)
- [twilio-node SDK (GitHub)](https://github.com/twilio/twilio-node)
- [Twilio Media Streams Overview](https://www.twilio.com/docs/voice/media-streams)
- [Twilio Stream TwiML Reference](https://www.twilio.com/docs/voice/twiml/stream)
- [Twilio Media Streams WebSocket Messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages)
- [Twilio Stream Resource REST API](https://www.twilio.com/docs/voice/api/stream-resource)
- [Twilio Media Streams GitHub Examples](https://github.com/twilio/media-streams)
- [Build an AI Voice Assistant with Twilio + OpenAI](https://www.twilio.com/en-us/blog/voice-ai-assistant-openai-realtime-api-node)
- [Connect TwiML App to Twilio Conference](https://www.twilio.com/en-us/blog/developers/tutorials/product/connect-twiml-app-twilio-conference)
