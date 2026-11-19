/** Layout and behaviour modelled on bumbmatei-sys/Admin-dashboard (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/dashboard/(auth)/pages/profile/components/complete-your-profile.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useState } from "react";
import { Bell, ChevronRight, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NotificationSettingsSheet } from "@/components/communities/notification-settings-sheet";
import { useRequest } from "@/hooks/use-request";
import type { NotificationPrefs } from "@/lib/notifications";

/**
 * The viewer's own settings in this community. Each row opens the service that owns it: account name and language, the notification
 * switches, and member messages. Nothing here keeps a second copy of those settings. `acceptMembers` is null when messages are not on.
 */
export function MemberProfileSettings({ slug, prefs, acceptMembers }: { slug: string; prefs: NotificationPrefs; acceptMembers: boolean | null }) {
  const t = useTranslations("CommunityProfile"), request = useRequest();
  const [sheet, setSheet] = useState(false), [accept, setAccept] = useState(acceptMembers ?? true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function change(next: boolean) {
    setBusy(true); setError("");
    const result = await request<{ outcome?: string }>(`/api/communities/${slug}/chat/dms/preferences`, { method: "PUT", body: { acceptMembers: next } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setAccept(next);
  }
  const row = "flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-start hover:bg-muted/60";
  return <Card>
    <CardHeader><CardTitle>{t("settings")}</CardTitle></CardHeader>
    <CardContent className="space-y-1">
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <Link href="/account/profile" prefetch={false} className={row}><span className="flex items-center gap-3"><UserRound className="size-4 text-muted-foreground" aria-hidden="true" />{t("accountDetails")}</span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></Link>
      <Button type="button" variant="ghost" className={`${row} h-auto !px-2 font-normal`} onClick={() => setSheet(true)}>
        <span className="flex items-center gap-3"><Bell className="size-4 text-muted-foreground" aria-hidden="true" />{t("notifications")}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></Button>
      {acceptMembers !== null && <Label htmlFor="accept-members" className="flex min-h-11 items-center justify-between gap-3 !px-2 font-normal">{t("acceptMessages")}
        <Switch id="accept-members" checked={accept} disabled={busy} onCheckedChange={(on) => void change(on)} /></Label>}
    </CardContent>
    <NotificationSettingsSheet slug={slug} prefs={prefs} open={sheet} onOpenChange={setSheet} />
  </Card>;
}
