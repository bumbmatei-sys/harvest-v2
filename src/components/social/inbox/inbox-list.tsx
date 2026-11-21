/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/dashboard/(auth)/apps/mail/components/mail-list.tsx and mail.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useState } from "react";
import { Inbox as InboxIcon, ListFilter, PanelLeftClose, RotateCw, Search, ShieldAlert, Star, TriangleAlert, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { PlatformLogo } from "@/components/social/platform-logo";
import { accountProblem, tabFolders, typeFilters, type Filters, type InboxItem, type InboxPage, type ServiceState } from "@/lib/social/inbox";
import { platformLabels } from "@/lib/social/labels";
import type { InboxKind } from "@/lib/social/platforms";
import { cn } from "@/lib/utils";

export type ListView = {
  status: "loading" | "ready" | "error" | "unavailable"; items: InboxItem[]; nextCursor: string | null; more: "idle" | "loading" | "error";
  partial: ServiceState[]; pending: string[]; channels: InboxPage["channels"]; retryAfter: number | null; refreshFailed: boolean; local: boolean;
};

/** The conversation list: tabs, type and search controls, honest partial and error states, and one row per conversation. */
export function InboxList({ tenantId, view, filters, search, selected, me, accountCount, onFilters, onSearch, onSelect, onLoadMore, onRetry, onFilterPane, hosted, onCollapse, collapseRef }: {
  tenantId: string; view: ListView; filters: Filters; search: string; selected: string | null; me: string; accountCount: number | null;
  onFilters: (filters: Filters) => void; onSearch: (value: string) => void; onSelect: (id: string) => void; onLoadMore: () => void; onRetry: () => void; onFilterPane: () => void;
  /** True when the filters live in the shell's sidebar: the button only opens that drawer on phones, and the list can collapse. */
  hosted: boolean; onCollapse: () => void; collapseRef: React.Ref<HTMLButtonElement>;
}) {
  const t = useTranslations("SocialInbox"), [draft, setDraft] = useState(search);
  const searching = search.trim().length > 0;
  const problems = view.channels.filter((channel) => accountProblem(channel) !== null);
  const filtered = filters.folder !== "all" || !!filters.platform || !!filters.account || !!filters.kind || !!filters.label || searching;

  return <section className="flex min-h-0 flex-1 flex-col" aria-label={t("list.label")} data-testid="list-pane">
    <div className="space-y-3 border-b p-3">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon-responsive" className={hosted ? "md:hidden" : "xl:hidden"} aria-label={t("filters")} onClick={onFilterPane}><ListFilter aria-hidden="true" /></Button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{searching ? t("search.results") : t("title")}</h2>
        {hosted && <Button ref={collapseRef} type="button" variant="ghost" size="icon-responsive" className="max-md:hidden" aria-expanded={true} aria-controls="inbox-list-pane" aria-label={t("list.collapse")} onClick={onCollapse} data-testid="list-collapse"><PanelLeftClose aria-hidden="true" /></Button>}
        <NativeSelect value={filters.kind ?? "all"} className="min-h-11 lg:min-h-9" aria-label={t("type.label")} onChange={(event) => { const value = event.target.value as InboxKind | "all"; onFilters({ ...filters, kind: value === "all" ? undefined : value }); }}>
          {typeFilters.map((kind) => <NativeSelectOption key={kind} value={kind}>{kind === "all" ? t("type.all") : t(`type.${kind}`)}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div role="group" aria-label={t("tabs.label")} className="inline-flex w-full flex-wrap rounded-lg bg-muted p-[3px]">
        {tabFolders.map((folder) => <button key={folder} type="button" aria-pressed={filters.folder === folder} onClick={() => onFilters({ ...filters, folder })}
          className={cn("inline-flex min-h-11 flex-1 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-8", filters.folder === folder ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t(`tabs.${folder}`)}</button>)}
      </div>
      <form role="search" onSubmit={(event) => { event.preventDefault(); onSearch(draft.trim()); }}>
        <InputGroup className="min-h-11 lg:min-h-9">
          <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={t("search.label")} placeholder={t("search.placeholder")} maxLength={100} />
          {(draft || searching) && <InputGroupAddon align="inline-end"><Button type="button" variant="ghost" size="icon-responsive" className="-mr-2" aria-label={t("search.clear")} onClick={() => { setDraft(""); onSearch(""); }}><X aria-hidden="true" /></Button></InputGroupAddon>}
        </InputGroup>
      </form>
    </div>

    {view.status === "ready" && (problems.length > 0 || view.partial.length > 0 || view.refreshFailed) && <div className="space-y-2 border-b p-3" data-testid="list-notices">
      {problems.length > 0 && <Alert role="status" data-testid="accounts-problem"><TriangleAlert aria-hidden="true" /><AlertTitle>{t("partial.accountsTitle")}</AlertTitle><AlertDescription>
        <ul className="list-disc pl-4">{problems.map((channel) => <li key={channel.id}>{t("partial.line", { name: channel.displayName ?? platformLabels[channel.platform], state: t(`partial.state.${accountProblem(channel)}`) })}</li>)}</ul>
        <Link href={`/workspaces/${tenantId}/social/accounts`} prefetch={false} className="mt-1 inline-block font-medium underline underline-offset-2">{t("manageAccounts")}</Link></AlertDescription></Alert>}
      {view.partial.length > 0 && <Alert role="status" data-testid="partial-notice"><TriangleAlert aria-hidden="true" /><AlertTitle>{t("partial.title")}</AlertTitle><AlertDescription>
        <ul className="list-disc pl-4">{summarize(view).map((row) => <li key={row.key}>{t("partial.line", { name: row.name, state: t(`partial.state.${row.state}`) })}</li>)}</ul>
        <Button type="button" variant="outline" size="responsive" className="mt-2" onClick={onRetry}><RotateCw aria-hidden="true" />{t("retry")}</Button></AlertDescription></Alert>}
      {view.refreshFailed && <Alert variant="destructive" role="alert" data-testid="refresh-failed"><AlertDescription className="flex flex-wrap items-center gap-2">{t("list.refreshFailed")}<Button type="button" variant="outline" size="responsive" onClick={onRetry}>{t("retry")}</Button></AlertDescription></Alert>}
    </div>}

    <div className="min-h-0 flex-1 md:overflow-y-auto" data-testid="list-scroll">
      {view.status === "loading" && <ul className="divide-y" aria-busy="true" aria-label={t("list.loading")} role="status">{[0, 1, 2, 3, 4, 5].map((row) => <li key={row} className="flex gap-3 p-3"><Skeleton className="size-10 shrink-0 rounded-lg" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-4/5" /></div></li>)}</ul>}
      {view.status === "unavailable" && <div className="p-4"><EmptyState icon={ShieldAlert} title={t("list.unavailableTitle")} description={t("list.unavailable")} solid /></div>}
      {view.status === "error" && <div className="p-4"><Alert variant="destructive" role="alert" data-testid="list-error"><AlertDescription className="flex flex-wrap items-center gap-2">{t("list.failed")}<Button type="button" variant="outline" size="responsive" onClick={onRetry}><RotateCw aria-hidden="true" />{t("retry")}</Button></AlertDescription></Alert></div>}
      {view.status === "ready" && view.items.length === 0 && <div className="p-4" data-testid="list-empty">{emptyState({ t, tenantId, accountCount, problems: problems.length, filtered, searching, pending: view.pending.length > 0, onClear: () => { setDraft(""); onSearch(""); onFilters({ folder: "all" }); } })}</div>}
      {view.status === "ready" && view.items.length > 0 && <>
        <ul className="divide-y" data-testid="list">{view.items.map((item) => <li key={item.id}><Row item={item} selected={selected === item.id} me={me} local={view.local} onSelect={() => onSelect(item.id)} /></li>)}</ul>
        {view.more === "error" && <div className="p-3"><Alert variant="destructive" role="alert"><AlertDescription>{t("list.moreFailed")}</AlertDescription></Alert></div>}
        {view.nextCursor && <div className="p-3 text-center"><Button type="button" variant="outline" size="responsive" disabled={view.more === "loading"} onClick={onLoadMore} data-testid="load-more">{view.more === "loading" ? t("loadingMore") : t("list.loadMore")}</Button></div>}
        {view.nextCursor && view.retryAfter !== null && <p className="px-3 pb-3 text-center text-xs text-muted-foreground">{t("list.waiting", { seconds: view.retryAfter })}</p>}
      </>}
    </div>
  </section>;
}

function summarize(view: ListView) {
  const names = new Map(view.channels.map((channel) => [channel.id, channel.displayName ?? platformLabels[channel.platform]]));
  const rows = new Map<string, { key: string; name: string; state: ServiceState["state"] }>();
  for (const entry of view.partial) rows.set(`${entry.accountId}/${entry.state}`, { key: `${entry.accountId}/${entry.state}`, name: names.get(entry.accountId) ?? "", state: entry.state });
  return [...rows.values()];
}

function emptyState({ t, tenantId, accountCount, problems, filtered, searching, pending, onClear }: { t: ReturnType<typeof useTranslations>; tenantId: string; accountCount: number | null; problems: number; filtered: boolean; searching: boolean; pending: boolean; onClear: () => void }) {
  if (accountCount === 0) return <EmptyState icon={InboxIcon} title={t("empty.noAccountsTitle")} description={t("empty.noAccounts")} solid
    action={<Button asChild size="responsive"><Link href={`/workspaces/${tenantId}/social/accounts`} prefetch={false}>{t("empty.connect")}</Link></Button>} />;
  if (filtered) return <EmptyState icon={Search} title={searching ? t("empty.noNotesTitle") : t("empty.noMatchTitle")} solid
    action={<Button type="button" variant="outline" size="responsive" onClick={onClear}>{t("empty.clear")}</Button>} />;
  if (problems > 0) return <EmptyState icon={TriangleAlert} title={t("empty.problemTitle")} description={t("empty.problem")} solid
    action={<Button asChild variant="outline" size="responsive"><Link href={`/workspaces/${tenantId}/social/accounts`} prefetch={false}>{t("manageAccounts")}</Link></Button>} />;
  return <EmptyState icon={InboxIcon} title={pending ? t("empty.pendingTitle") : t("empty.title")} description={pending ? undefined : t("empty.body")} solid />;
}

function Row({ item, selected, me, local, onSelect }: { item: InboxItem; selected: boolean; me: string; local: boolean; onSelect: () => void }) {
  const t = useTranslations("SocialInbox"), format = useFormatter();
  const when = item.activityAt ? (() => { const date = new Date(item.activityAt), today = new Date().toDateString() === date.toDateString(); return format.dateTime(date, today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" }); })() : null;
  const platform = platformLabels[item.account.platform], accountName = item.account.displayName ?? platform;
  const title = item.title ?? (local ? t(`kind.${item.kind}`) : t("row.untitled", { kind: t(`kind.${item.kind}`) }));
  const unread = !item.readInHarvest, mine = item.assigneeId === me;
  return <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} data-testid="row" data-unread={unread} data-selected={selected} data-platform={item.account.platform} data-kind={item.kind}
    className={cn("flex min-h-11 w-full gap-3 p-3 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50", selected && "bg-accent/70")}>
    <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border bg-card"><PlatformLogo platform={item.account.platform} colored className="size-5" /></span>
    <span className="min-w-0 flex-1 space-y-1">
      <span className="flex items-center gap-2"><span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold" : "font-medium")}><span className="sr-only">{t("row.label", { platform, kind: t(`kind.${item.kind}`), unread: unread ? "yes" : "no" })} </span>{title}</span>
        {unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" data-testid="unread-dot" />}
        {when && <time dateTime={item.activityAt ?? undefined} className="shrink-0 text-xs text-muted-foreground tabular-nums">{when}</time>}</span>
      {item.preview ? <span className="line-clamp-2 block text-xs text-muted-foreground">{item.preview}</span> : local ? <span className="block text-xs text-muted-foreground">{t("search.openToRead")}</span> : null}
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone="neutral" label={t(`kind.${item.kind}`)} />
        <span className="truncate text-xs text-muted-foreground">{accountName}</span>
        {item.assigneeId && <span className="inline-flex" data-testid="assigned-marker"><StatusBadge tone={mine ? "info" : "neutral"} dot label={mine ? t("row.assignedYou") : t("row.assigned")} /></span>}
        {item.status === "done" && <StatusBadge tone="success" label={t("row.done")} />}
        {item.starred && <Star className="size-3.5 fill-current text-warning" aria-label={t("row.starred")} />}
      </span>
    </span>
  </button>;
}
