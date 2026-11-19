/** Derived from bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/chat-header.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import type { Ref } from "react";
import { ArrowLeft, Hash, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import UserAvatar from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import type { ChatChannel } from "@/lib/chat-view";

/** Channel header: back (phone), channel list toggle (tablet), mark, name that opens the channel info, and actions. */
export function ChatHeader({ channel, subtitle, onBack, listToggle, onInfo, headingRef, nameRef, children }: {
  channel: ChatChannel;
  subtitle?: string;
  onBack: () => void;
  listToggle: React.ReactNode;
  onInfo: () => void;
  headingRef: Ref<HTMLHeadingElement>;
  nameRef: Ref<HTMLButtonElement>;
  children: React.ReactNode;
}) {
  const t = useTranslations("CommunityChat");
  const Icon = channel.accessMode === "all" ? Hash : Lock;
  return <div className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-b px-3 sm:px-4">
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button variant="outline" size="icon" className="size-11 shrink-0 md:hidden" onClick={onBack} aria-label={t("backToChannels")}><ArrowLeft aria-hidden="true" /></Button>
      {listToggle}
      {channel.emoji ? <UserAvatar name={channel.name} emoji={channel.emoji} className="size-10" />
        : <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span>}
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 ref={headingRef} tabIndex={-1} className="min-w-0 truncate leading-tight font-semibold outline-none">
          <Button ref={nameRef} variant="ghost" className="-ms-2 h-auto min-h-11 max-w-full justify-start px-2 font-semibold" aria-haspopup="dialog" onClick={onInfo}>
            <span className="truncate">{channel.name}</span></Button></h2>
        {subtitle && <span className="-mt-2 truncate text-xs text-muted-foreground">{subtitle}</span>}
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-1">{children}</div>
  </div>;
}
