"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MemberList } from "@/components/communities/member-list";
import { StickySaveBar } from "@/components/sticky-save-bar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { channelInput } from "@/lib/chat";
import type { ChatChannelSetting } from "@/lib/chat-view";
import { communityRoles } from "@/lib/community-permissions";

export type ChannelSheetMember = { userId: string; name: string; role: string; status?: string };
type Options = ChatChannelSetting["accessMode"];
export const newChannel = (position: number): ChatChannelSetting => ({
  id: "", name: "", emoji: null, description: null, position, posting: "members", accessMode: "all",
  minRole: "member", slowModeSeconds: 0, archived: false, userIds: [],
});

/** One request to the chat channel routes. Resolves the parsed body, or the catalogue key of the error to show. */
export async function chatChannelCall(base: string, path: string, method: string, body?: unknown): Promise<{ ok: true; result: { channel: { id: string }; channels: ChatChannelSetting[] } } | { ok: false; key: "channelLimit" | "forbidden" | "actionFailed" }> {
  try {
    const response = await fetch(`${base}${path}`, body === undefined ? { method } : {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (response.ok) return { ok: true, result };
    return { ok: false, key: result?.outcome === "channel_limit" ? "channelLimit" : response.status === 403 ? "forbidden" : "actionFailed" };
  } catch { return { ok: false, key: "actionFailed" }; }
}

/**
 * Create or edit one channel: name, emoji, description, who can read, who can post, slow mode and archive. Shared by the community
 * editor's Channels step and the chat screens so both use the same fields and the same routes. Mount it with a `key` per channel.
 */
export function ChannelSheet({ base, channel, members, open, onOpenChange, onSaved }: {
  base: string;
  channel: ChatChannelSetting;
  members: ChannelSheetMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (channel: ChatChannelSetting) => void;
}) {
  const t = useTranslations("CommunityChat"), roles = useTranslations("CommunityEditor.roles");
  const original = channel;
  const [draft, setDraft] = useState(channel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const activeMembers = members.filter(member => !member.status || member.status === "active");
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const change = <K extends keyof ChatChannelSetting>(key: K, value: ChatChannelSetting[K]) =>
    setDraft(previous => ({ ...previous, [key]: value }));

  async function save(archived?: boolean) {
    if (busy) return;
    const { id: existingId, userIds, ...fields } = draft;
    const body = channelInput.safeParse({ ...fields, archived: archived ?? fields.archived });
    if (!body.success) { setError(t("checkChannel")); return; }
    setBusy(true);
    setError("");
    try {
      const saved = await chatChannelCall(base, existingId ? `/channels/${existingId}` : "/channels", existingId ? "PUT" : "POST", body.data);
      if (!saved.ok) { setError(t(saved.key)); return; }
      const id = existingId || saved.result.channel.id;
      setDraft({ ...draft, id });
      if (fields.accessMode === "invite" && (!existingId || JSON.stringify(original.userIds) !== JSON.stringify(userIds))) {
        const chosen = userIds.filter(id => activeMembers.some(member => member.userId === id));
        const members = await chatChannelCall(base, `/channels/${id}/members`, "PUT", { userIds: chosen });
        if (!members.ok) { setError(t(members.key)); return; }
      }
      onSaved({ id, ...body.data, userIds });
    } finally { setBusy(false); }
  }

  return <Sheet open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader><SheetTitle>{t(original.id ? "editChannel" : "newChannel")}</SheetTitle></SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          {error && <Alert role="alert" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
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
        </div>
      </SheetContent>
    </Sheet>;
}
