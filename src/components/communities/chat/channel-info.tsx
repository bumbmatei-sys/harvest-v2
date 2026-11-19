/** Derived from bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/group-detail-drawer.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useState } from "react";
import { ArrowLeft, ExternalLink, Hash, Lock, Pin } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import UserAvatar from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { channelEligible, channelMutes } from "@/lib/chat";
import { channelLinks, plainChatBody, type ChatChannel, type ChatChannelSetting, type ChatMessage } from "@/lib/chat-view";
import type { DirectoryMember } from "@/server/community-forum";

const pageSize = 20;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2 border-t px-4 py-4"><h3 className="text-sm font-semibold">{title}</h3>{children}</section>;
}

/**
 * Channel information: name and description, the member's own notification choice, who is in the channel, pinned messages,
 * links from the loaded history, and placeholders for photos and files (attachments wait for the malware scanner).
 */
export function ChannelInfo({ open, onOpenChange, returnFocus, channel, slug, members, pins, messages, setting, onMute, onJump, onEdit, onProfile }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the panel closes: the channel name that opened it. */
  returnFocus: React.RefObject<HTMLElement | null>;
  channel: ChatChannel;
  slug: string;
  members: DirectoryMember[];
  pins: ChatMessage[];
  messages: ChatMessage[];
  /** Full settings, present only for roles that manage channels (the invite list is not readable by others). */
  setting?: ChatChannelSetting;
  onMute: (value: typeof channelMutes[number]) => void;
  onJump: (message: ChatMessage) => void;
  onEdit?: () => void;
  onProfile: (person: DirectoryMember) => void;
}) {
  const t = useTranslations("CommunityChat"), roles = useTranslations("CommunityEditor.roles");
  const [shown, setShown] = useState(pageSize);
  const links = channelLinks(messages);
  const list = channel.accessMode === "role"
    ? members.filter(member => channelEligible({ active: true, grant: true, role: member.role, accessMode: "role", minRole: channel.minRole ?? "member", invited: false, archived: false }))
    : channel.accessMode === "invite" && setting ? members.filter(member => setting.userIds.includes(member.userId)) : null;
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" showCloseButton={false} className="h-dvh w-full min-w-0 gap-0 overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-md"
      onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
      <SheetHeader className="flex-row items-center gap-2 p-3">
        <SheetClose asChild><Button variant="ghost" size="icon" className="size-11" aria-label={t("backToChat")}><ArrowLeft aria-hidden="true" /></Button></SheetClose>
        <SheetTitle className="min-w-0 flex-1 truncate">{t("channelInfo")}</SheetTitle>
      </SheetHeader>
      <div className="flex flex-col items-center px-4 pb-4 text-center">
        {channel.emoji ? <UserAvatar name={channel.name} emoji={channel.emoji} className="mb-4 size-24 text-3xl" />
          : <span className="mb-4 flex size-24 items-center justify-center rounded-full bg-muted text-muted-foreground">{channel.accessMode === "all" ? <Hash className="size-10" aria-hidden="true" /> : <Lock className="size-10" aria-hidden="true" />}</span>}
        <p className="min-w-0 text-lg font-semibold break-words">{channel.name}</p>
        {channel.accessMode === "all" && <p className="mt-0.5 text-sm text-muted-foreground">{t("memberCount", { count: members.length })}</p>}
        {channel.description ? <SheetDescription className="mt-2">{channel.description}</SheetDescription> : <SheetDescription className="sr-only">{channel.name}</SheetDescription>}
        {onEdit && <Button variant="secondary" className="mt-4 min-h-11" onClick={onEdit}>{t("editChannel")}</Button>}
      </div>
      <Section title={t("notifications")}>
        <Field><FieldLabel htmlFor="channel-info-mute" className="sr-only">{t("muteChannel")}</FieldLabel>
          <NativeSelect id="channel-info-mute" className="min-h-11 w-full" value={channel.mute} onChange={event => onMute(event.target.value as typeof channelMutes[number])}>
            {channelMutes.map(option => <NativeSelectOption key={option} value={option}>{t(`mutes.${option}`)}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
      </Section>
      <Section title={t("membersHeading")}>
        {list === null
          ? channel.accessMode === "all"
            ? <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{t("everyoneCount", { count: members.length })}</p>
              <Button asChild variant="outline" className="min-h-11"><Link href={`/communities/${slug}/members`} prefetch={false}>{t("viewMembers")}</Link></Button></div>
            : <p className="text-sm text-muted-foreground">{t("invitedOnly")}</p>
          : <>
            <ul className="-mx-2 space-y-1" aria-label={t("membersHeading")}>
              {list.slice(0, shown).map(member => <li key={member.userId}>
                <Button variant="ghost" className="h-auto min-h-11 w-full justify-start gap-3 rounded-xl px-2 py-2 text-left font-normal" onClick={() => onProfile(member)} aria-label={t("profileOf", { name: member.name })}>
                  <UserAvatar name={member.name} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{member.name}</span>
                  <Badge variant="secondary">{roles(member.role as "owner")}</Badge>
                </Button></li>)}
            </ul>
            {list.length > shown && <Button variant="outline" className="min-h-11" onClick={() => setShown(count => count + pageSize)}>{t("showMore")}</Button>}
          </>}
      </Section>
      <Section title={t("pinned")}>
        {pins.length ? <ul className="space-y-1">{pins.slice(0, 5).map(pin => <li key={pin.id}>
          <Button variant="ghost" className="h-auto min-h-11 w-full justify-start gap-2 text-left font-normal whitespace-normal" onClick={() => onJump(pin)}>
            <Pin className="shrink-0" aria-hidden="true" />
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{pin.authorName?.trim() || t("formerMember")}</span>
              <span className="line-clamp-2 text-sm text-muted-foreground">{plainChatBody(pin)}</span></span>
          </Button></li>)}</ul>
          : <p className="text-sm text-muted-foreground">{t("noPinned")}</p>}
      </Section>
      <Section title={t("sharedLinks")}>
        {links.length ? <ul className="space-y-1">{links.map(link => <li key={link}>
          <a href={link} target="_blank" rel="nofollow noopener noreferrer ugc" className="flex min-h-11 items-center gap-2 text-sm underline underline-offset-2">
            <ExternalLink className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-all">{link}</span></a></li>)}</ul>
          : <p className="text-sm text-muted-foreground">{t("noLinks")}</p>}
        <p className="text-xs text-muted-foreground">{t("linksLoadedOnly")}</p>
      </Section>
      <Section title={t("sharedMedia")}><p className="text-sm text-muted-foreground">{t("filesSoon")}</p></Section>
      <Section title={t("documents")}><p className="text-sm text-muted-foreground">{t("filesSoon")}</p></Section>
    </SheetContent>
  </Sheet>;
}
