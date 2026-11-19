/** Derived from bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/new-message-dialog.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { chatBody } from "@/lib/chat";
import type { DmFailure, DmPerson } from "@/lib/dm-view";
import { failureKey, startDirectMessage, useRetryId } from "./dm-api";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import UserAvatar from "@/components/user-avatar";
import { Check, Search } from "lucide-react";

export default function NewMessageDialog({
  open,
  onOpenChange,
  slug,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  onStarted: (conversationId: string) => void;
}) {
  const t = useTranslations("CommunityDm");
  const [retryId, clearRetry] = useRetryId();
  const [contacts, setContacts] = useState<DmPerson[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DmPerson>();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<DmFailure>();
  const [searchFailed, setSearchFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/communities/${slug}/chat/dms/people?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) { setSearchFailed(true); setContacts([]); return; }
        const result = await response.json() as { items: DmPerson[] };
        setSearchFailed(false);
        setContacts(result.items);
      } catch { if (!controller.signal.aborted) { setSearchFailed(true); setContacts([]); } }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query, slug]);

  const reset = () => {
    setQuery("");
    setContacts(null);
    setSelected(undefined);
    setBody("");
    setFailure(undefined);
  };

  const handleOpenChange = (value: boolean) => {
    if (busy) return;
    onOpenChange(value);
    if (!value) reset();
  };

  const valid = chatBody.safeParse(body.trim()).success;
  const handleContinue = async () => {
    if (!selected || !valid || busy) return;
    setBusy(true);
    setFailure(undefined);
    const text = body.trim();
    const result = await startDirectMessage(slug, selected.id, text, retryId(`${selected.id}:${text}`));
    setBusy(false);
    if (!result.ok) {
      setFailure(result.failure);
      return;
    }
    clearRetry();
    onStarted(result.conversationId);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden" aria-describedby={undefined}>
        <DialogHeader className="p-6 pb-2 text-start">
          <DialogTitle className="text-xl">{t("newMessage")}</DialogTitle>
        </DialogHeader>
        <div className="relative flex items-center px-6 pb-2">
          <Search className="absolute start-9 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPeople")}
            aria-label={t("searchPeople")}
            className="min-h-11 ps-9"
          />
        </div>
        <div className="max-h-72 overflow-y-auto px-3 py-2" role="group" aria-label={t("people")} aria-busy={contacts === null}>
          {contacts === null ? (
            <div className="text-center text-sm text-muted-foreground py-8" role="status">
              {t("loading")}
            </div>
          ) : searchFailed ? (
            <div className="text-center text-sm text-muted-foreground py-8" role="alert">
              {t("searchFailed")}
            </div>
          ) : contacts.length ? (
            contacts.map((contact) => {
              const isSelected = selected?.id === contact.id;

              return (
                <button
                  key={contact.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelected(contact);
                    setFailure(undefined);
                  }}
                  className={cn(
                    "w-full min-h-14 flex items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                    { "bg-muted": isSelected }
                  )}
                >
                  <UserAvatar className="size-10" name={contact.name} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {contact.name}
                    </div>
                  </div>
                  {isSelected && <Check className="size-4 shrink-0" aria-hidden="true" />}
                </button>
              );
            })
          ) : (
            <div className="text-center text-sm text-muted-foreground py-8">
              {t("noPeople")}
            </div>
          )}
        </div>
        {selected && (
          <div className="space-y-2 border-t px-6 py-3">
            <label htmlFor="dm-first-message" className="sr-only">
              {t("writeTo", { name: selected.name })}
            </label>
            <Textarea
              id="dm-first-message"
              value={body}
              maxLength={2000}
              rows={3}
              className="min-h-20 resize-none text-base"
              placeholder={t("writeTo", { name: selected.name })}
              disabled={busy}
              onChange={(e) => {
                setBody(e.target.value);
                setFailure(undefined);
              }}
            />
            {failure && (
              <Alert role="alert" variant="destructive" className="w-auto">
                <AlertDescription>{t(failureKey[failure])}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t px-6 py-4">
          {selected ? (
            <div className="flex min-w-0 items-center gap-2">
              <UserAvatar
                className="size-9 ring-2 ring-background"
                name={selected.name}
              />
              <span className="text-sm font-medium truncate">{selected.name}</span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t("selectPerson")}
            </span>
          )}
          <Button
            className="min-h-11"
            disabled={!selected || !valid || busy}
            onClick={handleContinue}
          >
            {t("send")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
