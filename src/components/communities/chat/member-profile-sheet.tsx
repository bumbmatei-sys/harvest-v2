/** Derived from bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/user-detail-sheet.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { ArrowLeft } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import UserAvatar from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export type ProfilePerson = { name: string; role?: string; joinedAt?: string | null };

/** What the community knows about a member: name, role and when they joined. Direct messages arrive in a later release. */
export function MemberProfileSheet({ person, onClose, returnFocus }: {
  person?: ProfilePerson;
  onClose: () => void;
  returnFocus?: React.RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("CommunityChat"), roles = useTranslations("CommunityEditor.roles"), format = useFormatter();
  return <Sheet open={!!person} onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent side="right" showCloseButton={false} className="h-dvh w-full min-w-0 gap-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-sm"
      onCloseAutoFocus={returnFocus ? event => { event.preventDefault(); returnFocus.current?.focus(); } : undefined}>
      <SheetHeader className="flex-row items-center gap-2 p-3">
        <SheetClose asChild><Button variant="ghost" size="icon" className="size-11" aria-label={t("backToChat")}><ArrowLeft aria-hidden="true" /></Button></SheetClose>
        <SheetTitle className="min-w-0 flex-1 truncate">{t("profile")}</SheetTitle>
      </SheetHeader>
      {person && <div className="flex flex-col items-center px-6 pb-6 text-center">
        <UserAvatar name={person.name} className="mb-4 size-24 text-2xl" />
        <p className="text-lg font-semibold break-words">{person.name}</p>
        <SheetDescription className="sr-only">{person.name}</SheetDescription>
        {person.role && <Badge variant="secondary" className="mt-2">{roles(person.role as "owner")}</Badge>}
        {person.joinedAt && <p className="mt-3 text-sm text-muted-foreground">{t("joinedOn", { date: format.dateTime(new Date(person.joinedAt), { dateStyle: "medium" }) })}</p>}
      </div>}
    </SheetContent>
  </Sheet>;
}
