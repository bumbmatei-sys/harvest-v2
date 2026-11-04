"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  async function send() {
    setBusy(true); setError(""); setMessage(""); setCodeInvalid(false);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (result.error) setError(result.error.message ?? "Could not send your code.");
      else { setSent(true); setMessage("Check your email for a six-digit code. It expires in 10 minutes. Wait 60 seconds before resending."); }
    } catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  async function verify(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setCodeInvalid(false);
    try {
      const result = await authClient.signIn.emailOtp({ email, otp });
      if (result.error) { setError(result.error.message ?? "Check your code and try again."); setCodeInvalid(true); }
      else { router.replace("/workspaces"); router.refresh(); }
    } catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-dvh items-center justify-center p-6">
    <Card className="w-full max-w-sm">
      <CardHeader><p className="mb-4 text-sm font-semibold">Harvest</p><CardTitle><h1 className="text-[28px] font-semibold leading-tight tracking-[-0.7px]">Sign in to Harvest</h1></CardTitle><CardDescription>Enter your email to receive a sign-in code.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {error && <Alert id="sign-in-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {message && <Alert id="sign-in-status" role="status"><AlertDescription>{message}</AlertDescription></Alert>}
        <form className="space-y-4" onSubmit={sent ? verify : (event) => { event.preventDefault(); void send(); }}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="email">Email address</FieldLabel><Input id="email" type="email" autoComplete="email" required value={email} readOnly={sent} onChange={(e) => setEmail(e.target.value)} /></Field>
            {sent && <Field data-invalid={codeInvalid}>
              <FieldLabel htmlFor="code">Six-digit code</FieldLabel>
              <InputOTP id="code" inputMode="numeric" autoComplete="one-time-code" pattern={REGEXP_ONLY_DIGITS} minLength={6} maxLength={6} required disabled={busy} value={otp} onChange={setOtp} aria-invalid={codeInvalid} aria-describedby={[message && "sign-in-status", codeInvalid && "sign-in-error"].filter(Boolean).join(" ") || undefined}>
                <InputOTPGroup>
                  {Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} aria-invalid={codeInvalid} />)}
                </InputOTPGroup>
              </InputOTP>
            </Field>}
            <Button className="w-full" disabled={busy || (sent && otp.length !== 6)}>{busy ? "Please wait…" : sent ? "Sign in" : "Send sign-in code"}</Button>
          </FieldGroup>
        </form>
        {sent && <ButtonGroup aria-label="Sign-in options"><Button variant="outline" disabled={busy} onClick={() => void send()}>Resend code</Button><Button variant="ghost" disabled={busy} onClick={() => { setSent(false); setOtp(""); setMessage(""); setError(""); setCodeInvalid(false); }}>Change email</Button></ButtonGroup>}
      </CardContent>
    </Card>
  </main>;
}
