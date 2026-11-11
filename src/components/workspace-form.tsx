"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHydrated } from "@/hooks/use-hydrated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AudienceField } from "@/components/audience-field";
import type { Audience } from "@/lib/audience";
export function WorkspaceForm() {
  const t = useTranslations("ComponentsWorkspaceForm");
  const router = useRouter();
  const hydrated = useHydrated();
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<Audience | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!audience) { setError(t("chooseAMinistryType")); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, audience }) });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      if (!response.ok) { setError(errorMessage((await response.json()).error)); return; }
      setName(""); setAudience(null); router.refresh();
    } catch { setError(t("couldNotConnectPleaseTryAgain")); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <form onSubmit={submit}><FieldGroup><Field><FieldLabel htmlFor="workspace-name">{t("workspaceName")}</FieldLabel><Input id="workspace-name" required maxLength={100} disabled={!hydrated || busy} value={name} onChange={(e) => setName(e.target.value)} /></Field><AudienceField id="new-ministry-audience" value={audience} onChange={setAudience} disabled={!hydrated || busy} required /><Field orientation="horizontal"><Button disabled={!hydrated || busy}>{busy ? t("pleaseWait") : t("createWorkspace")}</Button></Field></FieldGroup></form>
  </div>;
}
