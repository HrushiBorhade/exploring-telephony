"use client";

import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { pageStagger, pageFadeUp, spring } from "@/lib/motion";
import { useSession } from "@/lib/auth-client";
import {
  useProfile,
  useUpdateProfile,
  useUpdateLanguages,
  profileKeys,
} from "@/lib/api";
import {
  profileSchema,
  type ProfileFormValues,
  GENDERS,
  INDIAN_STATES,
  INDIAN_LANGUAGES,
} from "@/lib/schemas/onboarding";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  PencilIcon,
  LoaderCircle,
  ShieldCheckIcon,
  AlertCircle,
} from "lucide-react";
import type { ProfileResponse } from "@/lib/types";

const fadeUp = pageFadeUp;
const stagger = pageStagger;

// ── Smooth height wrapper (same pattern as onboarding) ────────────

function useSmoothHeight() {
  const [height, setHeight] = useState<number | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
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

  return { ref, height };
}

function SmoothResize({ children }: { children: React.ReactNode }) {
  const { ref, height } = useSmoothHeight();
  return (
    <motion.div
      animate={{ height }}
      transition={{ ...spring, duration: 0.35 }}
      initial={false}
      className="overflow-hidden"
    >
      <div ref={ref}>{children}</div>
    </motion.div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="@container/main flex flex-1 flex-col">
      <div className="flex flex-col gap-6 py-4 md:py-6 px-4 lg:px-6 max-w-2xl">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-4 w-52" />
        </div>

        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-7 w-14 rounded-md" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-1.5">
              <Skeleton className="h-3.5 w-14" />
              <Skeleton
                className="h-3.5"
                style={{ width: `${[80, 64, 48, 72, 96][i]}px` }}
              />
            </div>
          ))}
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-14 rounded-md" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-6 rounded-full"
                style={{ width: `${[56, 64, 52][i]}px` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Info Row ───────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

// ── Profile Edit Form ─────────────────────────────────────────────

function ProfileEditForm({
  profile,
  onCancel,
  onSuccess,
}: {
  profile: ProfileResponse;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const updateProfile = useUpdateProfile();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: profile.profile?.name ?? "",
      age: profile.profile?.age ?? (undefined as unknown as number),
      gender: profile.profile?.gender ?? "",
      state: profile.profile?.state ?? "",
      city: profile.profile?.city ?? "",
      upiId: profile.profile?.upiId ?? "",
    },
  });

  async function onSubmit(data: ProfileFormValues) {
    const prev = queryClient.getQueryData<ProfileResponse>(profileKeys.profile);
    if (prev?.profile) {
      queryClient.setQueryData(profileKeys.profile, {
        ...prev,
        profile: { ...prev.profile, ...data },
      });
    }
    onSuccess();

    try {
      await updateProfile.mutateAsync(data);
      toast.success("Profile updated");
    } catch {
      if (prev) queryClient.setQueryData(profileKeys.profile, prev);
    }
  }

  const isPending = updateProfile.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-name" className="text-sm text-muted-foreground">
          Name
        </label>
        <Input
          id="edit-name"
          placeholder="Your name"
          maxLength={100}
          {...register("name")}
          disabled={isPending}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="edit-age" className="text-sm text-muted-foreground">
            Age
          </label>
          <Input
            id="edit-age"
            type="number"
            inputMode="numeric"
            placeholder="25"
            min={18}
            max={100}
            {...register("age", { valueAsNumber: true })}
            disabled={isPending}
          />
          {errors.age && (
            <p className="text-xs text-destructive">{errors.age.message}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm text-muted-foreground">Gender</label>
          <Select
            defaultValue={profile.profile?.gender}
            onValueChange={(v) => v && setValue("gender", v)}
            disabled={isPending}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {GENDERS.map((g) => (
                <SelectItem key={g.value} value={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.gender && (
            <p className="text-xs text-destructive">{errors.gender.message}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm text-muted-foreground">State</label>
        <Select
          defaultValue={profile.profile?.state}
          onValueChange={(v) => v && setValue("state", v)}
          disabled={isPending}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select state" />
          </SelectTrigger>
          <SelectContent>
            {INDIAN_STATES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.state && (
          <p className="text-xs text-destructive">{errors.state.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-city" className="text-sm text-muted-foreground">
          City
        </label>
        <Input
          id="edit-city"
          placeholder="Your city"
          maxLength={100}
          {...register("city")}
          disabled={isPending}
        />
        {errors.city && (
          <p className="text-xs text-destructive">{errors.city.message}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-upiId" className="text-sm text-muted-foreground">
          UPI ID
        </label>
        <Input
          id="edit-upiId"
          placeholder="yourname@upi"
          maxLength={50}
          {...register("upiId")}
          disabled={isPending}
        />
        {errors.upiId && (
          <p className="text-xs text-destructive">{errors.upiId.message}</p>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? (
            <>
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
              Saving...
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </div>
    </form>
  );
}

// ── Languages Edit ────────────────────────────────────────────────

function LanguagesEdit({
  currentLanguages,
  onCancel,
  onSuccess,
}: {
  currentLanguages: {
    languageCode: string;
    languageName: string;
    isPrimary: boolean;
    dialects: string[] | null;
  }[];
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const updateLanguages = useUpdateLanguages();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<string[]>(
    currentLanguages.map((l) => l.languageCode)
  );

  function toggle(code: string) {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  async function handleSave() {
    if (selected.length === 0) return;

    const languages = selected.map((code, i) => ({
      languageCode: code,
      languageName:
        INDIAN_LANGUAGES.find((l) => l.code === code)?.name ?? code,
      isPrimary: i === 0,
      dialects: [] as string[],
    }));

    const prev = queryClient.getQueryData<ProfileResponse>(
      profileKeys.profile
    );
    if (prev) {
      queryClient.setQueryData(profileKeys.profile, {
        ...prev,
        languages: languages.map((l, i) => ({
          ...l,
          id: i,
          userId: prev.profile?.id ?? "",
          createdAt: new Date().toISOString(),
        })),
      });
    }
    onSuccess();

    try {
      await updateLanguages.mutateAsync({ languages });
      toast.success("Languages updated");
    } catch {
      if (prev) queryClient.setQueryData(profileKeys.profile, prev);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {INDIAN_LANGUAGES.map((l) => {
          const isSelected = selected.includes(l.code);
          return (
            <Badge
              key={l.code}
              variant={isSelected ? "default" : "outline"}
              className="cursor-pointer select-none text-xs py-1 px-2.5 transition-colors"
              onClick={() =>
                !updateLanguages.isPending && toggle(l.code)
              }
            >
              {l.name}
            </Badge>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="text-xs text-destructive">
          Select at least one language
        </p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={updateLanguages.isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={selected.length === 0 || updateLanguages.isPending}
        >
          {updateLanguages.isPending ? (
            <>
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
              Saving...
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: session, isPending: sessionPending } = useSession();
  const {
    data: profileData,
    isLoading: profileLoading,
    isError,
    error,
    refetch,
  } = useProfile();

  const [editingSection, setEditingSection] = useState<
    "profile" | "languages" | null
  >(null);

  // Only show skeleton on first load — never flash when cached data exists
  const isFirstLoad =
    (!session && sessionPending) || (!profileData && profileLoading);
  if (isFirstLoad) {
    return <SettingsSkeleton />;
  }

  if (isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-20 px-4">
        <AlertCircle className="size-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium">Failed to load settings</p>
        <p className="text-sm text-muted-foreground mt-1">
          {error?.message}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  const user = session?.user;
  const phoneNumber = String(
    (user as Record<string, unknown>)?.phoneNumber ?? ""
  );
  const phoneVerified = Boolean(
    (user as Record<string, unknown>)?.phoneNumberVerified
  );
  const profile = profileData?.profile;
  const languages = profileData?.languages ?? [];

  const displayName = profile?.name || "User";
  const isPhone = /^\+?\d/.test(displayName);
  const initials = isPhone
    ? displayName.slice(-2)
    : displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "U";

  const genderLabel = profile?.gender
    ? profile.gender
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "\u2014";

  return (
    <div className="@container/main flex flex-1 flex-col">
      <motion.div
        className="flex flex-col gap-6 py-4 md:py-6 px-4 lg:px-6 max-w-2xl"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        {/* Page Header */}
        <motion.div variants={fadeUp}>
          <h2 className="text-lg font-semibold tracking-tight font-heading">
            Settings
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage your profile and preferences
          </p>
        </motion.div>

        {/* Profile Identity */}
        <motion.div variants={fadeUp} className="flex items-center gap-3">
          <Avatar size="lg">
            <AvatarFallback className="text-base font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{displayName}</p>
            {phoneNumber && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground font-mono">
                  {phoneNumber}
                </span>
                {phoneVerified && (
                  <ShieldCheckIcon className="size-3 text-primary shrink-0" />
                )}
              </div>
            )}
          </div>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Separator />
        </motion.div>

        {/* Profile Section */}
        <motion.div variants={fadeUp}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">Profile</h3>
            {editingSection !== "profile" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setEditingSection("profile")}
              >
                <PencilIcon data-icon="inline-start" />
                Edit
              </Button>
            )}
          </div>

          <SmoothResize>
            <AnimatePresence mode="wait" initial={false}>
              {editingSection === "profile" && profileData ? (
                <motion.div
                  key="profile-edit"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                >
                  <ProfileEditForm
                    profile={profileData}
                    onCancel={() => setEditingSection(null)}
                    onSuccess={() => setEditingSection(null)}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="profile-view"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="flex flex-col"
                >
                  <InfoRow label="Name" value={profile?.name ?? "\u2014"} />
                  <InfoRow label="Age" value={profile?.age ?? "\u2014"} />
                  <InfoRow label="Gender" value={genderLabel} />
                  <InfoRow label="City" value={profile?.city ?? "\u2014"} />
                  <InfoRow label="State" value={profile?.state ?? "\u2014"} />
                  <InfoRow label="UPI ID" value={profile?.upiId ?? "\u2014"} />
                </motion.div>
              )}
            </AnimatePresence>
          </SmoothResize>
        </motion.div>

        <motion.div variants={fadeUp}>
          <Separator />
        </motion.div>

        {/* Languages Section */}
        <motion.div variants={fadeUp}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">Languages</h3>
            {editingSection !== "languages" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setEditingSection("languages")}
              >
                <PencilIcon data-icon="inline-start" />
                Edit
              </Button>
            )}
          </div>

          <SmoothResize>
            <AnimatePresence mode="wait" initial={false}>
              {editingSection === "languages" ? (
                <motion.div
                  key="languages-edit"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                >
                  <LanguagesEdit
                    currentLanguages={languages}
                    onCancel={() => setEditingSection(null)}
                    onSuccess={() => setEditingSection(null)}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="languages-view"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                >
                  {languages.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {languages.map((l) => (
                        <Badge
                          key={l.languageCode}
                          variant="secondary"
                          className="text-xs"
                        >
                          {l.languageName}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No languages added yet. Click edit to add your languages.
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </SmoothResize>
        </motion.div>
      </motion.div>
    </div>
  );
}
