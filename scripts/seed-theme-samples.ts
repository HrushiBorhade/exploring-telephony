import "dotenv/config";
import { db } from "../packages/db/src/client";
import { themeSamples } from "../packages/db/src/schema";
import { count } from "drizzle-orm";
import { readFileSync } from "fs";
import { resolve } from "path";

const CATEGORY_LANGUAGE_MAP: Record<string, { category: string; language: string }> = {
  alphanumeric_hindi: { category: "alphanumeric", language: "hindi" },
  alphanumeric_telugu: { category: "alphanumeric", language: "telugu" },
  healthcare_hindi: { category: "healthcare", language: "hindi" },
  healthcare_telugu: { category: "healthcare", language: "telugu" },
  short_utterances_hindi: { category: "short_utterances", language: "hindi" },
  short_utterances_telugu: { category: "short_utterances", language: "telugu" },
};

async function seed() {
  console.log("Checking if theme_samples is already seeded...");

  const [{ value: existing }] = await db.select({ value: count() }).from(themeSamples);

  if (existing > 0) {
    console.log(`Table already has ${existing} rows — skipping seed.`);
    process.exit(0);
  }

  const jsonPath = resolve(__dirname, "../data/conversation_samples.json");
  const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));

  const rows: { category: string; language: string; data: string }[] = [];

  for (const [key, mapping] of Object.entries(CATEGORY_LANGUAGE_MAP)) {
    const samples: Record<string, unknown>[] = raw[key];
    if (!samples) {
      console.warn(`Warning: key "${key}" not found in JSON — skipping`);
      continue;
    }

    for (const sample of samples) {
      // Strip the label-only "id" field
      const { id: _stripped, ...fields } = sample;
      rows.push({
        category: mapping.category,
        language: mapping.language,
        data: JSON.stringify(fields),
      });
    }

    console.log(`  ${key}: ${samples.length} samples`);
  }

  console.log(`\nInserting ${rows.length} rows...`);

  // Insert in batches of 50 to stay within Postgres parameter limits
  const BATCH_SIZE = 50;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(themeSamples).values(batch);
  }

  console.log(`Done — inserted ${rows.length} theme samples.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
