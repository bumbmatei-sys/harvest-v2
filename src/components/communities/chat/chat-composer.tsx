/** Derived from Shadcn UI Kit item chat-ui10 (premium), supplied and approved 2026-11-17. */
"use client";

import { useId, useState } from "react";
import { AtSign, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chatBody } from "@/lib/chat";
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
  return <form className="min-w-0 shrink-0 space-y-1 p-3 pt-1 md:px-4" onSubmit={event => { event.preventDefault(); if (!disabled) onSend(); }}>
    <label className="sr-only" htmlFor={id}>{label}</label>
    <InputGroup className="rounded-2xl">
      <InputGroupTextarea id={id} value={draft.text} className="min-h-16" maxLength={2000} disabled={blocked || busy}
        rows={2} placeholder={label} onChange={event => {
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
      <InputGroupAddon align="block-end" className="gap-0.5">
        <Popover open={picker} onOpenChange={setPicker}>
          <PopoverTrigger asChild><InputGroupButton type="button" className="size-11" aria-label={t("mention")}
            disabled={blocked || busy || !members.length || draft.mentions.length >= 10}><AtSign aria-hidden="true" /></InputGroupButton></PopoverTrigger>
          <PopoverContent align="start" className="p-0">
            <Command><CommandInput placeholder={t("findMember")} aria-label={t("findMember")} />
              <CommandList><CommandEmpty>{t("noMembers")}</CommandEmpty>
                {members.map(person => <CommandItem className="min-h-11" value={`${person.name} ${person.id}`}
                  key={person.id} onSelect={() => mention(person)}>{person.name}</CommandItem>)}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {onCancel && <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>{t("cancel")}</Button>}
        <InputGroupButton type="submit" variant="default" className="ml-auto size-11" disabled={disabled}
          aria-label={t(mode === "edit" ? "saveEdit" : "send")}><Send aria-hidden="true" /></InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </form>;
}
