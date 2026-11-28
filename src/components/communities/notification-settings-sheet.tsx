/** Derived from Shadcn UI Kit item list-block3 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Community screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  BellOff,
  Heart,
  Mail,
  Megaphone,
  MessageSquareText,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { EmailFrequencyDialog } from "@/components/communities/email-frequency-dialog";
import { useRequest } from "@/hooks/use-request";
import { notificationPrefs, type NotificationPrefs } from "@/lib/notifications";
import { notify } from "@/lib/toast";

const channels = [
  { id: "replies", icon: MessageSquareText },
  { id: "likes", icon: Heart },
  { id: "announcements", icon: Megaphone },
  { id: "muted", icon: BellOff },
] as const;

/**
 * C15a: the member's notification switches for one community, in a side sheet, as the kit's switch list. Muting silences everything
 * in the app. C15c: the Email row opens the email frequency window, which saves through its own route; Save here sends the switches
 * only when they changed.
 */
export function NotificationSettingsSheet({ slug, prefs, open, onOpenChange }: { slug: string; prefs: NotificationPrefs; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("CommunityNotifications"), request = useRequest(), router = useRouter();
  const [draft, setDraft] = useState(prefs), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const activeCount = draft.muted ? 0 : notificationPrefs.filter((key) => draft[key]).length;
  async function save() {
    setError("");
    const switchesChanged = draft.muted !== prefs.muted || notificationPrefs.some((key) => draft[key] !== prefs[key]);
    if (switchesChanged) {
      setBusy(true);
      const switches = await request(`/api/communities/${slug}/notifications/preferences`, { method: "PUT",
        body: { replies: draft.replies, likes: draft.likes, announcements: draft.announcements, muted: draft.muted } });
      setBusy(false);
      if (!switches.ok) { setError(switches.error); notify.error(switches.error, { id: "community-notification-settings" }); return; }
    }
    notify.success(t("savedToast"), { id: "community-notification-settings" });
    onOpenChange(false); router.refresh();
  }
  return <Sheet open={open} onOpenChange={(next) => { if (next) { setDraft(prefs); setError(""); } onOpenChange(next); }}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-md">
      <SheetHeader><SheetTitle>{t("settingsTitle")}</SheetTitle></SheetHeader>
      <div className="space-y-2 px-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <Card className="w-full gap-2">
          <CardHeader>
            <CardTitle>{t("inApp")}</CardTitle>
            <CardDescription className="text-xs">
              {t("activeSummary", { active: activeCount, count: notificationPrefs.length })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-0 has-data-[size=sm]:gap-0">
              {channels.map((channel) => (
                <Item
                  key={channel.id}
                  size="sm"
                  variant="outline"
                  className="min-h-11 rounded-none border-x-0 border-t-0 px-0 last:border-b-0"
                  asChild
                >
                  <label htmlFor={`notify-${channel.id}`} className="cursor-pointer">
                    <ItemMedia className="bg-muted text-muted-foreground size-8 rounded-md border">
                      <channel.icon className="size-4" aria-hidden="true" />
                    </ItemMedia>
                    <ItemContent className="gap-0.5">
                      <ItemTitle>{t(`prefs.${channel.id}`)}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        id={`notify-${channel.id}`}
                        checked={draft[channel.id]}
                        disabled={channel.id !== "muted" && draft.muted}
                        onCheckedChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            [channel.id]: checked,
                          }))
                        }
                      />
                    </ItemActions>
                  </label>
                </Item>
              ))}
              <Item
                size="sm"
                variant="outline"
                className="min-h-11 rounded-none border-x-0 border-t-0 px-0 last:border-b-0"
              >
                <ItemMedia className="bg-muted text-muted-foreground size-8 rounded-md border">
                  <Mail className="size-4" aria-hidden="true" />
                </ItemMedia>
                <ItemContent className="gap-0.5">
                  <ItemTitle>{t("email.title")}</ItemTitle>
                  <ItemDescription className="text-xs">
                    {t(`email.${prefs.email}`)}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <EmailFrequencyDialog slug={slug} value={prefs.email} />
                </ItemActions>
              </Item>
            </ItemGroup>
          </CardContent>
        </Card>
      </div>
      <SheetFooter><Button className="min-h-11" disabled={busy} onClick={() => void save()}>{t("save")}</Button></SheetFooter>
    </SheetContent>
  </Sheet>;
}
