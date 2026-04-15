import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import * as dbq from "@repo/db";
import { notifySlack } from "@repo/shared";
import { logger } from "../logger";

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
  const { name, age, gender, city, state, upiId } = req.body;

  const errors: Record<string, string> = {};
  if (!name || typeof name !== "string" || name.trim().length < 2) errors.name = "Name must be at least 2 characters";
  else if (name.length > MAX_NAME_LENGTH) errors.name = `Name must be under ${MAX_NAME_LENGTH} characters`;
  if (!age || age < 18 || age > 100) errors.age = "Age must be 18-100";
  if (!gender) errors.gender = "Gender is required";
  if (!state) errors.state = "State is required";
  if (!city || typeof city !== "string" || city.trim().length < 2) errors.city = "City must be at least 2 characters";
  else if (city.length > MAX_CITY_LENGTH) errors.city = `City must be under ${MAX_CITY_LENGTH} characters`;
  if (upiId !== undefined && upiId !== "") {
    const upiRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/;
    if (typeof upiId !== "string" || !upiRegex.test(upiId)) errors.upiId = "Enter a valid UPI ID (e.g., name@upi)";
    else if (upiId.length > 50) errors.upiId = "UPI ID must be under 50 characters";
  }

  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: "Validation failed", fields: errors });
    return;
  }

  try {
    await dbq.upsertProfile(req.userId!, { name: name.trim(), age: Number(age), gender, city: city.trim(), state, upiId: upiId?.trim() || undefined });
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

  try {
    const profile = await dbq.getProfile(req.userId!);
    if (!profile) {
      res.status(400).json({ error: "Complete your profile first" }); return;
    }

    await dbq.setLanguages(req.userId!, languages);
    await dbq.markOnboardingComplete(req.userId!);

    // Notify Slack when onboarding completes
    const primaryLang = languages.find((l: any) => l.isPrimary)?.languageName || languages[0]?.languageName || "N/A";
    notifySlack({
      blocks: [
        { type: "header", text: { type: "plain_text", text: "User Onboarding Completed", emoji: true } },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Name:*\n${profile.name}` },
            { type: "mrkdwn", text: `*Phone:*\n${(req as any).userPhone || "N/A"}` },
            { type: "mrkdwn", text: `*Location:*\n${profile.city}, ${profile.state}` },
            { type: "mrkdwn", text: `*Language:*\n${primaryLang}` },
            { type: "mrkdwn", text: `*Age/Gender:*\n${profile.age}, ${profile.gender}` },
          ],
        },
      ],
    }).catch((err) => logger.error({ err }, "Slack onboarding notification failed"));

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to save languages" });
  }
});

// GET /api/profile/onboarding-status — lightweight check
router.get("/api/profile/onboarding-status", requireAuth, async (req: AuthRequest, res) => {
  try {
    const completed = await dbq.isOnboarded(req.userId!);
    res.json({ completed });
  } catch {
    res.status(500).json({ error: "Failed to check onboarding status" });
  }
});

export default router;
