"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { motion } from "motion/react";
import { staggerContainer, staggerChild } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  profileSchema,
  type ProfileFormValues,
  GENDERS,
  INDIAN_STATES,
} from "@/lib/schemas/onboarding";
import { useUpdateProfile } from "@/lib/api";
import type { StepProps } from "./shared";

export function ProfileStep({ onNext, profile }: StepProps) {
  const updateProfile = useUpdateProfile();

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: profile.profile?.name ?? "",
      age: profile.profile?.age ?? (undefined as unknown as number),
      gender: profile.profile?.gender ?? "",
      state: profile.profile?.state ?? "",
      city: profile.profile?.city ?? "",
    },
  });

  async function onSubmit(data: ProfileFormValues) {
    try {
      await updateProfile.mutateAsync(data);
      onNext();
    } catch (err: any) {
      // Map server field errors to form
      if (err.fields) {
        Object.entries(err.fields).forEach(([field, message]) => {
          setError(field as keyof ProfileFormValues, {
            message: message as string,
          });
        });
      }
    }
  }

  return (
    <>
      <CardHeader className="p-0">
        <CardTitle className="font-heading">Complete your profile</CardTitle>
        <CardDescription>Tell us about yourself</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <form onSubmit={handleSubmit(onSubmit)}>
          <motion.div
            className="flex flex-col gap-4"
            variants={staggerContainer}
            initial="enter"
            animate="center"
          >
            <motion.div variants={staggerChild} className="space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium">
                Full Name
              </label>
              <Input
                id="name"
                placeholder="Enter your name"
                maxLength={100}
                {...register("name")}
                disabled={updateProfile.isPending}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </motion.div>

            <motion.div variants={staggerChild} className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="age" className="text-sm font-medium">
                  Age
                </label>
                <Input
                  id="age"
                  type="number"
                  inputMode="numeric"
                  placeholder="25"
                  min={18}
                  max={100}
                  {...register("age", { valueAsNumber: true })}
                  disabled={updateProfile.isPending}
                />
                {errors.age && (
                  <p className="text-xs text-destructive">{errors.age.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Gender</label>
                <Select
                  defaultValue={profile.profile?.gender}
                  onValueChange={(v) => v && setValue("gender", v)}
                  disabled={updateProfile.isPending}
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
            </motion.div>

            <motion.div variants={staggerChild} className="space-y-1.5">
              <label className="text-sm font-medium">State</label>
              <Select
                defaultValue={profile.profile?.state}
                onValueChange={(v) => v && setValue("state", v)}
                disabled={updateProfile.isPending}
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
            </motion.div>

            <motion.div variants={staggerChild} className="space-y-1.5">
              <label htmlFor="city" className="text-sm font-medium">
                City
              </label>
              <Input
                id="city"
                placeholder="Enter your city"
                maxLength={100}
                {...register("city")}
                disabled={updateProfile.isPending}
              />
              {errors.city && (
                <p className="text-xs text-destructive">{errors.city.message}</p>
              )}
            </motion.div>

            <motion.div variants={staggerChild}>
              <Button
                type="submit"
                className="w-full"
                disabled={updateProfile.isPending}
              >
                {updateProfile.isPending ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </motion.div>
          </motion.div>
        </form>
      </CardContent>
    </>
  );
}
