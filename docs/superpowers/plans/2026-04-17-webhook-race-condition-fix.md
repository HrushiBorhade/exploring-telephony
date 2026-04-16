# Webhook Race Condition Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the race condition where `participant_left` and `room_finished` webhooks interfere with `egress_ended`, causing recording URLs to be lost and captures stuck in "Saving Recordings" forever.

**Architecture:** Make `egress_ended` the sole authority for capture completion. Other webhooks do their specific job (stop egress, remove participants) but never change capture status or delete the room when egress recordings are pending.

**Key constraint:** All 3 egresses must have the same duration (synchronized stop via `stopEgress` on all 3 simultaneously).

---

## Root Cause

`participant_left` currently does 4 things:
1. Stop all egresses ← CORRECT (synchronized duration)
2. Mark capture "ended" in DB ← WRONG (blocks egress_ended from saving URLs)
3. Remove other participant ← CORRECT
4. Delete room ← WRONG (breaks findCaptureByRoom lookups for egress_ended)

## The Fix (Summary)

| Webhook | Before | After |
|---|---|---|
| `participant_left` | Stop egress + mark ended + remove caller + delete room | Stop egress + remove caller ONLY |
| `room_finished` | Mark capture ended | No-op if egress was started (egressIds present) |
| `egress_ended` | Save URL + check all 3 + maybe enqueue | Save URL + check all 3 + set ended + enqueue (sole authority) |
| `room_metadata_changed` (failure) | Mark ended | UNCHANGED (no egress to wait for) |

---

## File: `apps/api/src/routes/webhooks.ts`

### Change 1: `participant_left` (lines 100-158)

Remove lines 135-156 (status change, DB update, room deletion). Keep only: stop egresses + remove other caller.

**Before (lines 100-158):**
```typescript
if (capture && capture.status === "active") {
  // ... stop egresses (keep this)
  
  // Update capture status AFTER egress is stopped ← REMOVE
  captureActiveGauge.dec();                         ← REMOVE
  capture.status = "ended";                          ← REMOVE
  capture.endedAt = new Date().toISOString();         ← REMOVE
  capture.durationSeconds = ...;                      ← REMOVE
  await dbq.updateCapture(capture.id, {...});         ← REMOVE
  
  // Remove the other caller (keep this)
  
  // Delete room ← REMOVE
  roomService.deleteRoom(roomName)...                 ← REMOVE
}
```

**After:**
```typescript
if (capture && capture.status === "active") {
  capture._joinedCallers?.delete(identity);
  const remaining = capture._joinedCallers?.size ?? 0;
  logger.info(`[WEBHOOK] ${identity} left ${roomName}. Callers remaining: ${remaining}`);

  // Stop all egresses for synchronized recording duration
  if (capture._egressIds?.length) {
    try {
      await Promise.all(
        capture._egressIds.map((eid) =>
          egressClient.stopEgress(eid)
            .catch((e: any) => logger.warn(`[CLEANUP] stopEgress ${eid} failed:`, e.message)),
        ),
      );
      logger.info(`[WEBHOOK] All egresses stopped for ${capture.id}`);
    } catch (err: any) {
      logger.error(`[WEBHOOK] Egress stop failed:`, err.message);
    }
  }

  // Remove the other caller so they don't sit alone
  if (remaining > 0) {
    const otherCaller = identity === "caller_a" ? "caller_b" : "caller_a";
    logger.info(`[WEBHOOK] Removing ${otherCaller} from ${roomName} (partner left)`);
    roomService.removeParticipant(roomName, otherCaller)
      .catch((e) => logger.warn(`[CLEANUP] removeParticipant ${otherCaller} failed:`, e.message));
  }

  // DO NOT mark capture as ended — egress_ended webhooks will handle completion
  // DO NOT delete room — room_finished will fire naturally after participants leave
  logger.info(`[WEBHOOK] Waiting for egress_ended webhooks to save recordings for ${capture.id}`);
}
```

### Change 2: `room_finished` (lines 161-178)

Only handle captures where egress was NEVER started (failed calls). Skip if egress was started.

**Before (lines 161-178):**
```typescript
if (event.event === "room_finished" && event.room) {
  const capture = findCaptureByRoom(roomName);
  if (capture && capture.status === "active") {
    captureActiveGauge.dec();
    capture.status = "ended";
    // ... mark ended, release theme sample
  }
}
```

**After:**
```typescript
if (event.event === "room_finished" && event.room) {
  const roomName = event.room.name;
  const capture = findCaptureByRoom(roomName);
  if (capture && capture.status === "active") {
    // Only handle if egress was NEVER started (failed call — consent denied, no answer, etc.)
    // If egress was started, egress_ended webhooks will handle completion.
    if (!capture._egressIds?.length) {
      captureActiveGauge.dec();
      capture.status = "ended";
      capture.endedAt = new Date().toISOString();
      capture.durationSeconds = calculateDuration(capture.startedAt);
      await dbq.updateCapture(capture.id, {
        status: "ended",
        endedAt: new Date(capture.endedAt),
        durationSeconds: capture.durationSeconds,
      }).catch((e) => logger.error("[DB] room_finished update failed:", e.message));
      dbq.releaseThemeSample(capture.id).catch(() => {});
      logger.info(`[WEBHOOK] Capture ${capture.id} ended (room finished, no egress)`);
    } else {
      logger.info(`[WEBHOOK] Room finished for ${capture.id} — egress was started, waiting for egress_ended webhooks`);
    }
  }
}
```

### Change 3: `egress_ended` (lines 180-264)

Add: after all 3 URLs are saved, set capture status to "ended" with duration, THEN enqueue processing. Also delete room here.

**Change the `setRecordingUrlAndCheckReady` status check** — currently it only returns if status is `ended` or `active`. Since we no longer mark as `ended` in `participant_left`, the status will still be `active` when egress_ended arrives. This already works because the WHERE clause includes `active`.

**Add after the enqueue block (after line 258):**
```typescript
// Clean up: update status to ended, delete room
// This is now the ONLY place that transitions active → ended → processing
const endedAt = new Date();
const durationSeconds = ready.startedAt
  ? Math.round((endedAt.getTime() - new Date(ready.startedAt).getTime()) / 1000)
  : 0;

// Decrement active gauge
const cached = activeCaptures.get(ready.id);
if (cached && cached.status === "active") {
  captureActiveGauge.dec();
  cached.status = "processing";
  cached.endedAt = endedAt.toISOString();
  cached.durationSeconds = durationSeconds;
}

// Delete room (safe now — all egresses finalized)
if (ready.roomName) {
  roomService.deleteRoom(ready.roomName).catch(() => {});
}
```

Also update the DB update on line 255 to include endedAt and durationSeconds:
```typescript
await dbq.updateCapture(ready.id, {
  status: "processing",
  endedAt,
  durationSeconds,
});
```

---

## Verification

### Test Case 1: Normal call (both callers talk, one hangs up)
1. Start a call, record for 1 minute
2. One caller hangs up
3. Check: all 3 recording URLs saved in DB
4. Check: capture status transitions active → processing → completed
5. Check: no "Saving Recordings" stuck state

### Test Case 2: Call where both callers disconnect simultaneously
1. Both callers hang up at the same time
2. Check: participant_left fires for both (second is no-op for egress since already stopped)
3. Check: all 3 URLs saved, processing triggered

### Test Case 3: Failed call (one doesn't pick up)
1. Start call, one doesn't answer
2. Agent signals announced:false
3. Check: capture marked "ended" by room_metadata_changed (not egress_ended)
4. Check: room_finished is no-op (or marks ended if metadata webhook was missed)

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Capture stays "active" forever if egress_ended never arrives | The 30-minute timeout enforcer (stashed) catches this. Also room_finished fallback for non-egress captures. |
| Room stays alive after all participants leave | LiveKit's built-in empty room timeout (default 5 min) auto-closes the room → triggers room_finished |
| participant_left doesn't stop egresses (egressIds lost after deploy) | Known limitation of in-memory cache. Future fix: store egress IDs in DB or query LiveKit. |
