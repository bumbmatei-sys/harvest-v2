/** Composed from Harvest shared components. The Shadcn UI Kit chat blocks were a layout reference only and no kit code is copied here. Exception to the use-kit rule approved by the founder on 18 November 2026 for this screen; the next screens (DMs, profile, events) adopt the real kit blocks from the start. See docs/ui-sources.md. */
"use client";

import { Ellipsis, MessageSquare, Pin, SmilePlus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { ReportDialog } from "@/components/communities/report-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { chatReactions, chatTokens } from "@/lib/chat";
import type { ChatMessage } from "@/lib/chat-view";
import { memberInitials } from "@/lib/community-members";
import { cn } from "@/lib/utils";

export type ChatAction = "delete" | "restore" | "pin" | "unpin" | "remove" | "restoreRemoved";

export function ChatMessageRow({ message, slug, mine, post, mayModerate, restore, thread, onReply, onEdit, onAction, onReact }: {
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
}) {
  const t = useTranslations("CommunityChat"), format = useFormatter();
  const name = message.authorName?.trim() || t(message.authorId ? "member" : "formerMember"), removed = !!message.deletedAt;
  const canRestore = removed && (mine && message.deletedKind === "author" || restore && message.deletedKind === "host");
  const active = !removed && !message.heldAt;
  const actions = !removed && (mine || mayModerate) || canRestore;
  const renderLinks = (text: string) => text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="nofollow noopener noreferrer ugc" className="underline underline-offset-2">{part}</a> : part);
  return <article id={`message-${message.id}`} className={cn("flex min-w-0 gap-2.5", mine && "flex-row-reverse")}>
    <Avatar className="mt-1"><AvatarFallback aria-hidden="true">{memberInitials(name)}</AvatarFallback></Avatar>
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1", mine && "items-end")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{mine ? t("you") : name}</span>
        <time dateTime={new Date(message.createdAt).toISOString()}>{format.dateTime(new Date(message.createdAt), { dateStyle: "short", timeStyle: "short" })}</time>
        {!!message.editedAt && !removed && <span>{t("edited")}</span>}
        {!!message.pinnedAt && active && <Pin className="size-3.5" aria-label={t("pinned")} />}
        {!!message.heldAt && !removed && <Badge variant="outline">{t("held")}</Badge>}
      </div>
      <Bubble align={mine ? "end" : "start"} variant={mine ? "tinted" : "muted"}>
        <BubbleContent className="whitespace-pre-wrap">
          {removed ? t("deleted") : chatTokens(message.body ?? "", message.mentionIds).map((part, index) => {
            if (part.type === "text") return <span key={index}>{renderLinks(part.text)}</span>;
            const person = message.mentions.find(entry => entry.id === part.id);
            return person ? <b key={index}>{t("mentionName", { name: person.name })}</b> : part.text;
          })}
        </BubbleContent>
      </Bubble>
      {(active || actions || !!message.replyCount) && <div className="flex max-w-full flex-wrap items-center gap-1">
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
