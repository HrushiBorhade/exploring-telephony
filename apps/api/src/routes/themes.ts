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

// Validate form answers against theme sample reference data
router.post("/api/captures/:id/form/validate", requireAuth, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  try {
    const capture = activeCaptures.get(id) ?? (await dbq.getCapture(id));
    if (!capture) { res.status(404).json({ error: "Not found" }); return; }
    if (capture.userId !== req.userId && req.userRole !== "admin") {
      res.status(403).json({ error: "Forbidden" }); return;
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
    const normalize = (s: string) =>
      s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

    const results: { field: string; submitted: string; correct: boolean }[] = [];
    for (const key of Object.keys(reference)) {
      const submitted = values[key] ?? "";
      const correct = normalize(submitted) === normalize(reference[key]);
      results.push({ field: key, submitted, correct });
    }

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
