"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, BookOpen, MessageCirclePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationSettingsSheet } from "@/components/communities/notification-settings-sheet";
import { useRequest } from "@/hooks/use-request";
import type { NotificationPrefs } from "@/lib/notifications";

/** C15a: dismissible welcome checklist at the top of the forum: the owner's message, the rules, an introduction and notifications. */
export function WelcomeCard({ slug, message, introCategoryId, prefs, hasRules }: { slug: string; message: string | null; introCategoryId: string | null; prefs: NotificationPrefs; hasRules: boolean }) {
  const t = useTranslations("WelcomeCard"), request = useRequest(), router = useRouter();
  const [settings, setSettings] = useState(false), [gone, setGone] = useState(false), [busy, setBusy] = useState(false);
  async function dismiss() {
    setBusy(true);
    const result = await request(`/api/communities/${slug}/notifications/welcome/dismiss`, { method: "POST" });
    setBusy(false);
    if (result.ok) { setGone(true); router.refresh(); }
  }
  if (gone) return null;
  const action = "min-h-11 justify-start";
  return <Card aria-labelledby="welcome-title">
    <CardHeader className="flex flex-row items-start justify-between gap-3">
      <CardTitle><h2 id="welcome-title" className="text-lg font-semibold">{t("title")}</h2></CardTitle>
      <Button variant="ghost" size="icon" className="size-11" aria-label={t("dismiss")} disabled={busy} onClick={() => void dismiss()}><X aria-hidden="true" /></Button>
    </CardHeader>
    <CardContent className="space-y-4">
      {message && <p className="whitespace-pre-line break-words">{message}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {hasRules && <Button asChild variant="outline" className={action}><Link href={`/communities/${slug}/about`} prefetch={false}><BookOpen aria-hidden="true" />{t("rules")}</Link></Button>}
        {introCategoryId && <Button asChild variant="outline" className={action}><Link href={`/communities/${slug}/forum?new=${introCategoryId}`} prefetch={false}><MessageCirclePlus aria-hidden="true" />{t("introduce")}</Link></Button>}
        <Button variant="outline" className={action} onClick={() => setSettings(true)}><Bell aria-hidden="true" />{t("notifications")}</Button>
      </div>
    </CardContent>
    <NotificationSettingsSheet key={JSON.stringify(prefs)} slug={slug} prefs={prefs} open={settings} onOpenChange={setSettings} />
  </Card>;
}
