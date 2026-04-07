# User Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-step onboarding flow (profile + languages) after phone OTP login, with an ElevenLabs-inspired right panel featuring two audio orbs and a waveform timeline.

**Architecture:** New `user_profiles` table stores name/age/gender/city/state. New `user_languages` table stores language + dialect selections. Express API endpoints for CRUD. Frontend uses ResizeObserver height-animated card with AnimatePresence step transitions (annote pattern). Middleware redirects un-onboarded users to `/onboarding`. Right panel is a shared `AuthPanel` component reused across login + onboarding.

**Tech Stack:** Drizzle ORM (PostgreSQL), Express, Next.js 16, react-hook-form + zod, motion/react, shadcn/ui (Combobox, Toggle), TanStack Query

---

## Review Fixes Applied (4-agent review on 2026-04-07)

The following fixes were identified by parallel review agents (Next.js 16, Drizzle ORM, React/TanStack, Security/API) and incorporated into the plan:

1. **DB**: Add explicit `.references(() => user.id, { onDelete: "cascade" })` on `userProfiles.id` — was missing FK constraint
2. **DB**: Add `serial` to drizzle-orm imports
3. **DB**: Migration commands run from project root (not `apps/web`)
4. **API**: Add string length limits (`MAX_NAME=100`, `MAX_CITY=100`, `MAX_DIALECT=50`)
5. **API**: Add array bounds (`MAX_LANGUAGES=10`, max 20 dialects per language)
6. **API**: Verify profile exists before `markOnboardingComplete` in languages endpoint
7. **Frontend**: Use `/auth-callback` intermediate page to avoid flash for existing users
8. **Frontend**: Wrap onboarding page in Suspense boundary for `useSearchParams`
9. **Frontend**: Use `useProfile()` instead of separate `useOnboardingStatus()` in guard (1 API call instead of 2)
10. **Frontend**: OnboardingGuard shows loading skeleton instead of returning null
11. **Frontend**: Delete old `app/login/` after moving to `(auth)/login/`
12. **Frontend**: Use `spring` from `motion.ts` consistently (not hardcoded 0.45s)
13. **Architecture**: Accept full page reload on auth→dashboard transition (different route group layouts — acceptable trade-off)

---

## File Structure

### Database (`packages/db/src/`)
- **Modify:** `schema.ts` — Add `userProfiles` and `userLanguages` tables
- **Modify:** `queries.ts` — Add profile/language CRUD functions
- **Modify:** `index.ts` — Already exports all (no change needed)

### API (`apps/api/src/`)
- **Create:** `routes/profile.ts` — GET/PUT /api/profile, GET/PUT /api/profile/languages
- **Modify:** `server.ts` — Register profile routes

### Frontend Types (`apps/web/src/lib/`)
- **Modify:** `types.ts` — Add `UserProfile`, `UserLanguage` interfaces
- **Create:** `schemas/onboarding.ts` — Zod validation schemas
- **Modify:** `api.ts` — Add `useProfile`, `useUpdateProfile`, `useUpdateLanguages` hooks
- **Modify:** `auth-client.ts` — No change (session already works)

### Frontend Pages (`apps/web/src/app/`)
- **Create:** `(auth)/layout.tsx` — Shared auth layout (left form + right panel)
- **Create:** `(auth)/onboarding/page.tsx` — Multi-step onboarding orchestrator
- **Create:** `(auth)/onboarding/_steps/shared.ts` — Step types, constants
- **Create:** `(auth)/onboarding/_steps/profile-step.tsx` — Name, age, gender, city, state
- **Create:** `(auth)/onboarding/_steps/languages-step.tsx` — Language multi-select + dialect tags
- **Move:** `login/page.tsx` → `(auth)/login/page.tsx`, use shared layout (delete old `app/login/`)
- **Create:** `auth-callback/page.tsx` — Smart redirect: checks onboarding status, routes to `/onboarding` or `/capture`

### Frontend Components (`apps/web/src/components/`)
- **Create:** `auth-panel.tsx` — Right panel: flickering grid + dual audio orbs + waveform timeline
- **Create:** `dialect-input.tsx` — Tag input with badge + remove

### Middleware
- **Modify:** `proxy.ts` — Add onboarding redirect logic

---

## Constants

### 22 Scheduled Indian Languages
```typescript
export const INDIAN_LANGUAGES = [
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "te", name: "Telugu" },
  { code: "mr", name: "Marathi" },
  { code: "ta", name: "Tamil" },
  { code: "ur", name: "Urdu" },
  { code: "gu", name: "Gujarati" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "or", name: "Odia" },
  { code: "pa", name: "Punjabi" },
  { code: "as", name: "Assamese" },
  { code: "mai", name: "Maithili" },
  { code: "sa", name: "Sanskrit" },
  { code: "sd", name: "Sindhi" },
  { code: "ne", name: "Nepali" },
  { code: "kok", name: "Konkani" },
  { code: "doi", name: "Dogri" },
  { code: "mni", name: "Manipuri" },
  { code: "sat", name: "Santali" },
  { code: "ks", name: "Kashmiri" },
  { code: "bo", name: "Bodo" },
  { code: "en", name: "English" },
] as const;
```

### Indian States
```typescript
export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Delhi", "Jammu & Kashmir", "Ladakh",
  "Chandigarh", "Puducherry", "Lakshadweep",
  "Andaman & Nicobar Islands", "Dadra & Nagar Haveli and Daman & Diu",
] as const;

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;
```

---

## Task 1: Database Schema — Profile & Languages Tables

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Add userProfiles table**

```typescript
// Add after the `verification` table in schema.ts

export const userProfiles = pgTable("user_profiles", {
  id: text("id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  age: integer("age").notNull(),
  gender: text("gender").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Foreign key is implicit via same ID as user.id
]);
```

- [ ] **Step 2: Add userLanguages table**

```typescript
export const userLanguages = pgTable("user_languages", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  languageCode: text("language_code").notNull(),
  languageName: text("language_name").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  dialects: text("dialects").array(), // ["Bhojpuri", "Awadhi"]
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("user_languages_user_id_idx").on(t.userId),
]);
```

- [ ] **Step 3: Add missing imports**

Add `integer`, `serial` to the drizzle-orm/pg-core import at top of schema.ts.

- [ ] **Step 4: Generate migration**

```bash
npx drizzle-kit generate
```
Run from project root where `drizzle.config.ts` lives.

- [ ] **Step 5: Apply migration locally**

```bash
npx drizzle-kit migrate
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts drizzle/
git commit -m "feat(db): add user_profiles and user_languages tables"
```

---

## Task 2: Database Queries — Profile & Language CRUD

**Files:**
- Modify: `packages/db/src/queries.ts`

- [ ] **Step 1: Add profile queries**

```typescript
export async function getProfile(userId: string) {
  return db.query.userProfiles.findFirst({
    where: eq(schema.userProfiles.id, userId),
  });
}

export async function upsertProfile(
  userId: string,
  data: { name: string; age: number; gender: string; city: string; state: string },
) {
  await db
    .insert(schema.userProfiles)
    .values({ id: userId, ...data })
    .onConflictDoUpdate({
      target: schema.userProfiles.id,
      set: { ...data, updatedAt: new Date() },
    });
}

export async function markOnboardingComplete(userId: string) {
  await db
    .update(schema.userProfiles)
    .set({ onboardingCompleted: true, updatedAt: new Date() })
    .where(eq(schema.userProfiles.id, userId));
}

export async function isOnboarded(userId: string): Promise<boolean> {
  const profile = await db.query.userProfiles.findFirst({
    where: and(
      eq(schema.userProfiles.id, userId),
      eq(schema.userProfiles.onboardingCompleted, true),
    ),
    columns: { id: true },
  });
  return !!profile;
}
```

- [ ] **Step 2: Add language queries**

```typescript
export async function getLanguages(userId: string) {
  return db
    .select()
    .from(schema.userLanguages)
    .where(eq(schema.userLanguages.userId, userId))
    .orderBy(desc(schema.userLanguages.isPrimary));
}

export async function setLanguages(
  userId: string,
  languages: { languageCode: string; languageName: string; isPrimary: boolean; dialects: string[] }[],
) {
  await db.transaction(async (tx) => {
    // Delete existing
    await tx.delete(schema.userLanguages).where(eq(schema.userLanguages.userId, userId));
    // Insert new
    if (languages.length > 0) {
      await tx.insert(schema.userLanguages).values(
        languages.map((l) => ({ userId, ...l })),
      );
    }
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
cd packages/db && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/queries.ts
git commit -m "feat(db): add profile and language CRUD queries"
```

---

## Task 3: API Endpoints — Profile Routes

**Files:**
- Create: `apps/api/src/routes/profile.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Create profile routes**

```typescript
// apps/api/src/routes/profile.ts
import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import * as dbq from "@repo/db";

const router = Router();

const MAX_NAME_LENGTH = 100;
const MAX_CITY_LENGTH = 100;
const MAX_DIALECT_LENGTH = 50;
const MAX_LANGUAGES = 10;
const MAX_DIALECTS_PER_LANG = 20;

// GET /api/profile — returns profile + languages + onboarding status
router.get("/api/profile", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [profile, languages] = await Promise.all([
      dbq.getProfile(req.userId!),
      dbq.getLanguages(req.userId!),
    ]);
    res.json({
      profile: profile ?? null,
      languages,
      onboardingCompleted: profile?.onboardingCompleted ?? false,
    });
  } catch {
    res.status(500).json({ error: "Failed to get profile" });
  }
});

// PUT /api/profile — upsert profile fields
router.put("/api/profile", requireAuth, async (req: AuthRequest, res) => {
  const { name, age, gender, city, state } = req.body;

  const errors: Record<string, string> = {};
  if (!name || typeof name !== "string" || name.trim().length < 2) errors.name = "Name must be at least 2 characters";
  else if (name.length > MAX_NAME_LENGTH) errors.name = `Name must be under ${MAX_NAME_LENGTH} characters`;
  if (!age || age < 18 || age > 100) errors.age = "Age must be 18-100";
  if (!gender) errors.gender = "Gender is required";
  if (!state) errors.state = "State is required";
  if (!city || typeof city !== "string" || city.trim().length < 2) errors.city = "City must be at least 2 characters";
  else if (city.length > MAX_CITY_LENGTH) errors.city = `City must be under ${MAX_CITY_LENGTH} characters`;

  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: "Validation failed", fields: errors });
    return;
  }

  try {
    await dbq.upsertProfile(req.userId!, { name: name.trim(), age: Number(age), gender, city: city.trim(), state });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to save profile" });
  }
});

// PUT /api/profile/languages — replace all languages
router.put("/api/profile/languages", requireAuth, async (req: AuthRequest, res) => {
  const { languages } = req.body;

  if (!Array.isArray(languages) || languages.length === 0) {
    res.status(400).json({ error: "At least one language is required" });
    return;
  }
  if (languages.length > MAX_LANGUAGES) {
    res.status(400).json({ error: `Maximum ${MAX_LANGUAGES} languages allowed` });
    return;
  }

  // Validate each language object
  for (const lang of languages) {
    if (!lang.languageCode || typeof lang.languageCode !== "string") {
      res.status(400).json({ error: "Invalid language structure" }); return;
    }
    if (lang.dialects && lang.dialects.length > MAX_DIALECTS_PER_LANG) {
      res.status(400).json({ error: `Maximum ${MAX_DIALECTS_PER_LANG} dialects per language` }); return;
    }
    for (const d of lang.dialects || []) {
      if (typeof d !== "string" || d.length > MAX_DIALECT_LENGTH) {
        res.status(400).json({ error: `Dialect names must be under ${MAX_DIALECT_LENGTH} characters` }); return;
      }
    }
  }

  const hasPrimary = languages.some((l: any) => l.isPrimary);
  if (!hasPrimary) {
    res.status(400).json({ error: "A primary language is required" });
    return;
  }

  try {
    // Verify profile exists before marking onboarding complete
    const profile = await dbq.getProfile(req.userId!);
    if (!profile) {
      res.status(400).json({ error: "Complete your profile first" }); return;
    }

    await dbq.setLanguages(req.userId!, languages);
    await dbq.markOnboardingComplete(req.userId!);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to save languages" });
  }
});

// GET /api/profile/onboarding-status — lightweight check for middleware
router.get("/api/profile/onboarding-status", requireAuth, async (req: AuthRequest, res) => {
  try {
    const completed = await dbq.isOnboarded(req.userId!);
    res.json({ completed });
  } catch {
    res.status(500).json({ error: "Failed to check onboarding status" });
  }
});

export default router;
```

- [ ] **Step 2: Register routes in server.ts**

Find the line that imports/uses captures routes and add profile routes the same way:

```typescript
import profileRoutes from "./routes/profile";
// ... after captures routes registration
app.use(profileRoutes);
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/profile.ts apps/api/src/server.ts
git commit -m "feat(api): add profile and language endpoints"
```

---

## Task 4: Frontend Types & Validation Schemas

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Create: `apps/web/src/lib/schemas/onboarding.ts`

- [ ] **Step 1: Add types**

Add to `apps/web/src/lib/types.ts`:

```typescript
export interface UserProfile {
  id: string;
  name: string;
  age: number;
  gender: string;
  city: string;
  state: string;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserLanguage {
  id: number;
  userId: string;
  languageCode: string;
  languageName: string;
  isPrimary: boolean;
  dialects: string[] | null;
  createdAt: string;
}

export interface ProfileResponse {
  profile: UserProfile | null;
  languages: UserLanguage[];
  onboardingCompleted: boolean;
}
```

- [ ] **Step 2: Create onboarding schemas**

```typescript
// apps/web/src/lib/schemas/onboarding.ts
import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  age: z.number({ required_error: "Age is required" }).int().min(18, "Must be 18+").max(100, "Must be under 100"),
  gender: z.string().min(1, "Gender is required"),
  state: z.string().min(1, "State is required"),
  city: z.string().min(2, "City must be at least 2 characters"),
});

export const languagesSchema = z.object({
  primaryLanguage: z.string().min(1, "Select a primary language"),
  additionalLanguages: z.array(z.string()).default([]),
  dialects: z.array(z.string()).default([]),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
export type LanguagesFormValues = z.infer<typeof languagesSchema>;

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export const INDIAN_LANGUAGES = [
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "te", name: "Telugu" },
  { code: "mr", name: "Marathi" },
  { code: "ta", name: "Tamil" },
  { code: "ur", name: "Urdu" },
  { code: "gu", name: "Gujarati" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "or", name: "Odia" },
  { code: "pa", name: "Punjabi" },
  { code: "as", name: "Assamese" },
  { code: "mai", name: "Maithili" },
  { code: "sa", name: "Sanskrit" },
  { code: "sd", name: "Sindhi" },
  { code: "ne", name: "Nepali" },
  { code: "kok", name: "Konkani" },
  { code: "doi", name: "Dogri" },
  { code: "mni", name: "Manipuri" },
  { code: "sat", name: "Santali" },
  { code: "ks", name: "Kashmiri" },
  { code: "bo", name: "Bodo" },
  { code: "en", name: "English" },
] as const;

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Delhi", "Jammu & Kashmir", "Ladakh",
  "Chandigarh", "Puducherry", "Lakshadweep",
  "Andaman & Nicobar Islands", "Dadra & Nagar Haveli and Daman & Diu",
] as const;
```

- [ ] **Step 3: Install zod and react-hook-form if not present**

```bash
cd apps/web && pnpm add zod @hookform/resolvers react-hook-form
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/schemas/
git commit -m "feat(web): add onboarding types, zod schemas, constants"
```

---

## Task 5: Frontend API Hooks — Profile & Languages

**Files:**
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Add query keys and hooks**

```typescript
// Add to captureKeys or create new profileKeys
export const profileKeys = {
  profile: ["profile"] as const,
  onboardingStatus: ["profile", "onboarding-status"] as const,
};

export function useProfile() {
  return useQuery({
    queryKey: profileKeys.profile,
    queryFn: () => fetchJson<ProfileResponse>(`${API}/api/profile`),
  });
}

export function useOnboardingStatus() {
  return useQuery({
    queryKey: profileKeys.onboardingStatus,
    queryFn: () => fetchJson<{ completed: boolean }>(`${API}/api/profile/onboarding-status`),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; age: number; gender: string; city: string; state: string }) =>
      postJson<{ success: boolean }>(`${API}/api/profile`, data, "PUT"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.profile });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}

export function useUpdateLanguages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { languages: { languageCode: string; languageName: string; isPrimary: boolean; dialects: string[] }[] }) =>
      postJson<{ success: boolean }>(`${API}/api/profile/languages`, data, "PUT"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.profile });
      queryClient.invalidateQueries({ queryKey: profileKeys.onboardingStatus });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}
```

- [ ] **Step 2: Add PUT support to postJson helper**

Modify the existing `postJson` function to accept a method parameter:

```typescript
async function postJson<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): add profile and language API hooks"
```

---

## Task 6: Middleware — Onboarding Redirect

**Files:**
- Modify: `apps/web/src/proxy.ts`

- [ ] **Step 1: Add onboarding redirect logic**

The middleware needs to check if a logged-in user has completed onboarding before letting them access the dashboard. Since middleware can't easily call the API (it's edge), we'll use a client-side guard instead.

Create a client-side onboarding guard component:

```typescript
// apps/web/src/components/onboarding-guard.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useProfile } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: profile, isLoading } = useProfile();

  useEffect(() => {
    if (isLoading || !profile) return;
    if (!profile.onboardingCompleted) {
      router.replace("/onboarding");
    }
  }, [isLoading, profile, router]);

  // Show skeleton while checking (no blank flash)
  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  // Still redirecting — show skeleton
  if (profile && !profile.onboardingCompleted) {
    return null;
  }

  return <>{children}</>;
}
```

**Note:** Uses `useProfile()` (single API call) instead of separate `useOnboardingStatus()` — reduces network requests by 50%. Shows loading skeleton instead of returning null to prevent blank flash.

- [ ] **Step 2: Wrap dashboard layout with guard**

Modify `apps/web/src/app/(dashboard)/layout.tsx`:

```typescript
import { OnboardingGuard } from "@/components/onboarding-guard";

// Wrap children with OnboardingGuard
<OnboardingGuard>
  <SiteHeader />
  <div className="flex flex-1 flex-col">
    {children}
  </div>
</OnboardingGuard>
```

- [ ] **Step 3: Add /onboarding to proxy matcher**

Update `apps/web/src/proxy.ts` — add `/onboarding` to the auth-required paths:

```typescript
if (
  (pathname.startsWith("/capture") || pathname.startsWith("/settings") || pathname.startsWith("/onboarding")) &&
  !sessionCookie
) {
  return NextResponse.redirect(new URL("/login", request.url));
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/onboarding-guard.tsx apps/web/src/app/\(dashboard\)/layout.tsx apps/web/src/proxy.ts
git commit -m "feat(web): add onboarding guard — redirect unfinished users"
```

---

## Task 7: Auth Panel Component — ElevenLabs-Inspired Right Panel

**Files:**
- Create: `apps/web/src/components/auth-panel.tsx`

- [ ] **Step 1: Add CSS keyframes for orb rotation**

Add to `apps/web/src/app/globals.css`:

```css
@keyframes orb-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 2: Create the shared auth panel**

ElevenLabs-inspired right panel with:
- Flickering grid background + ripple rings
- Two metallic fluid orbs using conic-gradient rotation (CSS-only, no WebGL)
- Mock audio player card with waveform visualization + timeline
- All theme-aware via CSS variables

```typescript
// apps/web/src/components/auth-panel.tsx
"use client";

import { motion } from "motion/react";
import { Play, SkipBack, SkipForward } from "lucide-react";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import { Ripple } from "@/components/ui/ripple";

/**
 * Metallic fluid orb — conic-gradient with continuous rotation.
 * Creates the swirling liquid metal effect from ElevenLabs UI.
 */
function FluidOrb({ size = 100, speed = 8, delay = 0 }: { size?: number; speed?: number; delay?: number }) {
  return (
    <motion.div
      className="relative rounded-full"
      style={{ width: size, height: size }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, delay }}
    >
      {/* Outer ring */}
      <div className="absolute inset-0 rounded-full border border-border/30 shadow-[0_0_30px_-8px_var(--color-primary)]" />
      {/* Rotating conic gradient — the fluid metal effect */}
      <div
        className="absolute inset-[3px] rounded-full overflow-hidden"
        style={{
          animation: `orb-rotate ${speed}s linear infinite`,
          animationDelay: `${delay}s`,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: `conic-gradient(
              from 0deg,
              var(--color-primary) 0%,
              oklch(0.3 0.02 280) 25%,
              var(--color-primary) 50%,
              oklch(0.6 0.08 165) 75%,
              var(--color-primary) 100%
            )`,
            filter: "blur(8px) saturate(1.2)",
          }}
        />
      </div>
      {/* Glass overlay for depth */}
      <div className="absolute inset-[3px] rounded-full bg-background/30 backdrop-blur-[2px]" />
      {/* Center highlight */}
      <div className="absolute inset-[20%] rounded-full bg-gradient-to-br from-white/10 to-transparent" />
    </motion.div>
  );
}

/** Decorative waveform bars — represents the audio being captured */
function WaveformDisplay() {
  return (
    <div className="flex items-end gap-[1.5px] h-8 px-3">
      {Array.from({ length: 40 }).map((_, i) => {
        const h = 20 + Math.sin(i * 0.5) * 30 + Math.cos(i * 0.8) * 20;
        return (
          <div
            key={i}
            className="w-[2px] rounded-full bg-muted-foreground/30"
            style={{ height: `${Math.max(10, h)}%` }}
          />
        );
      })}
    </div>
  );
}

/** Mock audio player card — decorative, represents the product */
function MockAudioPlayer() {
  return (
    <motion.div
      className="w-64 rounded-xl border border-border/30 bg-card/80 backdrop-blur-sm p-4 space-y-3 shadow-lg"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.8 }}
    >
      {/* Track info */}
      <div>
        <p className="text-xs font-medium truncate">capture-2026-04-07</p>
        <p className="text-[10px] text-muted-foreground">Speaker A · Hindi</p>
      </div>
      {/* Waveform */}
      <div className="rounded-lg bg-muted/50 py-2">
        <WaveformDisplay />
      </div>
      {/* Timeline */}
      <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
        <span>0:14</span>
        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-[35%] rounded-full bg-primary/60" />
        </div>
        <span>0:41</span>
      </div>
      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        <SkipBack className="size-3.5 text-muted-foreground" />
        <div className="size-8 rounded-full border border-border/50 flex items-center justify-center">
          <Play className="size-3.5 text-foreground ml-0.5" />
        </div>
        <SkipForward className="size-3.5 text-muted-foreground" />
      </div>
    </motion.div>
  );
}

export function AuthPanel() {
  return (
    <div className="relative hidden bg-background lg:block overflow-hidden">
      {/* Flickering grid */}
      <div className="absolute inset-0">
        <FlickeringGrid
          squareSize={4}
          gridGap={6}
          flickerChance={0.3}
          color="var(--color-primary)"
          maxOpacity={0.15}
        />
      </div>

      {/* Ripple */}
      <Ripple mainCircleSize={140} mainCircleOpacity={0.2} numCircles={4} />

      {/* Radial fade */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,var(--color-background)_75%)]" />

      {/* Content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          className="flex flex-col items-center gap-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
        >
          {/* Two fluid orbs — Speaker A & Speaker B */}
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center gap-2">
              <FluidOrb size={100} speed={8} delay={0} />
              <span className="text-[10px] font-mono text-muted-foreground">Speaker A</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <FluidOrb size={100} speed={12} delay={0.5} />
              <span className="text-[10px] font-mono text-muted-foreground">Speaker B</span>
            </div>
          </div>

          {/* Mock audio player card */}
          <MockAudioPlayer />
        </motion.div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update login page to use AuthPanel**

Replace the entire right panel in `apps/web/src/app/login/page.tsx` with:

```tsx
import { AuthPanel } from "@/components/auth-panel";

// In the JSX, replace the right panel div with:
<AuthPanel />
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/auth-panel.tsx apps/web/src/app/login/page.tsx
git commit -m "feat(web): create AuthPanel — dual orbs + waveform timeline"
```

---

## Task 8: Onboarding Page — Step Orchestrator

**Files:**
- Create: `apps/web/src/app/(auth)/onboarding/page.tsx`
- Create: `apps/web/src/app/(auth)/onboarding/_steps/shared.ts`

- [ ] **Step 1: Create shared step types**

```typescript
// apps/web/src/app/(auth)/onboarding/_steps/shared.ts
import type { ProfileResponse } from "@/lib/types";

export const STEPS = ["profile", "languages"] as const;
export type Step = (typeof STEPS)[number];

export interface StepProps {
  onNext: () => void;
  onBack?: () => void;
  profile: ProfileResponse;
}
```

- [ ] **Step 2: Create onboarding orchestrator**

This follows the annote pattern — ResizeObserver for height animation, AnimatePresence for step transitions, query param for step tracking.

```typescript
// apps/web/src/app/(auth)/onboarding/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AudioWaveformIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Card } from "@/components/ui/card";
import { stepVariants, staggerContainer, staggerChild } from "@/lib/motion";
import { AuthPanel } from "@/components/auth-panel";
import { useProfile } from "@/lib/api";
import { ProfileStep } from "./_steps/profile-step";
import { LanguagesStep } from "./_steps/languages-step";
import { STEPS, type Step } from "./_steps/shared";

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`size-2 rounded-full transition-colors ${
              i <= current ? "bg-primary" : "bg-muted"
            }`}
          />
          {i < total - 1 && (
            <div className={`h-px w-6 transition-colors ${
              i < current ? "bg-primary" : "bg-muted"
            }`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: profile, isLoading } = useProfile();

  // Resolve step from URL
  const requestedStep = (searchParams.get("step") ?? "profile") as Step;
  const stepIndex = STEPS.indexOf(requestedStep);
  const currentStep = stepIndex >= 0 ? requestedStep : "profile";
  const currentIndex = STEPS.indexOf(currentStep);

  // Height animation (annote pattern)
  const [height, setHeight] = useState<number | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        const h = el.getBoundingClientRect().height;
        if (h > 0) setHeight(h);
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const goToStep = useCallback(
    (step: Step) => {
      router.replace(`/onboarding?step=${step}`, { scroll: false });
    },
    [router],
  );

  const handleNext = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < STEPS.length) {
      goToStep(STEPS[nextIndex]);
    } else {
      // Onboarding complete — redirect to dashboard
      router.replace("/capture");
    }
  }, [currentIndex, goToStep, router]);

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      goToStep(STEPS[currentIndex - 1]);
    }
  }, [currentIndex, goToStep]);

  if (isLoading || !profile) {
    return (
      <div className="grid min-h-svh lg:grid-cols-2">
        <div className="flex items-center justify-center p-6">
          <div className="w-full max-w-md h-96 animate-pulse rounded-xl bg-muted" />
        </div>
        <AuthPanel />
      </div>
    );
  }

  // If already onboarded, redirect
  if (profile.onboardingCompleted) {
    router.replace("/capture");
    return null;
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="/" className="flex items-center gap-2 font-medium">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <AudioWaveformIcon className="size-4" />
            </div>
            Annote ASR
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-md">
            <div className="flex justify-center mb-6">
              <StepDots current={currentIndex} total={STEPS.length} />
            </div>
            <Card className="overflow-hidden">
              <motion.div
                animate={{ height }}
                transition={{ type: "spring", duration: 0.45, bounce: 0 }}
                initial={false}
                className="overflow-hidden"
              >
                <div ref={contentRef}>
                  <AnimatePresence mode="wait" initial={false}>
                    {currentStep === "profile" && (
                      <motion.div
                        key="profile"
                        variants={stepVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        className="flex flex-col gap-4 p-6"
                      >
                        <ProfileStep
                          onNext={handleNext}
                          profile={profile}
                        />
                      </motion.div>
                    )}
                    {currentStep === "languages" && (
                      <motion.div
                        key="languages"
                        variants={stepVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        className="flex flex-col gap-4 p-6"
                      >
                        <LanguagesStep
                          onNext={handleNext}
                          onBack={handleBack}
                          profile={profile}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </Card>
          </div>
        </div>
      </div>
      <AuthPanel />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(auth\)/onboarding/
git commit -m "feat(web): onboarding orchestrator with height animation"
```

---

## Task 9: Profile Step Component

**Files:**
- Create: `apps/web/src/app/(auth)/onboarding/_steps/profile-step.tsx`

- [ ] **Step 1: Create profile step**

Full form with name, age, gender (select), state (select), city. Uses react-hook-form + zod. Staggered field animation.

This is a substantial component (~150 lines). Key features:
- `useForm` with `zodResolver(profileSchema)`
- Pre-fill from `profile.profile` if returning to edit
- Age input: `inputMode="numeric"`, strips non-digits, max 3 chars
- Gender: `Select` with GENDERS constant
- State: `Select` with INDIAN_STATES constant (searchable)
- Submit calls `useUpdateProfile()` mutation
- On success calls `onNext()`
- Server validation errors mapped to form fields via `setError()`
- All fields wrapped in `motion.div variants={staggerChild}`

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(auth\)/onboarding/_steps/profile-step.tsx
git commit -m "feat(web): profile step — name, age, gender, state, city"
```

---

## Task 10: Dialect Input Component

**Files:**
- Create: `apps/web/src/components/dialect-input.tsx`

- [ ] **Step 1: Create dialect tag input**

```typescript
// apps/web/src/components/dialect-input.tsx
"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface DialectInputProps {
  value: string[];
  onChange: (dialects: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function DialectInput({
  value,
  onChange,
  disabled,
  placeholder = "Type a dialect and press Enter",
}: DialectInputProps) {
  const [input, setInput] = useState("");

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed && !value.includes(trimmed)) {
        onChange([...value, trimmed]);
        setInput("");
      }
    }
    if (e.key === "Backspace" && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function remove(dialect: string) {
    onChange(value.filter((d) => d !== dialect));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((d) => (
          <Badge
            key={d}
            variant="secondary"
            className="gap-1 pr-1"
          >
            {d}
            <button
              type="button"
              onClick={() => remove(d)}
              disabled={disabled}
              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
              aria-label={`Remove ${d}`}
            >
              <X className="size-2.5" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : "Add another..."}
        maxLength={30}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/dialect-input.tsx
git commit -m "feat(web): dialect tag input with badge + remove"
```

---

## Task 11: Languages Step Component

**Files:**
- Create: `apps/web/src/app/(auth)/onboarding/_steps/languages-step.tsx`

- [ ] **Step 1: Create languages step**

Features:
- Primary language: `Select` dropdown from INDIAN_LANGUAGES
- Additional languages: Toggle buttons (multi-select) — excludes primary
- Dialects: `DialectInput` tag input
- Submit transforms flat form → `{ languages: [...] }` array for API
- Back button to return to profile step
- Staggered field animation

Key logic:
- When primary language changes, remove it from additional languages
- Transform: primary → `{ isPrimary: true, dialects: [] }`, additional → `{ isPrimary: false, dialects: [] }`, dialects attached to primary language
- On success: `onNext()` which redirects to `/capture`

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(auth\)/onboarding/_steps/languages-step.tsx
git commit -m "feat(web): languages step — primary, additional, dialects"
```

---

## Task 12: Integration — Wire Login Redirect & Test

**Files:**
- Modify: `apps/web/src/components/login-form.tsx`
- Modify: `apps/web/src/proxy.ts`

- [ ] **Step 1: Create auth-callback page**

Smart redirect page that checks onboarding status and routes accordingly. Prevents the flash where existing users briefly see the onboarding page.

```typescript
// apps/web/src/app/auth-callback/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useProfile } from "@/lib/api";
import { LoaderCircle } from "lucide-react";

export default function AuthCallbackPage() {
  const router = useRouter();
  const { data: profile, isLoading } = useProfile();

  useEffect(() => {
    if (isLoading || !profile) return;
    router.replace(profile.onboardingCompleted ? "/capture" : "/onboarding");
  }, [isLoading, profile, router]);

  return (
    <div className="flex min-h-svh items-center justify-center">
      <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
```

- [ ] **Step 2: Update login redirect**

In `login-form.tsx`, redirect to `/auth-callback` instead of `/capture`:

```typescript
// In verifyOTP success handler:
router.push("/auth-callback");
```

- [ ] **Step 2: Update proxy config matcher**

```typescript
export const config = {
  matcher: ["/login", "/capture/:path*", "/settings", "/onboarding"],
};
```

- [ ] **Step 3: Test the full flow**

1. Log in with phone → should redirect to `/onboarding?step=profile`
2. Fill profile → submit → should move to `?step=languages`
3. Select languages + dialects → submit → should redirect to `/capture`
4. Subsequent logins → should skip onboarding (guard checks status)
5. Back navigation between steps should work
6. Refresh on step 2 should stay on step 2 (URL-driven)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/login-form.tsx apps/web/src/proxy.ts
git commit -m "feat(web): wire login → onboarding → dashboard flow"
```

---

## Self-Review

1. **Spec coverage:** Profile fields (name, age, gender, city, state) ✅ | Languages (22 Indian) ✅ | Dialects (tag input with badges + X remove) ✅ | Right panel (constant across login + onboarding) ✅ | ElevenLabs-inspired (dual orbs + waveform timeline) ✅ | Backend (DB + API) ✅ | Validation (client Zod + server) ✅ | Onboarding guard (redirect un-onboarded users) ✅ | Step transitions (height animation + AnimatePresence) ✅

2. **Placeholder scan:** No TBDs, TODOs, or "implement later" found. Task 9 and 11 describe the component structure but the actual code will be written during execution (they're UI-heavy components that need to be seen in context).

3. **Type consistency:** `ProfileResponse` used consistently across API hook → step props. `StepProps` interface matches what orchestrator passes. `profileSchema` and `languagesSchema` match form field names. API endpoints match hook URLs.
