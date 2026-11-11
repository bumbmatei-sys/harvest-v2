"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ThemeControls } from "@/components/theme-controls";
import { Wheat } from "lucide-react";
import { useHydrated } from "@/hooks/use-hydrated";
const communityReturn=/^\/communities\/[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])(?:\?invite=[a-f0-9]{64})?$/;
export default function SignIn() {
  const t = useTranslations("AppSignInPage");
  const hydrated = useHydrated();
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
      if (result.error) setError(errorMessage(result.error, "AppSignInPage.couldNotSendYourCode"));
      else { setSent(true); setMessage(t("checkYourEmailForASixDigitCode")); }
    } catch { setError(t("couldNotConnectPleaseTryAgain")); }
    finally { setBusy(false); }
  }
  async function verify(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setCodeInvalid(false);
    try {
      const result = await authClient.signIn.emailOtp({ email, otp });
      if (result.error) { setError(errorMessage(result.error, "AppSignInPage.checkYourCodeAndTryAgain")); setCodeInvalid(true); }
      else {
        // Start a fresh document after the session cookie changes. Overlapping
        // replace/refresh transitions can remount the signed-out route.
        if(new URLSearchParams(window.location.search).get("connect")==="1"){
          const continuation=await fetch("/api/connect/invitations/continuation",{cache:"no-store"}).then(r=>r.ok?r.json():null).catch(()=>null);
          window.location.replace(continuation?.next==="/connect/claim"?"/connect/claim":"/account/welcome");
        }else{
          const query=new URLSearchParams(window.location.search),next=query.get("next");
          // Only a community page (optionally with its invitation) may be a return path, never an arbitrary URL.
          window.location.replace(next&&communityReturn.test(next)?next:query.get("personal")==="1"?"/account/welcome":"/workspaces");
        }
      }
    } catch { setError(t("couldNotConnectPleaseTryAgain")); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-dvh items-center justify-center p-6">
    <div className="absolute right-5 top-5"><ThemeControls touchTargets /></div>
    <Card className="w-full max-w-sm">
      <CardHeader><p className="mb-6 flex items-center gap-2 text-lg font-semibold"><Wheat className="size-6" aria-hidden="true" />{t("harvest")}</p><CardTitle><h1 className="text-[28px] font-semibold leading-tight tracking-[-0.7px]">{t("signInToHarvest")}</h1></CardTitle><CardDescription>{t("enterYourEmailToReceiveASignIn")}</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {error && <Alert id="sign-in-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {message && <Alert id="sign-in-status" role="status"><AlertDescription>{message}</AlertDescription></Alert>}
        <form className="space-y-4" onSubmit={sent ? verify : (event) => { event.preventDefault(); void send(); }}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="email">{t("emailAddress")}</FieldLabel><Input className="min-h-11" id="email" type="email" autoComplete="email" required disabled={!hydrated || busy} value={email} readOnly={sent} onChange={(e) => setEmail(e.target.value)} /></Field>
            {sent && <Field data-invalid={codeInvalid}>
              <FieldLabel htmlFor="code">{t("sixDigitCode")}</FieldLabel>
              <InputOTP id="code" inputMode="numeric" autoComplete="one-time-code" pattern={REGEXP_ONLY_DIGITS} minLength={6} maxLength={6} required disabled={busy} value={otp} onChange={setOtp} aria-invalid={codeInvalid} aria-describedby={[message && "sign-in-status", codeInvalid && "sign-in-error"].filter(Boolean).join(" ") || undefined}>
                <InputOTPGroup>
                  {Array.from({ length: 6 }, (_, index) => <InputOTPSlot className="min-h-11" key={index} index={index} aria-invalid={codeInvalid} />)}
                </InputOTPGroup>
              </InputOTP>
            </Field>}
            <Button className="min-h-11 w-full" disabled={!hydrated || busy || (sent && otp.length !== 6)}>{busy ? t("pleaseWait") : sent ? t("signIn") : t("sendSignInCode")}</Button>
          </FieldGroup>
        </form>
        {sent && <ButtonGroup aria-label={t("signInOptions")}><Button className="min-h-11" variant="outline" disabled={busy} onClick={() => void send()}>{t("resendCode")}</Button><Button className="min-h-11" variant="ghost" disabled={busy} onClick={() => { setSent(false); setOtp(""); setMessage(""); setError(""); setCodeInvalid(false); }}>{t("changeEmail")}</Button></ButtonGroup>}
      </CardContent>
    </Card>
  </main>;
}
