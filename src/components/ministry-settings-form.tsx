"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHydrated } from "@/hooks/use-hydrated";
import type { Audience } from "@/lib/audience";
import { AudienceField } from "@/components/audience-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export function MinistrySettingsForm({ tenantId, current, writable }: { tenantId: string; current: Audience | null; writable: boolean }) {
  const t = useTranslations("ComponentsMinistrySettingsForm");
  const router = useRouter(), hydrated = useHydrated();
  const [audience, setAudience] = useState(current), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (!audience) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${tenantId}/audience`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience }) });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      if (!response.ok) { setError(errorMessage((await response.json()).error) ?? t("couldNotSaveTryAgain")); return; }
      setMessage(t("saved")); router.refresh();
    } catch { setError(t("couldNotConnectPleaseTryAgain")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-4">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <AudienceField id="ministry-audience" value={audience} onChange={setAudience} disabled={!hydrated || !writable || busy} />
    {message && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
    {writable ? <div className="space-y-4"><Separator /><div className="flex justify-end"><Button size="responsive" disabled={busy || !audience || audience === current}>{busy ? t("saving") : t("save")}</Button></div></div>
      : <Alert><AlertDescription>{t("onlyOwnersAndAdmins")}</AlertDescription></Alert>}
  </form>;
}
