# AuthKey WhatsApp OTP Integration

## Summary

Replace the dev-mode `console.log` in better-auth's `sendOTP` callback with an actual AuthKey WhatsApp API call to deliver OTP codes via WhatsApp.

## Scope

**Single file change:** `apps/web/src/lib/auth.ts` — the `sendOTP` callback (lines 19-24).

No new files, no new dependencies, no schema changes, no frontend changes.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AUTHKEY_API_KEY` | AuthKey portal authentication key (used as Basic auth) |
| `AUTHKEY_WID` | WhatsApp template ID for OTP messages |

Added to `apps/web/.env.local`. Existing Telnyx vars retained for future SMS fallback.

## AuthKey API Contract

**Endpoint:** `POST https://console.authkey.io/restapi/requestjson.php`

**Headers:**
- `Authorization: Basic <AUTHKEY_API_KEY>`
- `Content-Type: application/json`

**Body:**
```json
{
  "country_code": "91",
  "mobile": "9876543210",
  "wid": "<AUTHKEY_WID>",
  "type": "text",
  "bodyValues": { "var1": "<otp_code>" }
}
```

**Template:** Single variable (`var1` = OTP code). Message like: "Your OTP for Annote ASR Platform is {#otp#}. Valid for 5 minutes. Do not share this code."

## Phone Number Parsing

Input from better-auth: E.164 format `+919876543210`
- Strip `+91` prefix to extract 10-digit mobile number
- Country code hardcoded to `"91"` (India-only user base)
- Validation: ensure remaining number is exactly 10 digits

## Error Handling Strategy

| Scenario | Behavior |
|----------|----------|
| `AUTHKEY_API_KEY` not set | Fall back to `console.log` (dev mode) |
| `AUTHKEY_WID` not set | Fall back to `console.log` (dev mode) |
| Network error (fetch fails) | Throw error — surfaces to client via better-auth |
| Non-2xx response from AuthKey | Throw error with status + response body for debugging |
| Invalid phone format | Throw error before API call |
| Production with missing env vars | Log warning + throw (should not silently fail) |

## Implementation Detail

```typescript
sendOTP: async ({ phoneNumber: phone, code }) => {
  const apiKey = process.env.AUTHKEY_API_KEY;
  const wid = process.env.AUTHKEY_WID;

  // Dev fallback: log OTP if AuthKey not configured
  if (!apiKey || !wid) {
    console.log(`[DEV OTP] Phone: ${phone}, Code: ${code}`);
    return;
  }

  // Parse E.164 phone number (+91XXXXXXXXXX → XXXXXXXXXX)
  const mobile = phone.replace(/^\+91/, "");
  if (!/^\d{10}$/.test(mobile)) {
    throw new Error(`Invalid phone number format: ${phone}`);
  }

  const response = await fetch(
    "https://console.authkey.io/restapi/requestjson.php",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        country_code: "91",
        mobile,
        wid,
        type: "text",
        bodyValues: { var1: code },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error(`[AuthKey] Failed to send OTP: ${response.status}`, body);
    throw new Error("Failed to send OTP via WhatsApp");
  }
}
```

## What Does NOT Change

- Frontend login page (`apps/web/src/app/login/page.tsx`) — no changes
- Database schema — no changes
- Auth client config — no changes
- Express middleware — no changes
- OTP length (6), expiry (300s), sign-up behavior — all unchanged
- Telnyx environment variables — retained

## Post-Implementation

User adds `AUTHKEY_API_KEY` and `AUTHKEY_WID` to `apps/web/.env.local`.
