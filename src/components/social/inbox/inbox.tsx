/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/dashboard/(auth)/apps/mail/components/mail.tsx (three panes, one pane at a time on phones); code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, MessagesSquare, PanelLeftOpen, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { InboxFrame, useCollapsibleList } from "@/components/inbox/inbox-frame";
import { useSidebar } from "@/components/ui/sidebar";
import { useContextualSidebar } from "@/components/editor/editor-context";
import { contextExit } from "@/lib/navigation";
import { EmptyState } from "@/components/empty-state";
import { InboxFilters, type SidebarView } from "@/components/social/inbox/inbox-filters";
import { InboxList, type ListView } from "@/components/social/inbox/inbox-list";
import { InboxSettings } from "@/components/social/inbox/inbox-settings";
import { InboxThread } from "@/components/social/inbox/inbox-thread";
import { defaultFilters, fetchSidebar, inboxApi, mergeItems, patchItem, type Filters, type InboxItem } from "@/lib/social/inbox";
import { SocialApiError } from "@/lib/social/api";

const emptyList: ListView = { status: "loading", items: [], nextCursor: null, more: "idle", partial: [], pending: [], channels: [], retryAfter: null, refreshFailed: false, local: false };
const pollMs = 30_000;

/**
 * Public mode, Social media, Inbox. One list of conversations, comments and mentions from every connected account, with the Harvest-only markers (read,
 * assigned, done, starred) and the live conversation beside it. Message text is read live and never stored. Three panes from 1280px, list and thread from
 * 768px, one pane at a time on phones.
 */
export function Inbox({ tenantId, me, sendEnabled, view }: { tenantId: string; me: string; sendEnabled: boolean; view: "inbox" | "settings" }) {
  const t = useTranslations("SocialInbox"), nav = useTranslations("ComponentsAppShell");
  const { setOpenMobile } = useSidebar();
  const exit = contextExit(tenantId, "inbox");
  // The folders and accounts panel is the whole sidebar while the Inbox is open (back arrow on top); without the shell-modes flag it stays inline as before.
  const { hosted, slot } = useContextualSidebar(view === "inbox" && exit ? { title: t("title"), back: { href: exit.href, label: nav(exit.label) }, label: t("sidebarLabel") } : null);
  const { listOpen, toggleList, listToggle, reopen } = useCollapsibleList();
  const api = useMemo(() => inboxApi(tenantId), [tenantId]);
  const router = useRouter(), pathname = usePathname(), params = useSearchParams(), selected = params.get("item");
  const [filters, setFilters] = useState<Filters>(defaultFilters), [search, setSearch] = useState("");
  const [list, setList] = useState<ListView>(emptyList), [sidebar, setSidebar] = useState<SidebarView>({ status: "loading", data: null });
  const [paneOpen, setPaneOpen] = useState(false), [threadRefresh, setThreadRefresh] = useState(0);
  const run = useRef(0), abort = useRef<AbortController | null>(null), etag = useRef<string | null>(null), revision = useRef<string | null>(null);

  // A list load never sets state before its request answers; the handlers that change filters or retry show the skeleton first.
  const loadFirst = useCallback(async () => {
    const mine = ++run.current;
    abort.current?.abort();
    const controller = abort.current = new AbortController();
    try {
      if (search) {
        const result = await api.metadata({ ...filters, note: search }, undefined, controller.signal);
        if (mine === run.current) setList({ ...emptyList, status: "ready", items: result.items, nextCursor: result.after, local: true });
      } else {
        const result = await api.list(filters, undefined, controller.signal);
        if (mine === run.current) setList({ ...emptyList, status: "ready", items: mergeItems([], result.items), nextCursor: result.nextCursor, partial: result.partial, pending: result.pendingAccountIds, channels: result.channels, retryAfter: result.retryAfter });
      }
    } catch (error) {
      if (controller.signal.aborted || mine !== run.current) return;
      if (error instanceof SocialApiError && error.unavailable) setList({ ...emptyList, status: "unavailable" });
      else setList((current) => current.status === "ready" ? { ...current, refreshFailed: true } : { ...emptyList, status: "error" });
    }
  }, [api, filters, search]);
  const loadFirstRef = useRef(loadFirst);
  useEffect(() => { loadFirstRef.current = loadFirst; });
  useEffect(() => { if (view !== "inbox") return; void loadFirst(); return () => abort.current?.abort(); }, [loadFirst, view]);

  async function loadMore() {
    if (!list.nextCursor || list.more === "loading") return;
    const cursor = list.nextCursor, controller = new AbortController(), mine = run.current;
    setList((current) => ({ ...current, more: "loading" }));
    try {
      if (list.local) {
        const result = await api.metadata({ ...filters, note: search }, cursor, controller.signal);
        if (mine === run.current) setList((current) => ({ ...current, items: mergeItems(current.items, result.items), nextCursor: result.after, more: "idle" }));
      } else {
        const result = await api.list(filters, cursor, controller.signal);
        if (mine === run.current) setList((current) => ({ ...current, items: mergeItems(current.items, result.items), nextCursor: result.nextCursor, partial: result.partial, pending: result.pendingAccountIds, channels: result.channels, retryAfter: result.retryAfter, more: "idle" }));
      }
    } catch (error) {
      if (mine !== run.current) return;
      // A stale or expired scan starts again from the first page.
      if (error instanceof SocialApiError && error.conflict) void loadFirst();
      else setList((current) => ({ ...current, more: "error" }));
    }
  }

  const loadSidebar = useCallback(async () => {
    try {
      const result = await fetchSidebar(tenantId, etag.current);
      if (!result) return;
      etag.current = result.etag;
      setSidebar({ status: "ready", data: result.sidebar });
      const changed = revision.current !== null && revision.current !== result.sidebar.activityRevision;
      revision.current = result.sidebar.activityRevision;
      if (changed) { void loadFirstRef.current(); setThreadRefresh((value) => value + 1); }
    } catch (error) {
      if (error instanceof DOMException) return;
      setSidebar((current) => current.data ? current : { status: "error", data: null });
    }
  }, [tenantId]);
  // Poll while the tab is visible and online; resume on focus or reconnect.
  useEffect(() => {
    void loadSidebar();
    const tick = () => { if (document.visibilityState === "visible" && navigator.onLine) void loadSidebar(); };
    const timer = window.setInterval(tick, pollMs);
    document.addEventListener("visibilitychange", tick); window.addEventListener("online", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); window.removeEventListener("online", tick); };
  }, [loadSidebar]);

  const go = useCallback((next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) { if (value) query.set(key, value); else query.delete(key); }
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }, [params, pathname, router]);
  const onChanged = useCallback((id: string, version: number, fields: Partial<InboxItem>) => {
    setList((current) => ({ ...current, items: patchItem(current.items, id, version, fields) }));
    void loadSidebar();
  }, [loadSidebar]);
  const changeFilters = (next: Filters) => { setList(emptyList); setFilters(next); };
  const changeSearch = (value: string) => { setList(emptyList); setSearch(value); };
  const retryList = () => { if (list.status !== "ready") setList(emptyList); void loadFirst(); };
  const accounts = sidebar.data?.platforms.flatMap((group) => group.accounts) ?? [];
  const accountCount = sidebar.data ? accounts.length : null;
  const header = <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
    <div className="min-w-0"><h1 className="text-[28px] font-semibold tracking-tight">{view === "settings" ? t("settings.title") : t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{view === "settings" ? t("settings.subtitle") : t("subtitle")}</p></div>
    {view === "settings"
      ? <Button asChild variant="outline" size="responsive"><Link href={pathname} prefetch={false}><ArrowLeft aria-hidden="true" />{t("settings.back")}</Link></Button>
      : <Button asChild variant="outline" size="responsive"><Link href={`${pathname}?view=settings`} prefetch={false}><Settings2 aria-hidden="true" />{t("settings.open")}</Link></Button>}
  </header>;

  if (view === "settings") return <div className="space-y-4">{header}<InboxSettings tenantId={tenantId} api={api} accounts={accounts} loading={sidebar.status === "loading"} failed={sidebar.status === "error"} onRetry={() => void loadSidebar()} /></div>;

  const hint = list.items.find((item) => item.id === selected);
  const filterPane = <InboxFilters tenantId={tenantId} view={sidebar} filters={filters} onFilters={(next) => { changeFilters(next); setPaneOpen(false); if (hosted) setOpenMobile(false); }} onRetry={() => void loadSidebar()} />;
  return <div className="space-y-4">
    {header}
    <InboxFrame hosted={hosted} slot={slot} filterPane={filterPane} labels={{ filters: t("filters"), filtersDescription: t("filtersDescription"), thread: t("thread.label") }}
      paneOpen={paneOpen} onPaneOpenChange={setPaneOpen} selected={!!selected} listOpen={listOpen}
      reopenBar={<Button ref={reopen} type="button" variant="outline" size="responsive" aria-expanded={false} aria-controls="inbox-list-pane" onClick={() => toggleList(true)} data-testid="list-expand"><PanelLeftOpen aria-hidden="true" />{t("list.expand")}</Button>}
      list={<InboxList tenantId={tenantId} view={list} filters={filters} search={search} selected={selected} me={me} accountCount={accountCount}
        onFilters={changeFilters} onSearch={changeSearch} onSelect={(id) => go({ item: id })} onLoadMore={() => void loadMore()} onRetry={retryList} onFilterPane={() => hosted ? setOpenMobile(true) : setPaneOpen(true)} hosted={hosted} onCollapse={() => toggleList(false)} collapseRef={listToggle} />}
      thread={selected
        ? <InboxThread key={selected} tenantId={tenantId} api={api} itemId={selected} hint={hint} me={me} assignees={sidebar.data?.assignees ?? []} sendEnabled={sendEnabled} refreshKey={threadRefresh} onBack={() => go({ item: null })} onChanged={onChanged} />
        : <div className="flex flex-1 items-center justify-center p-6"><EmptyState size="compact" icon={MessagesSquare} title={t("thread.selectTitle")} description={t("thread.select")} /></div>} />
  </div>;
}
