"use client";

import { useState } from "react";
import { LoaderCircle, ChevronLeft } from "lucide-react";
import { motion } from "motion/react";
import { staggerContainer, staggerChild } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DialectInput } from "@/components/dialect-input";
import { INDIAN_LANGUAGES } from "@/lib/schemas/onboarding";
import { useUpdateLanguages } from "@/lib/api";
import type { StepProps } from "./shared";

export function LanguagesStep({ onNext, onBack, profile }: StepProps) {
  const updateLanguages = useUpdateLanguages();

  // Pre-fill from existing data
  const existingPrimary = profile.languages.find((l) => l.isPrimary);
  const existingAdditional = profile.languages
    .filter((l) => !l.isPrimary)
    .map((l) => l.languageCode);
  const existingDialects = existingPrimary?.dialects ?? [];

  const [primaryLanguage, setPrimaryLanguage] = useState(existingPrimary?.languageCode ?? "");
  const [additionalLanguages, setAdditionalLanguages] = useState<string[]>(existingAdditional);
  const [dialects, setDialects] = useState<string[]>(existingDialects);

  function toggleLanguage(code: string) {
    setAdditionalLanguages((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  // When primary changes, remove it from additional
  function handlePrimaryChange(code: string) {
    setPrimaryLanguage(code);
    setAdditionalLanguages((prev) => prev.filter((c) => c !== code));
  }

  async function handleSubmit() {
    if (!primaryLanguage) return;

    const primaryName = INDIAN_LANGUAGES.find((l) => l.code === primaryLanguage)?.name ?? primaryLanguage;

    const languages = [
      {
        languageCode: primaryLanguage,
        languageName: primaryName,
        isPrimary: true,
        dialects,
      },
      ...additionalLanguages.map((code) => ({
        languageCode: code,
        languageName: INDIAN_LANGUAGES.find((l) => l.code === code)?.name ?? code,
        isPrimary: false,
        dialects: [] as string[],
      })),
    ];

    try {
      await updateLanguages.mutateAsync({ languages });
      onNext();
    } catch {
      // Error already shown via toast in the hook
    }
  }

  const availableAdditional = INDIAN_LANGUAGES.filter(
    (l) => l.code !== primaryLanguage
  );

  return (
    <>
      <CardHeader className="p-0">
        <CardTitle className="font-heading">Select languages</CardTitle>
        <CardDescription>What languages do you speak?</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <motion.div
          className="flex flex-col gap-4"
          variants={staggerContainer}
          initial="enter"
          animate="center"
        >
          <motion.div variants={staggerChild} className="space-y-1.5">
            <label className="text-sm font-medium">Primary Language</label>
            <Select
              value={primaryLanguage}
              onValueChange={(v) => v && handlePrimaryChange(v)}
              disabled={updateLanguages.isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select primary language" />
              </SelectTrigger>
              <SelectContent>
                {INDIAN_LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </motion.div>

          <motion.div variants={staggerChild} className="space-y-1.5">
            <label className="text-sm font-medium">
              Additional Languages{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {availableAdditional.map((l) => {
                const selected = additionalLanguages.includes(l.code);
                return (
                  <Badge
                    key={l.code}
                    variant={selected ? "default" : "outline"}
                    className="cursor-pointer select-none"
                    onClick={() => !updateLanguages.isPending && toggleLanguage(l.code)}
                  >
                    {l.name}
                  </Badge>
                );
              })}
            </div>
          </motion.div>

          <motion.div variants={staggerChild} className="space-y-1.5">
            <label className="text-sm font-medium">
              Dialects{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <DialectInput
              value={dialects}
              onChange={setDialects}
              disabled={updateLanguages.isPending}
              placeholder="e.g. Bhojpuri, Awadhi"
            />
          </motion.div>

          <motion.div variants={staggerChild} className="flex gap-2">
            {onBack && (
              <Button
                type="button"
                variant="outline"
                onClick={onBack}
                disabled={updateLanguages.isPending}
              >
                <ChevronLeft className="size-4" />
                Back
              </Button>
            )}
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={!primaryLanguage || updateLanguages.isPending}
            >
              {updateLanguages.isPending ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Complete Setup"
              )}
            </Button>
          </motion.div>
        </motion.div>
      </CardContent>
    </>
  );
}
