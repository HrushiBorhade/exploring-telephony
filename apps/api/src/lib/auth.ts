import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins";
import { db, user, session, account, verification } from "@repo/db";

const isProduction = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  baseURL: isProduction ? "https://asr-api.annoteapp.com" : "http://localhost:8080",
  basePath: "/api/auth",
  trustedOrigins: [
    process.env.FRONTEND_URL || "http://localhost:3000",
  ],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber: phone, code }) => {
        const apiKey = process.env.AUTHKEY_API_KEY;
        const wid = process.env.AUTHKEY_WID;

        if (!apiKey || !wid) {
          console.log(`\n[DEV OTP] ================================`);
          console.log(`[DEV OTP] Phone : ${phone}`);
          console.log(`[DEV OTP] Code  : ${code}`);
          console.log(`[DEV OTP] ================================\n`);
          return;
        }

        const mobile = phone.replace(/^\+91/, "");
        if (!/^\d{10}$/.test(mobile)) {
          throw new Error("Invalid phone number format: expected +91 followed by 10 digits");
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);

        try {
          const response = await fetch("https://console.authkey.io/restapi/requestjson.php", {
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
              bodyValues: { "1": code },
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const body = await response.text();
            console.error(`[AuthKey] Failed to send OTP: ${response.status}`, body.slice(0, 500));
            throw new Error("Failed to send OTP via WhatsApp");
          }

          if (process.env.NODE_ENV !== "production") {
            const body = await response.text();
            console.log("[AuthKey] OTP sent successfully", body.slice(0, 500));
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            console.error("[AuthKey] OTP request timed out after 10s");
            throw new Error("OTP request timed out");
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      otpLength: 6,
      expiresIn: 300,
      signUpOnVerification: {
        getTempEmail: (phone) => `${phone.replace(/[^0-9]/g, "")}@voice-capture.local`,
        getTempName: (phone) => phone,
      },
    }),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
      domain: process.env.NODE_ENV === "production" ? "annoteapp.com" : undefined,
    },
    useSecureCookies: process.env.NODE_ENV === "production",
  },
});

export type Session = typeof auth.$Infer.Session;
