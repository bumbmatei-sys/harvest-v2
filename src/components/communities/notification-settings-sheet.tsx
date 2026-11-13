"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useRequest } from "@/hooks/use-request";
import { notificationPrefs, type NotificationPrefs } from "@/lib/notifications";

/** C15a: the member's notification switches for one community, in a side sheet. Muting silences everything. */
export function NotificationSettingsSheet({ slug, prefs, open, onOpenChange }: { slug: string; prefs: NotificationPrefs; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("CommunityNotifications"), request = useRequest(), router = useRouter();
  const [draft, setDraft] = useState(prefs), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    const result = await request(`/api/communities/${slug}/notifications/preferences`, { method: "PUT", body: draft });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onOpenChange(false); router.refresh();
  }
  return <Sheet open={open} onOpenChange={(next) => { if (next) { setDraft(prefs); setError(""); } onOpenChange(next); }}>
    <SheetContent className="w-full sm:max-w-md">
      <SheetHeader><SheetTitle>{t("settingsTitle")}</SheetTitle></SheetHeader>
      <div className="space-y-2 px-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {notificationPrefs.map((key) => <Label key={key} htmlFor={`notify-${key}`} className="flex min-h-11 items-center justify-between gap-3 font-normal">{t(`prefs.${key}`)}
          <Switch id={`notify-${key}`} checked={draft[key]} disabled={draft.muted} onCheckedChange={(on) => setDraft((d) => ({ ...d, [key]: on }))} /></Label>)}
        <Label htmlFor="notify-muted" className="flex min-h-11 items-center justify-between gap-3 border-t pt-2 font-normal">{t("prefs.muted")}
          <Switch id="notify-muted" checked={draft.muted} onCheckedChange={(on) => setDraft((d) => ({ ...d, muted: on }))} /></Label>
      </div>
      <SheetFooter><Button className="min-h-11" disabled={busy} onClick={() => void save()}>{t("save")}</Button></SheetFooter>
    </SheetContent>
  </Sheet>;
}
