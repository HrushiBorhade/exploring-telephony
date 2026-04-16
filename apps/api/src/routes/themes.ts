import { Router } from "express";
import crypto from "crypto";
import { requireAuth, requireAdmin, type AuthRequest } from "../middleware/auth";
import * as dbq from "@repo/db";
import { logger } from "../logger";
import { activeCaptures } from "../services/state";
import { captureTotal } from "../metrics";
import type { Capture } from "@repo/types";
import { sendThemeWhatsApp } from "../lib/whatsapp";

const router = Router();

const LANG_CODE_MAP: Record<string, string> = {
  hi: "hindi",
  te: "telugu",
};

// Theme sample availability
router.get("/api/theme-samples/availability", requireAuth, async (_req: AuthRequest, res) => {
  try {
    const availability = await dbq.getThemeSampleAvailability();
    res.json(availability);
  } catch {
    res.status(500).json({ error: "Failed to get theme sample availability" });
  }
});

// Create themed capture
router.post("/api/captures/themed", requireAuth, async (req: AuthRequest, res) => {
  const { phoneB } = req.body;

  if (!phoneB) {
    res.status(400).json({ error: "phoneB is required" });
    return;
  }
  if (!req.userPhone) {
    res.status(400).json({ error: "No phone number on your account" });
    return;
  }
  if (phoneB === req.userPhone) {
    res.status(400).json({ error: "Cannot call your own number" });
    return;
  }

  try {
    const languages = await dbq.getLanguages(req.userId!);
    const sampleLanguages = languages
      .map((l: any) => LANG_CODE_MAP[l.languageCode])
      .filter(Boolean);

    if (sampleLanguages.length === 0) {
      res.status(400).json({ error: "No matching theme languages for your profile" });
      return;
    }

    // 1. Create capture in DB FIRST (so FK reference is valid for theme_samples.assigned_capture_id)
    const id = crypto.randomBytes(6).toString("hex");
    const roomName = `capture-${id}`;

    await dbq.createCapture({
      id,
      userId: req.userId!,
      name: "",
      phoneA: req.userPhone,
      phoneB,
      language: "multi",
      status: "created",
      roomName,
    });

    // 2. Assign theme sample (now the capture ID exists for the FK)
    const sample = await dbq.assignThemeSample(id, sampleLanguages) as {
      id: number; category: string; language: string; data: string;
      status: string; public_token: string;
    } | null;

    if (!sample) {
      // No samples available — delete the capture we just created
      await dbq.updateCapture(id, { status: "failed" });
      res.status(409).json({ error: "No theme samples available for your languages" });
      return;
    }

    // 3. Update capture with theme sample info
    const lang = sample.language === "hindi" ? "hi" : sample.language === "telugu" ? "te" : "multi";
    await dbq.updateCapture(id, {
      themeSampleId: sample.id,
      language: lang,
      name: `Theme: ${sample.category}`,
    });

    const capture: Capture = {
      id,
      userId: req.userId!,
      name: `Theme: ${sample.category}`,
      phoneA: req.userPhone,
      phoneB,
      language: lang,
      status: "created",
      roomName,
      themeSampleId: sample.id,
      createdAt: new Date().toISOString(),
    };

    activeCaptures.set(id, capture);
    captureTotal.inc();
    logger.info(`[CAPTURE] Created themed capture: ${id} (${sample.category}/${sample.language})`);

    // Build public link for participant B
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const publicLink = `${frontendUrl}/t/${sample.public_token}`;

    // Fire-and-forget WhatsApp to participant B — don't block the response
    sendThemeWhatsApp({
      phone: phoneB,
      publicLink,
      category: sample.category,
      language: sample.language,
    }).catch((err) => logger.error({ captureId: id, error: err.message }, "[THEME] WhatsApp send failed (non-blocking)"));

    res.json({
      capture,
      themeSample: {
        id: sample.id,
        category: sample.category,
        language: sample.language,
        data: JSON.parse(sample.data),
        publicToken: sample.public_token,
      },
    });
  } catch (err: any) {
    logger.error({ error: err.message }, "[CAPTURE] Themed capture creation failed");
    res.status(500).json({ error: "Failed to create themed capture" });
  }
});

// Public: get theme sample by token
router.get("/api/theme/:token", async (req, res) => {
  const { token } = req.params;

  if (!token || token.length !== 32) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }

  try {
    const sample = await dbq.getThemeSampleByToken(token);
    if (!sample) {
      res.status(404).json({ error: "Theme sample not found" });
      return;
    }

    res.json({
      category: sample.category,
      language: sample.language,
      data: JSON.parse(sample.data),
    });
  } catch {
    res.status(500).json({ error: "Failed to get theme sample" });
  }
});

// Get theme sample for a capture
router.get("/api/captures/:id/theme", requireAuth, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  try {
    const capture = activeCaptures.get(id) ?? (await dbq.getCapture(id));
    if (!capture) { res.status(404).json({ error: "Not found" }); return; }
    if (capture.userId !== req.userId && req.userRole !== "admin") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const sample = await dbq.getThemeSampleByCaptureId(id);
    if (!sample) {
      res.status(404).json({ error: "No theme sample for this capture" });
      return;
    }

    res.json({
      id: sample.id,
      category: sample.category,
      language: sample.language,
      data: JSON.parse(sample.data),
      status: sample.status,
      publicToken: sample.publicToken,
    });
  } catch {
    res.status(500).json({ error: "Failed to get theme sample" });
  }
});

// ── Rate limiter for form validation (per capture, in-memory) ──
const validationAttempts = new Map<string, number>();
const MAX_VALIDATION_ATTEMPTS = 10;

/**
 * Exact string match fallback — used when Gemini is unavailable or fails.
 */
function exactMatchValidation(
  reference: Record<string, string>,
  values: Record<string, string>,
): { field: string; submitted: string; correct: boolean }[] {
  const normalize = (s: string) =>
    s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  return Object.keys(reference)
    .filter((k) => k !== "on_submit")
    .map((key) => ({
      field: key,
      submitted: values[key] ?? "",
      correct: normalize(values[key] ?? "") === normalize(reference[key]),
    }));
}

/**
 * LLM-powered semantic validation using Gemini Flash.
 * Accepts transliterations, numeric equivalents, minor spelling variations.
 */
async function llmValidation(
  reference: Record<string, string>,
  values: Record<string, string>,
): Promise<{ field: string; submitted: string; correct: boolean }[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const genai = new GoogleGenAI({ apiKey });

    const fieldsToValidate = Object.keys(reference).filter((k) => k !== "on_submit");
    const refObj: Record<string, string> = {};
    const subObj: Record<string, string> = {};
    for (const k of fieldsToValidate) {
      refObj[k] = reference[k];
      subObj[k] = values[k] ?? "";
    }

    const prompt = `You are validating a voice data collection form. Participant A listened to Participant B read reference values aloud, then typed what they heard.

Accept as correct if:
- Transliteration matches (प्रिया = Priya = priya)
- Numeric equivalents (चार सौ अस्सी = 480 = char sau assi)
- Minor spelling variations (Rahul = raahul)
- Partial but clearly correct (just first name when full name expected)
- Same meaning in different script (Devanagari vs Roman)

Mark as INCORRECT only if the meaning is clearly wrong, completely different, or empty.

Reference values: ${JSON.stringify(refObj)}
Submitted values: ${JSON.stringify(subObj)}

Return ONLY valid JSON array: [{"field":"field_name","correct":true},...]
Return one entry per field. No extra text.`;

    const response = await Promise.race([
      genai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);

    const text = response.text?.trim();
    if (!text) return null;

    const parsed = JSON.parse(text) as { field: string; correct: boolean }[];
    if (!Array.isArray(parsed)) return null;

    // Map LLM results back to the expected format
    return fieldsToValidate.map((key) => {
      const llmResult = parsed.find((r) => r.field === key);
      return {
        field: key,
        submitted: values[key] ?? "",
        correct: llmResult?.correct ?? false,
      };
    });
  } catch (err: any) {
    logger.warn({ error: err.message }, "[VALIDATE] LLM validation failed, falling back to exact match");
    return null;
  }
}

// Validate form answers against theme sample reference data
router.post("/api/captures/:id/form/validate", requireAuth, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  try {
    const capture = activeCaptures.get(id) ?? (await dbq.getCapture(id));
    if (!capture) { res.status(404).json({ error: "Not found" }); return; }
    if (capture.userId !== req.userId && req.userRole !== "admin") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    // Rate limit
    const attempts = validationAttempts.get(id) ?? 0;
    if (attempts >= MAX_VALIDATION_ATTEMPTS) {
      res.status(429).json({ error: "Maximum validation attempts reached" });
      return;
    }

    const { values } = req.body;
    if (!values || typeof values !== "object") {
      res.status(400).json({ error: "values object is required" });
      return;
    }

    const sample = await dbq.getThemeSampleByCaptureId(id);
    if (!sample) {
      res.status(404).json({ error: "No theme sample for this capture" });
      return;
    }

    const reference = JSON.parse(sample.data) as Record<string, string>;
    const fieldsToCheck = Object.keys(reference).filter((k) => k !== "on_submit");

    // Pre-validation: all fields must be non-empty and min 2 chars
    const emptyFields = fieldsToCheck.filter((k) => !values[k] || String(values[k]).trim().length < 2);
    if (emptyFields.length > 0) {
      res.status(400).json({
        error: "All fields must be filled (min 2 characters)",
        emptyFields,
      });
      return;
    }

    // Increment attempt counter
    validationAttempts.set(id, attempts + 1);

    // Try LLM validation first, fall back to exact match
    const results = (await llmValidation(reference, values)) ?? exactMatchValidation(reference, values);

    const score = results.filter((r) => r.correct).length;
    const total = results.length;

    res.json({
      results,
      score,
      total,
      allCorrect: score === total,
    });
  } catch {
    res.status(500).json({ error: "Failed to validate form" });
  }
});

// Resend WhatsApp theme data to participant
router.post("/api/captures/:id/whatsapp/resend", requireAuth, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  try {
    const capture = activeCaptures.get(id) ?? (await dbq.getCapture(id));
    if (!capture) { res.status(404).json({ error: "Not found" }); return; }
    if (capture.userId !== req.userId && req.userRole !== "admin") {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const sample = await dbq.getThemeSampleByCaptureId(id);
    if (!sample || !sample.publicToken) {
      res.status(404).json({ error: "No theme sample for this capture" });
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const publicLink = `${frontendUrl}/t/${sample.publicToken}`;

    const result = await sendThemeWhatsApp({
      phone: capture.phoneB,
      publicLink,
      category: sample.category,
      language: sample.language,
    });

    logger.info({ captureId: id, sent: result.sent, method: result.method }, "[THEME] WhatsApp resend");
    res.json({ ok: true, sent: result.sent, method: result.method });
  } catch {
    res.status(500).json({ error: "Failed to resend WhatsApp message" });
  }
});

// ── Admin: list all theme samples ──────────────────────────────────
router.get("/api/admin/theme-samples", requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    const samples = await dbq.listAllThemeSamples();
    res.json(samples.map((s) => ({
      ...s,
      data: JSON.parse(s.data),
      assignedAt: s.assignedAt?.toISOString() ?? null,
    })));
  } catch {
    res.status(500).json({ error: "Failed to list theme samples" });
  }
});

export default router;
