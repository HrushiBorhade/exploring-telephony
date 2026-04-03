# Temporal — From First Principles to Production

---

## 1. What Problem Does Temporal Solve?

Modern distributed applications fail in partial, non-obvious ways:

- A payment service crashes mid-transfer
- A retry loop runs forever eating resources
- A long-running process loses state on restart
- Coordinating 5 microservices requires a spaghetti of queues, retries, and dead-letter handlers

**Temporal's answer:** *Durable Execution* — your code runs as if the process never crashes. State is automatically persisted. Retries, timeouts, and rollbacks are first-class. You write plain async code; Temporal handles the failure modes.

---

## 2. Core Mental Model

```
┌─────────────────────────────────────────────────────┐
│                  TEMPORAL SERVICE                    │
│  (the "brain" — stores history, schedules tasks)    │
│                                                      │
│  ┌──────────────────┐    ┌───────────────────────┐  │
│  │  Workflow History │    │  Task Queues           │  │
│  │  (event log)      │    │  (work distribution)   │  │
│  └──────────────────┘    └───────────────────────┘  │
└─────────────────────────────────────────────────────┘
         ↕ polls / reports
┌──────────────────────────────────┐
│           WORKERS                │
│  (your code — stateless pollers) │
│  ┌───────────────┐ ┌──────────┐  │
│  │  Workflow Code │ │Activities│  │
│  └───────────────┘ └──────────┘  │
└──────────────────────────────────┘
         ↕ starts / queries
┌─────────────────┐
│  CLIENT (SDK)   │  (your API server, CLI, etc.)
└─────────────────┘
```

**Key insight:** Workers are stateless. The Temporal Service is the source of truth. Workers replay events from history to reconstruct current state.

---

## 3. The 5 Core Concepts

### 3.1 Workflow

The **orchestrator**. Defines the sequence of steps (activities), handles branching, waits for signals, manages state. Must be **deterministic** — same inputs → same execution path every time.

**Why deterministic?** Temporal replays workflow history to reconstruct state after a crash. Non-deterministic code (`Math.random()`, `Date.now()`, direct API calls) would produce different results on replay.

```typescript
import { proxyActivities, sleep } from '@temporalio/workflow';
import type * as activities from './activities';

const { chargeCard, sendEmail } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 5 },
});

export async function orderWorkflow(orderId: string): Promise<void> {
  await chargeCard(orderId);           // Activity — can fail & retry
  await sleep('1 day');                // Durable timer — survives restarts
  await sendEmail(orderId, 'shipped'); // Another activity
}
```

### 3.2 Activity

The **executor**. Does the actual work: API calls, DB writes, file I/O. Can fail, can be retried. Has **no determinism requirement**. Activities are your impure side effects.

```typescript
// activities.ts
export async function chargeCard(orderId: string): Promise<void> {
  await stripe.charges.create({ amount: 1000, currency: 'usd' });
  // If this throws → Temporal retries based on retry policy
}

export async function sendEmail(orderId: string, status: string): Promise<void> {
  await sendgrid.send({ to: 'user@example.com', subject: `Order ${status}` });
}
```

### 3.3 Worker

Polls task queues and executes Workflows/Activities. You run these on your infra. Multiple workers = horizontal scale.

```typescript
// worker.ts
import { Worker } from '@temporalio/worker';
import * as activities from './activities';

async function run() {
  const worker = await Worker.create({
    workflowsPath: require.resolve('./workflows'),
    activities,
    taskQueue: 'orders',
  });
  await worker.run();
}
run().catch(console.error);
```

### 3.4 Task Queue

Named channel between Client and Workers. Workers long-poll their queue. Multiple workers on same queue = load balanced. Different queues = different worker pools (e.g., `high-priority`, `batch`).

### 3.5 Temporal Service (Server)

Stores all workflow state as an **append-only event history**. Core internal components:

- **Frontend** — gRPC gateway
- **History** — owns workflow state/history
- **Matching** — manages task queues
- **Worker** (internal) — background processes

---

## 4. Event History & Determinism Deep Dive

This is the engine. Every Workflow execution is an event log:

```
WorkflowExecutionStarted
ActivityTaskScheduled  (chargeCard)
ActivityTaskStarted
ActivityTaskCompleted  → result: "ok"
TimerStarted           (1 day)
TimerFired
ActivityTaskScheduled  (sendEmail)
ActivityTaskCompleted
WorkflowExecutionCompleted
```

**Replay:** When a Worker picks up a workflow task, it replays this history through your code. The SDK intercepts all side effects (`executeActivity`, `sleep`) and short-circuits them with recorded results — your code fast-forwards to current state without re-executing side effects.

**Non-determinism rules (TypeScript):**

```typescript
// ❌ WRONG — different value on replay
const id = Math.random();
const now = Date.now();

// ✅ CORRECT — deterministic SDK equivalents
import { uuid4, now } from '@temporalio/workflow';
const id = uuid4();
const ts = now();
```

**Other constraints inside Workflow code:**

- No direct network/DB calls (use activities instead)
- No native timer APIs — use `sleep()` from `@temporalio/workflow` for all delays
- No reading env vars at runtime (read at worker startup, pass as args)
- No importing non-deterministic libraries

---

## 5. Signals, Queries & Updates

### Signals — send data INTO a running workflow (async, fire-and-forget)

```typescript
// workflow.ts
import { defineSignal, setHandler, condition } from '@temporalio/workflow';

export const approveSignal = defineSignal<[string]>('approve');

export async function approvalWorkflow(): Promise<string> {
  let approved = false;
  let approver = '';

  setHandler(approveSignal, (name: string) => {
    approved = true;
    approver = name;
  });

  await condition(() => approved, '30 days'); // wait up to 30 days
  return `Approved by ${approver}`;
}

// client.ts — send signal to running workflow
const handle = client.workflow.getHandle('approval-123');
await handle.signal(approveSignal, 'alice@corp.com');
```

### Queries — read state FROM a workflow (sync, read-only)

```typescript
export const statusQuery = defineQuery<string>('status');

export async function myWorkflow(): Promise<void> {
  let status = 'pending';
  setHandler(statusQuery, () => status);

  status = 'processing';
  await someActivity();
  status = 'done';
}

// client.ts
const currentStatus = await handle.query(statusQuery);
```

### Updates — signal + query combined (send data, get response, can be validated)

```typescript
export const addItemUpdate = defineUpdate<number, [string]>('addItem');

export async function cartWorkflow(): Promise<void> {
  const items: string[] = [];

  setHandler(
    addItemUpdate,
    (item: string) => {
      items.push(item);
      return items.length;
    },
    {
      validator: (item: string) => {
        if (!item) throw new Error('Item cannot be empty');
      },
    }
  );

  await condition(() => items.length >= 10);
}
```

---

## 6. Retries, Timeouts & Error Handling

### Retry Policy

```typescript
const { processPayment } = proxyActivities<typeof activities>({
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,          // exponential: 1s → 2s → 4s → 8s...
    maximumInterval: '100s',
    maximumAttempts: 5,
    nonRetryableErrorTypes: ['InvalidCardError'], // don't retry these
  },
  startToCloseTimeout: '30s',       // single attempt deadline
  scheduleToCloseTimeout: '5m',     // total time across all retries
});
```

### 4 Timeout Types


| Timeout                  | Scope                        | Use For                             |
| ------------------------ | ---------------------------- | ----------------------------------- |
| `scheduleToCloseTimeout` | whole activity (all retries) | hard deadline                       |
| `startToCloseTimeout`    | single attempt               | per-attempt cap                     |
| `scheduleToStartTimeout` | queue wait time              | detect stuck queues                 |
| `heartbeatTimeout`       | between heartbeats           | detect hung long-running activities |


### Long-running Activity Heartbeats

```typescript
import { Context } from '@temporalio/activity';

export async function processLargeFile(fileId: string): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    Context.current().heartbeat({ progress: i }); // must beat within heartbeatTimeout

    await processChunk(fileId, i);

    if (Context.current().cancellationSignal.aborted) {
      await cleanup();
      break; // handle graceful cancellation
    }
  }
}
```

### ApplicationFailure — control retry behavior from activity code

```typescript
import { ApplicationFailure } from '@temporalio/common';

export async function chargeCard(orderId: string): Promise<void> {
  try {
    await stripe.charges.create({ ... });
  } catch (err) {
    if (err.code === 'card_declined') {
      // Non-retryable — don't waste retries on a definitive failure
      throw ApplicationFailure.nonRetryable('Card declined', 'CardDeclinedError');
    }
    throw err; // retryable by default
  }
}
```

---

## 7. Child Workflows & Parallel Execution

```typescript
import { executeChild } from '@temporalio/workflow';

export async function parentWorkflow(userIds: string[]): Promise<void> {
  // Run child workflows in parallel
  await Promise.all(
    userIds.map((id) =>
      executeChild(userWorkflow, {
        args: [id],
        workflowId: `user-${id}`,
        taskQueue: 'users',
      })
    )
  );
}
```

**Child vs Continue-As-New:**

- Use child workflows for true sub-processes with separate history
- Use `continueAsNew` when a single workflow needs to run indefinitely without history growing unbounded

```typescript
import { continueAsNew, isContinueAsNewSuggested } from '@temporalio/workflow';

export async function infiniteWorkflow(iteration: number): Promise<void> {
  await doWork(iteration);

  if (isContinueAsNewSuggested()) {
    // Starts a fresh execution — clean history, same workflow
    await continueAsNew<typeof infiniteWorkflow>(iteration + 1);
  }
}
```

---

## 8. Schedules (Cron-style)

```typescript
import { ScheduleOverlapPolicy } from '@temporalio/client';

await client.schedule.create({
  scheduleId: 'daily-report',
  spec: {
    cronExpressions: ['0 9 * * 1-5'], // weekdays at 9am
  },
  action: {
    type: 'startWorkflow',
    workflowType: generateReportWorkflow,
    taskQueue: 'reports',
  },
  policies: {
    overlap: ScheduleOverlapPolicy.Skip, // skip if previous still running
    catchupWindow: '1 minute',
  },
});

// Pause/resume/trigger manually
const handle = client.schedule.getHandle('daily-report');
await handle.pause('deploy in progress');
await handle.unpause();
await handle.trigger(); // run immediately
```

---

## 9. Versioning (Workflow Code Changes in Production)

When you change workflow code while executions are still running, replays break. Use `patched()`:

```typescript
import { patched } from '@temporalio/workflow';

export async function myWorkflow(): Promise<void> {
  if (patched('added-new-step-v2')) {
    // New code path — only runs for new executions
    await newActivity();
  }
  // Old code path — still runs for in-flight executions from before the patch
  await existingActivity();
}
```

Once all pre-patch executions complete, remove the patch with `deprecatePatch()`, then in the next release remove it entirely.

---

## 10. TypeScript Project Structure

```
my-temporal-app/
├── src/
│   ├── workflows/
│   │   └── order.ts        # Workflow definitions (deterministic only)
│   ├── activities/
│   │   └── index.ts        # Activity implementations (any code ok)
│   ├── worker.ts           # Worker setup
│   └── client.ts           # Workflow starter / signal sender
├── package.json
└── tsconfig.json
```

**package.json dependencies:**

```json
{
  "dependencies": {
    "@temporalio/client": "^1.x",
    "@temporalio/worker": "^1.x",
    "@temporalio/workflow": "^1.x",
    "@temporalio/activity": "^1.x",
    "@temporalio/common": "^1.x"
  }
}
```

---

## 11. Starting a Workflow (Client)

```typescript
import { Connection, Client } from '@temporalio/client';

async function main() {
  const client = new Client(); // localhost:7233 by default

  const handle = await client.workflow.start(orderWorkflow, {
    args: ['order-123'],
    taskQueue: 'orders',
    workflowId: 'order-order-123', // must be unique; idempotency key
  });

  console.log(`Started: ${handle.workflowId}`);

  const result = await handle.result(); // wait for completion
  console.log('Result:', result);
}
```

**Workflow ID is your idempotency key** — starting the same ID twice returns the existing execution (configurable via `workflowIdReusePolicy`).

---

## 12. Production Deployment

### Option A: Temporal Cloud (recommended for most teams)

Temporal runs the server; you run only your Workers.

```typescript
import { Connection, Client } from '@temporalio/client';
import { readFile } from 'fs/promises';

const connection = await Connection.connect({
  address: 'your-namespace.tmprl.cloud:7233',
  tls: {
    clientCert: await readFile('client.pem'),
    clientPrivateKey: await readFile('client.key'),
  },
});

const client = new Client({
  connection,
  namespace: 'your-namespace.acctid',
});
```

Workers connect the same way — just pass the same `connection` to `Worker.create()`.

### Option B: Self-Hosted — Docker Compose (local/dev)

```yaml
version: '3.5'
services:
  postgresql:
    image: postgres:13
    environment:
      POSTGRES_PASSWORD: temporal
      POSTGRES_USER: temporal
      POSTGRES_DB: temporal

  temporal:
    image: temporalio/auto-setup:1.24
    depends_on: [postgresql]
    ports: ["7233:7233"]
    environment:
      DB: postgresql
      DB_PORT: 5432
      POSTGRES_USER: temporal
      POSTGRES_PWD: temporal
      POSTGRES_SEEDS: postgresql

  temporal-ui:
    image: temporalio/ui:latest
    ports: ["8080:8080"]
    environment:
      TEMPORAL_ADDRESS: temporal:7233
```

```bash
docker-compose up -d
# UI at http://localhost:8080
# gRPC at localhost:7233
```

### Option C: Self-Hosted — Kubernetes (production)

```bash
helm repo add temporalio https://go.temporal.io/helm-charts
helm repo update

helm install temporal temporalio/temporal \
  --set server.replicaCount=3 \
  --set cassandra.config.cluster_size=3 \
  --set elasticsearch.enabled=true \
  --namespace temporal \
  --create-namespace
```

**Production infra requirements:**


| Component       | Recommended DB          | Scale                                  |
| --------------- | ----------------------- | -------------------------------------- |
| Persistence     | Cassandra or PostgreSQL | Cassandra for massive throughput       |
| Visibility      | Elasticsearch           | Required for workflow search/filtering |
| Frontend        | 2+ pods                 | gRPC load balanced                     |
| History         | 2+ pods                 | Stateless, scale horizontally          |
| Matching        | 2+ pods                 | Task queue management                  |
| Internal Worker | 1+ pods                 | Background maintenance tasks           |


---

## 13. Observability

### Temporal UI

- Built-in workflow explorer at `localhost:8080` (self-hosted) or `cloud.temporal.io`
- Search workflows by ID, type, status, time range
- Inspect full event history for any execution
- Replay failed workflows

### Metrics (Prometheus)

Workers export Prometheus metrics out of the box:

```typescript
import { Runtime, DefaultLogger, makeTelemetryFilterString } from '@temporalio/worker';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

Runtime.install({
  telemetryOptions: {
    metrics: {
      prometheus: { bindAddress: '0.0.0.0:9464' },
    },
  },
});
```

Key metrics to watch:

- `temporal_workflow_task_execution_latency` — workflow task processing time
- `temporal_activity_execution_latency` — activity execution time
- `temporal_task_queue_poll_empty` — workers with no work (over-provisioned)
- `temporal_workflow_failed_count` — failure rate

### OpenTelemetry Tracing

```typescript
import { WorkflowInboundCallsInterceptor } from '@temporalio/workflow';
// Use @temporalio/interceptors-opentelemetry for distributed tracing
```

---

## 14. Key Design Decisions

### When to use Temporal vs alternatives


| Need                             | Temporal   | Alternative               |
| -------------------------------- | ---------- | ------------------------- |
| Long-running multi-step process  | ✅          | BullMQ (no durability)    |
| Human-in-the-loop approval flows | ✅          | Manual polling            |
| Saga / distributed transactions  | ✅          | Custom compensating logic |
| Simple background jobs           | ❌ overkill | BullMQ / Sidekiq          |
| Stream processing                | ❌          | Kafka                     |
| Simple cron jobs                 | ❌ overkill | node-cron / Inngest       |


### Activity granularity

- Make activities **idempotent** — they may run more than once
- Each activity = one retryable unit of work
- Don't make activities too fine-grained (overhead) or too coarse (lose retry precision)

### Task Queue design

- Separate queues for different resource profiles: `cpu-intensive`, `io-bound`, `high-priority`
- Workers can listen to multiple queues
- Use versioning on task queues (`task-queue:v2`) for zero-downtime deploys

---

## 15. Common Patterns

### Saga Pattern (distributed transactions with compensation)

```typescript
export async function transferWorkflow(from: string, to: string, amount: number): Promise<void> {
  await debitAccount(from, amount);

  try {
    await creditAccount(to, amount);
  } catch (err) {
    // Compensate — undo the debit
    await creditAccount(from, amount); // refund
    throw err;
  }
}
```

### Fan-out / Fan-in

```typescript
export async function fanOutWorkflow(items: string[]): Promise<string[]> {
  const results = await Promise.all(
    items.map((item) => executeActivity(processItem, { args: [item], startToCloseTimeout: '30s' }))
  );
  return results;
}
```

### Human-in-the-loop

```typescript
export const reviewSignal = defineSignal<[boolean]>('review');

export async function documentApprovalWorkflow(docId: string): Promise<string> {
  let approved: boolean | null = null;

  setHandler(reviewSignal, (decision: boolean) => { approved = decision; });

  // Notify reviewer
  await sendReviewEmail(docId);

  // Wait up to 7 days for review
  const timedOut = !(await condition(() => approved !== null, '7 days'));

  if (timedOut) return 'expired';
  return approved ? 'approved' : 'rejected';
}
```

---

## 16. Quick Reference

### CLI (temporal CLI)

```bash
# Install
brew install temporal

# Start local dev server (no Docker needed)
temporal server start-dev

# List workflows
temporal workflow list

# Start a workflow
temporal workflow start \
  --workflow-type orderWorkflow \
  --task-queue orders \
  --workflow-id my-order-1 \
  --input '"order-123"'

# Signal a workflow
temporal workflow signal \
  --workflow-id my-order-1 \
  --name approve \
  --input '"alice"'

# Show workflow history
temporal workflow show --workflow-id my-order-1

# Cancel a workflow
temporal workflow cancel --workflow-id my-order-1
```

### Environment Variables (Worker)

```bash
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
TEMPORAL_TLS_CERT=/path/to/cert.pem      # Temporal Cloud
TEMPORAL_TLS_KEY=/path/to/key.pem        # Temporal Cloud
```

---

## Sources

- [Official Docs](https://docs.temporal.io)
- [TypeScript SDK Reference](https://typescript.temporal.io)
- [Temporal Cloud](https://cloud.temporal.io)
- [Self-hosted Helm charts](https://go.temporal.io/helm-charts)
- [Samples (TypeScript)](https://github.com/temporalio/samples-typescript)

