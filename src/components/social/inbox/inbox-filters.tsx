/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/dashboard/(auth)/apps/mail/components/nav.tsx and nav-desktop.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useState } from "react";
import { Archive, CheckCheck, ChevronDown, Inbox, MailOpen, Star, Tag, UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { PlatformLogo } from "@/components/social/platform-logo";
import { accountProblem, type Filters, type InboxFolder, type InboxSidebar } from "@/lib/social/inbox";
import { platformLabels } from "@/lib/social/labels";
import { cn } from "@/lib/utils";

export type SidebarView = { status: "loading" | "ready" | "error"; data: InboxSidebar | null };
const folders: { id: InboxFolder; icon: typeof Inbox }[] = [
  { id: "all", icon: Inbox }, { id: "unread", icon: MailOpen }, { id: "assigned", icon: UserCheck }, { id: "open", icon: Archive }, { id: "done", icon: CheckCheck }, { id: "starred", icon: Star },
];

/** The filter pane: folders with counts, accounts grouped by network with their coloured marks, and labels. Counts cover what Harvest has already seen. */
export function InboxFilters({ tenantId, view, filters, onFilters, onRetry }: { tenantId: string; view: SidebarView; filters: Filters; onFilters: (filters: Filters) => void; onRetry: () => void }) {
  const t = useTranslations("SocialInbox");
  const item = "flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9";
  const data = view.data;
  // Account groups collapse; the choice lasts for this visit only.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (platform: string) => setClosed((current) => { const next = new Set(current); if (next.has(platform)) next.delete(platform); else next.add(platform); return next; });
  return <nav aria-label={t("filters")} className="flex flex-col gap-5 p-3" data-testid="filter-pane">
    <section aria-labelledby="folders-heading">
      <h3 id="folders-heading" className="mb-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("folders.label")}</h3>
      <ul className="space-y-0.5">{folders.map(({ id, icon: Icon }) => <li key={id}>
        <button type="button" className={cn(item, filters.folder === id && "bg-accent font-medium")} aria-current={filters.folder === id ? "true" : undefined} onClick={() => onFilters({ ...filters, folder: id })} data-testid={`folder-${id}`}>
          <Icon className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{t(`folders.${id}`)}</span>
          {data ? <span className="text-xs tabular-nums text-muted-foreground" data-testid={`count-${id}`}>{data.folders[id]}</span> : view.status === "loading" ? <Skeleton className="h-4 w-5" /> : null}</button></li>)}</ul>
      {view.status === "ready" && <p className="mt-2 px-2.5 text-xs text-muted-foreground">{t("folders.coverage")}</p>}
    </section>
    {view.status === "error" && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-2">{t("folders.failed")}<Button type="button" variant="outline" size="responsive" onClick={onRetry}>{t("retry")}</Button></AlertDescription></Alert>}
    {view.status === "loading" && <div className="space-y-2" role="status" aria-busy="true" aria-label={t("folders.loading")}>{[0, 1, 2].map((row) => <Skeleton key={row} className="h-9 w-full" />)}</div>}
    {data && <section aria-labelledby="accounts-heading">
      <h3 id="accounts-heading" className="mb-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("accounts.label")}</h3>
      {data.platforms.length === 0 ? <p className="px-2.5 text-sm text-muted-foreground" data-testid="no-accounts">{t("accounts.none")} <Link href={`/workspaces/${tenantId}/social/accounts`} prefetch={false} className="font-medium text-foreground underline underline-offset-2">{t("empty.connect")}</Link></p>
        : <ul className="space-y-0.5">
          {data.platforms.map((group) => { const open = !closed.has(group.platform), listId = `accounts-${group.platform}`; return <li key={group.platform}>
            <div className="flex items-center gap-0.5">
              <button type="button" className={cn(item, "flex-1", filters.platform === group.platform && !filters.account && "bg-accent font-medium")} aria-current={filters.platform === group.platform && !filters.account ? "true" : undefined}
                onClick={() => onFilters({ ...filters, platform: filters.platform === group.platform && !filters.account ? undefined : group.platform, account: undefined })} data-testid={`platform-${group.platform}`}>
                <PlatformLogo platform={group.platform} colored className="size-5 shrink-0" /><span className="min-w-0 flex-1 truncate">{platformLabels[group.platform]}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{group.counts.all}</span></button>
              {group.accounts.length > 0 && <button type="button" className="flex size-11 shrink-0 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:size-9" aria-expanded={open} aria-controls={listId}
                aria-label={t("accounts.toggle", { platform: platformLabels[group.platform] })} onClick={() => toggle(group.platform)} data-testid={`toggle-${group.platform}`}><ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} aria-hidden="true" /></button>}
            </div>
            {group.accounts.length > 0 && <ul id={listId} hidden={!open} className="ml-7 mt-0.5 space-y-0.5 border-l pl-2">{group.accounts.map((account) => {
              const problem = accountProblem(account);
              return <li key={account.id}><button type="button" className={cn(item, "min-h-11 lg:min-h-8", filters.account === account.id && "bg-accent font-medium")} aria-current={filters.account === account.id ? "true" : undefined}
                onClick={() => onFilters({ ...filters, platform: undefined, account: filters.account === account.id ? undefined : account.id })} data-testid={`account-${account.id}`}>
                <span className="min-w-0 flex-1 truncate">{account.displayName ?? platformLabels[account.platform]}</span>
                {problem ? <StatusBadge tone="danger" label={t(`accounts.problem.${problem}`)} /> : <span className="text-xs tabular-nums text-muted-foreground">{account.counts.all}</span>}</button></li>;
            })}</ul>}</li>; })}</ul>}
    </section>}
    {data && data.labels.length > 0 && <section aria-labelledby="labels-heading">
      <h3 id="labels-heading" className="mb-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("labels.label")}</h3>
      <ul className="space-y-0.5">{data.labels.map((label) => <li key={label.id}><button type="button" className={cn(item, filters.label === label.id && "bg-accent font-medium")} aria-current={filters.label === label.id ? "true" : undefined}
        onClick={() => onFilters({ ...filters, label: filters.label === label.id ? undefined : label.id })}><Tag className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{label.name}</span></button></li>)}</ul>
    </section>}
  </nav>;
}
