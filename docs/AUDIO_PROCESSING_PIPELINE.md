# Background Processing Pipeline — BullMQ + Redis

> Audio processing, email campaigns, cron jobs, and any future background work.

---

## Why BullMQ + Redis

Redis + BullMQ is a **universal background processing layer** that serves multiple purposes:

| Use Case | How BullMQ Handles It |
|----------|----------------------|
| **Audio post-processing** | Durable job: transcribe → slice → upload → save |
| **Email campaigns** | Scheduled jobs with rate limiting (e.g., 100 emails/min) |
| **Cron jobs** | Repeatable jobs (`every: '0 9 * * *'` = daily at 9 AM) |
| **Webhooks retry** | Failed outbound webhooks → retry with backoff |
| **Report generation** | Long-running jobs with progress tracking |
| **Rate limiting** | Redis used by `express-rate-limit` across multiple ECS tasks |

One service, one dependency, many uses.

---

## Architecture

### Local Dev

```
docker-compose.dev.yml:
  ├── postgres   (existing)
  ├── redis      (NEW — 6MB Alpine image)
  └── api        (existing, runs BullMQ worker in-process)
```

One extra line in docker-compose. Worker runs inside the API process locally — no separate service needed.

### Production

```
ECS Cluster
├── telephony-api (existing)
│   └── Publishes jobs to Redis queue
│       queue.add('process-audio', { captureId, audioUrl, caller })
│       queue.add('send-email', { to, subject, body }, { delay: 3600000 })
│       queue.add('daily-report', {}, { repeat: { pattern: '0 9 * * *' } })
│
├── background-worker (NEW ECS service)
│   ├── BullMQ worker — polls Redis for jobs
│   ├── Has ffmpeg installed (for audio slicing)
│   ├── Processes: audio, email, cron, anything
│   ├── 1-3 tasks, auto-scales on queue depth
│   └── No ALB (no inbound HTTP traffic)
│
└── ElastiCache Redis (NEW — t4g.micro, $13/mo)
    ├── BullMQ job storage (durable with AOF)
    ├── Rate limiting store (shared across API tasks)
    └── Future: caching, pub/sub
```

---

## Audio Processing Pipeline

### Current Flow (Broken)

```
webhook → transcribeRecording() inline → fire-and-forget → lost on crash
```

### New Flow (Durable)

```
webhook (egress_ended)
    │
    │ queue.add('process-audio', {
    │   captureId: row.id,
    │   audioUrl: publicUrl,
    │   caller: 'a'
    │ })
    │
    │ Returns in ~5ms — webhook handler is done
    │
    ▼ (Redis holds the job durably)

Background worker picks up job:
    │
    ├── Step 1: Deepgram transcription
    │   POST audioUrl to Deepgram → get utterances[]
    │   Retry: 3 attempts, exponential backoff
    │
    ├── Step 2: Download full recording to /tmp
    │   fetch(audioUrl) → write to disk
    │
    ├── Step 3: Parallel slice to MP3 (batches of 10)
    │   ffmpeg -c:a libmp3lame -q:a 5 -ar 16000 -ac 1
    │   50 utterances: ~3s (parallel) vs ~25s (sequential)
    │
    ├── Step 4: Parallel upload to S3 (batches of 10)
    │   PUT to S3 bucket via VPC endpoint (free)
    │
    └── Step 5: Save utterances to DB
        UPDATE captures_v2 SET transcriptA = [...]

On failure → retry 3× with exponential backoff
On permanent failure → dead letter queue
On worker crash → lock expires → another worker picks it up
```

---

## Code Design

### Worker Package Structure

```
apps/workers/
├── package.json
├── tsconfig.json
├── Dockerfile              # node:22-alpine + ffmpeg
└── src/
    ├── worker.ts           # BullMQ Worker setup
    ├── queues.ts           # Queue definitions (shared with API)
    ├── processors/
    │   ├── audio.ts        # Audio processing pipeline
    │   ├── email.ts        # Email sending (future)
    │   └── cron.ts         # Scheduled tasks (future)
    └── lib/
        ├── deepgram.ts     # Deepgram API client
        ├── ffmpeg.ts       # ffmpeg slicing helpers
        └── s3.ts           # S3 upload helpers
```

### Queue Definitions (Shared Between API + Worker)

```typescript
// packages/queues/src/index.ts (new shared package)
// or apps/workers/src/queues.ts

import { Queue } from 'bullmq';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// Audio processing queue
export const audioQueue = new Queue('audio-processing', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000 },   // Keep last 1000 completed for debugging
    removeOnFail: { count: 5000 },       // Keep last 5000 failed for investigation
  },
});

// Email queue (future)
export const emailQueue = new Queue('email', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
  },
});

// Cron/scheduled jobs queue (future)
export const cronQueue = new Queue('cron', {
  connection,
});
```

### API Side — Publish Jobs

```typescript
// In apps/api/src/routes/webhooks.ts
// Replace the fire-and-forget transcribeRecording() calls:

import { audioQueue } from '@repo/queues';

// OLD (no durability):
// transcribeRecording(row.id, publicUrl!, "a")
//   .catch((e) => logger.error("[TRANSCRIBE] failed:", e.message));

// NEW (durable):
await audioQueue.add('process-audio', {
  captureId: row.id,
  audioUrl: publicUrl,
  caller: 'a',
});
// Returns instantly. Job is in Redis. Worker processes it.
```

### Worker Side — Process Jobs

```typescript
// apps/workers/src/worker.ts
import { Worker } from 'bullmq';
import { processAudio } from './processors/audio';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const audioWorker = new Worker('audio-processing', processAudio, {
  connection,
  concurrency: 5,        // Process 5 jobs at once per worker instance
  limiter: {
    max: 10,             // Max 10 jobs per minute (Deepgram rate limit)
    duration: 60_000,
  },
});

audioWorker.on('completed', (job) => {
  console.log(`[WORKER] Completed: ${job.id} (${job.name})`);
});

audioWorker.on('failed', (job, err) => {
  console.error(`[WORKER] Failed: ${job?.id}`, err.message);
});

// Future: add more workers for email, cron, etc.
// const emailWorker = new Worker('email', processEmail, { connection });
```

### Audio Processor

```typescript
// apps/workers/src/processors/audio.ts
import { Job } from 'bullmq';
import { execFile } from 'child_process';
import { readFile, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

interface AudioJobData {
  captureId: string;
  audioUrl: string;
  caller: 'a' | 'b';
}

export async function processAudio(job: Job<AudioJobData>): Promise<void> {
  const { captureId, audioUrl, caller } = job.data;

  // Step 1: Transcribe with Deepgram
  await job.updateProgress(10);
  const utterances = await transcribeWithDeepgram(audioUrl);

  if (utterances.length === 0) {
    await saveToDb(captureId, caller, []);
    return;
  }

  // Step 2: Download full recording
  await job.updateProgress(20);
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'audio-'));
  const fullPath = path.join(tmpDir, 'full.mp4');
  const res = await fetch(audioUrl);
  await writeFile(fullPath, Buffer.from(await res.arrayBuffer()));

  try {
    // Step 3: Parallel slice to MP3 (batches of 10)
    await job.updateProgress(40);
    const clips = await sliceInBatches(fullPath, utterances, captureId, caller, tmpDir, 10);

    // Step 4: Parallel upload to S3 (batches of 10)
    await job.updateProgress(70);
    const uploadedUtterances = await uploadInBatches(clips, 10);

    // Step 5: Save to DB
    await job.updateProgress(90);
    await saveToDb(captureId, caller, uploadedUtterances);

    await job.updateProgress(100);
  } finally {
    // Cleanup temp files
    await rm(tmpDir, { recursive: true }).catch(() => {});
  }
}

async function sliceInBatches(
  fullPath: string,
  utterances: any[],
  captureId: string,
  caller: string,
  tmpDir: string,
  batchSize: number,
) {
  const clips = [];

  for (let i = 0; i < utterances.length; i += batchSize) {
    const batch = utterances.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (u: any, j: number) => {
        const idx = i + j;
        const filename = `${captureId}-caller_${caller}-utt-${idx}.mp3`;
        const clipPath = path.join(tmpDir, filename);

        await ffmpegToMp3(fullPath, clipPath, u.start, u.end);

        return {
          start: u.start,
          end: u.end,
          text: u.transcript,
          confidence: u.confidence,
          localPath: clipPath,
          filename,
        };
      }),
    );
    clips.push(...results);
  }

  return clips;
}

function ffmpegToMp3(input: string, output: string, start: number, end: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y', '-ss', String(start), '-t', String(end - start),
      '-i', input,
      '-c:a', 'libmp3lame',
      '-q:a', '5',
      '-ar', '16000',
      '-ac', '1',
      output,
    ], (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg: ${stderr || err.message}`));
      else resolve();
    });
  });
}
```

### BullMQ Dashboard (Bull Board)

```typescript
// Optional: add to API for job visibility
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues: [
    new BullMQAdapter(audioQueue),
    new BullMQAdapter(emailQueue),
  ],
  serverAdapter,
});
serverAdapter.setBasePath('/admin/queues');
app.use('/admin/queues', serverAdapter.getRouter());

// Visit http://localhost:8080/admin/queues to see all jobs
```

---

## Cron Jobs with BullMQ

```typescript
// Future: scheduled/repeating jobs

// Daily report at 9 AM IST
await cronQueue.add('daily-report', {}, {
  repeat: { pattern: '0 9 * * *', tz: 'Asia/Kolkata' },
});

// Email campaign — 100 emails, 2 per second
for (const recipient of recipients) {
  await emailQueue.add('send-campaign', {
    to: recipient.email,
    template: 'monthly-update',
  }, {
    limiter: { max: 2, duration: 1000 },  // Rate: 2/sec
  });
}

// Cleanup old recordings — weekly
await cronQueue.add('cleanup-recordings', {}, {
  repeat: { pattern: '0 2 * * 0' },  // Sunday 2 AM
});
```

---

## Docker + Local Dev

### docker-compose.dev.yml (updated)

```yaml
services:
  api:
    build:
      context: .
      target: builder
    command: sh -c "npx drizzle-kit push && npx tsx watch apps/api/src/server.ts"
    ports:
      - "8080:8080"
    env_file: .env
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://telephony:telephony@postgres:5432/telephony
      - REDIS_HOST=redis
    volumes:
      - ./apps/api/src:/app/apps/api/src
      - ./packages:/app/packages
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes    # AOF persistence
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: telephony
      POSTGRES_PASSWORD: telephony
      POSTGRES_DB: telephony
    volumes:
      - pgdata_dev:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U telephony"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata_dev:
  redis_data:
```

### Worker Dockerfile

```dockerfile
# apps/workers/Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate && \
    npm install -g esbuild
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/workers/package.json ./apps/workers/
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile
COPY apps/workers/ ./apps/workers/
RUN esbuild apps/workers/src/worker.ts \
    --bundle --platform=node --target=node22 \
    --outfile=dist/worker.js --packages=external --sourcemap

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app && \
    apk add --no-cache ffmpeg    # Required for audio slicing
# Copy deps + bundle
COPY --from=builder /app/dist/worker.js ./dist/worker.js
# Install only worker's prod dependencies
COPY --from=builder /app/node_modules ./node_modules
USER app
ENV NODE_ENV=production
CMD ["node", "--enable-source-maps", "dist/worker.js"]
```

---

## Terraform Additions

### ElastiCache Redis

```hcl
resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.project}-redis"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  name        = "${var.project}-redis"
  vpc_id      = module.vpc.vpc_id
  description = "Redis - from ECS only"

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.ecs.services["telephony-api"].security_group_id]
    description     = "Redis from ECS"
  }
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${var.project}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t4g.micro"    # $13/mo
  num_cache_nodes      = 1
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]

  snapshot_retention_limit = 1    # 1-day backup
  maintenance_window       = "Mon:05:00-Mon:06:00"
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.redis.cache_nodes[0].address
}
```

### Worker ECS Service (Add to Existing Cluster)

```hcl
# In the ECS module, add a second service:
services = {
  telephony-api = { ... }    # existing

  background-worker = {
    cpu    = 1024
    memory = 2048    # More for ffmpeg + audio processing

    container_definitions = {
      worker = {
        cpu       = 1024
        memory    = 2048
        essential = true
        image     = "${aws_ecr_repository.worker.repository_url}:latest"

        environment = [
          { name = "NODE_ENV",    value = "production" },
          { name = "REDIS_HOST",  value = aws_elasticache_cluster.redis.cache_nodes[0].address },
          { name = "REDIS_PORT",  value = "6379" },
          { name = "S3_BUCKET",   value = module.s3_recordings.s3_bucket_id },
          { name = "S3_REGION",   value = "ap-south-1" },
        ]

        secrets = [
          { name = "DATABASE_URL",     valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:DATABASE_URL::" },
          { name = "DEEPGRAM_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:DEEPGRAM_API_KEY::" },
          { name = "S3_ACCESS_KEY",    valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:S3_ACCESS_KEY::" },
          { name = "S3_SECRET_KEY",    valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:S3_SECRET_KEY::" },
        ]

        enable_cloudwatch_logging = true
      }
    }

    # No ALB — worker is not HTTP-facing
    subnet_ids = module.vpc.private_subnets
    security_group_ingress_rules = {}    # No inbound
    security_group_egress_rules = {
      all = { ip_protocol = "-1", cidr_ipv4 = "0.0.0.0/0" }
    }

    enable_autoscaling       = true
    autoscaling_min_capacity = 1
    autoscaling_max_capacity = 3
  }
}
```

---

## Updated Cost

| Resource | Monthly Cost |
|----------|-------------|
| ECS API (2 tasks) | ~$30 |
| **ECS Worker (1 task)** | **~$22** |
| **ElastiCache Redis** | **~$13** |
| NAT Gateway | ~$35 |
| ALB | ~$20 |
| RDS | ~$15 |
| S3, ECR, CloudWatch, Secrets | ~$10 |
| **Total** | **~$145/mo** |

+$35/mo over the original plan. Redis + worker pay for themselves in reliability and future use cases.

---

## Implementation Order

| Phase | What | When |
|-------|------|------|
| **Now** | Add ffmpeg to Dockerfile + fix MP3 output | Before Terraform |
| **With Terraform** | Add ElastiCache Redis + worker ECS service | During infra deploy |
| **After deploy** | Create `apps/workers/` package, wire BullMQ | First feature after infra |
| **Future** | Email queue, cron jobs, Bull Board dashboard | As needed |
