# Phone Number Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add phone-number-only login (OTP via Telnyx SMS) using Better Auth so captures are scoped per user and Phone A auto-fills from the logged-in user's phone number.

**Architecture:** Better Auth lives in `apps/web` (Next.js 16). Session is stored in an HTTP-only cookie. Express API validates sessions by querying the session token directly from the shared PostgreSQL DB — no auth package needed on the API side. `proxy.ts` (Next.js 16 convention) protects `/capture` routes.

**Tech Stack:** better-auth, better-auth/plugins (phoneNumber), better-auth/adapters/drizzle, shadcn InputOTP, Telnyx SMS API

---

## File Map

**Create:**
- `apps/web/src/lib/auth.ts` — Better Auth server instance
- `apps/web/src/lib/auth-client.ts` — Client-side Better Auth hooks/mutations
- `apps/web/src/app/api/auth/[...all]/route.ts` — Better Auth Next.js handler (intercepts before rewrite)
- `apps/web/src/app/login/page.tsx` — 2-step login UI: phone → 6-digit OTP
- `apps/web/src/proxy.ts` — Next.js 16 route protection (NOT middleware.ts)
- `apps/api/src/middleware/auth.ts` — Express session validation against DB

**Modify:**
- `packages/db/src/schema.ts` — Add Better Auth tables + `userId` on captures
- `packages/db/src/queries.ts` — Add `listCapturesByUser`, `getSessionByToken`
- `apps/web/src/lib/types.ts` — Add `userId` to `Capture` interface
- `apps/web/package.json` — Add `better-auth`, `@repo/db`
- `apps/api/package.json` — No new deps needed
- `apps/api/src/server.ts` — Apply auth middleware, scope captures to user, auto-fill phoneA
- `apps/web/src/app/capture/page.tsx` — Remove phoneA input, add sign-out
- `apps/web/src/lib/api.ts` — Remove `phoneA` from `useCreateCapture` input type

---

## Task 1: Install Dependencies

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Install better-auth in the web app**

```bash
cd /Users/hrushiborhade/Developer/exploring-telephony/apps/web
pnpm add better-auth
```

- [ ] **Step 2: Add @repo/db to web app dependencies**

Open `apps/web/package.json`. Add to `"dependencies"`:

```json
"@repo/db": "workspace:*",
```

Then run from repo root:
```bash
cd /Users/hrushiborhade/Developer/exploring-telephony
pnpm install
```

Expected: no errors, `@repo/db` resolves to `packages/db`.

- [ ] **Step 3: Install shadcn InputOTP component**

```bash
cd /Users/hrushiborhade/Developer/exploring-telephony/apps/web
npx shadcn@latest add input-otp -y
```

Expected: `apps/web/src/components/ui/input-otp.tsx` created.

- [ ] **Step 4: Install cookie-parser in the API**

```bash
cd /Users/hrushiborhade/Developer/exploring-telephony/apps/api
pnpm add cookie-parser
pnpm add -D @types/cookie-parser
```

- [ ] **Step 5: Commit**

```bash
cd /Users/hrushiborhade/Developer/exploring-telephony
git add apps/web/package.json apps/api/package.json apps/web/src/components/ui/input-otp.tsx pnpm-lock.yaml
git commit -m "chore: add better-auth, input-otp, cookie-parser dependencies"
```

---

## Task 2: DB Schema — Add Better Auth Tables + userId on Captures

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/queries.ts`
- Modify: `apps/web/src/lib/types.ts`

- [ ] **Step 1: Replace schema.ts with updated version**

Open `packages/db/src/schema.ts`. Replace the entire file with:

```typescript
import {
  pgTable,
  text,
  boolean,
  timestamp,
  varchar,
  integer,
} from "drizzle-orm/pg-core";

// ── Better Auth tables ────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  phoneNumber: text("phone_number").unique(),
  phoneNumberVerified: boolean("phone_number_verified").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Captures ──────────────────────────────────────────────────────────

export const captures = pgTable("captures_v2", {
  id: varchar("id", { length: 12 }).primaryKey(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  phoneA: varchar("phone_a", { length: 20 }).notNull(),
  phoneB: varchar("phone_b", { length: 20 }).notNull(),
  language: varchar("language", { length: 10 }).notNull().default("en"),
  status: varchar("status", { length: 20 }).notNull().default("created"),
  roomName: varchar("room_name", { length: 100 }),
  egressId: varchar("egress_id", { length: 50 }),
  recordingUrl: text("recording_url"),
  recordingUrlA: text("recording_url_a"),
  recordingUrlB: text("recording_url_b"),
  localRecordingPath: text("local_recording_path"),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});
```

- [ ] **Step 2: Add listCapturesByUser to queries.ts**

Open `packages/db/src/queries.ts`. Add these two functions (keep all existing functions):

```typescript
import { eq, and, gt } from "drizzle-orm";
import * as schema from "./schema";

export async function listCapturesByUser(userId: string) {
  return db
    .select()
    .from(schema.captures)
    .where(eq(schema.captures.userId, userId))
    .orderBy(schema.captures.createdAt);
}

export async function getSessionByToken(token: string) {
  const [row] = await db
    .select({
      userId: schema.session.userId,
      phoneNumber: schema.user.phoneNumber,
      expiresAt: schema.session.expiresAt,
    })
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
    .where(
      and(
        eq(schema.session.token, token),
        gt(schema.session.expiresAt, new Date())
      )
    )
    .limit(1);
  return row ?? null;
}
```

- [ ] **Step 3: Add userId to Capture type**

Open `apps/web/src/lib/types.ts`. Add `userId` field:

```typescript
export interface Capture {
  id: string;
  userId?: string;   // ← ADD THIS
  name: string;
  phoneA: string;
  phoneB: string;
  language: string;
  status: "created" | "calling" | "active" | "ended" | "completed";
  roomName?: string;
  recordingUrl?: string;
  recordingUrlA?: string;
  recordingUrlB?: string;
  localRecordingPath?: string;
  durationSeconds?: number;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
}
```

- [ ] **Step 4: Generate and apply the migration**

```bash
cd /Users/hrushiborhade/Developer/exploring-telephony
DATABASE_URL="<your-db-url>" npx drizzle-kit generate
DATABASE_URL="<your-db-url>" npx drizzle-kit migrate
```

Expected output: migration file created in `./drizzle/`, tables `user`, `session`, `account`, `verification` created, `user_id` column added to `captures_v2`.

Verify:
```bash
psql $DATABASE_URL -c "\dt"
```

Expected: lists `user`, `session`, `account`, `verification`, `captures_v2`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/queries.ts apps/web/src/lib/types.ts drizzle/
git commit -m "feat: add Better Auth tables and userId column to captures schema"
```

---

## Task 3: Better Auth Server Instance

**Files:**
- Create: `apps/web/src/lib/auth.ts`

- [ ] **Step 1: Create auth.ts**

Create `apps/web/src/lib/auth.ts`:

```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber, nextCookies } from "better-auth/plugins";
import { db } from "@repo/db";
import { user, session, account, verification } from "@repo/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber: phone, code }) => {
        // Fire-and-forget — do NOT await in serverless to prevent timing leaks
        fetch("https://api.telnyx.com/v2/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
          },
          body: JSON.stringify({
            from: process.env.TELNYX_FROM_NUMBER,
            to: phone,
            text: `Your Voice Capture code: ${code}. Valid for 5 minutes.`,
          }),
        }).catch((err) => console.error("[auth] SMS send failed:", err));
      },
      otpLength: 6,
      expiresIn: 300, // 5 minutes
      signUpOnVerification: {
        // Phone-only auth — Better Auth requires an email; use a synthetic one
        getTempEmail: (phone) =>
          `${phone.replace(/[^0-9]/g, "")}@voice-capture.local`,
        getTempName: (phone) => phone,
      },
    }),
    nextCookies(), // required for Server Actions + Route Handlers to write cookies
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,       // refresh session expiry daily
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
});

export type Session = typeof auth.$Infer.Session;
```

- [ ] **Step 2: Add env vars to apps/web/.env.local**

Create or edit `apps/web/.env.local`:

```bash
BETTER_AUTH_SECRET=<run: openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=<same postgresql:// URL used by apps/api>
TELNYX_API_KEY=<same TELNYX_API_KEY from apps/api>
TELNYX_FROM_NUMBER=<E.164 SMS-capable Telnyx number, e.g. +12025550100>
```

`TELNYX_FROM_NUMBER` must be an SMS-capable number on your Telnyx account (check Telnyx portal → Numbers → filter by SMS capability).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/auth.ts
git commit -m "feat: add Better Auth server instance with Telnyx phone OTP"
```

---

## Task 4: Auth Client + Better Auth API Route

**Files:**
- Create: `apps/web/src/lib/auth-client.ts`
- Create: `apps/web/src/app/api/auth/[...all]/route.ts`

- [ ] **Step 1: Create auth-client.ts**

Create `apps/web/src/lib/auth-client.ts`:

```typescript
import { createAuthClient } from "better-auth/react";
import { phoneNumberClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  plugins: [phoneNumberClient()],
});

// Named exports for convenience in components
export const { useSession, signOut } = authClient;
```

- [ ] **Step 2: Create Better Auth Next.js route handler**

Create `apps/web/src/app/api/auth/[...all]/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

This file is a filesystem match so Next.js serves it directly — it is **not** forwarded to the Express rewrite. `/api/auth/*` → Next.js, `/api/captures/*` → Express. No change to `next.config.ts` needed.

- [ ] **Step 3: Verify Better Auth API is reachable**

Start the dev server:
```bash
cd /Users/hrushiborhade/Developer/exploring-telephony/apps/web
pnpm dev
```

```bash
curl http://localhost:3000/api/auth/get-session
```

Expected response: `{"session":null}`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/auth-client.ts apps/web/src/app/api/auth/
git commit -m "feat: add Better Auth client and Next.js route handler"
```

---

## Task 5: Login Page

**Files:**
- Create: `apps/web/src/app/login/page.tsx`

- [ ] **Step 1: Create login/page.tsx**

Create `apps/web/src/app/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";

type Step = "phone" | "otp";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendOTP() {
    if (!phone.startsWith("+") || phone.length < 10) {
      toast.error("Use E.164 format: +91XXXXXXXXXX");
      return;
    }
    setLoading(true);
    const { error } = await authClient.phoneNumber.sendOtp({
      phoneNumber: phone,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Failed to send code");
      return;
    }
    toast.success("Code sent!");
    setStep("otp");
  }

  async function verifyOTP(code: string) {
    if (code.length !== 6) return;
    setLoading(true);
    const { error } = await authClient.phoneNumber.verify({
      phoneNumber: phone,
      code,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Invalid code");
      setOtp("");
      return;
    }
    router.push("/capture");
  }

  function handleOTPChange(value: string) {
    setOtp(value);
    if (value.length === 6) verifyOTP(value);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground mx-auto">
            <Phone className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold">Voice Capture</h1>
          <p className="text-sm text-muted-foreground">
            {step === "phone"
              ? "Enter your phone number to sign in"
              : `Enter the 6-digit code sent to ${phone}`}
          </p>
        </div>

        {step === "phone" && (
          <div className="space-y-3">
            <Input
              type="tel"
              placeholder="+91XXXXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendOTP()}
              disabled={loading}
              className="text-center font-mono tracking-widest"
              autoFocus
            />
            <Button className="w-full" onClick={sendOTP} disabled={loading || phone.length < 10}>
              {loading ? (
                <><LoaderCircle className="size-4 animate-spin" /> Sending...</>
              ) : (
                "Send Code"
              )}
            </Button>
          </div>
        )}

        {step === "otp" && (
          <div className="space-y-5">
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                value={otp}
                onChange={handleOTPChange}
                disabled={loading}
                autoFocus
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            {loading && (
              <div className="flex justify-center">
                <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => { setStep("phone"); setOtp(""); }}
              disabled={loading}
            >
              Change number
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Redirect root → /capture**

Open (or create) `apps/web/src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/capture");
}
```

- [ ] **Step 3: Test login page renders**

Open `http://localhost:3000/login`. Expected: Phone input with dark background, centered layout. Typing `+91` in the input and pressing Enter shows a loading spinner and then the OTP input.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/login/ apps/web/src/app/page.tsx
git commit -m "feat: add phone + OTP login page"
```

---

## Task 6: proxy.ts — Route Protection

**Files:**
- Create: `apps/web/src/proxy.ts`

Note: In Next.js 16, the file is `proxy.ts` (not `middleware.ts`) and exports `proxy` (not `middleware`). It lives at `apps/web/src/proxy.ts` because the project uses the `src/` directory.

- [ ] **Step 1: Create proxy.ts**

Create `apps/web/src/proxy.ts`:

```typescript
import { type NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);

  // Already logged in → skip the login page
  if (pathname === "/login" && sessionCookie) {
    return NextResponse.redirect(new URL("/capture", request.url));
  }

  // Not logged in → redirect to login
  if (pathname.startsWith("/capture") && !sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/capture/:path*"],
};
```

`getSessionCookie` checks cookie existence only — no DB call, very fast. The Express API does the real session validation against the DB on every data request.

- [ ] **Step 2: Verify protection**

With the dev server running:
```bash
# Should redirect to /login (no session)
curl -I http://localhost:3000/capture
```

Expected: `Location: /login`

```bash
# Login page should render (no session)
curl -I http://localhost:3000/login
```

Expected: `200 OK`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/proxy.ts
git commit -m "feat: add proxy.ts route protection for /capture routes"
```

---

## Task 7: Express Auth Middleware

**Files:**
- Create: `apps/api/src/middleware/auth.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Create the middleware**

Create `apps/api/src/middleware/auth.ts`:

```typescript
import { type Request, type Response, type NextFunction } from "express";
import { getSessionByToken } from "@repo/db";

export interface AuthRequest extends Request {
  userId?: string;
  userPhone?: string;
}

/** Parse a single named cookie from the raw Cookie header — no package needed */
function getSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    /(?:^|;\s*)better-auth\.session_token=([^;]+)/
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getSessionToken(req.headers.cookie);

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sess = await getSessionByToken(token);

  if (!sess) {
    res.status(401).json({ error: "Session expired or invalid" });
    return;
  }

  req.userId = sess.userId;
  req.userPhone = sess.phoneNumber ?? undefined;
  next();
}
```

- [ ] **Step 2: Import requireAuth in server.ts**

Open `apps/api/src/server.ts` and add the import:

```typescript
import { requireAuth, type AuthRequest } from "./middleware/auth";
```

No `cookieParser()` middleware needed — `req.headers.cookie` is always available in Node.js HTTP.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/server.ts
git commit -m "feat: add Express session validation middleware via DB lookup"
```

---

## Task 8: Scope Captures to Authenticated User

**Files:**
- Modify: `apps/api/src/server.ts`

Apply `requireAuth` to all capture routes and update logic to use userId/userPhone from the session.

- [ ] **Step 1: Update GET /api/captures**

Find `app.get("/api/captures", ...)` and replace signature + body:

```typescript
app.get("/api/captures", requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbCaptures = await dbq.listCapturesByUser(req.userId!);
    // Merge with in-memory active captures that belong to this user
    const merged = dbCaptures.map((row) => activeCaptures.get(row.id) ?? row);
    const inMemoryOnly = Array.from(activeCaptures.values()).filter(
      (c) => !dbCaptures.find((r) => r.id === c.id) && c.userId === req.userId
    );
    res.json([...merged, ...inMemoryOnly]);
  } catch {
    res.status(500).json({ error: "Failed to list captures" });
  }
});
```

- [ ] **Step 2: Update POST /api/captures**

Find `app.post("/api/captures", ...)`. Replace to remove `phoneA` from body and use session phone:

```typescript
app.post("/api/captures", requireAuth, async (req: AuthRequest, res) => {
  const { name, phoneB, language } = req.body;

  if (!phoneB) {
    res.status(400).json({ error: "phoneB is required" });
    return;
  }
  if (!req.userPhone) {
    res.status(400).json({ error: "No phone number on your account" });
    return;
  }

  const id = crypto.randomBytes(6).toString("hex");
  const roomName = `capture-${id}`;

  const capture = {
    id,
    userId: req.userId!,
    name: name || "",
    phoneA: req.userPhone,   // auto-filled from session
    phoneB,
    language: language || "en",
    status: "created" as const,
    roomName,
    createdAt: new Date().toISOString(),
  };

  activeCaptures.set(id, capture);
  await dbq.createCapture({
    id,
    userId: req.userId!,
    name: capture.name,
    phoneA: capture.phoneA,
    phoneB: capture.phoneB,
    language: capture.language,
    status: capture.status,
    roomName,
  });
  captureTotal.inc();
  res.json(capture);
});
```

- [ ] **Step 3: Add requireAuth + ownership check to GET /api/captures/:id**

Find `app.get("/api/captures/:id", ...)`:

```typescript
app.get("/api/captures/:id", requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const capture = activeCaptures.get(id) ?? (await dbq.getCapture(id));
  if (!capture) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (capture.userId && capture.userId !== req.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(capture);
});
```

- [ ] **Step 4: Add requireAuth to start + end endpoints**

Find `app.post("/api/captures/:id/start", ...)` and `app.post("/api/captures/:id/end", ...)`.

Add `requireAuth` as second argument to both and add the same ownership check at the top:

```typescript
app.post("/api/captures/:id/start", requireAuth, async (req: AuthRequest, res) => {
  const capture = activeCaptures.get(req.params.id);
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.userId && capture.userId !== req.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  // ... rest of existing handler unchanged ...
});

app.post("/api/captures/:id/end", requireAuth, async (req: AuthRequest, res) => {
  const capture = activeCaptures.get(req.params.id);
  if (!capture) { res.status(404).json({ error: "Not found" }); return; }
  if (capture.userId && capture.userId !== req.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  // ... rest of existing handler unchanged ...
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat: scope all capture routes to authenticated user, auto-fill phoneA"
```

---

## Task 9: Update Capture Dashboard UI

**Files:**
- Modify: `apps/web/src/app/capture/page.tsx`
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Remove phoneA from useCreateCapture**

Open `apps/web/src/lib/api.ts`. Find `useCreateCapture` and update the mutationFn type:

```typescript
export function useCreateCapture() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; phoneB: string; language: string }) =>
      postJson<Capture>(`${API}/api/captures`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: captureKeys.all });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });
}
```

- [ ] **Step 2: Update capture/page.tsx**

Open `apps/web/src/app/capture/page.tsx`. Make these four changes:

**a) Add signOut import:**
```typescript
import { signOut } from "@/lib/auth-client";
```

**b) Remove phoneA state (keep the rest):**
```typescript
// Remove:  const [phoneA, setPhoneA] = useState("");
const [name, setName] = useState("");
const [phoneB, setPhoneB] = useState("");
const [language, setLanguage] = useState("en");
```

**c) Update create() function:**
```typescript
async function create() {
  const result = await createMutation.mutateAsync({ name, phoneB, language });
  toast.success("Capture created");
  setOpen(false);
  setName(""); setPhoneB(""); setLanguage("en");
  router.push(`/capture/${result.id}`);
}
```

**d) In the dialog JSX, remove the Phone A input block entirely and update the submit button:**
```tsx
{/* Remove the entire Phone A block */}

{/* Keep Phone B: */}
<div className="space-y-1.5">
  <label className="text-sm font-medium">Phone B</label>
  <Input
    placeholder="+91XXXXXXXXXX"
    value={phoneB}
    onChange={(e) => setPhoneB(e.target.value)}
    disabled={creating}
  />
</div>

{/* Update button disabled condition: */}
<Button
  className="w-full"
  onClick={create}
  disabled={!phoneB || creating}
>
```

**e) Add sign-out button to the page header (next to the "New Capture" button):**
```tsx
<div className="flex items-center gap-2">
  <Button
    variant="ghost"
    size="sm"
    onClick={() =>
      signOut().then(() => { window.location.href = "/login"; })
    }
  >
    Sign out
  </Button>
  <Button onClick={() => setOpen(true)}>New Capture</Button>
</div>
```

- [ ] **Step 3: Test the full flow end-to-end**

1. Start both servers:
   ```bash
   # Terminal 1
   cd apps/api && pnpm dev
   # Terminal 2
   cd apps/web && pnpm dev
   ```

2. Open `http://localhost:3000` → redirects to `/login`
3. Enter your phone number (+91...) → receive SMS OTP via Telnyx
4. Enter 6-digit code → auto-submits → redirects to `/capture`
5. Click "New Capture" → dialog shows only Phone B field (no Phone A)
6. Create capture → capture appears in list
7. Click capture → detail page shows your number as Phone A
8. Sign out → redirects to `/login`

- [ ] **Step 4: Final commit**

```bash
git add apps/web/src/app/capture/page.tsx apps/web/src/lib/api.ts
git commit -m "feat: remove phoneA from create dialog, add sign-out button"
```

---

## Self-Review

**Spec coverage:**
- ✅ Phone number login via OTP
- ✅ Telnyx SMS delivery
- ✅ HTTP-only session cookies (Better Auth default)
- ✅ `useSession()` for client components (via `authClient`)
- ✅ `auth.api.getSession()` usable in server components via `await headers()`
- ✅ `proxy.ts` (Next.js 16) for route protection
- ✅ Phone A auto-filled from session in Express
- ✅ Captures scoped to userId
- ✅ shadcn InputOTP UI
- ✅ Sign-out support

**Type consistency:**
- `getSessionByToken` defined in Task 2, used in Task 7 ✅
- `listCapturesByUser(userId: string)` defined in Task 2, used in Task 8 ✅
- `AuthRequest.userId` and `AuthRequest.userPhone` defined in Task 7, used in Task 8 ✅
- `Capture.userId` added in Task 2, used in Task 8 filter ✅
