"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Hash, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ChatChannelSetting } from "@/lib/chat-view";
import type { CommunityMember } from "../community-editor";
import { ChannelSheet, chatChannelCall, newChannel } from "./channel-sheet";

export type ChatSettings = { enabled: boolean; dmPolicy: "channels_only" | "members"; channels: ChatChannelSetting[] };

export function ChatChannelsEditor({ slug, initial, members }: {
  slug: string;
  initial: ChatSettings;
  members: CommunityMember[];
}) {
  const t = useTranslations("CommunityChat"), router = useRouter();
  const base = `/api/communities/${slug}/chat`;
  const [settings, setSettings] = useState(initial);
  const [sheet, setSheet] = useState<ChatChannelSetting>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = settings.channels.filter(channel => !channel.archived);
  const channels = [...active, ...settings.channels.filter(channel => channel.archived)];

  async function call(path: string, method: string, body: unknown) {
    setError("");
    const response = await chatChannelCall(base, path, method, body);
    if (!response.ok) { setError(t(response.key)); return null; }
    return response.result;
  }

  async function reorder(id: string, direction: -1 | 1) {
    if (busy) return;
    const ids = active.map(channel => channel.id), position = ids.indexOf(id), other = position + direction;
    if (!ids[other]) return;
    [ids[position], ids[other]] = [ids[other], ids[position]];
    setBusy(true);
    try {
      if (!await call("/channels/reorder", "PUT", { ids })) return;
      setSettings(value => ({ ...value, channels: [...ids.map((id, index) => ({ ...active.find(channel => channel.id === id)!, position: index + 1 })),
        ...value.channels.filter(channel => channel.archived)] }));
      router.refresh();
    } catch { setError(t("actionFailed")); }
    finally { setBusy(false); }
  }

  async function toggle(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (!await call("/settings", "PUT", { chatEnabled: enabled, dmPolicy: settings.dmPolicy })) return;
      setSettings(value => ({ ...value, enabled }));
      router.refresh();
    } catch { setError(t("actionFailed")); }
    finally { setBusy(false); }
  }

  return <div className="space-y-3">
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">{t("enableChat")}
      <Switch checked={settings.enabled} disabled={busy} onCheckedChange={value => void toggle(value)} /></label>
    {!sheet && error && <Alert role="alert" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {settings.enabled && <>
      <ul className="divide-y">
        {channels.map(channel => {
          const index = active.findIndex(item => item.id === channel.id);
          return <li key={channel.id} className="flex min-w-0 flex-wrap items-center gap-1 py-1">
            <Button variant="ghost" className="min-h-11 min-w-0 flex-1 justify-start" onClick={() => { setError(""); setSheet(channel); }}>
              {channel.emoji ? <span aria-hidden="true">{channel.emoji}</span> : <Hash aria-hidden="true" />}
              <span className="truncate">{channel.name}</span>
            </Button>
            {channel.archived ? <Badge variant="outline">{t("archived")}</Badge> : <>
              <Button variant="ghost" size="icon" className="size-11" aria-label={t("moveUp", { name: channel.name })}
                disabled={busy || index < 1} onClick={() => void reorder(channel.id, -1)}><ArrowUp aria-hidden="true" /></Button>
              <Button variant="ghost" size="icon" className="size-11" aria-label={t("moveDown", { name: channel.name })}
                disabled={busy || index === active.length - 1} onClick={() => void reorder(channel.id, 1)}><ArrowDown aria-hidden="true" /></Button>
            </>}
          </li>;
        })}
      </ul>
      <Button variant="outline" className="min-h-11" disabled={busy || active.length >= 30}
        onClick={() => { setError(""); setSheet(newChannel(Math.max(0, ...active.map(channel => channel.position)) + 1)); }}>
        <Plus aria-hidden="true" />{t("newChannel")}
      </Button>
    </>}
    {sheet && <ChannelSheet key={sheet.id || "new"} base={base} channel={sheet} members={members} open onOpenChange={open => { if (!open) setSheet(undefined); }}
      onSaved={entry => {
        setSettings(value => ({ ...value, channels: [...value.channels.filter(channel => channel.id !== entry.id), entry].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)) }));
        setSheet(undefined);
        router.refresh();
      }} />}
  </div>;
}
