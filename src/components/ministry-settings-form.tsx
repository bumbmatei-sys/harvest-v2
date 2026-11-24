"use client";
import { errorMessage } from "@/i18n/messages";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHydrated } from "@/hooks/use-hydrated";
import type { Audience } from "@/lib/audience";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MinistryTypeCards } from "@/components/ministry-type-cards";
import { SettingsSection } from "@/components/settings/settings-section";
import { TimeZoneCombobox } from "@/components/time-zone-combobox";
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
  const suffix = inline ? "-inline" : "", level = inline ? 3 : 2;
  return <form id={formId} onSubmit={save} className="space-y-4" data-testid="ministry-settings">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {!writable && <Alert><AlertDescription>{t("onlyOwnersAndAdmins")}</AlertDescription></Alert>}
    <SettingsSection id={`ministry-type${suffix}`} title={t("typeTitle")} description={t("typeDescription")} stacked={inline} level={level}>
      <MinistryTypeCards id={`ministry-audience${suffix}`} labelledBy={`ministry-type${suffix}-title`} value={audience} onChange={setAudience} disabled={!hydrated || !writable || busy} />
    </SettingsSection>
    <SettingsSection id={`ministry-zone${suffix}`} title={t("timeZone")} description={t("zoneDescription")} stacked={inline} level={level}>
      <TimeZoneCombobox id={`ministry-time-zone${suffix}`} labelledBy={`ministry-zone${suffix}-title`} value={zone} onChange={setZone} disabled={!hydrated || !writable || busy} />
    </SettingsSection>
    {writable && inline ? <div className="flex items-center gap-3"><Button type="submit" className="min-h-11" disabled={!hydrated || busy || !dirty || !audience}>{t(busy ? "saving" : "save")}</Button>
      <span role="status" className="text-sm text-muted-foreground">{dirty ? t("unsaved") : t("savedState")}</span></div>
      : writable ? <StickySaveBar form={formId} dirty={dirty} busy={busy} saveDisabled={!audience} onDiscard={() => { setAudience(saved); setZone(savedZone); setError(""); }} /> : null}
  </form>;
}
