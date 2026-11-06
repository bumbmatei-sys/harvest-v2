"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useHydrated } from "@/hooks/use-hydrated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
export function WorkspaceForm({ onCreated }: { onCreated?: (tenantId: string) => void } = {}) {
  const t = useTranslations("ComponentsWorkspaceForm");
  const router = useRouter();
  const hydrated = useHydrated();
  const nameId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (response.status === 401) { router.replace("/sign-in"); return; }
      if (!response.ok) { setError(errorMessage((await response.json()).error)); return; }
      const workspace: { tenantId: string } = await response.json();
      setName("");
      if (onCreated) onCreated(workspace.tenantId);
      else router.refresh();
    } catch { setError(t("couldNotConnectPleaseTryAgain")); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <form onSubmit={submit}><FieldGroup><Field><FieldLabel htmlFor={nameId}>{t("workspaceName")}</FieldLabel><Input id={nameId} required maxLength={100} disabled={!hydrated || busy} value={name} onChange={(e) => setName(e.target.value)} /></Field><Field orientation="horizontal"><Button disabled={!hydrated || busy}>{busy ? t("pleaseWait") : t("createWorkspace")}</Button></Field></FieldGroup></form>
  </div>;
}
