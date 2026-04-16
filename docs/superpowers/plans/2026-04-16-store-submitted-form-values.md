# Store Submitted Form Values — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist participant A's submitted form values so the Form Results section shows what they actually typed (vs what was expected) on page revisit.

**Architecture:** Add `submitted_form_values` text column to `captures_v2` table. The validation endpoint saves the submitted values on first successful validation. The frontend loads them from the capture object and populates the form on revisit. Form Results always shows: entered value in input + expected value below.

**Tech Stack:** Drizzle ORM (migration + schema), Express API, React (useState), existing `useCapture` hook.

---

### File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/db/src/schema.ts:75-102` | Add `submittedFormValues` column to `captures` table |
| Modify | `packages/types/src/index.ts:6-31` | Add `submittedFormValues` to `Capture` interface |
| Create | `drizzle/0008_*.sql` | Migration: `ALTER TABLE captures_v2 ADD COLUMN IF NOT EXISTS submitted_form_values text` |
| Modify | `drizzle/meta/_journal.json` | Register migration idx 8 |
| Modify | `apps/api/src/routes/themes.ts:284-343` | Save submitted values to DB on validation |
| Modify | `apps/web/src/app/(dashboard)/dashboard/tasks/[id]/themed/page.tsx` | Load submitted values from capture, populate form on revisit |

---

### Task 1: Schema + Migration

**Files:**
- Modify: `packages/db/src/schema.ts:91` (after `datasetCsvUrl`)
- Modify: `packages/types/src/index.ts:23` (after `datasetCsvUrl`)
- Create: `drizzle/0008_add_submitted_form_values.sql`
- Modify: `drizzle/meta/_journal.json` (add idx 8 entry)

- [ ] **Step 1: Add column to Drizzle schema**

In `packages/db/src/schema.ts`, add after line 90 (`datasetCsvUrl`):

```typescript
submittedFormValues: text("submitted_form_values"), // JSON: participant A's form entries
```

- [ ] **Step 2: Add field to Capture type**

In `packages/types/src/index.ts`, add after line 23 (`datasetCsvUrl`):

```typescript
submittedFormValues?: string | null;
```

Also update the `ThemeSample` category union type on line 36 to include `customer_support`:

```typescript
category: "alphanumeric" | "healthcare" | "short_utterances" | "customer_support";
```

- [ ] **Step 3: Generate migration with drizzle-kit**

Run: `npx drizzle-kit generate`

This should produce a migration file like `0008_xxx.sql` with:
```sql
ALTER TABLE "captures_v2" ADD COLUMN "submitted_form_values" text;
```

If drizzle-kit doesn't generate (because it's a single column add), create manually:

File: `drizzle/0008_add_submitted_form_values.sql`
```sql
ALTER TABLE "captures_v2" ADD COLUMN IF NOT EXISTS "submitted_form_values" text;
```

And add to `drizzle/meta/_journal.json`:
```json
{
  "idx": 8,
  "version": "7",
  "when": 1776537600000,
  "tag": "0008_add_submitted_form_values",
  "breakpoints": true
}
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter ./apps/api exec tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/types/src/index.ts drizzle/ 
git commit -m "feat(db): add submitted_form_values column to captures_v2"
```

---

### Task 2: API — Save submitted values on validation

**Files:**
- Modify: `apps/api/src/routes/themes.ts:326-340`

- [ ] **Step 1: Save submitted values after successful validation**

In `apps/api/src/routes/themes.ts`, after the line `validationAttempts.set(id, attempts + 1);` (line 327), and after the results are computed (line 330), add a DB save before the response:

```typescript
// Save submitted form values to DB (only form fields, not on_submit)
const submittedOnly: Record<string, string> = {};
for (const k of fieldsToCheck) submittedOnly[k] = String(values[k] ?? "").trim();
await dbq.updateCapture(id, { submittedFormValues: JSON.stringify(submittedOnly) }).catch(() => {});
```

Insert this between the `const results = ...` line (330) and the `const score = ...` line (332).

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter ./apps/api exec tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/themes.ts
git commit -m "feat(api): persist submitted form values on validation"
```

---

### Task 3: Frontend — Load and display submitted values

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/tasks/[id]/themed/page.tsx`

- [ ] **Step 1: Update formInitialized logic to prefer submitted values**

Find the `useEffect` that populates form values (around line 248):

```typescript
useEffect(() => {
  if (theme?.data && isPostCall && !formInitialized) {
    setFormValues(theme.data);
    setFormInitialized(true);
  }
}, [theme?.data, isPostCall, formInitialized]);
```

Replace with:

```typescript
useEffect(() => {
  if (isPostCall && !formInitialized) {
    // Prefer submitted values (what user actually typed) over reference values
    if (capture?.submittedFormValues) {
      try {
        const submitted = JSON.parse(capture.submittedFormValues) as Record<string, string>;
        setFormValues(submitted);
      } catch {
        if (theme?.data) setFormValues(theme.data);
      }
    } else if (theme?.data) {
      setFormValues(theme.data);
    }
    setFormInitialized(true);
  }
}, [capture?.submittedFormValues, theme?.data, isPostCall, formInitialized]);
```

This means:
- If submitted values exist in DB → show what user actually typed
- If not (old captures before this feature) → fall back to reference values

- [ ] **Step 2: Verify build**

Run: `pnpm --filter ./apps/web exec next build`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(dashboard)/dashboard/tasks/[id]/themed/page.tsx
git commit -m "feat(web): load submitted form values on themed capture revisit"
```

---

### Task 4: Full verification

- [ ] **Step 1: Typecheck all packages**

```bash
pnpm --filter ./apps/api exec tsc --noEmit
pnpm --filter ./apps/workers exec tsc --noEmit
pnpm --filter ./apps/web exec next build
```

Expected: all exit 0

- [ ] **Step 2: Docker build**

```bash
docker build -t test-api .
```

Expected: exit 0

- [ ] **Step 3: Push and verify CI**

```bash
git push origin main
```

Watch CI + deploy. The migration runs on API container start and adds the column.

---

### Behavior Summary

| Scenario | Form Results shows |
|---|---|
| During call (live session) | What user is typing (React state) |
| After validation, same session | What user typed (React state) + expected below |
| Page revisit (completed capture, submitted values stored) | What user typed (from DB) + expected below |
| Page revisit (old capture, no submitted values) | Reference values (from theme.data) + expected below |
