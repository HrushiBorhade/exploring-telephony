# Pipecat Deep Dive: From First Principles to Production
## A Complete Guide for TypeScript Developers

> **Who this is for:** You're primarily a TypeScript/Node.js developer. You understand async/await, event emitters, streams, and REST APIs. You may be new to Python. This guide bridges that gap and takes you all the way to running production voice agents with Pipecat.

---

## Table of Contents

1. [Python Primer for TS Developers](#1-python-primer-for-ts-developers)
2. [What is Pipecat and Why Does It Exist?](#2-what-is-pipecat-and-why-does-it-exist)
3. [Core Mental Model: The Pipeline](#3-core-mental-model-the-pipeline)
4. [Frames: The Data Packets of Pipecat](#4-frames-the-data-packets-of-pipecat)
5. [Frame Processors: The Workers](#5-frame-processors-the-workers)
6. [Transports: The Network Layer](#6-transports-the-network-layer)
7. [Speech-to-Text (STT) Services](#7-speech-to-text-stt-services)
8. [LLM Services](#8-llm-services)
9. [Text-to-Speech (TTS) Services](#9-text-to-speech-tts-services)
10. [Voice Activity Detection (VAD)](#10-voice-activity-detection-vad)
11. [Context Management: Conversation Memory](#11-context-management-conversation-memory)
12. [Function Calling: Giving Your Bot Superpowers](#12-function-calling-giving-your-bot-superpowers)
13. [Building Your First Complete Bot](#13-building-your-first-complete-bot)
14. [Pipecat Flows: Structured Conversations](#14-pipecat-flows-structured-conversations)
15. [Custom Frame Processors](#15-custom-frame-processors)
16. [Observers and Metrics](#16-observers-and-metrics)
17. [Telephony Integration (Twilio / Telnyx)](#17-telephony-integration-twilio--telnyx)
18. [FastAPI Server Patterns](#18-fastapi-server-patterns)
19. [Production Deployment](#19-production-deployment)
20. [Debugging and Observability](#20-debugging-and-observability)
21. [Common Patterns and Recipes](#21-common-patterns-and-recipes)
22. [TypeScript vs Python Cheat Sheet](#22-typescript-vs-python-cheat-sheet)

---

## 1. Python Primer for TS Developers

Before we touch Pipecat, you need to be comfortable enough in Python to read and write the code. If you already know Python well, skip to Section 2.

### 1.1 Environment Setup

In TypeScript you have `nvm` + `npm`/`pnpm`. Python has a similar story:

```bash
# Install uv - the modern Python package manager (replaces pip, venv, poetry)
# Think of it like "pnpm for Python" - fast, deterministic
curl -LsSf https://astral.sh/uv/install.sh | sh

# Create a new project (like npm init)
uv init my-voice-bot
cd my-voice-bot

# Add a dependency (like pnpm add)
uv add pipecat-ai

# Add a dependency with optional extras (like pnpm add with peer deps)
uv add "pipecat-ai[daily,openai,deepgram,cartesia,silero]"

# Run a file (like node bot.js or npx ts-node bot.ts)
uv run bot.py

# Sync dependencies from lockfile (like pnpm install)
uv sync
```

> **The `.venv` folder** is created automatically by `uv` in your project root. It is like `node_modules` - add it to `.gitignore`.

### 1.2 Key Python vs TypeScript Syntax Differences

#### Variables and Types

```python
# Python - no let/const, uses type hints (optional but recommended)
name: str = "Alice"
age: int = 30
items: list[str] = ["a", "b", "c"]
config: dict[str, any] = {"key": "value"}

# No semicolons. Indentation IS the block (like significant whitespace)
if age > 18:
    print("Adult")
else:
    print("Minor")
```

```typescript
// TypeScript equivalent
const name: string = "Alice";
const age: number = 30;
const items: string[] = ["a", "b", "c"];
const config: Record<string, any> = { key: "value" };
```

#### Functions

```python
# Python
def greet(name: str, greeting: str = "Hello") -> str:
    return f"{greeting}, {name}!"

# f-strings = template literals
message = f"User said: {text}"   # like `User said: ${text}`
```

```typescript
// TypeScript
function greet(name: string, greeting: string = "Hello"): string {
  return `${greeting}, ${name}!`;
}
```

#### Classes

```python
# Python class
class AudioProcessor:
    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate   # this.sampleRate = sampleRate
        self._buffer = []                # private by convention (underscore prefix)

    def process(self, audio: bytes) -> bytes:
        # do something
        return audio

    @property                            # like a getter
    def buffer_size(self) -> int:
        return len(self._buffer)

# Inheritance
class SpecialProcessor(AudioProcessor):
    def __init__(self):
        super().__init__(sample_rate=8000)  # super() like in TS
```

```typescript
// TypeScript equivalent
class AudioProcessor {
  private buffer: Buffer[] = [];
  constructor(public sampleRate: number = 16000) {}

  process(audio: Buffer): Buffer { return audio; }

  get bufferSize(): number { return this.buffer.length; }
}

class SpecialProcessor extends AudioProcessor {
  constructor() { super(8000); }
}
```

#### Async/Await - THE Most Important Part

Python's async/await is almost identical to TypeScript's, with one key difference: you need an **event loop** to run coroutines.

```python
import asyncio

# Define an async function (coroutine) - same as TypeScript async function
async def fetch_data(url: str) -> dict:
    await asyncio.sleep(1)  # like await setTimeout(1000)
    return {"data": "result"}

# Parallel execution - like Promise.all()
async def main():
    result1, result2 = await asyncio.gather(
        fetch_data("url1"),
        fetch_data("url2"),
    )
    print(result1, result2)

# Run the event loop - this is what "node bot.js" does for you automatically
asyncio.run(main())
```

```typescript
// TypeScript equivalent
async function fetchData(url: string): Promise<object> {
  await new Promise(r => setTimeout(r, 1000));
  return { data: "result" };
}

async function main() {
  const [result1, result2] = await Promise.all([
    fetchData("url1"),
    fetchData("url2"),
  ]);
  console.log(result1, result2);
}

main();
```

#### Async Queues (you will need these with Pipecat)

```python
import asyncio

queue: asyncio.Queue[str] = asyncio.Queue()

# Producer
async def producer():
    await queue.put("hello")
    await queue.put("world")

# Consumer
async def consumer():
    while True:
        item = await queue.get()  # blocks until item available
        print(item)
        queue.task_done()         # mark item as processed
```

#### Dataclasses - Python's Answer to TypeScript Interfaces/Types

```python
from dataclasses import dataclass, field

@dataclass
class UserMessage:
    text: str
    timestamp: float
    metadata: dict = field(default_factory=dict)

# Usage
msg = UserMessage(text="hello", timestamp=1234567890.0)
print(msg.text)  # hello
```

```typescript
// TypeScript equivalent
interface UserMessage {
  text: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
```

#### Environment Variables

```python
import os
from dotenv import load_dotenv

load_dotenv()  # reads .env file - like require('dotenv').config()

api_key = os.getenv("OPENAI_API_KEY")
port = int(os.getenv("PORT", "8080"))  # with default value + type cast
```

#### Type Hints You Will See in Pipecat

```python
from typing import Optional, List, Dict, Any, Callable, Awaitable, Union

# Optional = T | undefined in TS
name: Optional[str] = None

# Union = T | U in TS
value: Union[str, int] = "hello"

# Callable with types
handler: Callable[[str, int], Awaitable[None]]

# In Python 3.10+ you can use | syntax like TS
name: str | None = None
```

### 1.3 Python Packages You Will Use Constantly

| Python | TypeScript Equivalent | Purpose |
|--------|-----------------------|---------|
| `asyncio` | Node.js event loop (built-in) | Async runtime |
| `fastapi` | Express / Hono | HTTP server |
| `uvicorn` | Node.js HTTP server | ASGI server (runs FastAPI) |
| `aiohttp` | fetch / axios | HTTP client |
| `python-dotenv` | dotenv | Load .env files |
| `loguru` | pino / winston | Logging |
| `pydantic` | zod | Schema validation |

---

## 2. What is Pipecat and Why Does It Exist?

### 2.1 The Problem It Solves

Building a real-time voice AI bot sounds simple: receive audio -> transcribe -> think -> speak. But the moment you start building it yourself, you hit a wall of hard problems:

1. **Audio streaming**: Raw PCM audio arrives as a stream of bytes. You need VAD (Voice Activity Detection) to detect when someone starts/stops talking.
2. **Latency**: The entire round trip (audio in -> STT -> LLM -> TTS -> audio out) must happen in under 800ms for it to feel natural.
3. **Interruption handling**: If the user starts talking while the bot is speaking, the bot needs to immediately stop and listen.
4. **Concurrency**: Audio processing, LLM calls, and TTS generation all need to happen concurrently, not sequentially.
5. **State management**: Multi-turn conversations need to track history and context correctly.
6. **Provider swapping**: You want to swap Deepgram for Google STT or ElevenLabs for Cartesia without rewriting everything.

Pipecat solves all of these with a clean abstraction: **the pipeline**.

### 2.2 The Framework at 10,000 Feet

```
User speaks -> [microphone/phone] -> [Transport Input]
                                           |
                              [VAD: is user speaking?]
                                           |
                              [STT: audio -> text]
                                           |
                              [Context Aggregator: store user turn]
                                           |
                              [LLM: generate response]
                                           |
                              [TTS: text -> audio]
                                           |
                              [Transport Output] -> [speaker/phone]
                                           |
                              [Context Aggregator: store assistant turn]
```

Each box in that diagram is a **FrameProcessor**. Data moves between them as **Frames**. The whole thing is orchestrated by a **Pipeline**.

### 2.3 What Pipecat is NOT

- It is **not a hosting platform** (though Pipecat Cloud exists for deployment)
- It is **not an LLM** - you bring your own (OpenAI, Anthropic, Google, etc.)
- It is **not a telephony provider** - you use Twilio, Telnyx, Daily, etc.
- It is **not a frontend framework** - it runs on the server; client SDKs exist for JS/React/mobile

---

## 3. Core Mental Model: The Pipeline

### 3.1 Pipelines vs. Node.js Streams

If you have used Node.js streams or RxJS, the Pipeline concept will click immediately.

| Node.js Streams | Pipecat Pipeline |
|-----------------|-----------------|
| `stream.pipe(transform).pipe(output)` | `Pipeline([processor1, processor2, ...])` |
| `Readable`, `Writable`, `Transform` | `FrameProcessor` |
| `chunk` (Buffer/string) | `Frame` (typed dataclass) |
| `stream.push(data)` | `await self.push_frame(frame)` |
| `EventEmitter` events | Observer callbacks |

### 3.2 Creating a Pipeline

```python
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.pipeline.runner import PipelineRunner

# A pipeline is just an ordered list of processors
pipeline = Pipeline([
    transport.input(),              # Source: receives audio from user
    stt,                            # Speech to Text
    context_aggregator.user(),      # Store user's text in conversation
    llm,                            # Text to Response text (streamed tokens)
    tts,                            # Response text to Audio
    transport.output(),             # Sink: sends audio to user
    context_aggregator.assistant(), # Store bot's response in conversation
])

# Wrap in a task to configure execution
task = PipelineTask(
    pipeline,
    params=PipelineParams(
        enable_metrics=True,
        audio_in_sample_rate=16000,   # 16kHz input audio
        audio_out_sample_rate=24000,  # 24kHz output audio
    ),
)

# Run it
runner = PipelineRunner(handle_sigint=True)
await runner.run(task)
```

### 3.3 How Data Flows

This is **the most important thing to understand**:

> **Processors do NOT consume frames. They propagate them.**

When `stt` receives an `InputAudioRawFrame`, it:
1. Transcribes it
2. Creates a `TranscriptionFrame` with the text
3. **Pushes BOTH the original audio AND the new transcription downstream**

This means multiple processors can observe the same audio. For example:

```python
pipeline = Pipeline([
    transport.input(),          # Creates InputAudioRawFrame
    stt,                        # Audio -> TranscriptionFrame (audio still flows too)
    context_aggregator.user(),  # Reads TranscriptionFrame
    llm,                        # Reads context, creates LLMTextFrame
    tts,                        # Reads LLMTextFrame, creates TTSAudioRawFrame
    transport.output(),         # Reads TTSAudioRawFrame - sends to user
    audio_recorder,             # ALSO reads TTSAudioRawFrame - records it!
    context_aggregator.assistant(),
])
```

### 3.4 Parallel Pipelines

For conditional routing (like multi-language support):

```python
from pipecat.pipeline.parallel_pipeline import ParallelPipeline
from pipecat.processors.filters.function_filter import FunctionFilter

async def is_english(frame) -> bool:
    return getattr(frame, "language", "en").startswith("en")

async def is_spanish(frame) -> bool:
    return getattr(frame, "language", "es").startswith("es")

pipeline = Pipeline([
    transport.input(),
    stt,
    llm,
    ParallelPipeline([
        [FunctionFilter(is_english), english_tts],   # Branch 1: English TTS
        [FunctionFilter(is_spanish), spanish_tts],   # Branch 2: Spanish TTS
    ]),
    transport.output(),
])
```

Think of `ParallelPipeline` like a Promise.all() where each branch receives all upstream frames but only acts on the ones it matches.

### 3.5 Pipeline Lifecycle

```
Starting -> Running -> Stopping -> Stopped
```

- **Starting**: All processors initialize (open WebSocket connections, load models)
- **Running**: Frames flow continuously
- **Stopping**: Triggered by EndFrame, signal, or exception
- **Stopped**: Resources cleaned up

### 3.6 PipelineParams Reference

```python
params = PipelineParams(
    # Audio
    audio_in_sample_rate=16000,         # Input audio sample rate (Hz)
    audio_out_sample_rate=24000,        # Output audio sample rate (Hz)
    audio_in_channels=1,                # Mono input
    audio_out_channels=1,               # Mono output

    # Metrics
    enable_metrics=True,                # Track latency/timing metrics
    enable_usage_metrics=True,          # Track token/character usage
    report_only_initial_ttfb=True,      # Log only first Time-To-First-Byte per turn

    # Behavior
    allow_interruptions=True,           # Let user interrupt the bot
)
```

---

## 4. Frames: The Data Packets of Pipecat

### 4.1 What is a Frame?

A Frame is like a typed message in a message queue - it carries data and has a specific type that tells processors what to do with it.

In TypeScript terms, a Frame is like:

```typescript
// TypeScript analogy
interface Frame {
  id: number;         // auto-assigned
  name: string;       // auto-assigned from class name
}

interface InputAudioRawFrame extends Frame {
  audio: Uint8Array;
  sample_rate: number;
  num_channels: number;
}

interface TranscriptionFrame extends Frame {
  text: string;
  user_id: string;
  timestamp: string;
}
```

In Python:

```python
from pipecat.frames.frames import Frame, InputAudioRawFrame, TranscriptionFrame
from dataclasses import dataclass

# All frames are dataclasses
@dataclass
class InputAudioRawFrame(DataFrame):
    audio: bytes
    sample_rate: int
    num_channels: int
```

### 4.2 Frame Categories - The Most Important Distinction

There are three base frame categories, and this determines **how urgently** they are processed:

#### SystemFrames - Jump the Queue

```python
# Processed IMMEDIATELY, bypass all queues
# Use for urgent signals that cannot wait

class SystemFrame(Frame): pass

# Examples:
# InputAudioRawFrame   - raw audio from user (needs immediate processing)
# InterruptionFrame    - user interrupted the bot (cancel everything NOW)
# UserStartedSpeakingFrame
# UserStoppedSpeakingFrame
```

Think of SystemFrames like browser events with `{ capture: true }` - they fire before queued work.

#### DataFrames - Orderly Queue

```python
# Queued and processed in order
# Use for content that must be sequentially handled

class DataFrame(Frame): pass

# Examples:
# TranscriptionFrame     - "user said X"
# LLMTextFrame           - "bot will say token X"
# TTSAudioRawFrame       - audio chunk to play
# OutputAudioRawFrame    - audio being sent out
# TextFrame              - general text
```

#### ControlFrames - Lifecycle Signals

```python
# Also queued, but carry pipeline lifecycle information

class ControlFrame(Frame): pass

# Examples:
# StartFrame            - pipeline is starting
# EndFrame              - pipeline should stop
# TTSStartedFrame       - TTS has started generating
# TTSStoppedFrame       - TTS finished
# LLMFullResponseStartFrame / LLMFullResponseEndFrame
# BotStartedSpeakingFrame / BotStoppedSpeakingFrame
```

### 4.3 Complete Frame Type Reference

Here are the frames you will work with most often:

```python
# --- AUDIO ---
InputAudioRawFrame(audio: bytes, sample_rate: int, num_channels: int)
# Raw audio bytes from the user's microphone/phone

OutputAudioRawFrame(audio: bytes, sample_rate: int, num_channels: int)
# Audio bytes being sent to the user

TTSAudioRawFrame(audio: bytes, sample_rate: int, num_channels: int)
# Audio generated by TTS service

# --- TEXT ---
TranscriptionFrame(text: str, user_id: str, timestamp: str)
# User's speech transcribed to text

TextFrame(text: str)
# Generic text frame

LLMTextFrame(text: str)
# A single token from the LLM streaming response

# --- LLM LIFECYCLE ---
LLMFullResponseStartFrame()
# LLM started generating a response

LLMFullResponseEndFrame()
# LLM finished generating (full response complete)

LLMMessagesFrame(messages: list)
# Sends conversation history to LLM

# --- TTS LIFECYCLE ---
TTSSpeakFrame(text: str)
# Request TTS to speak this text immediately (bypasses LLM)

TTSStartedFrame()
TTSStoppedFrame()

# --- SPEECH DETECTION ---
UserStartedSpeakingFrame()
# VAD detected user started speaking

UserStoppedSpeakingFrame()
# VAD detected user stopped speaking

# --- CONTROL ---
StartFrame()
# Pipeline started

EndFrame()
# Pipeline should cleanly stop

CancelFrame()
# Pipeline should immediately abort

InterruptionFrame()
# User interrupted - cancel current bot response

# --- METRICS ---
MetricsFrame(data: list)
# Contains timing/usage metrics
```

### 4.4 Creating Custom Frames

```python
from dataclasses import dataclass
from pipecat.frames.frames import DataFrame

@dataclass
class CustomerDataFrame(DataFrame):
    """Custom frame carrying customer information"""
    customer_id: str
    account_tier: str
    is_verified: bool = False

# Use it in a processor:
async def process_frame(self, frame: Frame, direction: FrameDirection):
    await super().process_frame(frame, direction)

    if isinstance(frame, CustomerDataFrame):
        self._current_customer = frame
        # Don't forget to push it forward!

    await self.push_frame(frame, direction)
```

---

## 5. Frame Processors: The Workers

### 5.1 The Base Class

Every component in a Pipecat pipeline is a `FrameProcessor`. The API is simple:

```python
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.frames.frames import Frame

class MyProcessor(FrameProcessor):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)   # ALWAYS call super().__init__()

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        # ALWAYS call super first - it handles StartFrame, EndFrame, InterruptionFrame
        await super().process_frame(frame, direction)

        # Your custom logic here
        if isinstance(frame, SomeFrame):
            # do something
            pass

        # ALWAYS push frames forward - if you don't, you break the pipeline!
        await self.push_frame(frame, direction)
```

The TypeScript equivalent would be:

```typescript
// TypeScript analogy - like a Transform stream
class MyProcessor extends Transform {
  _transform(frame: Frame, encoding: string, callback: Function) {
    if (frame instanceof SomeFrame) {
      // do something
    }
    this.push(frame); // ALWAYS push!
    callback();
  }
}
```

### 5.2 Frame Direction

Frames can flow **downstream** (toward output) or **upstream** (toward input):

```python
from pipecat.processors.frame_processor import FrameDirection

# Normal flow - toward transport.output()
await self.push_frame(frame, FrameDirection.DOWNSTREAM)

# Reverse flow - back toward transport.input()
# Used for control signals like interruptions
await self.push_frame(InterruptionFrame(), FrameDirection.UPSTREAM)
```

### 5.3 Processor Lifecycle Hooks

```python
class MyProcessor(FrameProcessor):
    async def start(self, frame: StartFrame):
        """Called once when pipeline starts. Open connections, load models here."""
        await super().start(frame)
        self._connection = await open_db_connection()

    async def stop(self, frame: EndFrame):
        """Called when pipeline stops cleanly."""
        await super().stop(frame)
        await self._connection.close()

    async def cancel(self, frame: CancelFrame):
        """Called when pipeline is aborted."""
        await super().cancel(frame)
        await self._connection.close()
```

### 5.4 A Real Custom Processor: Transcript Logger

```python
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.frames.frames import Frame, TranscriptionFrame, LLMTextFrame
from loguru import logger

class ConversationLogger(FrameProcessor):
    """Logs all user speech and bot responses to a file."""

    def __init__(self, log_file: str = "conversation.log"):
        super().__init__()
        self._log_file = log_file
        self._bot_response_buffer = []

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            # User spoke
            self._write_log(f"USER: {frame.text}")

        elif isinstance(frame, LLMTextFrame):
            # Bot is streaming its response token by token
            self._bot_response_buffer.append(frame.text)

        elif isinstance(frame, LLMFullResponseEndFrame):
            # Bot finished speaking
            full_response = "".join(self._bot_response_buffer)
            self._write_log(f"BOT: {full_response}")
            self._bot_response_buffer = []

        # Critical: always push ALL frames forward
        await self.push_frame(frame, direction)

    def _write_log(self, message: str):
        with open(self._log_file, "a") as f:
            f.write(f"{message}\n")
        logger.info(message)
```

### 5.5 Async Worker Processor Pattern

Sometimes you need to do expensive async work without blocking the pipeline:

```python
class AsyncEnrichmentProcessor(FrameProcessor):
    """Enriches transcriptions with async database lookups."""

    def __init__(self, db_client):
        super().__init__()
        self._db = db_client

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            # Fetch customer data - this is async, but it happens inline
            customer_data = await self._db.get_customer(frame.user_id)

            # Create and push enriched frame
            enriched = EnrichedTranscriptionFrame(
                text=frame.text,
                user_id=frame.user_id,
                timestamp=frame.timestamp,
                customer_name=customer_data["name"],
                account_tier=customer_data["tier"],
            )
            await self.push_frame(enriched, direction)
        else:
            await self.push_frame(frame, direction)
```

---

## 6. Transports: The Network Layer

### 6.1 What is a Transport?

A transport is the bridge between the real world (browser, phone, app) and your pipeline. It provides:
- `transport.input()` - a FrameProcessor that creates audio/video frames from incoming data
- `transport.output()` - a FrameProcessor that takes audio frames and sends them out

### 6.2 Available Transports

| Transport | Protocol | Best For |
|-----------|----------|----------|
| `DailyTransport` | WebRTC | Browser/app clients, production voice |
| `FastAPIWebsocketTransport` | WebSocket | Telephony (Twilio, Telnyx), server-to-server |
| `LiveKitTransport` | WebRTC | LiveKit-based apps |
| `SmallWebRTCTransport` | WebRTC P2P | Development, direct browser connections |
| `WebsocketTransport` | WebSocket | General-purpose server connections |
| `TavusTransport` | Proprietary | Tavus video avatar bots |
| `HeyGenTransport` | Proprietary | HeyGen LiveAvatar bots |

### 6.3 WebRTC vs WebSocket - When to Use Which

```
WebRTC (Daily, LiveKit, SmallWebRTC):
  Good for browser/mobile clients - built-in echo cancellation, noise reduction
  Good for unreliable networks - packet loss recovery, automatic adaptation
  Good for low latency voice - optimized for real-time audio
  Best for production voice assistants, customer-facing bots

WebSocket (FastAPIWebsocketTransport):
  Good for telephony providers (Twilio, Telnyx) - they send audio over WebSocket
  Good for server-to-server communication
  Good when you control both ends and network is reliable
  Note: No built-in audio processing - you handle echo/noise yourself
```

### 6.4 Daily Transport Setup

```python
import aiohttp
import os
from pipecat.transports.services.daily import DailyTransport, DailyParams

async def setup_daily_transport():
    room_url = os.getenv("DAILY_ROOM_URL")  # Pre-created room
    token = os.getenv("DAILY_TOKEN")         # Bot token

    transport = DailyTransport(
        room_url=room_url,
        token=token,
        bot_name="VoiceAssistant",
        params=DailyParams(
            audio_in_enabled=True,   # Receive user audio
            audio_out_enabled=True,  # Send bot audio
            video_in_enabled=False,  # No video input
            video_out_enabled=False, # No video output
            transcription_enabled=False,  # We handle STT ourselves
        ),
    )

    return transport
```

### 6.5 FastAPI WebSocket Transport (for Telephony)

```python
from fastapi import FastAPI, WebSocket
from pipecat.transports.network.fastapi_websocket import (
    FastAPIWebsocketTransport,
    FastAPIWebsocketParams,
)

app = FastAPI()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,    # Telephony providers do not want WAV headers
        ),
    )

    await run_bot(transport)
```

### 6.6 Transport Events

Transports emit events you can listen to:

```python
@transport.event_handler("on_client_connected")
async def on_connected(transport, participant):
    print(f"User connected: {participant['id']}")
    # Maybe send a greeting
    await task.queue_frame(TTSSpeakFrame("Hello! How can I help you today?"))

@transport.event_handler("on_client_disconnected")
async def on_disconnected(transport, participant):
    print(f"User disconnected: {participant['id']}")
    await task.cancel()  # End the pipeline
```

---

## 7. Speech-to-Text (STT) Services

### 7.1 How STT Works in the Pipeline

```
[InputAudioRawFrame] -> [STT Service] -> [TranscriptionFrame]
       ^                                         |
  Raw audio bytes                    "User said: hello there"
  (16000 Hz, mono)
```

### 7.2 STT Approaches

**Streaming STT** (recommended for low latency):
- Opens a persistent WebSocket to the STT provider
- Sends audio chunks in real-time
- Receives partial ("interim") and final transcriptions as they arrive
- Providers: Deepgram, Speechmatics, Gladia, AssemblyAI

**Segmented STT** (higher latency):
- Uses local VAD to detect end-of-speech
- Sends complete audio segment via HTTP
- Receives full transcription
- Providers: OpenAI Whisper, Google STT

### 7.3 Deepgram STT (Most Common)

```python
from pipecat.services.deepgram.stt import DeepgramSTTService
from deepgram import LiveOptions
import os

stt = DeepgramSTTService(
    api_key=os.getenv("DEEPGRAM_API_KEY"),
    live_options=LiveOptions(
        model="nova-2",           # Most accurate model
        language="en-US",         # Language
        encoding="linear16",      # PCM format
        sample_rate=16000,        # Match your audio input rate
        channels=1,               # Mono
        interim_results=True,     # Get partial transcriptions
        punctuate=True,           # Add punctuation
        endpointing=300,          # ms of silence before finalizing
    ),
)
```

### 7.4 OpenAI Whisper STT

```python
from pipecat.services.openai.stt import OpenAISTTService
import os

stt = OpenAISTTService(
    api_key=os.getenv("OPENAI_API_KEY"),
    model="whisper-1",
    language=None,  # None = auto-detect language
)
```

### 7.5 Pipeline Placement Rules

```python
# CORRECT: STT immediately after transport.input()
pipeline = Pipeline([
    transport.input(),     # Creates InputAudioRawFrame
    stt,                   # Converts audio -> TranscriptionFrame
    context_aggregator.user(),
    llm,
    ...
])

# WRONG: STT after other processors that do not pass audio through
pipeline = Pipeline([
    transport.input(),
    context_aggregator.user(),  # This does not produce audio frames
    stt,                        # Will not receive audio - broken!
    ...
])
```

### 7.6 Multilingual Configuration

```python
# Deepgram: use "multi" for multilingual mode
live_options = LiveOptions(model="nova-2", language="multi")

# Google STT: pass language array
from pipecat.services.google.stt import GoogleSTTService
stt = GoogleSTTService(
    credentials=credentials,
    languages=["en-US", "es-ES", "fr-FR"]
)

# Whisper: set language=None for auto-detection
stt = OpenAISTTService(api_key=key, model="whisper-1", language=None)
```

---

## 8. LLM Services

### 8.1 How LLM Works in the Pipeline

```
[LLMMessagesFrame]            -> [LLM Service] -> [LLMTextFrame] x N
(conversation history)                              (one per token)
                                                -> [LLMFullResponseEndFrame]
                                                -> [FunctionCallsStartedFrame] (if tools called)
```

### 8.2 OpenAI LLM Service

```python
from pipecat.services.openai.llm import OpenAILLMService
import os

llm = OpenAILLMService(
    api_key=os.getenv("OPENAI_API_KEY"),
    model="gpt-4o",
)

# With advanced settings
llm = OpenAILLMService(
    api_key=os.getenv("OPENAI_API_KEY"),
    model="gpt-4o",
    temperature=0.7,
    max_tokens=150,           # Keep responses short for voice
)
```

### 8.3 Anthropic Claude

```python
from pipecat.services.anthropic.llm import AnthropicLLMService
import os

llm = AnthropicLLMService(
    api_key=os.getenv("ANTHROPIC_API_KEY"),
    model="claude-3-5-sonnet-20241022",
)
```

### 8.4 Google Gemini

```python
from pipecat.services.google.llm import GoogleLLMService
import os

llm = GoogleLLMService(
    api_key=os.getenv("GOOGLE_API_KEY"),
    model="gemini-1.5-flash",
)
```

### 8.5 OpenAI-Compatible Endpoints (Local Models)

```python
# Use any OpenAI-compatible API (Ollama, LM Studio, Together AI, Groq)
llm = OpenAILLMService(
    api_key="not-needed-for-local",
    base_url="http://localhost:11434/v1",  # Ollama
    model="llama3.2:3b",
)
```

### 8.6 LLM Context: The System Prompt

```python
from pipecat.services.openai.llm import OpenAILLMContext

# Create context with system prompt and initial messages
context = OpenAILLMContext(
    messages=[
        {
            "role": "system",
            "content": """You are a helpful customer service agent for Acme Corp.

Your personality:
- Friendly and professional
- Concise - this is a voice conversation, keep answers under 2 sentences
- Always offer to help further"""
        }
    ]
)
```

### 8.7 LLM Context Aggregator

The context aggregator connects user speech to the LLM and stores the conversation history:

```python
from pipecat.processors.aggregators.openai_llm_context import (
    OpenAILLMContext,
    OpenAILLMContextAggregator,
)

context = OpenAILLMContext(messages=[
    {"role": "system", "content": "You are a helpful assistant."}
])

# Create a pair: one for user turns, one for assistant turns
context_aggregator = llm.create_context_aggregator(context)

# Use in pipeline
pipeline = Pipeline([
    transport.input(),
    stt,
    context_aggregator.user(),      # Stores user transcription in context
    llm,                            # Reads context, generates response
    tts,
    transport.output(),
    context_aggregator.assistant(), # Stores bot response in context
])
```

### 8.8 Keeping Responses Short for Voice

Voice responses should be concise. Engineer your system prompt:

```python
system_prompt = """You are a voice assistant.

CRITICAL RULES FOR VOICE:
1. Keep ALL responses under 2 sentences
2. Never use markdown formatting (no **, #, -, etc.)
3. Never say "Certainly!" or "Of course!" - just answer
4. Speak naturally, like a conversation
5. If uncertain, ask ONE clarifying question
"""
```

---

## 9. Text-to-Speech (TTS) Services

### 9.1 How TTS Works in the Pipeline

```
[LLMTextFrame] x N            -> [TTS Service] -> [TTSAudioRawFrame] x N
(streaming tokens)                                  (audio chunks)

The TTS service aggregates tokens into sentences before synthesizing
(reduces latency vs waiting for full response)
```

### 9.2 Cartesia TTS (Low Latency, Recommended)

```python
from pipecat.services.cartesia.tts import CartesiaTTSService
import os

tts = CartesiaTTSService(
    api_key=os.getenv("CARTESIA_API_KEY"),
    voice_id="79a125e8-cd45-4c13-8a67-188112f4dd22",  # Voice ID
    model_id="sonic-2024-10-19",  # Fast, high-quality
)
```

### 9.3 ElevenLabs TTS

```python
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
import os

tts = ElevenLabsTTSService(
    api_key=os.getenv("ELEVENLABS_API_KEY"),
    voice_id="pNInz6obpgDQGcFmaJgB",  # "Adam" voice
    model="eleven_turbo_v2_5",         # Fast model for low latency
)
```

### 9.4 OpenAI TTS

```python
from pipecat.services.openai.tts import OpenAITTSService
import os

tts = OpenAITTSService(
    api_key=os.getenv("OPENAI_API_KEY"),
    voice="alloy",      # alloy, echo, fable, onyx, nova, shimmer
    model="tts-1",      # tts-1 (faster) or tts-1-hd (better quality)
    speed=1.0,          # Playback speed (0.25-4.0)
)
```

### 9.5 Forcing the Bot to Speak (TTSSpeakFrame)

Sometimes you want the bot to say something without going through the LLM:

```python
from pipecat.frames.frames import TTSSpeakFrame

# Queue a message from outside the pipeline
# (e.g., when a user connects)
await task.queue_frame(TTSSpeakFrame("Welcome back! How can I help you today?"))

# Or inside a processor
await self.push_frame(TTSSpeakFrame("Please hold while I look that up."))
```

### 9.6 Dynamic Voice Settings

```python
from pipecat.frames.frames import TTSUpdateSettingsFrame

# Change voice settings mid-conversation
await task.queue_frame(TTSUpdateSettingsFrame(
    speed=1.1,    # Slightly faster
    pitch=1.0,
))
```

### 9.7 TTS Latency Optimization

```
WebSocket-based TTS (Cartesia, ElevenLabs, Rime):
  Approximately 100-200ms TTFB (Time to First Audio Byte)
  Streams audio as it generates - user hears first word quickly

HTTP-based TTS (OpenAI TTS, Azure):
  Must generate complete audio before sending
  Approximately 500-1000ms latency for short responses
  Good quality but slower
```

**Rule**: For production voice bots, always use WebSocket-based TTS services.

---

## 10. Voice Activity Detection (VAD)

### 10.1 Why VAD Matters

VAD solves a fundamental problem: how does the bot know when you have finished speaking?

Without VAD, you would have to use silence detection at fixed intervals (clunky). With VAD, the system knows exactly when speech starts and ends, enabling:
- Accurate turn-taking (no talking over each other)
- Faster STT (do not send silence to transcription)
- Interruption detection (user can cut off the bot)

### 10.2 Silero VAD (Most Common)

```python
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams

# Silero is a fast, accurate local VAD model
# It runs on your server CPU - no API calls needed
vad = SileroVADAnalyzer(
    params=VADParams(
        start_secs=0.2,      # Seconds of speech before VAD triggers
        stop_secs=0.8,       # Seconds of silence before VAD stops
        min_volume=0.6,      # Minimum volume threshold (0.0-1.0)
    )
)
```

### 10.3 Connecting VAD to Context Aggregator

```python
from pipecat.processors.aggregators.openai_llm_context import (
    OpenAILLMContextAggregator,
    OpenAILLMUserAggregatorParams,
)

# VAD is attached to the user context aggregator
context_aggregator = llm.create_context_aggregator(
    context,
    user_params=OpenAILLMUserAggregatorParams(
        vad_analyzer=SileroVADAnalyzer(),
    ),
)
```

### 10.4 VAD Events in the Pipeline

When VAD detects speech, it emits SystemFrames:

```python
class ConversationCoordinator(FrameProcessor):
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, UserStartedSpeakingFrame):
            logger.info("User started speaking")

        elif isinstance(frame, UserStoppedSpeakingFrame):
            logger.info("User stopped speaking - LLM will now process")

        await self.push_frame(frame, direction)
```

### 10.5 Turn Detection vs. VAD

| Feature | VAD | Turn Detection |
|---------|-----|----------------|
| Detection method | Audio energy/ML model | LLM-based semantic analysis |
| Latency | ~50ms | ~200-500ms |
| Accuracy | High for silence detection | High for conversation turns |
| Use case | Standard voice bots | Complex multi-turn conversations |

---

## 11. Context Management: Conversation Memory

### 11.1 What is LLMContext?

`LLMContext` is the conversation history - every message the user and bot have exchanged. It is what gets sent to the LLM on each turn.

```python
from pipecat.services.openai.llm import OpenAILLMContext

context = OpenAILLMContext(
    messages=[
        {
            "role": "system",
            "content": "You are a helpful assistant named Alex."
        },
        # Optionally pre-populate conversation history:
        # {"role": "user", "content": "What is the weather like?"},
        # {"role": "assistant", "content": "I don't have access to real-time weather data."}
    ],
    tools=[...],  # Function definitions (see Section 12)
)
```

### 11.2 How Messages Accumulate

```
Turn 1:
  Context: [system]
  User says: "What's 2+2?"
  -> context_aggregator.user() adds: [user: "What's 2+2?"]
  -> LLM sees: [system, user]
  -> LLM says: "4"
  -> context_aggregator.assistant() adds: [assistant: "4"]

Turn 2:
  Context: [system, user, assistant]
  User says: "Multiply that by 3"
  -> context_aggregator.user() adds: [user: "Multiply that by 3"]
  -> LLM sees: [system, user, assistant, user]  <- full history
  -> LLM says: "12"
```

### 11.3 Updating System Prompt During Conversation

```python
from pipecat.frames.frames import LLMMessagesUpdateFrame

# Update the system prompt based on discovered info
new_messages = [
    {"role": "system", "content": f"You are helping {customer_name}, a premium member."}
]
await task.queue_frame(LLMMessagesUpdateFrame(messages=new_messages))
```

### 11.4 Context Window Management

For long conversations, the context can grow too large. Handle this:

```python
class ContextTrimmer(FrameProcessor):
    """Keep only the last N turns plus system prompt."""

    MAX_TURNS = 10

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMMessagesFrame):
            messages = frame.messages

            # Keep system message + last MAX_TURNS pairs
            system = [m for m in messages if m["role"] == "system"]
            turns = [m for m in messages if m["role"] != "system"]

            if len(turns) > self.MAX_TURNS * 2:
                turns = turns[-(self.MAX_TURNS * 2):]

            # Create new frame with trimmed context
            trimmed_frame = LLMMessagesFrame(messages=system + turns)
            await self.push_frame(trimmed_frame, direction)
        else:
            await self.push_frame(frame, direction)
```

---

## 12. Function Calling: Giving Your Bot Superpowers

### 12.1 Overview

Function calling lets the LLM trigger external actions mid-conversation:

```
User: "What is the weather in San Francisco?"
                |
LLM: "I need to call get_weather('San Francisco')"
                |
Your handler: fetches weather API
                |
LLM receives: {"temp": "72 degrees F", "conditions": "Sunny"}
                |
LLM says: "It is 72 degrees and sunny in San Francisco!"
```

### 12.2 Defining Functions (Recommended: FunctionSchema)

```python
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema

# Define the function schema (what the LLM sees)
weather_schema = FunctionSchema(
    name="get_current_weather",
    description="Get the current weather in a given location",
    properties={
        "location": {
            "type": "string",
            "description": "The city and state, e.g. 'San Francisco, CA'",
        },
        "unit": {
            "type": "string",
            "enum": ["celsius", "fahrenheit"],
            "description": "Temperature unit to use",
        },
    },
    required=["location"],
)

# Bundle schemas into tools
tools = ToolsSchema(standard_tools=[weather_schema])
```

### 12.3 Implementing Function Handlers

```python
from pipecat.services.llm_service import FunctionCallParams
import aiohttp

async def get_weather_handler(params: FunctionCallParams):
    """Handles get_current_weather function calls."""
    location = params.arguments.get("location")
    unit = params.arguments.get("unit", "fahrenheit")

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://api.weather.com/v1/current",
                params={"location": location, "units": unit}
            ) as response:
                data = await response.json()

        await params.result_callback({
            "temperature": data["temp"],
            "conditions": data["conditions"],
            "humidity": data["humidity"],
        })

    except Exception as e:
        # Always return something - do not leave the LLM hanging
        await params.result_callback({
            "error": f"Could not get weather: {str(e)}"
        })
```

### 12.4 Registering Handlers with the LLM

```python
# Register the handler with the LLM service
llm.register_function(
    "get_current_weather",      # Must match FunctionSchema.name
    get_weather_handler,
    cancel_on_interruption=True,  # Cancel if user interrupts
    timeout_secs=10.0,            # Fail if takes > 10 seconds
)
```

### 12.5 Full Function Calling Example

```python
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.openai.llm import OpenAILLMService, OpenAILLMContext

# 1. Define schemas
book_appointment_schema = FunctionSchema(
    name="book_appointment",
    description="Book an appointment for the customer",
    properties={
        "date": {
            "type": "string",
            "description": "Appointment date in YYYY-MM-DD format",
        },
        "time": {
            "type": "string",
            "description": "Appointment time in HH:MM format (24h)",
        },
        "service_type": {
            "type": "string",
            "enum": ["consultation", "followup", "emergency"],
            "description": "Type of appointment",
        },
    },
    required=["date", "time", "service_type"],
)

check_availability_schema = FunctionSchema(
    name="check_availability",
    description="Check available appointment slots",
    properties={
        "date": {
            "type": "string",
            "description": "Date to check in YYYY-MM-DD format",
        },
    },
    required=["date"],
)

tools = ToolsSchema(standard_tools=[
    book_appointment_schema,
    check_availability_schema,
])

# 2. Create context with tools
context = OpenAILLMContext(
    messages=[{
        "role": "system",
        "content": """You are a medical appointment scheduler.
        Help patients book appointments. Ask for date, time, and reason.
        Always check availability before confirming a booking."""
    }],
    tools=tools,
)

# 3. Initialize LLM
llm = OpenAILLMService(api_key=os.getenv("OPENAI_API_KEY"), model="gpt-4o")

# 4. Register handlers
async def handle_check_availability(params: FunctionCallParams):
    date = params.arguments["date"]
    slots = await appointment_db.get_available_slots(date)
    await params.result_callback({
        "available_slots": slots,
        "date": date,
    })

async def handle_book_appointment(params: FunctionCallParams):
    date = params.arguments["date"]
    time = params.arguments["time"]
    service = params.arguments["service_type"]

    booking_id = await appointment_db.create_booking(date, time, service)
    await params.result_callback({
        "booking_id": booking_id,
        "confirmation": f"Appointment confirmed for {date} at {time}",
    })

llm.register_function("check_availability", handle_check_availability)
llm.register_function("book_appointment", handle_book_appointment)

# 5. Use in pipeline
context_aggregator = llm.create_context_aggregator(context)

pipeline = Pipeline([
    transport.input(),
    stt,
    context_aggregator.user(),
    llm,
    tts,
    transport.output(),
    context_aggregator.assistant(),
])
```

### 12.6 Direct Functions (Shorthand)

```python
# Pipecat can auto-generate schema from function signature + docstring
async def get_current_weather(
    params: FunctionCallParams,
    location: str,
    unit: str = "fahrenheit",
):
    """Get the current weather.

    Args:
        location: The city and state, e.g. 'San Francisco, CA'.
        unit: Temperature unit, either 'celsius' or 'fahrenheit'.
    """
    weather = await fetch_weather(location)
    await params.result_callback({"temperature": weather["temp"], "unit": unit})

# Auto-schema generation
tools = ToolsSchema(standard_tools=[get_current_weather])
```

---

## 13. Building Your First Complete Bot

Let us build a complete working voice bot from scratch.

### 13.1 Project Structure

```
my-voice-bot/
  .env
  pyproject.toml          - uv project file
  bot.py                  - Main bot logic
  server.py               - FastAPI server
```

### 13.2 .env File

```env
DAILY_API_KEY=your_daily_key
DAILY_ROOM_URL=https://yourteam.daily.co/your-room

DEEPGRAM_API_KEY=your_deepgram_key
OPENAI_API_KEY=your_openai_key
CARTESIA_API_KEY=your_cartesia_key
```

### 13.3 pyproject.toml

```toml
[project]
name = "my-voice-bot"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "pipecat-ai[daily,openai,deepgram,cartesia,silero]",
    "fastapi",
    "uvicorn",
    "python-dotenv",
    "aiohttp",
    "loguru",
]
```

Install: `uv sync`

### 13.4 Complete bot.py

```python
"""
Complete voice bot using Daily (WebRTC) + Deepgram + OpenAI + Cartesia.
This is the pattern you will use for 80% of voice bot use cases.
"""

import asyncio
import os
from dotenv import load_dotenv
from loguru import logger

# Pipecat core
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.pipeline.runner import PipelineRunner
from pipecat.frames.frames import EndFrame, TTSSpeakFrame

# Transport
from pipecat.transports.services.daily import DailyTransport, DailyParams

# Services
from pipecat.services.deepgram.stt import DeepgramSTTService
from deepgram import LiveOptions
from pipecat.services.openai.llm import OpenAILLMService, OpenAILLMContext
from pipecat.services.cartesia.tts import CartesiaTTSService

# VAD
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMUserAggregatorParams

load_dotenv()


async def run_bot(room_url: str, token: str):
    """Main bot function. Creates and runs the pipeline."""

    # 1. Transport
    transport = DailyTransport(
        room_url=room_url,
        token=token,
        bot_name="Assistant",
        params=DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    )

    # 2. STT: Speech to Text
    stt = DeepgramSTTService(
        api_key=os.getenv("DEEPGRAM_API_KEY"),
        live_options=LiveOptions(
            model="nova-2",
            language="en-US",
            encoding="linear16",
            sample_rate=16000,
            channels=1,
            interim_results=True,
            punctuate=True,
        ),
    )

    # 3. LLM: Text to Response
    llm = OpenAILLMService(
        api_key=os.getenv("OPENAI_API_KEY"),
        model="gpt-4o",
    )

    context = OpenAILLMContext(
        messages=[{
            "role": "system",
            "content": """You are a friendly voice assistant.
            Keep all responses SHORT (1-2 sentences max) and conversational.
            Never use markdown formatting. Speak naturally."""
        }]
    )

    context_aggregator = llm.create_context_aggregator(
        context,
        user_params=OpenAILLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    # 4. TTS: Response to Speech
    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        voice_id="79a125e8-cd45-4c13-8a67-188112f4dd22",
        model_id="sonic-2024-10-19",
    )

    # 5. Pipeline
    pipeline = Pipeline([
        transport.input(),              # Receive user audio
        stt,                            # Audio to text
        context_aggregator.user(),      # Store user turn
        llm,                            # Generate response
        tts,                            # Response to audio
        transport.output(),             # Send audio to user
        context_aggregator.assistant(), # Store bot turn
    ])

    # 6. Task
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            audio_in_sample_rate=16000,
            audio_out_sample_rate=24000,
        ),
    )

    # 7. Events
    @transport.event_handler("on_first_participant_joined")
    async def on_first_participant_joined(transport, participant):
        logger.info(f"User joined: {participant['id']}")
        await task.queue_frames([
            TTSSpeakFrame("Hello! I am your AI assistant. How can I help you today?")
        ])

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport, participant, reason):
        logger.info(f"User left: {participant['id']}, reason: {reason}")
        await task.queue_frame(EndFrame())  # Clean shutdown

    # 8. Run
    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)
    logger.info("Bot finished.")


if __name__ == "__main__":
    room_url = os.getenv("DAILY_ROOM_URL")
    token = os.getenv("DAILY_TOKEN", "")  # Empty = unauthenticated join

    asyncio.run(run_bot(room_url, token))
```

### 13.5 Running the Bot

```bash
# Simple run
uv run bot.py

# With environment variables
DAILY_ROOM_URL=https://yourteam.daily.co/room uv run bot.py
```

---

## 14. Pipecat Flows: Structured Conversations

### 14.1 What Are Flows?

Pipecat Flows adds a state machine on top of the basic pipeline. Instead of one giant system prompt trying to handle everything, you define **nodes** - each with a specific task.

Think of it like:
- **Without Flows**: One AI trying to do everything at once
- **With Flows**: A series of focused AI agents, each handling one step

TypeScript analogy: Flows are like a `useState` plus routing system for your bot's conversation state.

### 14.2 Installing Flows

```bash
uv add pipecat-flows
```

### 14.3 Flow Concepts

```python
from pipecat_flows import FlowManager
from pipecat_flows.types import FlowResult, NodeConfig

# A NodeConfig defines:
# - What the LLM should do RIGHT NOW (task_messages)
# - What functions (actions) are available
# - How to get to the next node (transition functions return next NodeConfig)
```

### 14.4 Complete Flows Example: Customer Service Bot

```python
"""
Multi-step customer service bot using Pipecat Flows.
Flow: Greeting -> Identify Issue -> Route to Resolution -> Confirm + End
"""

from pipecat_flows import FlowManager
from pipecat_flows.types import FlowResult, NodeConfig

# NODE DEFINITIONS

def create_greeting_node() -> NodeConfig:
    """Initial greeting - ask for customer's name and issue."""
    return NodeConfig(
        task_messages=[{
            "role": "system",
            "content": """Greet the customer warmly and ask:
            1. Their name
            2. Briefly, what they need help with today

            When you have both pieces of information, call collect_info."""
        }],
        functions=[collect_customer_info],
    )

def create_routing_node(customer_name: str, issue_type: str) -> NodeConfig:
    """Route to appropriate resolution based on issue type."""
    return NodeConfig(
        task_messages=[{
            "role": "system",
            "content": f"""You are helping {customer_name} with a {issue_type} issue.

Ask clarifying questions to understand the specific problem, then call resolve_issue
with your proposed solution."""
        }],
        functions=[resolve_issue],
    )

def create_confirmation_node(resolution: str) -> NodeConfig:
    """Confirm resolution and end conversation."""
    return NodeConfig(
        task_messages=[{
            "role": "system",
            "content": f"""The issue has been resolved: {resolution}

Confirm the resolution with the customer. Ask if there is anything else
you can help them with. If not, call end_conversation."""
        }],
        functions=[end_conversation],
        pre_actions=[{
            "type": "tts_say",
            "text": "Great, I have resolved that for you!"
        }],
    )


# TRANSITION FUNCTIONS

async def collect_customer_info(params) -> tuple[FlowResult, NodeConfig]:
    """LLM calls this when it has the customer's name and issue type."""
    name = params.arguments.get("customer_name")
    issue = params.arguments.get("issue_type")

    # Store in flow state for later use
    params.flow_manager.state["customer_name"] = name
    params.flow_manager.state["issue_type"] = issue

    return (
        FlowResult(status="success"),
        create_routing_node(name, issue)  # Move to routing node
    )

async def resolve_issue(params) -> tuple[FlowResult, NodeConfig]:
    """LLM calls this with its proposed resolution."""
    resolution = params.arguments.get("resolution")

    return (
        FlowResult(status="success"),
        create_confirmation_node(resolution)
    )

async def end_conversation(params) -> tuple[FlowResult, None]:
    """End the conversation."""
    return (FlowResult(status="success"), None)  # None = end flow


# BOT SETUP WITH FLOWS

async def run_bot_with_flows(room_url: str, token: str):
    # ... same transport/STT/LLM/TTS setup as before ...

    task = PipelineTask(pipeline, params=PipelineParams(...))

    # Create flow manager
    flow_manager = FlowManager(
        task=task,
        llm=llm,
        context=context,
        initial_node=create_greeting_node(),
    )

    @transport.event_handler("on_first_participant_joined")
    async def on_joined(transport, participant):
        await flow_manager.initialize()  # Start the flow!

    runner = PipelineRunner()
    await runner.run(task)
```

### 14.5 Flow Context Strategies

```python
from pipecat_flows.types import ContextStrategy

# APPEND (default): Keep full conversation history
NodeConfig(
    task_messages=[...],
    context_strategy=ContextStrategy.APPEND,
)

# RESET: Clear history at this node (fresh start)
NodeConfig(
    task_messages=[...],
    context_strategy=ContextStrategy.RESET,
)

# RESET_WITH_SUMMARY: Summarize previous conversation
NodeConfig(
    task_messages=[...],
    context_strategy=ContextStrategy.RESET_WITH_SUMMARY,
    # LLM will summarize what happened before and include in new context
)
```

---

## 15. Custom Frame Processors

### 15.1 Building a Sentiment Analyzer

```python
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.frames.frames import Frame, TranscriptionFrame
from dataclasses import dataclass

@dataclass
class SentimentFrame(DataFrame):
    """Custom frame carrying sentiment analysis results."""
    text: str
    sentiment: str          # "positive", "negative", "neutral"
    confidence: float       # 0.0 - 1.0

class SentimentAnalyzer(FrameProcessor):
    """Analyzes user sentiment from transcriptions.

    Downstream processors can check for SentimentFrame to adapt behavior.
    For example: route angry customers to a human agent.
    """

    NEGATIVE_KEYWORDS = {"angry", "frustrated", "terrible", "awful", "cancel"}
    POSITIVE_KEYWORDS = {"great", "awesome", "love", "perfect", "excellent"}

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            sentiment, confidence = self._analyze(frame.text)

            # Push sentiment frame alongside original transcription
            sentiment_frame = SentimentFrame(
                text=frame.text,
                sentiment=sentiment,
                confidence=confidence,
            )
            await self.push_frame(sentiment_frame, direction)

        # Always push original frame too!
        await self.push_frame(frame, direction)

    def _analyze(self, text: str) -> tuple[str, float]:
        words = set(text.lower().split())

        neg_count = len(words & self.NEGATIVE_KEYWORDS)
        pos_count = len(words & self.POSITIVE_KEYWORDS)

        if neg_count > pos_count:
            return "negative", min(0.5 + neg_count * 0.1, 1.0)
        elif pos_count > neg_count:
            return "positive", min(0.5 + pos_count * 0.1, 1.0)
        return "neutral", 0.5
```

### 15.2 Building a Latency Monitor

```python
import time
from statistics import mean

class LatencyMonitor(FrameProcessor):
    """Tracks end-to-end latency from user speech to bot audio."""

    def __init__(self):
        super().__init__()
        self._speech_start: float | None = None
        self._latencies: list[float] = []

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, UserStoppedSpeakingFrame):
            self._speech_start = time.time()

        elif isinstance(frame, TTSAudioRawFrame) and self._speech_start:
            latency_ms = (time.time() - self._speech_start) * 1000
            self._latencies.append(latency_ms)
            self._speech_start = None

            logger.info(
                f"Latency: {latency_ms:.0f}ms | Avg: {mean(self._latencies):.0f}ms"
            )

        await self.push_frame(frame, direction)
```

---

## 16. Observers and Metrics

### 16.1 What Are Observers?

Observers are a cleaner way to monitor pipeline activity without modifying the pipeline itself. They are like middleware that does not participate in the data flow.

TypeScript analogy: Observers are like React DevTools - they watch what is happening without changing it.

### 16.2 Creating a Custom Observer

```python
from pipecat.observers.base_observer import BaseObserver, FramePushed, FrameProcessed
from pipecat.frames.frames import (
    InterruptionFrame, BotStartedSpeakingFrame, BotStoppedSpeakingFrame
)
from loguru import logger

class ConversationFlowObserver(BaseObserver):
    """Monitors conversation flow events."""

    async def on_push_frame(self, data: FramePushed):
        """Called every time a frame is pushed between processors."""
        frame = data.frame

        if isinstance(frame, InterruptionFrame):
            logger.warning("INTERRUPTION - user cut off the bot")

        elif isinstance(frame, BotStartedSpeakingFrame):
            logger.info("Bot started speaking")

        elif isinstance(frame, BotStoppedSpeakingFrame):
            logger.info("Bot stopped speaking")

    async def on_pipeline_started(self):
        """Called when pipeline initializes."""
        logger.info("Pipeline started")
```

### 16.3 Attaching Observers

```python
from pipecat.observers.loguru_observer import LoguruObserver

task = PipelineTask(
    pipeline,
    params=PipelineParams(enable_metrics=True),
    observers=[
        LoguruObserver(),              # Built-in: logs all frames
        ConversationFlowObserver(),    # Your custom observer
    ],
)
```

### 16.4 Built-In Observers

```python
from pipecat.observers.loguru_observer import LoguruObserver
# Logs frame flow - useful during development

from pipecat.observers.turn_tracking_observer import TurnTrackingObserver
# Tracks conversation turns

from pipecat.observers.user_bot_latency_observer import UserBotLatencyObserver
# Measures user to bot response latency

from pipecat.observers.startup_timing_observer import StartupTimingObserver
# Measures processor startup times
```

---

## 17. Telephony Integration (Twilio / Telnyx)

### 17.1 How Phone Calls Work in Pipecat

```
User calls your phone number
         |
Twilio/Telnyx connects via WebSocket to your server
         |
Your FastAPI server accepts the WebSocket
         |
FastAPIWebsocketTransport handles the connection
         |
TwilioFrameSerializer converts Twilio's audio format to Pipecat frames
         |
Normal Pipecat pipeline processes the call
```

### 17.2 Twilio Integration

In Twilio console, set your phone number's "A Call Comes In" webhook to your WebSocket URL.

```python
"""
Complete Twilio voice bot server.
"""

import asyncio
import os
import json
from fastapi import FastAPI, WebSocket, Request, Response
from dotenv import load_dotenv
from loguru import logger

from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.pipeline.runner import PipelineRunner
from pipecat.transports.network.fastapi_websocket import (
    FastAPIWebsocketTransport,
    FastAPIWebsocketParams,
)
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService, OpenAILLMContext
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.frames.frames import TTSSpeakFrame

load_dotenv()
app = FastAPI()


@app.post("/incoming-call")
async def incoming_call(request: Request) -> Response:
    """
    Twilio calls this HTTP endpoint when someone calls your number.
    We return TwiML telling Twilio to connect via WebSocket.
    """
    host = request.url.hostname

    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="wss://{host}/ws" />
    </Connect>
</Response>"""

    return Response(content=twiml, media_type="application/xml")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Twilio connects here via WebSocket and streams audio.
    """
    await websocket.accept()

    start_data = await websocket.receive_text()
    data = json.loads(start_data)

    if data.get("event") != "start":
        logger.error(f"Expected 'start' event, got: {data.get('event')}")
        return

    stream_sid = data["start"]["streamSid"]
    call_sid = data["start"]["callSid"]

    logger.info(f"New call: stream={stream_sid}, call={call_sid}")

    try:
        await run_twilio_bot(websocket, stream_sid, call_sid)
    except Exception as e:
        logger.error(f"Error in bot: {e}")
    finally:
        logger.info(f"Call ended: {call_sid}")


async def run_twilio_bot(websocket: WebSocket, stream_sid: str, call_sid: str):
    """Run the Pipecat pipeline for a Twilio call."""

    # Twilio sends 8kHz mu-law audio - the serializer handles format conversion
    serializer = TwilioFrameSerializer(
        stream_sid=stream_sid,
        call_sid=call_sid,
        account_sid=os.getenv("TWILIO_ACCOUNT_SID"),
        auth_token=os.getenv("TWILIO_AUTH_TOKEN"),
    )

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,    # Twilio does not want WAV headers
            serializer=serializer,
        ),
    )

    # STT - Deepgram handles 8kHz mu-law audio
    stt = DeepgramSTTService(
        api_key=os.getenv("DEEPGRAM_API_KEY"),
        live_options=LiveOptions(
            model="nova-2",
            language="en-US",
            encoding="mulaw",        # Twilio's audio encoding
            sample_rate=8000,        # Twilio's sample rate
            channels=1,
        ),
    )

    llm = OpenAILLMService(
        api_key=os.getenv("OPENAI_API_KEY"),
        model="gpt-4o",
    )

    context = OpenAILLMContext(messages=[{
        "role": "system",
        "content": """You are a phone customer service agent.
        Keep responses very brief (1-2 sentences).
        Do not use markdown or special characters. Speak naturally."""
    }])

    context_aggregator = llm.create_context_aggregator(context)

    # Cartesia: output at 8kHz for Twilio compatibility
    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        voice_id="79a125e8-cd45-4c13-8a67-188112f4dd22",
        model_id="sonic-2024-10-19",
        sample_rate=8000,            # Match Twilio's 8kHz
    )

    pipeline = Pipeline([
        transport.input(),
        stt,
        context_aggregator.user(),
        llm,
        tts,
        transport.output(),
        context_aggregator.assistant(),
    ])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=8000,
            audio_out_sample_rate=8000,
        ),
    )

    @transport.event_handler("on_client_connected")
    async def on_connected(transport, client):
        await task.queue_frames([
            TTSSpeakFrame("Hello, thank you for calling. How can I help you today?")
        ])

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
```

### 17.3 Telnyx Integration

```python
from pipecat.serializers.telnyx import TelnyxFrameSerializer

serializer = TelnyxFrameSerializer(
    stream_id=stream_id,
)

transport = FastAPIWebsocketTransport(
    websocket=websocket,
    params=FastAPIWebsocketParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
        add_wav_header=False,
        serializer=serializer,
    ),
)
```

### 17.4 Telephone Audio Format Reference

| Provider | Sample Rate | Encoding | Format |
|----------|-------------|----------|--------|
| Twilio | 8,000 Hz | mulaw | 8-bit |
| Telnyx | 8,000 Hz | mulaw | 8-bit |
| Plivo | 8,000 Hz | mulaw | 8-bit |
| LiveKit SIP | 16,000 Hz | PCM Linear16 | 16-bit |

---

## 18. FastAPI Server Patterns

### 18.1 The Bot Runner Pattern

For production deployments, you separate the **server** (handles HTTP/WebSocket) from the **bot** (handles the conversation):

```python
"""
bot_runner.py - Production FastAPI server
Handles room creation, bot spawning, and lifecycle management.
"""

import asyncio
import os
from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from loguru import logger

app = FastAPI(title="Voice Bot Runner")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BotStartRequest(BaseModel):
    customer_id: str | None = None
    language: str = "en"


@app.post("/api/start")
async def start_bot(
    request: BotStartRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    """
    Client calls this to start a bot session.
    Returns room URL + token for the client to connect.
    """
    room_url, bot_token, user_token = await create_daily_room()

    background_tasks.add_task(
        spawn_bot,
        room_url=room_url,
        token=bot_token,
        customer_id=request.customer_id,
        language=request.language,
    )

    logger.info(f"Started bot for room: {room_url}")

    return {
        "room_url": room_url,
        "token": user_token,
    }


async def spawn_bot(room_url: str, token: str, **kwargs):
    """Spawn bot as a subprocess."""
    env = os.environ.copy()
    env["BOT_ROOM_URL"] = room_url
    env["BOT_TOKEN"] = token

    for k, v in kwargs.items():
        if v is not None:
            env[f"BOT_{k.upper()}"] = str(v)

    process = await asyncio.create_subprocess_exec(
        "uv", "run", "bot.py",
        env=env,
        cwd=os.path.dirname(os.path.abspath(__file__)),
    )

    logger.info(f"Bot process {process.pid} started for {room_url}")

    return_code = await process.wait()
    logger.info(f"Bot process {process.pid} exited with code {return_code}")


async def create_daily_room() -> tuple[str, str, str]:
    """Create a Daily.co room and return (room_url, bot_token, user_token)."""
    import aiohttp

    async with aiohttp.ClientSession() as session:
        async with session.post(
            "https://api.daily.co/v1/rooms",
            headers={"Authorization": f"Bearer {os.getenv('DAILY_API_KEY')}"},
            json={"properties": {"max_participants": 2}},
        ) as resp:
            room = await resp.json()
            room_url = room["url"]

        async with session.post(
            "https://api.daily.co/v1/meeting-tokens",
            headers={"Authorization": f"Bearer {os.getenv('DAILY_API_KEY')}"},
            json={"properties": {"room_name": room["name"], "is_owner": True}},
        ) as resp:
            bot_token_data = await resp.json()

        async with session.post(
            "https://api.daily.co/v1/meeting-tokens",
            headers={"Authorization": f"Bearer {os.getenv('DAILY_API_KEY')}"},
            json={"properties": {"room_name": room["name"], "is_owner": False}},
        ) as resp:
            user_token_data = await resp.json()

        return room_url, bot_token_data["token"], user_token_data["token"]
```

### 18.2 WebSocket Server for Telephony

```python
from fastapi import FastAPI, WebSocket
import asyncio

app = FastAPI()

@app.websocket("/telephony/ws")
async def telephony_websocket(websocket: WebSocket):
    await websocket.accept()

    try:
        first_msg = await asyncio.wait_for(
            websocket.receive_text(),
            timeout=5.0
        )
    except asyncio.TimeoutError:
        await websocket.close()
        return

    import json
    data = json.loads(first_msg)

    # Route to appropriate handler based on provider
    if "streamSid" in str(data):  # Twilio
        await handle_twilio_call(websocket, data)
    elif "callId" in str(data):   # Telnyx
        await handle_telnyx_call(websocket, data)
    else:
        logger.warning(f"Unknown telephony provider: {data}")
        await websocket.close()
```

---

## 19. Production Deployment

### 19.1 Dockerfile

```dockerfile
FROM python:3.12-slim

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Copy dependency files first (for Docker layer caching)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Pre-download Silero VAD model (avoids runtime download)
RUN uv run python -c "from pipecat.audio.vad.silero import SileroVADAnalyzer; SileroVADAnalyzer()"

COPY . .

EXPOSE 8080

CMD ["uv", "run", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
```

### 19.2 Docker Compose for Local Development

```yaml
version: "3.9"

services:
  voice-bot:
    build: .
    ports:
      - "8080:8080"
    env_file:
      - .env
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

### 19.3 Scaling Architecture

For production, each phone call or voice session runs as a **separate bot process**:

```
Load Balancer (nginx/ALB)
         |
Bot Runner Service (FastAPI)
  Handles /start endpoints
  Creates Daily rooms
  Spawns bot subprocesses
         |
Bot Process Pool
  Bot 1 (Call A) - dedicated process
  Bot 2 (Call B) - dedicated process
  Bot 3 (Call C) - dedicated process
```

Why separate processes?
- Python's GIL means threads do not truly run in parallel
- Separate processes give true parallelism for CPU-bound audio processing
- Process isolation means one bot crashing does not affect others

### 19.4 Pipecat Cloud Deployment

```bash
# Install CLI
uv tool install pipecat-ai-cli

# Login
pipecat cloud auth login

# Set secrets
pipecat cloud secrets set my-bot-secrets --file .env

# Deploy (uses Dockerfile automatically)
pipecat cloud deploy
```

### 19.5 Fly.io Deployment

```toml
# fly.toml
app = "my-voice-bot"
primary_region = "iad"

[build]

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[env]
  PORT = "8080"
```

```bash
fly launch
fly secrets set DEEPGRAM_API_KEY=your_key OPENAI_API_KEY=your_key
fly deploy
```

### 19.6 Environment Variables Best Practices

```python
# config.py - Centralized config with validation
import os
from dataclasses import dataclass

@dataclass
class Config:
    deepgram_api_key: str
    openai_api_key: str
    cartesia_api_key: str
    daily_api_key: str

    log_level: str = "INFO"
    max_session_duration_secs: int = 3600

    @classmethod
    def from_env(cls) -> "Config":
        required = [
            "DEEPGRAM_API_KEY",
            "OPENAI_API_KEY",
            "CARTESIA_API_KEY",
            "DAILY_API_KEY",
        ]
        missing = [k for k in required if not os.getenv(k)]
        if missing:
            raise RuntimeError(f"Missing required env vars: {missing}")

        return cls(
            deepgram_api_key=os.getenv("DEEPGRAM_API_KEY"),
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            cartesia_api_key=os.getenv("CARTESIA_API_KEY"),
            daily_api_key=os.getenv("DAILY_API_KEY"),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            max_session_duration_secs=int(os.getenv("MAX_SESSION_SECS", "3600")),
        )

config = Config.from_env()
```

### 19.7 Health Checks

```python
from fastapi import FastAPI
from datetime import datetime

app = FastAPI()
startup_time = datetime.now()

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "uptime_seconds": (datetime.now() - startup_time).seconds,
        "version": "1.0.0",
    }

@app.get("/ready")
async def ready():
    try:
        return {"status": "ready"}
    except Exception as e:
        return {"status": "not ready", "reason": str(e)}, 503
```

---

## 20. Debugging and Observability

### 20.1 Logging with Loguru

Pipecat uses `loguru` for structured logging. It is like Winston/Pino for Python:

```python
from loguru import logger
import sys

# Configure logger
logger.remove()  # Remove default handler

# Console output
logger.add(
    sys.stdout,
    level="DEBUG",
    format="<green>{time:HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> | <level>{message}</level>",
)

# File output with rotation
logger.add(
    "logs/bot_{time}.log",
    rotation="100 MB",
    retention="7 days",
    level="INFO",
    compression="gz",
)
```

### 20.2 Frame Debugging

```python
class FrameDebugger(FrameProcessor):
    """Log every frame type passing through a pipeline point.

    Insert this anywhere in your pipeline to see what is flowing:
    Pipeline([
        transport.input(),
        FrameDebugger("after input"),    # Add here to debug
        stt,
        FrameDebugger("after stt"),      # And here
        context_aggregator.user(),
        ...
    ])
    """

    def __init__(self, label: str = ""):
        super().__init__()
        self._label = label

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        dir_str = "DOWN" if direction == FrameDirection.DOWNSTREAM else "UP"
        logger.debug(f"[{self._label}] {dir_str} {type(frame).__name__}")

        if hasattr(frame, "text") and frame.text:
            logger.debug(f"  text: {frame.text[:100]}")

        await self.push_frame(frame, direction)
```

### 20.3 Using Whisker (Pipecat's Official Debugger)

```bash
# In one terminal: run your bot
uv run bot.py

# In another terminal: open Whisker debugger
npx @pipecat-ai/whisker
```

Whisker provides a visual real-time view of frames flowing through your pipeline.

### 20.4 Common Errors and Fixes

```
Error: "Pipeline is blocked - frames not flowing"
Fix: You forgot `await self.push_frame(frame, direction)` in a processor

Error: "TranscriptionFrame never arrives at LLM"
Fix: STT is not after transport.input() - check pipeline order

Error: "Bot speaks even after user interrupts"
Fix: Set allow_interruptions=True in PipelineParams

Error: "VAD not working - bot does not respond to speech"
Fix: VAD analyzer must be attached to LLMContextAggregator

Error: "Audio sounds wrong or garbled"
Fix: Check sample rates - audio_in_sample_rate/audio_out_sample_rate must match
     your STT and TTS services

Error: "Bot responds to its own words (echo)"
Fix: Use WebRTC transport (Daily/LiveKit) - it has built-in echo cancellation
     OR implement software echo cancellation for WebSocket transports

Error: "Bot keeps generating even after EndFrame"
Fix: context_aggregator.assistant() must be AFTER transport.output()
     to ensure it processes the EndFrame in correct order
```

---

## 21. Common Patterns and Recipes

### 21.1 Bot With Session Recording

```python
class SessionRecorder(FrameProcessor):
    """Records both user and bot audio to separate files."""

    def __init__(self, session_id: str):
        super().__init__()
        self._session_id = session_id
        self._user_audio = bytearray()
        self._bot_audio = bytearray()

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, InputAudioRawFrame):
            self._user_audio.extend(frame.audio)

        elif isinstance(frame, TTSAudioRawFrame):
            self._bot_audio.extend(frame.audio)

        elif isinstance(frame, EndFrame):
            await self._save_recordings()

        await self.push_frame(frame, direction)

    async def _save_recordings(self):
        import wave

        for audio_data, filename in [
            (self._user_audio, f"recordings/{self._session_id}_user.wav"),
            (self._bot_audio, f"recordings/{self._session_id}_bot.wav"),
        ]:
            with wave.open(filename, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)   # 16-bit
                wav_file.setframerate(16000)
                wav_file.writeframes(bytes(audio_data))

        logger.info(f"Saved recordings for session {self._session_id}")
```

### 21.2 Bot With User Authentication

```python
class PersonalizedBot:
    """Bot that loads user data before starting."""

    def __init__(self, user_id: str, db):
        self._user_id = user_id
        self._db = db
        self._user_data = None

    async def initialize(self):
        """Load user data before bot starts."""
        self._user_data = await self._db.get_user(self._user_id)

    def create_system_prompt(self) -> str:
        if not self._user_data:
            return "You are a helpful assistant. Ask the user to verify their identity."

        return f"""You are a personalized assistant for {self._user_data['name']}.

Their account type: {self._user_data['tier']}
Their preferences: {self._user_data['preferences']}

Address them by name. Be personalized and helpful."""
```

### 21.3 Multi-Language Bot

```python
from pipecat.pipeline.parallel_pipeline import ParallelPipeline
from pipecat.processors.filters.function_filter import FunctionFilter

# Language-specific TTS voices
english_tts = CartesiaTTSService(api_key=key, voice_id=ENGLISH_VOICE)
spanish_tts = CartesiaTTSService(api_key=key, voice_id=SPANISH_VOICE)

# Use multilingual STT
stt = DeepgramSTTService(
    api_key=key,
    live_options=LiveOptions(model="nova-2", language="multi"),
)

async def is_english(frame): return getattr(frame, "language", "en").startswith("en")
async def is_spanish(frame): return getattr(frame, "language", "es").startswith("es")

pipeline = Pipeline([
    transport.input(),
    stt,
    context_aggregator.user(),
    llm,
    ParallelPipeline([
        [FunctionFilter(is_english), english_tts],
        [FunctionFilter(is_spanish), spanish_tts],
    ]),
    transport.output(),
    context_aggregator.assistant(),
])
```

### 21.4 Bot with Timeout

```python
async def run_bot_with_timeout(room_url: str, token: str, max_duration_secs: int = 1800):
    """Run bot with a maximum session duration."""

    # ... setup pipeline ...

    task = PipelineTask(pipeline, params=PipelineParams(...))

    async def session_timeout():
        await asyncio.sleep(max_duration_secs)
        logger.info(f"Session timeout after {max_duration_secs}s")
        await task.queue_frames([
            TTSSpeakFrame("I am sorry, but our session time is up. Thank you for calling!"),
            EndFrame(),
        ])

    timeout_task = asyncio.create_task(session_timeout())

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)

    timeout_task.cancel()  # Cancel timeout if bot ended naturally
```

### 21.5 Speech-to-Speech (OpenAI Realtime API)

For the absolute lowest latency, use OpenAI's Realtime API which bypasses the STT-LLM-TTS chain:

```python
from pipecat.services.openai_realtime_beta.openai import OpenAIRealtimeService

# Single service handles everything: voice in -> voice out
realtime = OpenAIRealtimeService(
    api_key=os.getenv("OPENAI_API_KEY"),
    instructions="You are a helpful assistant.",
    voice="alloy",
)

# Much simpler pipeline!
pipeline = Pipeline([
    transport.input(),
    realtime,              # Handles STT + LLM + TTS internally
    transport.output(),
])
```

This gives approximately 200ms latency vs 500-800ms for the traditional pipeline.

---

## 22. TypeScript vs Python Cheat Sheet

### 22.1 Language Fundamentals

| TypeScript | Python | Notes |
|------------|--------|-------|
| `const x = 5` | `x = 5` | Python has no const |
| `let x: number = 5` | `x: int = 5` | Type hints are optional |
| `` `Hello ${name}` `` | `f"Hello {name}"` | f-strings = template literals |
| `array.push(item)` | `list.append(item)` | |
| `array.length` | `len(list)` | Function, not property |
| `{...obj, key: val}` | `{**obj, "key": val}` | Dict spread |
| `obj?.nested?.value` | `obj.get("nested", {}).get("value")` | No optional chaining |
| `obj ?? default` | `obj or default` | Nullish coalescing |
| `typeof x === "string"` | `isinstance(x, str)` | |
| `Array.isArray(x)` | `isinstance(x, list)` | |
| `Object.keys(obj)` | `obj.keys()` | |
| `Object.entries(obj)` | `obj.items()` | |
| `arr.filter(x => x > 0)` | `[x for x in arr if x > 0]` | List comprehension |
| `arr.map(x => x * 2)` | `[x * 2 for x in arr]` | |
| `arr.find(x => x.id === id)` | `next((x for x in arr if x.id == id), None)` | |

### 22.2 Async Patterns

| TypeScript | Python |
|------------|--------|
| `async function foo() {}` | `async def foo():` |
| `await somePromise` | `await some_coroutine()` |
| `Promise.all([p1, p2])` | `await asyncio.gather(c1, c2)` |
| `setTimeout(fn, 1000)` | `asyncio.create_task(delayed(fn, 1.0))` |
| `setInterval(fn, 1000)` | Loop with `await asyncio.sleep(1.0)` |
| Node.js entry: auto-run | Python: `asyncio.run(main())` |

### 22.3 Classes and Patterns

| TypeScript | Python |
|------------|--------|
| `class Foo extends Bar {}` | `class Foo(Bar):` |
| `super()` | `super().__init__()` |
| `private field` | `self._field` (convention) |
| `readonly field` | `@property` with no setter |
| `interface Foo {}` | `@dataclass class Foo:` or `TypedDict` |
| `type Foo = Bar \| Baz` | `Foo = Union[Bar, Baz]` or `Bar \| Baz` (3.10+) |
| `Partial<T>` | `Optional[T]` for each field |
| `Record<K, V>` | `dict[K, V]` |

### 22.4 Package Management

| npm/pnpm | uv |
|----------|-----|
| `npm init` | `uv init` |
| `package.json` | `pyproject.toml` |
| `node_modules/` | `.venv/` |
| `npm install` | `uv sync` |
| `npm add express` | `uv add fastapi` |
| `npm run dev` | `uv run python bot.py` |
| `npx command` | `uv run command` or `uvx command` |
| `package-lock.json` | `uv.lock` |

### 22.5 Pipecat-Specific Patterns

```
TypeScript/Node.js Concept    ->    Pipecat Equivalent
Transform Stream               ->   FrameProcessor
stream.pipe()                  ->   Pipeline([...])
EventEmitter                   ->   Transport event handlers
chunk (Buffer/string)          ->   Frame (typed dataclass)
this.push(data)               ->   await self.push_frame(frame, direction)
stream.destroy()               ->   EndFrame / CancelFrame
Node.js Worker Threads         ->   Separate Python processes
Express middleware             ->   FrameProcessor in pipeline
RxJS operators                 ->   Pipeline processors + ParallelPipeline
WebSocket (ws package)         ->   FastAPIWebsocketTransport
```

### 22.6 Python Gotchas for JS Devs

```python
# 1. Truthiness is different
if []:    # False in Python (empty list)
if {}:    # False in Python (empty dict)
if "":    # False in Python (empty string)

# 2. Integer division
10 / 3   # 3.333... (float, same as JS)
10 // 3  # 3 (integer division, no equivalent in JS)

# 3. None comparison - use "is" not "=="
if x is None:
if x is not None:

# 4. Exception handling
try:
    risky_operation()
except ValueError as e:    # Specific exception (like catch (e instanceof ValueError))
    handle_error(e)
except Exception as e:     # Catch-all (like catch (e) in JS)
    logger.error(f"Error: {e}")
finally:
    cleanup()              # Always runs

# 5. Dictionary access
d = {"key": "value"}
d["key"]           # Throws KeyError if missing (unlike JS -> undefined)
d.get("key")       # Returns None if missing (safer)
d.get("key", "default")  # Returns default if missing

# 6. f-string formatting
name = "Alice"
f"Hello {name}"              # like `Hello ${name}`
f"Price: ${price:.2f}"       # .2f = 2 decimal places
f"Count: {count:,}"         # comma-separated number

# 7. List/dict comprehensions (no equivalent in JS without methods)
squares = [x**2 for x in range(10)]           # [0, 1, 4, 9, 16, ...]
evens = [x for x in range(10) if x % 2 == 0]  # [0, 2, 4, 6, 8]
word_lengths = {w: len(w) for w in words}      # {"hello": 5, "world": 5}
```

---

## Appendix A: Complete Service Reference

### STT Services

```python
# Deepgram (WebSocket streaming, best latency)
from pipecat.services.deepgram.stt import DeepgramSTTService

# OpenAI Whisper (HTTP, best accuracy)
from pipecat.services.openai.stt import OpenAISTTService

# Google Cloud STT
from pipecat.services.google.stt import GoogleSTTService

# Azure Speech
from pipecat.services.azure.stt import AzureSTTService

# AssemblyAI
from pipecat.services.assemblyai.stt import AssemblyAISTTService

# Gladia (multilingual)
from pipecat.services.gladia.stt import GladiaSTTService
```

### LLM Services

```python
# OpenAI
from pipecat.services.openai.llm import OpenAILLMService

# Anthropic Claude
from pipecat.services.anthropic.llm import AnthropicLLMService

# Google Gemini
from pipecat.services.google.llm import GoogleLLMService

# AWS Bedrock
from pipecat.services.aws.llm import AWSBedrockLLMService

# OpenAI Realtime (speech-to-speech)
from pipecat.services.openai_realtime_beta.openai import OpenAIRealtimeService

# Gemini Live (speech-to-speech)
from pipecat.services.google.live import GeminiLiveService
```

### TTS Services

```python
# Cartesia (WebSocket, ultra-low latency)
from pipecat.services.cartesia.tts import CartesiaTTSService

# ElevenLabs (WebSocket, natural voices)
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

# OpenAI TTS (HTTP, good quality)
from pipecat.services.openai.tts import OpenAITTSService

# Azure Speech (WebSocket, enterprise)
from pipecat.services.azure.tts import AzureTTSService

# Google Cloud TTS
from pipecat.services.google.tts import GoogleTTSService

# Rime (WebSocket, low latency)
from pipecat.services.rime.tts import RimeTTSService
```

---

## Appendix B: Latency Budget for Voice Bots

A good voice bot should have under 800ms total latency. Here is how to budget it:

```
User stops speaking
       |
VAD detects end of speech:             50-150ms
       |
STT processes and returns text:        100-300ms (Deepgram streaming)
       |
LLM generates first token:            200-400ms (GPT-4o)
       |
TTS generates first audio chunk:      100-200ms (Cartesia/ElevenLabs WS)
       |
User hears first word:                50-100ms (network)
------------------------------------------------------
TOTAL:                                 500-1150ms

Target: under 800ms for natural conversation feel
```

**Optimization techniques:**
1. Use WebSocket-based TTS (Cartesia, ElevenLabs) - saves 300-500ms over HTTP
2. Enable Silero VAD - saves 150-200ms vs cloud VAD
3. Use Deepgram streaming STT with interim results
4. Use a fast LLM (GPT-4o-mini, Claude Haiku) for simple use cases
5. Keep system prompts short - less tokens = faster TTFB
6. Use speech-to-speech APIs (OpenAI Realtime) for absolute minimum latency

---

## Appendix C: Architecture Decision Checklist

Before building, answer these questions:

```
1. Client type?
   [ ] Browser/web app -> Daily or LiveKit (WebRTC)
   [ ] Phone call -> FastAPIWebsocket + Twilio/Telnyx serializer
   [ ] Mobile app -> Daily or LiveKit SDKs
   [ ] Another server -> WebSocket

2. STT provider?
   [ ] Best latency -> Deepgram streaming
   [ ] Best accuracy -> OpenAI Whisper
   [ ] Best multilingual -> Gladia or Deepgram "multi"
   [ ] Enterprise/compliance -> Azure Speech or Google STT

3. LLM?
   [ ] Best quality -> GPT-4o or Claude 3.5 Sonnet
   [ ] Lowest latency -> GPT-4o-mini or Claude Haiku
   [ ] Local/private -> Ollama via OpenAI-compatible endpoint
   [ ] Speech-to-speech -> OpenAI Realtime API

4. TTS?
   [ ] Lowest latency -> Cartesia (WebSocket)
   [ ] Most natural -> ElevenLabs (WebSocket)
   [ ] Cost-effective -> OpenAI TTS
   [ ] Custom voices -> ElevenLabs with voice cloning

5. Conversation structure?
   [ ] Simple Q&A -> Basic pipeline without Flows
   [ ] Multi-step process -> Pipecat Flows
   [ ] Complex branching -> Pipecat Flows + custom functions

6. Deployment?
   [ ] Prototype -> uv run bot.py locally
   [ ] Managed -> Pipecat Cloud
   [ ] Self-hosted -> Docker + Fly.io or AWS or GCP
   [ ] Phone calls -> Self-hosted + Twilio/Telnyx webhooks
```

---

*Last updated based on Pipecat docs as of 2026. For the latest, check docs.pipecat.ai and the Pipecat GitHub repo.*
