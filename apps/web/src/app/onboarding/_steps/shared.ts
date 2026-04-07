import type { ProfileResponse } from "@/lib/types";

export const STEPS = ["profile", "languages"] as const;
export type Step = (typeof STEPS)[number];

export interface StepProps {
  onNext: () => void;
  onBack?: () => void;
  profile: ProfileResponse;
}
