"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, BookOpen, HandHeart, MessageCirclePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NotificationSettingsSheet } from "@/components/communities/notification-settings-sheet";
import { useRequest } from "@/hooks/use-request";
import type { NotificationPrefs } from "@/lib/notifications";

export const welcomeActionClass = "h-auto min-h-11 justify-start lg:min-h-8";
/** The welcome notice's frame: a compact row with the title, the owner's message and the actions. The forum page passes live actions; the editor preview passes inert ones. */
export function WelcomeCardView({ message, dismiss, preview = false, children }: { message: string | null; dismiss: React.ReactNode; preview?: boolean; children: React.ReactNode }) {
  const t = useTranslations("WelcomeCard");
  return <Card aria-labelledby={preview ? undefined : "welcome-title"} aria-label={preview ? t("title") : undefined}
    className="flex-row flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 shadow-sm">
    <HandHeart className="text-primary size-5 shrink-0" aria-hidden="true" />
    <div className="min-w-0 flex-1 basis-48">
      <h2 id={preview ? undefined : "welcome-title"} className="text-sm font-semibold">{t("title")}</h2>
      {message && <p {...(preview ? { "data-preview-field": "welcome" } : {})} className="line-clamp-2 text-sm whitespace-pre-line break-words text-muted-foreground">{message}</p>}
    </div>
    {dismiss && <div className="sm:order-last">{dismiss}</div>}
    <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">{children}</div>
  </Card>;
}

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
  const action = welcomeActionClass;
  return <WelcomeCardView message={message} dismiss={<Button variant="ghost" size="icon-responsive" aria-label={t("dismiss")} disabled={busy} onClick={() => void dismiss()}><X aria-hidden="true" /></Button>}>
    <>
      {hasRules && <Button asChild variant="ghost" size="sm" className={action}><Link href={`/communities/${slug}/about`} prefetch={false}><BookOpen aria-hidden="true" />{t("rules")}</Link></Button>}
      {introCategoryId && <Button asChild variant="ghost" size="sm" className={action}><Link href={`/communities/${slug}/forum?new=${introCategoryId}`} prefetch={false}><MessageCirclePlus aria-hidden="true" />{t("introduce")}</Link></Button>}
      <Button variant="ghost" size="sm" className={action} onClick={() => setSettings(true)}><Bell aria-hidden="true" />{t("notifications")}</Button>
    </>
    <NotificationSettingsSheet key={JSON.stringify(prefs)} slug={slug} prefs={prefs} open={settings} onOpenChange={setSettings} />
  </WelcomeCardView>;
}
