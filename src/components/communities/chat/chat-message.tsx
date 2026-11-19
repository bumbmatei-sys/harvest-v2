/** Derived from bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/chat-bubbles.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { Ellipsis, MessageSquare, Pin, SmilePlus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { ReportDialog } from "@/components/communities/report-dialog";
import UserAvatar from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { chatReactions, chatTokens } from "@/lib/chat";
import type { ChatMessage } from "@/lib/chat-view";
import { cn } from "@/lib/utils";

export type ChatAction = "delete" | "restore" | "pin" | "unpin" | "remove" | "restoreRemoved";

export function ChatMessageRow({ message, slug, mine, post, mayModerate, restore, thread, onReply, onEdit, onAction, onReact, onProfile }: {
  message: ChatMessage;
  slug: string;
  mine: boolean;
  post: boolean;
  mayModerate: boolean;
  restore: boolean;
  thread?: boolean;
  onReply: (opener: HTMLButtonElement) => void;
  onEdit: () => void;
  onAction: (action: ChatAction) => void;
  onReact: (emoji: string) => void;
  /** Opens the author's profile sheet. */
  onProfile?: (message: ChatMessage) => void;
}) {
  const t = useTranslations("CommunityChat"), format = useFormatter();
  const name = message.authorName?.trim() || t(message.authorId ? "member" : "formerMember"), removed = !!message.deletedAt;
  const canRestore = removed && (mine && message.deletedKind === "author" || restore && message.deletedKind === "host");
  const active = !removed && !message.heldAt;
  const actions = !removed && (mine || mayModerate) || canRestore;
  const renderLinks = (text: string) => text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="nofollow noopener noreferrer ugc" className="underline underline-offset-2">{part}</a> : part);
  const profile = !mine && message.authorId && onProfile ? () => onProfile(message) : undefined;
  const text = removed ? t("deleted") : chatTokens(message.body ?? "", message.mentionIds).map((part, index) => {
    // A token the server did not validate, or one whose member is gone, never shows as a literal <@id>.
    if (part.type === "text") return <span key={index}>{renderLinks(part.text.replace(/<@[^<>\s]+>/g, ""))}</span>;
    const person = message.mentions.find(entry => entry.id === part.id);
    return <b key={index}>{t("mentionName", { name: person?.name || t("formerMember") })}</b>;
  });
  const time = <time dateTime={new Date(message.createdAt).toISOString()}>{format.dateTime(new Date(message.createdAt), { timeStyle: "short" })}</time>;
  return <article id={`message-${message.id}`} className={cn("group flex w-full min-w-0 gap-2.5", mine && "flex-row-reverse")}>
    {!mine && (profile
      ? <button type="button" onClick={profile} className="mt-0.5 size-11 shrink-0 self-start rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label={t("profileOf", { name })}><UserAvatar name={name} className="mx-auto" /></button>
      : <span className="mt-0.5 flex size-11 shrink-0 items-start justify-center"><UserAvatar name={name} /></span>)}
    <div className={cn("flex min-w-0 max-w-[min(85%,42rem)] flex-1 flex-col gap-1", mine ? "items-end" : "items-start")}>
      {!mine && <div className="flex flex-wrap items-center gap-x-2 text-xs">
        {profile ? <button type="button" onClick={profile} className="font-medium text-foreground hover:underline">{name}</button> : <span className="font-medium text-foreground">{name}</span>}
      </div>}
      <Bubble align={mine ? "end" : "start"} variant={mine ? "default" : "muted"} className="max-w-full">
        <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
      </Bubble>
      <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums", mine && "justify-end")}>
        {time}
        {!!message.editedAt && !removed && <span>{t("edited")}</span>}
        {!!message.pinnedAt && active && <Pin className="size-3.5" aria-label={t("pinned")} />}
        {!!message.heldAt && !removed && <Badge variant="outline">{t("held")}</Badge>}
      </div>
      {(active || actions || !!message.replyCount) && <div className={cn("flex max-w-full flex-wrap items-center gap-1", mine && "justify-end")}>
        {!thread && (active && post || !!message.replyCount) && <Button variant="ghost" className="min-h-11" onClick={event => onReply(event.currentTarget)}>
          <MessageSquare aria-hidden="true" />{message.replyCount ? t("replies", { count: message.replyCount }) : t("reply")}
        </Button>}
        {active && message.reactions.map(reaction => <Button key={reaction.emoji} variant={reaction.reactedByMe ? "secondary" : "ghost"}
          className="min-h-11 min-w-11 px-2" disabled={!post} aria-pressed={reaction.reactedByMe}
          aria-label={t("reactionCount", { emoji: reaction.emoji, count: reaction.count })} onClick={() => onReact(reaction.emoji)}>{reaction.emoji} {reaction.count}</Button>)}
        {active && post && <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-11" aria-label={t("react")}><SmilePlus aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align={mine ? "end" : "start"}>{chatReactions.map(emoji =>
            <DropdownMenuItem key={emoji} className="min-h-11" onSelect={() => onReact(emoji)}>{emoji}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>}
        {active && !mine && <ReportDialog slug={slug} targetType="message" name={name} targetId={message.id} compact />}
        {actions && <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-11" aria-label={t("actions")}><Ellipsis aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align={mine ? "end" : "start"}>
            {mine && !removed && post && <DropdownMenuItem className="min-h-11" onSelect={onEdit}>{t("editMessage")}</DropdownMenuItem>}
            {mine && !removed && <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => onAction("delete")}>{t("deleteMessage")}</DropdownMenuItem>}
            {active && mayModerate && <DropdownMenuItem className="min-h-11" onSelect={() => onAction(message.pinnedAt ? "unpin" : "pin")}>{t(message.pinnedAt ? "unpin" : "pin")}</DropdownMenuItem>}
            {!removed && !mine && mayModerate && <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => onAction("remove")}>{t("remove")}</DropdownMenuItem>}
            {canRestore && <DropdownMenuItem className="min-h-11" onSelect={() => onAction(message.deletedKind === "host" ? "restoreRemoved" : "restore")}>{t("restore")}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>}
    </div>
  </article>;
}
