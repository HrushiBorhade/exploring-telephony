import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
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
        // Fire-and-forget — do NOT await to prevent timing leaks
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
      expiresIn: 300,
      signUpOnVerification: {
        getTempEmail: (phone) =>
          `${phone.replace(/[^0-9]/g, "")}@voice-capture.local`,
        getTempName: (phone) => phone,
      },
    }),
    nextCookies(),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
});

export type Session = typeof auth.$Infer.Session;
