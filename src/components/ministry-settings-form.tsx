"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHydrated } from "@/hooks/use-hydrated";
import type { Audience } from "@/lib/audience";
import { AudienceField } from "@/components/audience-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { timeZoneChoices } from "@/lib/time-zone";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/toast";

/** `inline` (the Settings pop-up) ends the form with its own Save button: the sticky bar belongs to full pages. */
export function MinistrySettingsForm({ tenantId, current, timeZone: currentZone = "UTC", writable, inline = false }: { tenantId: string; current: Audience | null; timeZone?: string; writable: boolean; inline?: boolean }) {
  const t = useTranslations("ComponentsMinistrySettingsForm");
  const router = useRouter(), hydrated = useHydrated();
  const [audience, setAudience] = useState(current), [saved, setSaved] = useState(current), [zone, setZone] = useState(currentZone), [savedZone, setSavedZone] = useState(currentZone), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dirty = writable && (audience !== saved || zone !== savedZone), formId = inline ? "ministry-settings-form-inline" : "ministry-settings-form";
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (!audience || (audience === saved && zone === savedZone)) return;
    setBusy(true); setError("");
    try {
      const send = (path: string, body: object) => fetch(`/api/workspaces/${tenantId}/${path}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (audience !== saved) {
        const response = await send("audience", { audience });
        if (response.status === 401) { router.replace("/sign-in"); return; }
        if (!response.ok) { setError(errorMessage((await response.json()).error) ?? t("couldNotSaveTryAgain")); return; }
        setSaved(audience);
      }
      if (zone !== savedZone) {
        const response = await send("time-zone", { timeZone: zone });
        if (response.status === 401) { router.replace("/sign-in"); return; }
        if (!response.ok) { setError(errorMessage((await response.json()).error) ?? t("couldNotSaveTryAgain")); return; }
        setSavedZone(zone);
      }
      notify.success(t("saved")); router.refresh();
    } catch { setError(t("couldNotConnectPleaseTryAgain")); }
    finally { setBusy(false); }
  }
  return <form id={formId} onSubmit={save} className="space-y-4">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <AudienceField id={`ministry-audience${inline ? "-inline" : ""}`} value={audience} onChange={setAudience} disabled={!hydrated || !writable || busy} />
    <div className="space-y-2"><Label htmlFor={`ministry-time-zone${inline ? "-inline" : ""}`}>{t("timeZone")}</Label>
      <NativeSelect id={`ministry-time-zone${inline ? "-inline" : ""}`} className="min-h-11 w-full lg:min-h-9" value={zone} onChange={(event) => setZone(event.target.value)} disabled={!hydrated || !writable || busy}>
        {timeZoneChoices(savedZone).map((name) => <option key={name} value={name}>{name}</option>)}</NativeSelect></div>
    {writable && inline ? <Button type="submit" className="min-h-11" disabled={!hydrated || busy || !dirty || !audience}>{t(busy ? "saving" : "save")}</Button>
      : writable ? <StickySaveBar form={formId} dirty={dirty} busy={busy} saveDisabled={!audience} onDiscard={() => { setAudience(saved); setZone(savedZone); setError(""); }} />
      : <Alert><AlertDescription>{t("onlyOwnersAndAdmins")}</AlertDescription></Alert>}
  </form>;
}
