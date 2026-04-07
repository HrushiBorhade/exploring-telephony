"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { stepVariants, staggerContainer, staggerChild } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
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

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const verifyingRef = useRef(false);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    return () => clearInterval(cooldownRef.current);
  }, []);

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
    toast.success("Code sent!");
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
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <FieldGroup>
        {/* Header — animate on step change */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            className="flex flex-col items-center gap-1 text-center"
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <h1 className="text-2xl font-bold font-heading">
              {step === "phone" ? "Sign in" : "Enter verification code"}
            </h1>
            <p className="text-sm text-balance text-muted-foreground">
              {step === "phone"
                ? "Enter your mobile number to get started"
                : `We sent a 6-digit code to +91${phone.replace(/\D/g, "")}`}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Step content — stagger children */}
        <AnimatePresence mode="wait" initial={false}>
          {step === "phone" ? (
            <motion.div
              key="phone"
              className="flex flex-col gap-4"
              variants={staggerContainer}
              initial="enter"
              animate="center"
              exit="exit"
            >
              <motion.div variants={staggerChild}>
                <Field>
                  <FieldLabel>Phone Number</FieldLabel>
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
                      className="font-mono tracking-widest"
                      autoFocus
                    />
                  </div>
                </Field>
              </motion.div>
              <motion.div variants={staggerChild}>
                <Field>
                  <Button
                    className="w-full"
                    onClick={sendOTP}
                    disabled={loading || phone.replace(/\D/g, "").length !== 10}
                  >
                    {loading ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      "Send Code"
                    )}
                  </Button>
                </Field>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="otp"
              className="flex flex-col gap-4"
              variants={staggerContainer}
              initial="enter"
              animate="center"
              exit="exit"
            >
              <motion.div variants={staggerChild}>
                <Field>
                  <div className="flex justify-center py-2">
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
                  </div>
                  {loading && (
                    <motion.div
                      className="flex justify-center"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                    </motion.div>
                  )}
                </Field>
              </motion.div>
              <motion.div variants={staggerChild}>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    onClick={() => { setStep("phone"); setOtp(""); setResendCooldown(0); clearInterval(cooldownRef.current); }}
                    disabled={loading}
                  >
                    Change number
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    onClick={sendOTP}
                    disabled={loading || resendCooldown > 0}
                  >
                    {resendCooldown > 0 ? `Resend (${resendCooldown}s)` : "Resend code"}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <FieldDescription className="text-center text-xs">
          We'll send a verification code to your phone
        </FieldDescription>
      </FieldGroup>
    </div>
  );
}
