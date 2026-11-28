/** Derived from Shadcn UI Kit item dashboard-modal13 (premium), registry retrieved 2026-11-28, approved 2026-11-27 (Account and newsletter screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Trash2Icon } from "lucide-react";

import { useHydrated } from "@/hooks/use-hydrated";
import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const word = "DELETE";
const removed = ["removedProfile", "removedDms", "removedCourses", "removedMemberships", "removedConnections", "removedSessions"] as const;
const kept = ["keptPosts", "keptAudit", "keptMinistry"] as const;

/**
 * Delete my account, laid out as the kit's alert dialog shown in place on the page (not a modal, so the lists stay readable). Lists what is deleted
 * and what stays; the ministry's only owner is blocked; a sign-in older than 15 minutes is asked to sign in again; then the typed confirmation.
 */
export function DeleteAccountForm({ fresh, blockers }: { fresh: boolean; blockers: { id: string; name: string }[] }) {
  const t = useTranslations("YourData"), hydrated = useHydrated();
  const [typed, setTyped] = React.useState(""), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""), [stale, setStale] = React.useState(!fresh), [done, setDone] = React.useState(false);
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
  const cancel = <Button asChild variant="outline" className="min-h-11"><Link href="/account/profile">{t("cancel")}</Link></Button>;

  return (
    <div
      data-slot="alert-dialog-content"
      data-size="default"
      className="group/alert-dialog-content grid w-full gap-4 rounded-lg border bg-background p-6 shadow-lg"
    >
      <AlertDialogHeader>
        <AlertDialogMedia>
          <Trash2Icon className="text-destructive" aria-hidden="true" />
        </AlertDialogMedia>
        <h1 className="text-lg font-semibold sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2">{t("deleteTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("deleteHelp")}
        </p>
      </AlertDialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="delete-removed" className="space-y-2"><h2 id="delete-removed" className="text-sm font-medium">{t("removedTitle")}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{removed.map((key) => <li key={key}>{t(key)}</li>)}</ul></section>
        <section aria-labelledby="delete-kept" className="space-y-2"><h2 id="delete-kept" className="text-sm font-medium">{t("keptTitle")}</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{kept.map((key) => <li key={key}>{t(key)}</li>)}</ul></section>
      </div>
      {blockers.length > 0 ? <>
        <Alert variant="destructive" role="alert"><AlertTitle>{t("soleOwnerTitle")}</AlertTitle>
          <AlertDescription><p>{t("soleOwnerBody")}</p><ul className="mt-2 list-disc pl-5">{blockers.map((ministry) => <li key={ministry.id}>{ministry.name}</li>)}</ul></AlertDescription></Alert>
        <AlertDialogFooter>{cancel}</AlertDialogFooter>
      </> : done ? <div className="space-y-4"><p role="status" className="font-medium">{t("deleted")}</p>
        <AlertDialogFooter><Button asChild className="min-h-11"><Link href="/" prefetch={false}>{t("home")}</Link></Button></AlertDialogFooter></div>
      : stale ? <Alert role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{t("reauth")}
          <Button type="button" className="min-h-11" onClick={() => void signInAgain()}>{t("signInAgain")}</Button></AlertDescription></Alert>
      : <form onSubmit={submit} className="grid gap-4">
        <Field><FieldLabel htmlFor="delete-confirm">{t("typeToConfirm", { word })}</FieldLabel>
          <Input id="delete-confirm" className="min-h-11" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={!hydrated || busy} /></Field>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <AlertDialogFooter>
          {cancel}
          <Button type="submit" variant="destructive" className="min-h-11" disabled={!hydrated || busy || typed !== word}>
            {busy ? t("deleting") : t("deleteAccount")}
          </Button>
        </AlertDialogFooter>
      </form>}
    </div>
  );
}
