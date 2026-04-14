import { logger } from "../logger";

/**
 * Send a WhatsApp message via AuthKey API.
 *
 * Uses the same AuthKey gateway as OTP sending (see lib/auth.ts).
 * Requires a pre-approved WhatsApp Business API template.
 *
 * Template for theme sharing should have 3 variables:
 *   {{1}} = public link URL
 *   {{2}} = category (e.g. "Healthcare")
 *   {{3}} = language (e.g. "Hindi")
 *
 * Example template text (submit this in AuthKey console):
 *   "You've been invited to a voice data task!
 *    Category: {{2}} | Language: {{3}}
 *    Open this link to see your values: {{1}}
 *    Read the values aloud during the call."
 *
 * Env vars:
 *   AUTHKEY_API_KEY — same key used for OTP
 *   AUTHKEY_THEME_WID — template ID for theme messages (separate from OTP WID)
 */

interface SendThemeWhatsAppParams {
  phone: string;        // E.164 format, e.g. "+919876543210"
  publicLink: string;   // Full URL, e.g. "https://asr.annoteapp.com/t/abc123..."
  category: string;     // e.g. "Healthcare"
  language: string;     // e.g. "Hindi"
}

export async function sendThemeWhatsApp({
  phone,
  publicLink,
  category,
  language,
}: SendThemeWhatsAppParams): Promise<{ sent: boolean; method: "whatsapp" | "log" }> {
  const apiKey = process.env.AUTHKEY_API_KEY;
  const wid = process.env.AUTHKEY_THEME_WID;

  // Format category for display
  const categoryLabel = category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const languageLabel = language.charAt(0).toUpperCase() + language.slice(1);

  // Dev mode: log the message instead of sending
  if (!apiKey || !wid) {
    logger.info(
      { phone, publicLink, category: categoryLabel, language: languageLabel },
      "[WHATSAPP-DEV] Theme data (no AUTHKEY_THEME_WID configured):",
    );
    console.log(`\n[WHATSAPP-DEV] ================================`);
    console.log(`[WHATSAPP-DEV] To     : ${phone}`);
    console.log(`[WHATSAPP-DEV] Link   : ${publicLink}`);
    console.log(`[WHATSAPP-DEV] Theme  : ${categoryLabel} (${languageLabel})`);
    console.log(`[WHATSAPP-DEV] ================================\n`);
    return { sent: false, method: "log" };
  }

  // Strip country code — AuthKey expects 10-digit mobile number + separate country_code
  const mobile = phone.replace(/^\+91/, "");
  if (!/^\d{10}$/.test(mobile)) {
    logger.warn({ phone }, "[WHATSAPP] Non-Indian phone number, skipping WhatsApp send");
    return { sent: false, method: "log" };
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
        bodyValues: {
          "1": categoryLabel,
          "2": languageLabel,
          "3": publicLink,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error(
        { status: response.status, body: body.slice(0, 500), phone },
        "[WHATSAPP] Failed to send theme message",
      );
      return { sent: false, method: "whatsapp" };
    }

    const body = await response.text();
    logger.info({ phone, responsePreview: body.slice(0, 200) }, "[WHATSAPP] Theme message sent");
    return { sent: true, method: "whatsapp" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      logger.error({ phone }, "[WHATSAPP] Theme message request timed out after 10s");
    } else {
      logger.error({ phone, error: (error as Error).message }, "[WHATSAPP] Theme message send failed");
    }
    return { sent: false, method: "whatsapp" };
  } finally {
    clearTimeout(timeoutId);
  }
}
