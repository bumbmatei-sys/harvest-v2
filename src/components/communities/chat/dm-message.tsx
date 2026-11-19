/** Layout and behaviour modelled on bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/chat-bubbles.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";

import { Ellipsis } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { ReportDialog } from "@/components/communities/report-dialog";
import UserAvatar from "@/components/user-avatar";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { DmMessage } from "@/lib/dm-view";
import { cn } from "@/lib/utils";

export type DmAction = "delete" | "restore";

const links = (text: string) => text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) =>
  /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="nofollow noopener noreferrer ugc" className="underline underline-offset-2">{part}</a> : part);

/** One private message: text bubble with a time line and a menu for the author; others' messages can be reported. */
export function DmMessageRow({ message, slug, conversationId, mine, name, canEdit, onEdit, onAction, afterReport }: {
  message: DmMessage;
  slug: string;
  conversationId: string;
  mine: boolean;
  name: string;
  /** Editing needs the conversation to accept messages; deleting and restoring never do. */
  canEdit: boolean;
  onEdit: () => void;
  onAction: (action: DmAction) => void;
  /** Offered with the thanks after a report (block this person). */
  afterReport?: (close: () => void) => React.ReactNode;
}) {
  const t = useTranslations("CommunityDm"), format = useFormatter();
  const removed = !!message.deletedAt;
  const time = <time dateTime={new Date(message.createdAt).toISOString()}>{format.dateTime(new Date(message.createdAt), { timeStyle: "short" })}</time>;
  return <article id={`dm-message-${message.id}`} className={cn("group flex w-full min-w-0 gap-2.5", mine && "flex-row-reverse")}>
    {!mine && <span className="mt-0.5 flex size-11 shrink-0 items-start justify-center"><UserAvatar name={name} /></span>}
    <div className={cn("flex min-w-0 max-w-[min(85%,42rem)] flex-1 flex-col gap-1", mine ? "items-end" : "items-start")}>
      <Bubble align={mine ? "end" : "start"} variant={mine ? "default" : "muted"} className="max-w-full">
        <BubbleContent className={cn("whitespace-pre-wrap", removed && "italic")}>{removed ? t("deleted") : links(message.body ?? "")}</BubbleContent>
      </Bubble>
      <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums", mine && "justify-end")}>
        {time}
        {!!message.editedAt && !removed && <span>{t("edited")}</span>}
      </div>
      {(!mine && !removed || mine) && <div className={cn("flex max-w-full flex-wrap items-center gap-1", mine && "justify-end")}>
        {!mine && !removed && <ReportDialog slug={slug} targetType="message" name={name} targetId={message.id} dm={{ conversationId }} afterReport={afterReport} compact />}
        {mine && <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-11" aria-label={t("actions")}><Ellipsis aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!removed && canEdit && <DropdownMenuItem className="min-h-11" onSelect={onEdit}>{t("edit")}</DropdownMenuItem>}
            {!removed && <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => onAction("delete")}>{t("deleteMessage")}</DropdownMenuItem>}
            {removed && <DropdownMenuItem className="min-h-11" onSelect={() => onAction("restore")}>{t("restore")}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>}
    </div>
  </article>;
}
