/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/mail/components/mail-list.tsx and mail.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Inbox as InboxIcon, Link2, ListFilter, PanelLeftClose, PenSquare, RotateCw, Search, ShieldAlert, Star, TriangleAlert, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { threadTime, type Draft, type ThreadSummary } from "@/lib/office/mail";
import { cn } from "@/lib/utils";

export type ListView<T> = { status: "loading" | "ready" | "error" | "unavailable"; items: T[]; nextCursor: string | null; more: "idle" | "loading" | "error"; partial: boolean };
export const emptyView = <T,>(): ListView<T> => ({ status: "loading", items: [], nextCursor: null, more: "idle", partial: false });

type Props = {
  mode: "threads" | "drafts"; threads: ListView<ThreadSummary>; drafts: ListView<Draft>; search: string; selected: string | null;
  onSearch: (value: string) => void; onSelect: (ref: string) => void; onLoadMore: () => void; onRetry: () => void; onRefresh: () => void; onCompose: () => void;
  onFolderPane: () => void; onCollapse: () => void; collapseRef: React.Ref<HTMLButtonElement>; hosted: boolean; folderName: string;
};

/**
 * The message list: search (debounced, sent to the mailbox's own search), one row per thread with the Harvest-only unread dot, star and person-link
 * markers, honest loading, empty, failure and partial states, and the Drafts view. Rows come straight from the mailbox page; nothing is filtered locally,
 * so a page is never presented as a complete result.
 */
export function MailList({ mode, threads, drafts, search, selected, onSearch, onSelect, onLoadMore, onRetry, onRefresh, onCompose, onFolderPane, onCollapse, collapseRef, hosted, folderName }: Props) {
  const t = useTranslations("OfficeMail"), [draft, setDraft] = useState(search);
  const view = mode === "drafts" ? drafts : threads, searching = search.trim().length > 0;
  // Typing searches after a pause; Enter searches at once. The cursor resets in the parent whenever the query changes.
  const settled = useDebouncedValue(draft.trim(), 400), sent = useRef(search);
  useEffect(() => { if (mode === "threads" && settled !== sent.current) { sent.current = settled; onSearch(settled); } }, [settled, mode, onSearch]);
  useEffect(() => { sent.current = search; }, [search]);
  const submit = (value: string) => { sent.current = value; onSearch(value); };

  return <section className="flex min-h-0 flex-1 flex-col" aria-label={t("list.label")} data-testid="list-pane">
    <div className="space-y-3 border-b p-3">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon-responsive" className={hosted ? "md:hidden" : "xl:hidden"} aria-label={t("list.filters")} onClick={onFolderPane}><ListFilter aria-hidden="true" /></Button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold" data-testid="list-title">{folderName}</h2>
        <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("refresh")} onClick={onRefresh} data-testid="refresh"><RotateCw aria-hidden="true" /></Button>
        {hosted && <Button ref={collapseRef} type="button" variant="ghost" size="icon-responsive" className="max-md:hidden" aria-expanded={true} aria-controls="inbox-list-pane" aria-label={t("list.collapse")} onClick={onCollapse} data-testid="list-collapse"><PanelLeftClose aria-hidden="true" /></Button>}
        <Button type="button" size="responsive" onClick={onCompose} data-testid="compose-new"><PenSquare aria-hidden="true" /><span className="max-sm:sr-only">{t("compose.new")}</span></Button>
      </div>
      {mode === "threads" && <form role="search" onSubmit={(event) => { event.preventDefault(); submit(draft.trim()); }}>
        <InputGroup className="min-h-11 lg:min-h-9">
          <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={t("search.label")} placeholder={t("search.placeholder")} maxLength={300} />
          {(draft || searching) && <InputGroupAddon align="inline-end"><Button type="button" variant="ghost" size="icon-responsive" className="-mr-2" aria-label={t("search.clear")} onClick={() => { setDraft(""); submit(""); }}><X aria-hidden="true" /></Button></InputGroupAddon>}
        </InputGroup>
      </form>}
    </div>

    <div className="min-h-0 flex-1 md:overflow-y-auto" data-testid="list-scroll">
      {view.status === "loading" && <ul className="divide-y" aria-busy="true" aria-label={t("list.loading")} role="status">{[0, 1, 2, 3, 4, 5].map((row) => <li key={row} className="space-y-2 p-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-full" /></li>)}</ul>}
      {view.status === "unavailable" && <div className="p-4"><EmptyState icon={ShieldAlert} title={t("unavailableTitle")} description={t("unavailable")} solid /></div>}
      {view.status === "error" && <div className="p-4"><Alert variant="destructive" role="alert" data-testid="list-error"><AlertDescription className="flex flex-wrap items-center gap-2">{t("list.failed")}<Button type="button" variant="outline" size="responsive" onClick={onRetry}>{t("retry")}</Button></AlertDescription></Alert></div>}
      {view.status === "ready" && view.items.length === 0 && !view.nextCursor && <div className="p-4" data-testid="list-empty">
        {mode === "drafts" ? <EmptyState icon={FileText} title={t("list.emptyDrafts")} solid />
          : searching ? <EmptyState icon={Search} title={t("list.noMatch")} solid action={<Button type="button" variant="outline" size="responsive" onClick={() => { setDraft(""); submit(""); }}>{t("list.clear")}</Button>} />
            : <EmptyState icon={InboxIcon} title={t("list.empty")} solid />}</div>}
      {view.status === "ready" && (view.items.length > 0 || view.nextCursor) && <>
        {view.partial && <Alert role="status" className="m-3 w-auto" data-testid="partial-notice"><TriangleAlert aria-hidden="true" /><AlertDescription>{t("list.partial")}</AlertDescription></Alert>}
        <ul className="divide-y" data-testid="list">
          {mode === "threads" ? threads.items.map((item) => <li key={item.ref}><ThreadRow item={item} selected={selected === item.ref} onSelect={() => onSelect(item.ref)} /></li>)
            : drafts.items.map((item) => <li key={item.ref}><DraftRow item={item} selected={selected === item.ref} onSelect={() => onSelect(item.ref)} /></li>)}
        </ul>
        {view.more === "error" && <div className="p-3"><Alert variant="destructive" role="alert"><AlertDescription>{t("list.moreFailed")}</AlertDescription></Alert></div>}
        {view.nextCursor && <div className="p-3 text-center"><Button type="button" variant="outline" size="responsive" disabled={view.more === "loading"} onClick={onLoadMore} data-testid="load-more">{view.more === "loading" ? t("list.loadingMore") : t("list.loadMore")}</Button></div>}
      </>}
    </div>
  </section>;
}

const row = "flex min-h-11 w-full flex-col gap-1 p-3 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50";

function Time({ value }: { value: string | null }) {
  const format = useFormatter();
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const date = new Date(value), today = new Date().toDateString() === date.toDateString();
  return <time dateTime={value} className="shrink-0 text-xs text-muted-foreground tabular-nums">{format.dateTime(date, today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" })}</time>;
}

function ThreadRow({ item, selected, onSelect }: { item: ThreadSummary; selected: boolean; onSelect: () => void }) {
  const t = useTranslations("OfficeMail"), unread = !item.marker.read;
  return <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} data-testid="row" data-unread={unread} data-selected={selected} className={cn(row, selected && "bg-accent/70")}>
    <span className="flex w-full items-center gap-2">
      <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold" : "font-medium")}>
        {unread && <span className="sr-only">{t("list.unread")} </span>}{item.subject || t("list.noSubject")}</span>
      {unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" data-testid="unread-dot" />}
      {item.marker.contactId && <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("list.linked")} data-testid="linked-marker" />}
      {item.marker.starred && <Star className="size-3.5 shrink-0 fill-current text-warning" aria-label={t("list.starred")} data-testid="starred-marker" />}
      <Time value={threadTime(item)} />
    </span>
    {item.snippet && <span className="line-clamp-2 text-xs text-muted-foreground">{item.snippet}</span>}
  </button>;
}

function DraftRow({ item, selected, onSelect }: { item: Draft; selected: boolean; onSelect: () => void }) {
  const t = useTranslations("OfficeMail");
  return <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} data-testid="draft-row" className={cn(row, selected && "bg-accent/70")}>
    <span className="truncate text-sm font-medium">{item.subject || t("list.noSubject")}</span>
    <span className="truncate text-xs text-muted-foreground">{item.to.length ? item.to.join(", ") : t("list.draftNoRecipient")}</span>
  </button>;
}
