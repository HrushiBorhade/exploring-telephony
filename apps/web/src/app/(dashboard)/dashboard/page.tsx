"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, Target, LoaderCircle } from "lucide-react";
import { motion } from "motion/react";
import { pageStagger, pageFadeUp } from "@/lib/motion";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SectionCards } from "@/components/section-cards";
import { useCreateCapture, useCreateThemedCapture, useThemeAvailability } from "@/lib/api";

type TaskType = "general" | "themed" | null;

export default function DashboardHome() {
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [taskType, setTaskType] = useState<TaskType>(null);
  const [countryCode, setCountryCode] = useState("+91");
  const [phoneB, setPhoneB] = useState("");

  const createCapture = useCreateCapture();
  const createThemedCapture = useCreateThemedCapture();
  const { data: themeAvailability } = useThemeAvailability();

  const creating = createCapture.isPending || createThemedCapture.isPending;
  const phoneValid = phoneB.replace(/\D/g, "").length === 10;

  function openDialog(type: TaskType) {
    setTaskType(type);
    setPhoneB("");
    setDialogOpen(true);
  }

  async function handleCreate() {
    const fullPhone = `${countryCode}${phoneB.replace(/\D/g, "")}`;
    try {
      if (taskType === "general") {
        const result = await createCapture.mutateAsync({
          name: "",
          phoneB: fullPhone,
          language: "multi",
        });
        toast.success("Capture created");
        setDialogOpen(false);
        router.push(`/dashboard/tasks/${result.id}`);
      } else if (taskType === "themed") {
        const result = await createThemedCapture.mutateAsync({
          phoneB: fullPhone,
        });
        toast.success("Themed capture created");
        setDialogOpen(false);
        router.push(`/dashboard/tasks/${result.capture.id}/themed`);
      }
    } catch {
      // onError in hooks already shows the toast
    }
  }

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        {/* Stats row */}
        <SectionCards />

        {/* Task cards */}
        <motion.div
          className="px-4 lg:px-6"
          initial="hidden"
          animate="visible"
          variants={pageStagger}
        >
          <motion.h2
            variants={pageFadeUp}
            className="text-lg font-semibold tracking-tight mb-4"
          >
            Start a New Capture
          </motion.h2>

          <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2">
            {/* General Capture card */}
            <motion.div variants={pageFadeUp}>
              <Card className="relative bg-gradient-to-t from-primary/5 to-card shadow-xs dark:bg-card transition-all duration-200 hover:-translate-y-0.5 hover:ring-1 hover:ring-foreground/20">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center size-9 rounded-lg bg-primary/10">
                      <Phone className="size-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle>General Capture</CardTitle>
                    </div>
                  </div>
                  <CardDescription className="mt-2">
                    Bridge two phone numbers and record a free-form conversation in any language.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    className="w-full"
                    onClick={() => openDialog("general")}
                  >
                    Start &rarr;
                  </Button>
                </CardContent>
              </Card>
            </motion.div>

            {/* Special Theme Capture card */}
            <motion.div variants={pageFadeUp}>
              <Card className="relative bg-gradient-to-t from-primary/5 to-card shadow-xs dark:bg-card transition-all duration-200 hover:-translate-y-0.5 hover:ring-1 hover:ring-foreground/20">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center size-9 rounded-lg bg-emerald-500/10">
                      <Target className="size-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="flex items-center gap-2">
                      <CardTitle>Special Theme Capture</CardTitle>
                      <Badge variant="default" className="text-[10px] px-1.5 py-0">
                        New
                      </Badge>
                    </div>
                  </div>
                  <CardDescription className="mt-2">
                    Record a guided conversation using a themed prompt with form validation.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {themeAvailability && themeAvailability.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {themeAvailability.map((lang) => (
                        <Badge
                          key={lang.language}
                          variant="outline"
                          className="text-xs gap-1 text-muted-foreground border-border"
                        >
                          {lang.language}
                          <span className="font-mono tabular-nums">
                            {lang.available}/{lang.total}
                          </span>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <Button
                    className="w-full"
                    onClick={() => openDialog("themed")}
                  >
                    Start &rarr;
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </motion.div>
      </div>

      {/* Phone number dialog — shared for both task types */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!creating) setDialogOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {taskType === "themed" ? "New Themed Capture" : "New Capture"}
            </DialogTitle>
            <DialogDescription>
              Enter the phone number to call. We will bridge it with your registered number.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label htmlFor="dialog-phone-b" className="text-sm font-medium">
                Phone Number
              </label>
              <div className="flex items-center gap-2">
                <Select
                  value={countryCode}
                  onValueChange={(v) => setCountryCode(v ?? "+91")}
                  disabled={creating}
                >
                  <SelectTrigger className="w-[90px] shrink-0 font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="+91">+91</SelectItem>
                    <SelectItem value="+1">+1</SelectItem>
                    <SelectItem value="+44">+44</SelectItem>
                    <SelectItem value="+971">+971</SelectItem>
                    <SelectItem value="+65">+65</SelectItem>
                    <SelectItem value="+61">+61</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  id="dialog-phone-b"
                  type="tel"
                  inputMode="numeric"
                  placeholder="9876543210"
                  maxLength={10}
                  value={phoneB}
                  onChange={(e) => setPhoneB(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  disabled={creating}
                  className="font-mono tracking-widest"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              className="w-full sm:w-auto"
              onClick={handleCreate}
              disabled={!phoneValid || creating}
            >
              {creating ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create & Open"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
