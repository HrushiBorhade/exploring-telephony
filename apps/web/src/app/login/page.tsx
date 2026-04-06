"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Phone, LoaderCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";

type Step = "phone" | "otp";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
  exit: { transition: { staggerChildren: 0.04, staggerDirection: -1 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 25 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
};

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const verifyingRef = useRef(false);
  const cooldownRef = useRef<ReturnType<typeof setInterval>>();

  function startCooldown() {
    setResendCooldown(30);
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function sendOTP() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) {
      toast.error("Enter a valid 10-digit mobile number");
      return;
    }
    setLoading(true);
    const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: `+91${digits}` });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Failed to send code");
      return;
    }
    toast.success("Code sent via WhatsApp!");
    setStep("otp");
    startCooldown();
  }

  async function verifyOTP(code: string) {
    if (code.length !== 6 || verifyingRef.current) return;
    verifyingRef.current = true;
    setLoading(true);
    const digits = phone.replace(/\D/g, "");
    const { error } = await authClient.phoneNumber.verify({ phoneNumber: `+91${digits}`, code });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Invalid code");
      setOtp("");
      verifyingRef.current = false;
      return;
    }
    router.push("/capture");
    verifyingRef.current = false;
  }

  function handleOTPChange(value: string) {
    setOtp(value);
    if (value.length === 6) verifyOTP(value);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-8">
        <motion.div
          className="text-center space-y-2"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
        >
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground mx-auto">
            <Phone className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold">Voice Capture</h1>
          <p className="text-sm text-muted-foreground">
            {step === "phone"
              ? "Enter your mobile number to sign in"
              : `Enter the 6-digit code sent to +91${phone.replace(/\D/g, "")}`}
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {step === "phone" ? (
            <motion.div
              key="phone"
              variants={container}
              initial="hidden"
              animate="show"
              exit="exit"
              className="space-y-3"
            >
              <motion.div variants={item}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-muted-foreground shrink-0">+91</span>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder="9876543210"
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    onKeyDown={(e) => e.key === "Enter" && !loading && sendOTP()}
                    disabled={loading}
                    className="text-center font-mono tracking-widest"
                    autoFocus
                  />
                </div>
              </motion.div>
              <motion.div variants={item}>
                <Button
                  className="w-full"
                  onClick={sendOTP}
                  disabled={loading || phone.replace(/\D/g, "").length !== 10}
                >
                  {loading ? (
                    <><LoaderCircle className="size-4 animate-spin" /> Sending...</>
                  ) : (
                    "Send Code"
                  )}
                </Button>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="otp"
              variants={container}
              initial="hidden"
              animate="show"
              exit="exit"
              className="space-y-5"
            >
              <motion.div variants={item} className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  pattern={REGEXP_ONLY_DIGITS}
                  value={otp}
                  onChange={handleOTPChange}
                  disabled={loading}
                  autoFocus
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </motion.div>

              {loading && (
                <motion.div variants={item} className="flex justify-center">
                  <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                </motion.div>
              )}

              <motion.div variants={item} className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-muted-foreground"
                  onClick={() => { setStep("phone"); setOtp(""); setResendCooldown(0); clearInterval(cooldownRef.current); }}
                  disabled={loading}
                >
                  Change number
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-muted-foreground"
                  onClick={sendOTP}
                  disabled={loading || resendCooldown > 0}
                >
                  {resendCooldown > 0 ? `Resend (${resendCooldown}s)` : "Resend code"}
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
