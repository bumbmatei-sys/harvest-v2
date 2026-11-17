"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Hash, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { MemberList } from "@/components/communities/member-list";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { channelInput } from "@/lib/chat";
import type { ChatChannelSetting } from "@/lib/chat-view";
import { communityRoles } from "@/lib/community-permissions";
import type { CommunityMember } from "../community-editor";

export type ChatSettings = { enabled: boolean; dmPolicy: "channels_only" | "members"; channels: ChatChannelSetting[] };
const newChannel = (position: number): ChatChannelSetting => ({
  id: "", name: "", emoji: null, description: null, position, posting: "members", accessMode: "all",
  minRole: "member", slowModeSeconds: 0, archived: false, userIds: [],
});
type Options = ChatChannelSetting["accessMode"];

export function ChatChannelsEditor({ slug, initial, members }: {
  slug: string;
  initial: ChatSettings;
  members: CommunityMember[];
}) {
  const t = useTranslations("CommunityChat"), roles = useTranslations("CommunityEditor.roles"), router = useRouter();
  const base = `/api/communities/${slug}/chat`;
  const [settings, setSettings] = useState(initial);
  const [draft, setDraft] = useState<ChatChannelSetting>();
  const [original, setOriginal] = useState<ChatChannelSetting>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const active = settings.channels.filter(channel => !channel.archived);
  const channels = [...active, ...settings.channels.filter(channel => channel.archived)];
  const activeMembers = members.filter(member => member.status === "active");
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);

  function open(channel: ChatChannelSetting) {
    setError("");
    setDraft(channel);
    setOriginal(channel);
    setQuery("");
    setSheetOpen(true);
  }

  const change = <K extends keyof ChatChannelSetting>(key: K, value: ChatChannelSetting[K]) =>
    setDraft(previous => previous && ({ ...previous, [key]: value }));

  async function call(path: string, method: string, body: unknown) {
    setError("");
    const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const key = result?.outcome === "channel_limit" ? "channelLimit" : response.status === 403 ? "forbidden" : "actionFailed";
      setError(t(key));
      return null;
    }
    return result;
  }

  async function save(archived?: boolean) {
    if (!draft || busy) return;
    const { id: existingId, userIds, ...fields } = draft;
    const body = channelInput.safeParse({ ...fields, archived: archived ?? fields.archived });
    if (!body.success) { setError(t("checkChannel")); return; }
    setBusy(true);
    try {
      const saved = await call(existingId ? `/channels/${existingId}` : "/channels", existingId ? "PUT" : "POST", body.data);
      if (!saved) return;
      const id = existingId || saved.channel.id as string;
      setDraft({ ...draft, id });
      if (fields.accessMode === "invite" && (!existingId || JSON.stringify(original?.userIds) !== JSON.stringify(userIds))) {
        const chosen = userIds.filter(id => activeMembers.some(member => member.userId === id));
        if (!await call(`/channels/${id}/members`, "PUT", { userIds: chosen })) return;
      }
      const entry = { id, ...body.data, userIds };
      setSettings(value => ({ ...value, channels: [...value.channels.filter(channel => channel.id !== id), entry].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)) }));
      setSheetOpen(false);
      router.refresh();
    } catch { setError(t("actionFailed")); }
    finally { setBusy(false); }
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

  const errorNotice = error && <Alert role="alert" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
  return <div className="space-y-3">
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">{t("enableChat")}
      <Switch checked={settings.enabled} disabled={busy} onCheckedChange={value => void toggle(value)} /></label>
    {!sheetOpen && errorNotice}
    {settings.enabled && <>
      <ul className="divide-y">
        {channels.map(channel => {
          const index = active.findIndex(item => item.id === channel.id);
          return <li key={channel.id} className="flex min-w-0 flex-wrap items-center gap-1 py-1">
            <Button variant="ghost" className="min-h-11 min-w-0 flex-1 justify-start" onClick={() => open(channel)}>
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
        onClick={() => open(newChannel(Math.max(0, ...active.map(channel => channel.position)) + 1))}>
        <Plus aria-hidden="true" />{t("newChannel")}
      </Button>
    </>}
    <Sheet open={sheetOpen} onOpenChange={open => { if (!busy) setSheetOpen(open); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader><SheetTitle>{t(original?.id ? "editChannel" : "newChannel")}</SheetTitle></SheetHeader>
        {draft && <div className="space-y-4 px-4 pb-4">
          {errorNotice}
          <Field><FieldLabel htmlFor="chat-channel-name">{t("channelName")}</FieldLabel>
            <Input id="chat-channel-name" className="min-h-11" value={draft.name} maxLength={60} onChange={event => change("name", event.target.value)} />
          </Field>
          <Field><FieldLabel htmlFor="chat-channel-emoji">{t("emoji")}</FieldLabel>
            <Input id="chat-channel-emoji" className="min-h-11" value={draft.emoji ?? ""} maxLength={16} onChange={event => change("emoji", event.target.value || null)} />
          </Field>
          <Field><FieldLabel htmlFor="chat-channel-description">{t("description")}</FieldLabel>
            <Input id="chat-channel-description" className="min-h-11" value={draft.description ?? ""} maxLength={200}
              onChange={event => change("description", event.target.value || null)} />
          </Field>
          <Field><FieldLabel htmlFor="chat-channel-access">{t("access")}</FieldLabel>
            <NativeSelect id="chat-channel-access" value={draft.accessMode} className="min-h-11" onChange={event => change("accessMode", event.target.value as Options)}>
              {(["all", "role", "invite", "tier", "tag"] as const).map(value =>
                <NativeSelectOption key={value} value={value} disabled={value === "tier" || value === "tag"}>{t(`accessModes.${value}`)}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          {draft.accessMode === "role" && <Field><FieldLabel htmlFor="chat-channel-role">{t("minimumRole")}</FieldLabel>
            <NativeSelect id="chat-channel-role" className="min-h-11" value={draft.minRole}
              onChange={event => change("minRole", event.target.value as ChatChannelSetting["minRole"])}>
              {communityRoles.map(role => <NativeSelectOption key={role} value={role}>{roles(role)}</NativeSelectOption>)}
            </NativeSelect>
          </Field>}
          {draft.accessMode === "invite" && <div className="space-y-2">
            <Field><FieldLabel htmlFor="chat-channel-members">{t("findMember")}</FieldLabel>
              <Input id="chat-channel-members" className="min-h-11" type="search" value={query} onChange={event => setQuery(event.target.value)} />
            </Field>
            <MemberList label={t("invitedMembers")} audience="member" unnamedLabel={t("formerMember")}
              members={activeMembers.filter(member => member.name.toLowerCase().includes(query.toLowerCase())).map(member => ({
                id: member.userId, name: member.name, role: member.role,
                action: <label className="flex min-h-11 items-center gap-2 px-2 text-sm">
                  <Checkbox aria-label={t("inviteNamed", { name: member.name })} checked={draft.userIds.includes(member.userId)}
                    onCheckedChange={value => change("userIds", value ? [...draft.userIds, member.userId] : draft.userIds.filter(id => id !== member.userId))} />
                  {t("invite")}
                </label>,
              }))} />
          </div>}
          <Field><FieldLabel htmlFor="chat-channel-posting">{t("posting")}</FieldLabel>
            <NativeSelect id="chat-channel-posting" value={draft.posting} className="min-h-11"
              onChange={event => change("posting", event.target.value as ChatChannelSetting["posting"])}>
              <NativeSelectOption value="members">{t("membersCanPost")}</NativeSelectOption>
              <NativeSelectOption value="hosts">{t("hostsCanPost")}</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field><FieldLabel htmlFor="chat-channel-slow">{t("slowMode")}</FieldLabel>
            <Input id="chat-channel-slow" type="number" className="min-h-11" min={0} max={3600} value={draft.slowModeSeconds}
              onChange={event => change("slowModeSeconds", Number(event.target.value))} />
          </Field>
          {!!draft.id && <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void save(!draft.archived)}>
            {t(draft.archived ? "unarchive" : "archive")}
          </Button>}
          <StickySaveBar dirty={dirty} busy={busy} saveDisabled={!draft.name.trim()}
            onDiscard={() => { setDraft(original); setError(""); }} onSave={() => void save()} />
        </div>}
      </SheetContent>
    </Sheet>
  </div>;
}
