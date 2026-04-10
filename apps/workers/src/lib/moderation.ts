import { GoogleGenAI, Type } from "@google/genai";
import { logger } from "../logger";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface ModerationFlag {
  type: "pii" | "abuse" | "confidential";
  severity: "high" | "medium" | "low";
  description: string;
}

interface UtteranceInput {
  text: string;
  [key: string]: unknown;
}

interface ModerationResult {
  flags: Array<{
    participant: "a" | "b";
    index: number;
    type: "pii" | "abuse" | "confidential";
    severity: "high" | "medium" | "low";
    description: string;
  }>;
}

/**
 * Scan transcript utterances for PII, abuse, and confidential content using Gemini.
 * Returns the utterance arrays with `flags` embedded on flagged utterances.
 * On failure, returns utterances unchanged (no flags = clean pass).
 */
export async function moderateTranscript<T extends UtteranceInput>(
  utterancesA: T[],
  utterancesB: T[],
): Promise<{ utterancesA: T[]; utterancesB: T[] }> {
  if (utterancesA.length === 0 && utterancesB.length === 0) {
    return { utterancesA, utterancesB };
  }

  try {
    const formatUtterances = (utterances: UtteranceInput[], label: string) =>
      utterances.map((u, i) => `[${label}-${i}] ${u.text}`).join("\n");

    const prompt = `You are a content moderation engine for telephony transcription data.

TASK: Scan every utterance below for compliance violations. Return structured flags.

SCAN CATEGORIES:
1. PII (personally identifiable information):
   - Phone numbers (10+ digit sequences, formatted numbers like +91-XXXXX-XXXXX)
   - Email addresses
   - Social Security Numbers (XXX-XX-XXXX patterns)
   - Credit card numbers (13-19 digit sequences)
   - Physical addresses (street, city, state, zip combinations)
   - Aadhaar numbers (12-digit Indian ID, XXXX-XXXX-XXXX)
   - Full names when combined with other identifying info

2. ABUSIVE CONTENT:
   - Profanity and vulgar language (in any language/script)
   - Hate speech, slurs, discriminatory language
   - Threats of violence or harm
   - Harassment or intimidation

3. CONFIDENTIAL CONTENT:
   - Sensitive business information (revenue, unreleased products, strategy)
   - Legal privilege or medical record details
   - Access credentials, passwords, API keys, tokens
   - Bank account or financial details

SEVERITY GUIDE:
- high: Must be addressed before release (SSN, credit cards, threats, passwords, Aadhaar)
- medium: Should be reviewed (phone numbers, email, profanity, addresses)
- low: Advisory (partial PII, mild language, borderline confidential)

RULES:
- Return empty flags array [] if no issues found
- Each flag must reference the exact participant ("a" or "b") and the utterance index
- Be thorough but avoid false positives on common greetings or standard business terms
- Medical terminology (BP, ECG, HbA1c) is NOT confidential — it's domain data
- Names mentioned in casual greeting context ("Hi Rahul") are low severity

UTTERANCES:
Participant A:
${formatUtterances(utterancesA, "a")}

Participant B:
${formatUtterances(utterancesB, "b")}`;

    const response = await genai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            flags: {
              type: Type.ARRAY,
              description: "List of content flags found in utterances",
              items: {
                type: Type.OBJECT,
                properties: {
                  participant: { type: Type.STRING, description: "a or b" },
                  index: { type: Type.NUMBER, description: "Utterance index (0-based)" },
                  type: { type: Type.STRING, enum: ["pii", "abuse", "confidential"] },
                  severity: { type: Type.STRING, enum: ["high", "medium", "low"] },
                  description: { type: Type.STRING, description: "Brief explanation of the flag" },
                },
                required: ["participant", "index", "type", "severity", "description"],
              },
            },
          },
          required: ["flags"],
        },
      },
    });

    const result: ModerationResult = JSON.parse(response.text!);

    // Embed flags into utterance objects
    const cloneA = utterancesA.map((u) => ({ ...u }));
    const cloneB = utterancesB.map((u) => ({ ...u }));

    for (const flag of result.flags) {
      const arr = flag.participant === "a" ? cloneA : cloneB;
      if (flag.index >= 0 && flag.index < arr.length) {
        const utterance = arr[flag.index] as any;
        if (!utterance.flags) utterance.flags = [];
        utterance.flags.push({
          type: flag.type,
          severity: flag.severity,
          description: flag.description,
        });
      }
    }

    const totalFlags = result.flags.length;
    logger.info({ totalFlags }, "[MODERATION] Scan complete");

    return { utterancesA: cloneA, utterancesB: cloneB };
  } catch (err: any) {
    logger.warn({ error: err.message }, "[MODERATION] Scan failed, returning utterances without flags");
    return { utterancesA, utterancesB };
  }
}
