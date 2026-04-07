"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AudioWaveformIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { stepVariants, spring } from "@/lib/motion";
import { AuthPanel } from "@/components/auth-panel";
import { useProfile } from "@/lib/api";
import { STEPS, type Step } from "./_steps/shared";

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`size-2 rounded-full transition-colors ${
              i <= current ? "bg-primary" : "bg-muted"
            }`}
          />
          {i < total - 1 && (
            <div
              className={`h-px w-6 transition-colors ${
                i < current ? "bg-primary" : "bg-muted"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: profile, isLoading } = useProfile();

  const requestedStep = (searchParams.get("step") ?? "profile") as Step;
  const stepIndex = STEPS.indexOf(requestedStep);
  const currentStep = stepIndex >= 0 ? requestedStep : "profile";
  const currentIndex = STEPS.indexOf(currentStep);

  // Height animation (ResizeObserver pattern)
  const [height, setHeight] = useState<number | undefined>(undefined);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        const h = el.getBoundingClientRect().height;
        if (h > 0) setHeight(h);
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const goToStep = useCallback(
    (step: Step) => {
      router.replace(`/onboarding?step=${step}`, { scroll: false });
    },
    [router]
  );

  const handleNext = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < STEPS.length) {
      goToStep(STEPS[nextIndex]);
    } else {
      router.replace("/capture");
    }
  }, [currentIndex, goToStep, router]);

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      goToStep(STEPS[currentIndex - 1]);
    }
  }, [currentIndex, goToStep]);

  if (isLoading || !profile) {
    return (
      <div className="grid min-h-svh lg:grid-cols-2">
        <div className="flex items-center justify-center p-6">
          <Skeleton className="w-full max-w-md h-96 rounded-xl" />
        </div>
        <AuthPanel />
      </div>
    );
  }

  if (profile.onboardingCompleted) {
    router.replace("/capture");
    return null;
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="/" className="flex items-center gap-2 font-medium">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <AudioWaveformIcon className="size-4" />
            </div>
            Annote ASR
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-md">
            <div className="flex justify-center mb-6">
              <StepDots current={currentIndex} total={STEPS.length} />
            </div>
            <Card className="overflow-hidden">
              <motion.div
                animate={{ height }}
                transition={{ ...spring, duration: 0.45 }}
                initial={false}
                className="overflow-hidden"
              >
                <div ref={contentRef}>
                  <AnimatePresence mode="wait" initial={false}>
                    {currentStep === "profile" && (
                      <motion.div
                        key="profile"
                        variants={stepVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        className="flex flex-col gap-4 p-6"
                      >
                        {/* ProfileStep — placeholder until Task 9 */}
                        <div className="space-y-4">
                          <div>
                            <h2 className="text-lg font-semibold font-heading">
                              Complete your profile
                            </h2>
                            <p className="text-sm text-muted-foreground">
                              Tell us about yourself
                            </p>
                          </div>
                          <p className="text-sm text-muted-foreground py-8 text-center">
                            Profile form loading...
                          </p>
                          <button
                            onClick={handleNext}
                            className="text-primary text-sm underline"
                          >
                            Next (placeholder)
                          </button>
                        </div>
                      </motion.div>
                    )}
                    {currentStep === "languages" && (
                      <motion.div
                        key="languages"
                        variants={stepVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        className="flex flex-col gap-4 p-6"
                      >
                        {/* LanguagesStep — placeholder until Task 11 */}
                        <div className="space-y-4">
                          <div>
                            <h2 className="text-lg font-semibold font-heading">
                              Select languages
                            </h2>
                            <p className="text-sm text-muted-foreground">
                              What languages do you speak?
                            </p>
                          </div>
                          <p className="text-sm text-muted-foreground py-8 text-center">
                            Languages form loading...
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={handleBack}
                              className="text-muted-foreground text-sm underline"
                            >
                              Back
                            </button>
                            <button
                              onClick={handleNext}
                              className="text-primary text-sm underline"
                            >
                              Complete (placeholder)
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </Card>
          </div>
        </div>
      </div>
      <AuthPanel />
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-svh lg:grid-cols-2">
          <div className="flex items-center justify-center p-6">
            <Skeleton className="w-full max-w-md h-96 rounded-xl" />
          </div>
          <AuthPanel />
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
