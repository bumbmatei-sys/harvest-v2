"use client";
import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useHydrated } from "@/hooks/use-hydrated";
import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const word = "DELETE";

/** The typed confirmation for account deletion. A sign-in older than 15 minutes is asked to sign in again first. */
export function DeleteAccountForm({ fresh }: { fresh: boolean }) {
  const t = useTranslations("YourData"), hydrated = useHydrated();
  const [typed, setTyped] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [stale, setStale] = useState(!fresh), [done, setDone] = useState(false);
  async function signInAgain() { await authClient.signOut().catch(() => undefined); window.location.replace("/sign-in?personal=1&next=%2Faccount%2Fdelete"); }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typed !== word || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: typed }) });
      const body = await response.json().catch(() => ({})) as { details?: { code?: string } };
      if (response.ok) { setDone(true); return; }
      if (response.status === 401) { setStale(true); return; }
      setError(t(body.details?.code === "SOLE_OWNER" ? "soleOwnerShort" : body.details?.code === "OFFICE_DISCONNECT_FAILED" ? "disconnectFailed" : "deleteFailed"));
    } catch { setError(t("deleteFailed")); }
    finally { setBusy(false); }
  }
  if (done) return <div className="space-y-4"><p role="status" className="font-medium">{t("deleted")}</p>
    <Button asChild className="min-h-11"><Link href="/" prefetch={false}>{t("home")}</Link></Button></div>;
  if (stale) return <Alert role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{t("reauth")}
    <Button type="button" className="min-h-11" onClick={() => void signInAgain()}>{t("signInAgain")}</Button></AlertDescription></Alert>;
  return <form onSubmit={submit} className="space-y-4">
    <Field><FieldLabel htmlFor="delete-confirm">{t("typeToConfirm", { word })}</FieldLabel>
      <Input id="delete-confirm" className="min-h-11" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={!hydrated || busy} /></Field>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-3">
      <Button type="submit" variant="destructive" className="min-h-11" disabled={!hydrated || busy || typed !== word}>{busy ? t("deleting") : t("deleteAccount")}</Button>
      <Button asChild variant="outline" className="min-h-11"><Link href="/account/profile">{t("cancel")}</Link></Button>
    </div>
  </form>;
}
