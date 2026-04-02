import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@repo/db";
import { user, session, account, verification } from "@repo/db";

export const auth = betterAuth({
  trustedOrigins: [
    process.env.BETTER_AUTH_URL || "http://localhost:3002",
    "http://localhost:3001",
  ],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber: phone, code }) => {
        // DEV MODE: log OTP to console (Telnyx international SMS not yet enabled)
        console.log(`\n[DEV OTP] ================================`);
        console.log(`[DEV OTP] Phone : ${phone}`);
        console.log(`[DEV OTP] Code  : ${code}`);
        console.log(`[DEV OTP] ================================\n`);
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
