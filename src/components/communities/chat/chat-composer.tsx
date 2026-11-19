/** Layout and behaviour modelled on bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/chat-footer.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { AtSign, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chatBody } from "@/lib/chat";
import { composerHeight } from "@/lib/chat-composer-size";
import type { ChatPerson } from "@/lib/chat-view";

export type ChatDraft = { text: string; mentions: ChatPerson[] };
export const emptyChatDraft: ChatDraft = { text: "", mentions: [] };

export function chatDraftPayload(draft: ChatDraft) {
  let body = draft.text.trim();
  const mention_ids: string[] = [];
  for (const person of draft.mentions.toSorted((a, b) => b.name.length - a.name.length)) {
    const token = person.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(?<![\\p{L}\\p{N}<])@${token}(?![\\p{L}\\p{N}])`, "gu");
    if (!match.test(body)) continue;
    body = body.replace(match, () => `<@${person.id}>`);
    mention_ids.push(person.id);
  }
  return { body, mention_ids };
}

export function ChatComposer({ draft, onChange, onSend, onCancel, busy, blocked, members, mode = "send" }: {
  draft: ChatDraft;
  onChange: (draft: ChatDraft) => void;
  onSend: () => void;
  onCancel?: () => void;
  busy: boolean;
  blocked: boolean;
  members: ChatPerson[];
  mode?: "send" | "reply" | "edit";
}) {
  const t = useTranslations("CommunityChat"), id = useId();
  const [picker, setPicker] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // Start at one line and grow with the text. field-sizing does this natively where supported; this covers the rest.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${composerHeight(element.scrollHeight)}px`;
  }, [draft.text]);
  const label = t(mode === "edit" ? "editMessage" : mode === "reply" ? "reply" : "message");
  const valid = chatBody.safeParse(chatDraftPayload(draft).body).success;
  const disabled = blocked || busy || !valid;
  function mention(person: ChatPerson) {
    const mentions = draft.mentions.filter(item => item.id !== person.id && item.name !== person.name);
    const previous = draft.text.replace(/(^|\s)@[^@\s]*$/, "$1").trimEnd();
    const prefix = previous ? `${previous} ` : "";
    onChange({ text: `${prefix}@${person.name} `, mentions: [...mentions, person] });
    setPicker(false);
  }
  return <form className="min-w-0 shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-0 md:pb-3" onSubmit={event => { event.preventDefault(); if (!disabled) onSend(); }}>
    <label className="sr-only" htmlFor={id}>{label}</label>
    <Card className="gap-0 rounded-2xl py-0">
      <CardContent className="flex items-end gap-1 p-1.5">
        <Textarea ref={field} id={id} value={draft.text} className="max-h-25 min-h-11 flex-1 resize-none border-transparent bg-transparent py-2.5 text-base leading-5 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent" maxLength={2000} disabled={blocked || busy}
          rows={1} placeholder={label} onChange={event => {
            const text = event.target.value;
            onChange({ ...draft, text });
            if (members.length && draft.mentions.length < 10 && /(^|\s)@$/.test(text)) setPicker(true);
          }}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!disabled) onSend();
            }
          }} />
        <Popover open={picker} onOpenChange={setPicker}>
          <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label={t("mention")}
            disabled={blocked || busy || !members.length || draft.mentions.length >= 10}><AtSign aria-hidden="true" /></Button></PopoverTrigger>
          <PopoverContent align="end" className="p-0">
            <Command><CommandInput placeholder={t("findMember")} aria-label={t("findMember")} />
              <CommandList><CommandEmpty>{t("noMembers")}</CommandEmpty>
                {members.map(person => <CommandItem className="min-h-11" value={`${person.name} ${person.id}`}
                  key={person.id} onSelect={() => mention(person)}>{person.name}</CommandItem>)}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {onCancel && <Button type="button" variant="ghost" className="min-h-11 shrink-0" onClick={onCancel}>{t("cancel")}</Button>}
        <Button type="submit" size="icon" className="size-11 shrink-0 rounded-full" disabled={disabled}
          aria-label={t(mode === "edit" ? "saveEdit" : "send")}><Send aria-hidden="true" /></Button>
      </CardContent>
    </Card>
  </form>;
}
