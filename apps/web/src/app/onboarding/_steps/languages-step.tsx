"use client";

import { useState } from "react";
import { LoaderCircle, ChevronLeft } from "lucide-react";
import { motion } from "motion/react";
import { staggerContainer, staggerChild } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DialectInput } from "@/components/dialect-input";
import { INDIAN_LANGUAGES } from "@/lib/schemas/onboarding";
import { useUpdateLanguages } from "@/lib/api";
import { toast } from "sonner";
import type { StepProps } from "./shared";

export function LanguagesStep({ onNext, onBack, profile }: StepProps) {
  const updateLanguages = useUpdateLanguages();

  const existingCodes = profile.languages.map((l) => l.languageCode);
  const existingDialects = profile.languages.flatMap((l) => l.dialects ?? []);

  const [selected, setSelected] = useState<string[]>(existingCodes.length > 0 ? existingCodes : []);
  const [dialects, setDialects] = useState<string[]>(existingDialects);

  function toggle(code: string) {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  async function handleSubmit() {
    if (selected.length === 0 || updateLanguages.isPending) return;

    const languages = selected.map((code, i) => ({
      languageCode: code,
      languageName: INDIAN_LANGUAGES.find((l) => l.code === code)?.name ?? code,
      isPrimary: i === 0,
      dialects: i === 0 ? dialects : [],
    }));

    try {
      await updateLanguages.mutateAsync({ languages });
      onNext();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save languages");
    }
  }

  return (
    <>
      <CardHeader className="p-0">
        <CardTitle className="font-heading">Select languages</CardTitle>
        <CardDescription>
          Select all languages you can speak
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <motion.div
          className="flex flex-col gap-4"
          variants={staggerContainer}
          initial="enter"
          animate="center"
        >
          <motion.div variants={staggerChild} className="space-y-2">
            <label className="text-sm font-medium">
              Languages
              {selected.length > 0 && (
                <span className="text-muted-foreground font-normal ml-1">
                  ({selected.length} selected)
                </span>
              )}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {INDIAN_LANGUAGES.map((l) => {
                const isSelected = selected.includes(l.code);
                return (
                  <Badge
                    key={l.code}
                    variant={isSelected ? "default" : "outline"}
                    className="cursor-pointer select-none text-xs py-1 px-2.5"
                    onClick={() => !updateLanguages.isPending && toggle(l.code)}
                  >
                    {l.name}
                  </Badge>
                );
              })}
            </div>
            {selected.length === 0 && (
              <p className="text-xs text-destructive">Select at least one language</p>
            )}
          </motion.div>

          <motion.div variants={staggerChild} className="space-y-2">
            <label className="text-sm font-medium">
              Dialects
              <span className="text-muted-foreground font-normal ml-1">(optional)</span>
            </label>
            <DialectInput
              value={dialects}
              onChange={setDialects}
              disabled={updateLanguages.isPending}
              placeholder="e.g. Bhojpuri, Awadhi"
            />
          </motion.div>

          <motion.div variants={staggerChild} className="flex gap-2 pt-1">
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
              disabled={selected.length === 0 || updateLanguages.isPending}
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
