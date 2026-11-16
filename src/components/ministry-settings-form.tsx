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
import { Spinner } from "@/components/ui/spinner";
import { notify } from "@/lib/toast";
import { Separator } from "@/components/ui/separator";

export function MinistrySettingsForm({ tenantId, current, writable }: { tenantId: string; current: Audience | null; writable: boolean }) {
  const t = useTranslations("ComponentsMinistrySettingsForm");
  const router = useRouter(), hydrated = useHydrated();
  const [audience, setAudience] = useState(current), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (!audience) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${tenantId}/audience`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience }) });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      if (!response.ok) { setError(errorMessage((await response.json()).error) ?? t("couldNotSaveTryAgain")); return; }
      notify.success(t("saved")); router.refresh();
    } catch { setError(t("couldNotConnectPleaseTryAgain")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-4">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <AudienceField id="ministry-audience" value={audience} onChange={setAudience} disabled={!hydrated || !writable || busy} />
    {writable ? <div className="space-y-4"><Separator /><div className="flex justify-end"><Button size="responsive" disabled={busy || !audience || audience === current}>{busy ? <><Spinner decorative size="sm" />{t("saving")}</> : t("save")}</Button></div></div>
      : <Alert><AlertDescription>{t("onlyOwnersAndAdmins")}</AlertDescription></Alert>}
  </form>;
}
