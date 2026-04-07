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

        <FieldDescription className="text-center text-xs flex items-center justify-center gap-1.5">
          <svg viewBox="0 0 24 24" className="size-3.5 text-[#25D366] shrink-0" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          We&apos;ll send a code via WhatsApp
        </FieldDescription>
      </FieldGroup>
    </div>
  );
}
