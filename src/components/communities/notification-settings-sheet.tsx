"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useRequest } from "@/hooks/use-request";
import { emailFrequencies, notificationPrefs, type EmailFrequency, type NotificationPrefs } from "@/lib/notifications";
import { notify } from "@/lib/toast";

/**
 * C15a: the member's notification switches for one community, in a side sheet. Muting silences everything in the app.
 * C15c: how often the community may email them. The switches and the email choice are saved through their own routes,
 * and only what changed is sent.
 */
export function NotificationSettingsSheet({ slug, prefs, open, onOpenChange }: { slug: string; prefs: NotificationPrefs; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("CommunityNotifications"), request = useRequest(), router = useRouter();
  const [draft, setDraft] = useState(prefs), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    const switchesChanged = draft.muted !== prefs.muted || notificationPrefs.some((key) => draft[key] !== prefs[key]);
    const switches = switchesChanged ? await request(`/api/communities/${slug}/notifications/preferences`, { method: "PUT",
      body: { replies: draft.replies, likes: draft.likes, announcements: draft.announcements, muted: draft.muted } }) : null;
    const email = (!switches || switches.ok) && draft.email !== prefs.email
      ? await request(`/api/communities/${slug}/notifications/email`, { method: "PUT", body: { frequency: draft.email } }) : null;
    setBusy(false);
    const failed = [switches, email].find((result) => result && !result.ok);
    if (failed && !failed.ok) { setError(failed.error); notify.error(failed.error, { id: "community-notification-settings" }); if (switches?.ok) router.refresh(); return; }
    notify.success(t("savedToast"), { id: "community-notification-settings" });
    onOpenChange(false); router.refresh();
  }
  return <Sheet open={open} onOpenChange={(next) => { if (next) { setDraft(prefs); setError(""); } onOpenChange(next); }}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-md">
      <SheetHeader><SheetTitle>{t("settingsTitle")}</SheetTitle></SheetHeader>
      <div className="space-y-2 px-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {notificationPrefs.map((key) => <Label key={key} htmlFor={`notify-${key}`} className="flex min-h-11 items-center justify-between gap-3 font-normal">{t(`prefs.${key}`)}
          <Switch id={`notify-${key}`} checked={draft[key]} disabled={draft.muted} onCheckedChange={(on) => setDraft((d) => ({ ...d, [key]: on }))} /></Label>)}
        <Label htmlFor="notify-muted" className="flex min-h-11 items-center justify-between gap-3 border-t pt-2 font-normal">{t("prefs.muted")}
          <Switch id="notify-muted" checked={draft.muted} onCheckedChange={(on) => setDraft((d) => ({ ...d, muted: on }))} /></Label>
        <div className="border-t pt-3"><FieldSet className="gap-2">
          <FieldLegend variant="label">{t("email.title")}</FieldLegend>
          <RadioGroup value={draft.email} onValueChange={(value) => setDraft((d) => ({ ...d, email: value as EmailFrequency }))} className="gap-1">
            {emailFrequencies.map((value) => <Label key={value} htmlFor={`email-${value}`} className="flex min-h-11 items-start gap-3 rounded-md py-2 font-normal">
              <RadioGroupItem id={`email-${value}`} value={value} aria-describedby={`email-${value}-hint`} className="mt-0.5" />
              <span className="grid gap-0.5"><span>{t(`email.${value}`)}</span>
                <span id={`email-${value}-hint`} aria-hidden="true" className="text-xs text-muted-foreground">{t(`email.${value}Hint`)}</span></span>
            </Label>)}
          </RadioGroup>
        </FieldSet></div>
      </div>
      <SheetFooter><Button className="min-h-11" disabled={busy} onClick={() => void save()}>{t("save")}</Button></SheetFooter>
    </SheetContent>
  </Sheet>;
}
