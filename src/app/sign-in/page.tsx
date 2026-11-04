"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ThemeControls } from "@/components/theme-controls";
import { Wheat } from "lucide-react";
export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function send() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (result.error) setError(result.error.message ?? "Could not send your code.");
      else { setSent(true); setMessage("Check your email for a six-digit code. It expires in 10 minutes. Wait 60 seconds before resending."); }
    } catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  async function verify(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await authClient.signIn.emailOtp({ email, otp });
      if (result.error) setError(result.error.message ?? "Check your code and try again.");
      else { router.replace("/workspaces"); router.refresh(); }
    } catch { setError("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="flex min-h-dvh items-center justify-center p-6">
    <div className="absolute right-5 top-5"><ThemeControls /></div>
    <Card className="w-full max-w-sm">
      <CardHeader><p className="mb-6 flex items-center gap-2 text-lg font-semibold"><Wheat className="size-6" aria-hidden="true" />Harvest</p><CardTitle><h1 className="text-[28px] font-semibold leading-tight tracking-[-0.7px]">Sign in to Harvest</h1></CardTitle><CardDescription>Enter your email to receive a sign-in code.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <p role="status" className="text-sm text-muted-foreground">{message}</p>
        <form className="space-y-4" onSubmit={sent ? verify : (event) => { event.preventDefault(); void send(); }}>
          <div className="space-y-2"><Label htmlFor="email">Email address</Label><Input id="email" type="email" autoComplete="email" required value={email} readOnly={sent} onChange={(e) => setEmail(e.target.value)} /></div>
          {sent && <div className="space-y-2"><Label htmlFor="code">Six-digit code</Label><Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value)} /></div>}
          <Button className="w-full" disabled={busy}>{busy ? "Please wait…" : sent ? "Sign in" : "Send sign-in code"}</Button>
        </form>
        {sent && <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void send()}>Resend code</Button><Button variant="ghost" disabled={busy} onClick={() => { setSent(false); setOtp(""); setMessage(""); setError(""); }}>Change email</Button></div>}
      </CardContent>
    </Card>
  </main>;
}
