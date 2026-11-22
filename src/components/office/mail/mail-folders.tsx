/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/mail/components/nav.tsx and nav-desktop.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { Archive, FileText, Folder, Inbox, Send, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { inboxNavItem } from "@/components/inbox/inbox-frame";
import { ProviderLogo } from "@/components/office/provider-logo";
import { mailboxLabel, type NamedRef, type OfficeConnection } from "@/lib/office/mail";
import { cn } from "@/lib/utils";

export type FolderView = { status: "loading" | "ready" | "error"; items: NamedRef[] };
/** Where the list is pointed: a provider folder, or the drafts the provider holds. */
export type Place = { kind: "folder"; ref: string | null } | { kind: "drafts" };

const known: Record<string, { key: "inbox" | "sent" | "archive" | "trash" | "spam"; icon: typeof Inbox }> = {
  inbox: { key: "inbox", icon: Inbox }, sent: { key: "sent", icon: Send }, archive: { key: "archive", icon: Archive }, trash: { key: "trash", icon: Trash2 }, spam: { key: "spam", icon: ShieldAlert },
};
const lookup = (folder: NamedRef) => known[folder.ref.toLowerCase()] ?? known[folder.name.toLowerCase()];

/** The folder pane: the provider's folders by name, Drafts when the mailbox offers them, and the connected mailbox with its disconnect control. */
export function MailFolders({ view, place, onPlace, onRetry, connection, draftsAvailable, disconnect }: {
  view: FolderView; place: Place; onPlace: (place: Place) => void; onRetry: () => void; connection: OfficeConnection; draftsAvailable: boolean; disconnect: React.ReactNode;
}) {
  const t = useTranslations("OfficeMail"), a = useTranslations("OfficeMail.account");
  const platform = connection.platform;
  const current = (ref: string) => place.kind === "folder" && place.ref === ref;
  return <nav aria-label={t("folders")} className="flex flex-col gap-5 p-3" data-testid="folder-pane">
    <section aria-labelledby="mail-folders-heading">
      <h3 id="mail-folders-heading" className="mb-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("folders")}</h3>
      {view.status === "loading" && <div className="space-y-2" role="status" aria-busy="true" aria-label={t("loading")}>{[0, 1, 2].map((row) => <Skeleton key={row} className="h-9 w-full" />)}</div>}
      {view.status === "error" && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-2">{t("folder.failed")}<Button type="button" variant="outline" size="responsive" onClick={onRetry}>{t("retry")}</Button></AlertDescription></Alert>}
      {view.status === "ready" && <ul className="space-y-0.5">
        {view.items.map((folder) => { const match = lookup(folder), Icon = match?.icon ?? Folder; return <li key={folder.ref}>
          <button type="button" className={cn(inboxNavItem, current(folder.ref) && "bg-accent font-medium")} aria-current={current(folder.ref) ? "true" : undefined} onClick={() => onPlace({ kind: "folder", ref: folder.ref })} data-testid={`folder-${folder.ref}`}>
            <Icon className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{folder.name || t("folder.unnamed")}</span></button></li>; })}
        {draftsAvailable && <li><button type="button" className={cn(inboxNavItem, place.kind === "drafts" && "bg-accent font-medium")} aria-current={place.kind === "drafts" ? "true" : undefined} onClick={() => onPlace({ kind: "drafts" })} data-testid="folder-drafts">
          <FileText className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{t("folder.drafts")}</span></button></li>}
      </ul>}
    </section>
    {platform && <section aria-labelledby="mail-account-heading">
      <h3 id="mail-account-heading" className="mb-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{a("label")}</h3>
      <div className="flex min-h-11 items-center gap-2.5 px-2.5 text-sm" data-testid="account-chip" data-health={connection.health}>
        <ProviderLogo platform={platform} className="size-5 shrink-0" /><span className="min-w-0 flex-1 truncate">{mailboxLabel[platform]}</span></div>
      <div className="mt-1 px-1.5">{disconnect}</div>
    </section>}
  </nav>;
}
