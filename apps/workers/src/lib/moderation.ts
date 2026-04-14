import { GoogleGenAI, Type } from "@google/genai";
import { logger } from "../logger";

let _genai: GoogleGenAI | undefined;
function getGenAI(): GoogleGenAI {
  if (!_genai) {
    const { env } = require("../env");
    _genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return _genai;
}

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

    const prompt = `You are a compliance scanner for telephony ASR data. Scan for PII, abuse, and confidential content.

CATEGORIES:

PII — personally identifiable information that could identify a real person:
- Phone numbers: 10+ digits, +91-XXXXX-XXXXX, "ending in 8721"
- Email addresses: anything@domain.com
- Aadhaar: 12-digit Indian national ID (XXXX XXXX XXXX or XXXX-XXXX-XXXX)
- ABHA ID: health ID numbers
- Credit/debit card numbers: 13-19 digits
- Addresses: street + city + state/zip combinations
- Full name + identifying detail (DOB, ID number, phone) = PII. Name alone in greeting = NOT PII.
- Vehicle/patient IDs when combined with name

ABUSE — harmful or offensive content:
- Profanity / vulgar language (any language including Hindi expletives)
- Threats of violence or harm
- Hate speech, slurs, discriminatory language
- Harassment or intimidation

CONFIDENTIAL — sensitive non-public information:
- Passwords, API keys, tokens, credentials
- Bank account / financial account numbers
- Medical test RESULTS with values (e.g. "HbA1c was 6.8") — the values are confidential
- Unpublished business strategy, revenue numbers

NOT flaggable (avoid false positives):
- Medical TERMINOLOGY without values (BP, ECG, HbA1c, LDL) — these are domain terms
- Doctor names, clinic names — public information
- Appointment times/dates — not confidential
- Generic greetings with first names ("Hi Rahul", "thank you")
- Standard business operations language

SEVERITY:
- high: Must redact before dataset release (full Aadhaar, credit card, SSN, explicit threats)
- medium: Needs review (email, phone number, partial ID, medical results, profanity)
- low: Advisory only (partial name+context, mild language, borderline cases)

OUTPUT RULES:
- Return empty flags [] if nothing found
- In "description", quote the EXACT text that triggered the flag (max 50 chars)
- Be precise — flag the specific words, not the whole utterance

UTTERANCES:
Participant A:
${formatUtterances(utterancesA, "a")}

Participant B:
${formatUtterances(utterancesB, "b")}`;

    const response = await Promise.race([
      getGenAI().models.generateContent({
        model: "gemini-3-flash-preview",
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
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Moderation timeout after 60s")), 60_000),
      ),
    ]);

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
