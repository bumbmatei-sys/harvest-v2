/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/mail/components/mail.tsx (three panes, one pane at a time on phones); code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MailOpen, PanelLeftOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useContextualSidebar } from "@/components/editor/editor-context";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { InboxFrame, useCollapsibleList } from "@/components/inbox/inbox-frame";
import { MailComposer, type ComposeSeed } from "@/components/office/mail/mail-composer";
import { MailFolders, type FolderView, type Place } from "@/components/office/mail/mail-folders";
import { emptyView, MailList, type ListView } from "@/components/office/mail/mail-list";
import { MailThread } from "@/components/office/mail/mail-thread";
import { contextExit } from "@/lib/navigation";
import { OfficeApiError, replySubject, senderAddress, type Draft, type MailApi, type Marker, type OfficeConnection, type ThreadSummary } from "@/lib/office/mail";

const dedupe = <T extends { ref: string }>(current: T[], more: T[]) => { const seen = new Set(current.map((item) => item.ref)); return [...current, ...more.filter((item) => !seen.has(item.ref))]; };

/**
 * The connected mailbox: folders (the shell's contextual sidebar), the message list and the open thread or draft, in the shared inbox frame. Everything is
 * fetched live for this one connection and held in memory only; the component is keyed by connection id, so a different or reconnected mailbox starts clean.
 */
export function MailWorkspace({ tenantId, api, connection, disconnect, onReconnect }: {
  tenantId: string; api: MailApi; connection: OfficeConnection; disconnect: React.ReactNode; onReconnect: () => void;
}) {
  const t = useTranslations("OfficeMail"), nav = useTranslations("ComponentsAppShell");
  const { setOpenMobile } = useSidebar();
  const exit = contextExit(tenantId, "mail");
  const { hosted, slot } = useContextualSidebar(exit ? { title: t("title"), back: { href: exit.href, label: nav(exit.label) }, label: t("sidebarLabel") } : null);
  const { listOpen, toggleList, listToggle, reopen } = useCollapsibleList();
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const threadRef = params.get("thread"), folderParam = params.get("folder"), drafts = params.get("view") === "drafts";
  const draftsAvailable = connection.capabilities.drafts === "available" && connection.capabilities.createDraft === "available";
  const canReply = draftsAvailable;

  const [folders, setFolders] = useState<FolderView>({ status: "loading", items: [] });
  const [threads, setThreads] = useState<ListView<ThreadSummary>>(emptyView), [draftList, setDraftList] = useState<ListView<Draft>>(emptyView);
  const [search, setSearch] = useState(""), [paneOpen, setPaneOpen] = useState(false);
  const [composer, setComposer] = useState<(ComposeSeed & { key: number }) | null>(null), [pending, setPending] = useState<(() => void) | null>(null);
  const dirty = useRef(false), keyCounter = useRef(0), run = useRef(0), abort = useRef<AbortController | null>(null);
  const markerRevision = useRef(0);
  const savedMarkers = useRef(new Map<string, { revision: number; marker: Marker }>());
  const reconcileMarkers = useCallback((items: ThreadSummary[], startRevision: number) => items.map((item) => {
    const saved = savedMarkers.current.get(item.ref);
    return saved && saved.revision > startRevision ? { ...item, marker: saved.marker } : item;
  }), []);

  const go = useCallback((next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) { if (value) query.set(key, value); else query.delete(key); }
    const text = query.toString();
    if (text === params.toString()) return;
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const loadFolders = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await api.folders(connection.id, signal);
      if (result.state === "reconnect_needed") return onReconnect();
      setFolders(result.state === "available" ? { status: "ready", items: result.data.items } : { status: "error", items: [] });
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setFolders({ status: "error", items: [] }); }
  }, [api, connection.id, onReconnect]);
  useEffect(() => { const controller = new AbortController(); void Promise.resolve().then(() => loadFolders(controller.signal)); return () => controller.abort(); }, [loadFolders]);

  // The folder shown: the URL's, else the mailbox's Inbox, else the first folder; with no folder list the mailbox's default view.
  const folderRef = useMemo(() => {
    if (folders.status === "loading") return undefined;
    if (folderParam) return folderParam;
    return (folders.items.find((folder) => folder.ref.toLowerCase() === "inbox") ?? folders.items[0])?.ref ?? null;
  }, [folders, folderParam]);
  const place: Place = drafts && draftsAvailable ? { kind: "drafts" } : { kind: "folder", ref: folderRef ?? null };
  const mode = place.kind === "drafts" ? "drafts" : "threads";
  const folderName = place.kind === "drafts" ? t("folder.drafts") : (folders.items.find((folder) => folder.ref === place.ref)?.name || t("title"));

  const fail = (error: unknown): ListView<never> => ({ ...emptyView(), status: error instanceof OfficeApiError && error.unavailable ? "unavailable" : "error" });
  const loadFirst = useCallback(async () => {
    if (folderRef === undefined) return;
    const mine = ++run.current, startRevision = markerRevision.current;
    abort.current?.abort();
    const controller = abort.current = new AbortController();
    try {
      if (mode === "drafts") {
        const result = await api.drafts(connection.id, undefined, controller.signal);
        if (mine !== run.current) return;
        if (result.state === "reconnect_needed") return onReconnect();
        setDraftList(result.state === "available" ? { status: "ready", items: result.data.items, nextCursor: result.data.nextCursor ?? null, more: "idle", partial: !!result.data.partial } : { ...emptyView(), status: result.state === "temporarily_unavailable" ? "error" : "unavailable" });
      } else {
        const result = await api.threads(connection.id, { ...(folderRef ? { folderRef } : {}), ...(search ? { search } : {}) }, controller.signal);
        if (mine !== run.current) return;
        if (result.state === "reconnect_needed") return onReconnect();
        setThreads(result.state === "available" ? { status: "ready", items: reconcileMarkers(result.data.items, startRevision), nextCursor: result.data.nextCursor ?? null, more: "idle", partial: !!result.data.partial } : { ...emptyView(), status: result.state === "temporarily_unavailable" ? "error" : "unavailable" });
      }
    } catch (error) {
      if (controller.signal.aborted || mine !== run.current) return;
      (mode === "drafts" ? setDraftList : setThreads)(fail(error) as never);
    }
  }, [api, connection.id, folderRef, mode, search, onReconnect, reconcileMarkers]);
  useEffect(() => { void Promise.resolve().then(loadFirst); return () => abort.current?.abort(); }, [loadFirst]);

  const markMore = (value: "idle" | "loading" | "error") => { if (mode === "drafts") setDraftList((current) => ({ ...current, more: value })); else setThreads((current) => ({ ...current, more: value })); };
  async function loadMore() {
    const view = mode === "drafts" ? draftList : threads;
    if (!view.nextCursor || view.more === "loading") return;
    const cursor = view.nextCursor, mine = run.current, startRevision = markerRevision.current;
    markMore("loading");
    try {
      if (mode === "drafts") {
        const result = await api.drafts(connection.id, cursor);
        if (mine !== run.current) return;
        if (result.state !== "available") return setDraftList((current) => ({ ...current, more: "error" }));
        setDraftList((current) => ({ ...current, items: dedupe(current.items, result.data.items), nextCursor: result.data.nextCursor ?? null, more: "idle" }));
      } else {
        const result = await api.threads(connection.id, { cursor, ...(folderRef ? { folderRef } : {}), ...(search ? { search } : {}) });
        if (mine !== run.current) return;
        if (result.state !== "available") return setThreads((current) => ({ ...current, more: "error" }));
        setThreads((current) => ({ ...current, items: dedupe(current.items, reconcileMarkers(result.data.items, startRevision)), nextCursor: result.data.nextCursor ?? null, partial: current.partial || !!result.data.partial, more: "idle" }));
      }
    } catch { if (mine === run.current) markMore("error"); }
  }

  // Leaving an unsaved composer asks first; every path that replaces the right pane goes through here.
  const guard = useCallback((action: () => void) => { if (composer && dirty.current) setPending(() => action); else action(); }, [composer]);
  const closeComposer = useCallback(() => { dirty.current = false; setComposer(null); }, []);
  const openComposer = (seed: ComposeSeed) => guard(() => { dirty.current = false; setComposer({ ...seed, key: ++keyCounter.current }); go({ thread: null }); });
  const selectThread = (ref: string) => guard(() => { closeComposer(); go({ thread: ref }); });
  const selectDraft = (ref: string) => guard(() => { dirty.current = false; setComposer({ draftRef: ref, key: ++keyCounter.current }); go({ thread: null }); });
  const choosePlace = (next: Place) => guard(() => {
    closeComposer(); setSearch("");
    go(next.kind === "drafts" ? { view: "drafts", folder: null, thread: null } : { view: null, folder: next.ref, thread: null });
    setPaneOpen(false); if (hosted) setOpenMobile(false);
  });

  const onMarker = useCallback((marker: Marker) => {
    // A list response started before this write completed may still contain the old marker.
    savedMarkers.current.set(marker.ref, { revision: ++markerRevision.current, marker });
    setThreads((current) => ({ ...current, items: current.items.map((item) => item.ref === marker.ref ? { ...item, marker } : item) }));
  }, []);
  const onSaved = useCallback((draft: Draft) => { setDraftList((current) => current.status !== "ready" ? current : { ...current, items: [draft, ...current.items.filter((item) => item.ref !== draft.ref)] }); }, []);
  const onDeleted = useCallback((ref: string) => { setDraftList((current) => ({ ...current, items: current.items.filter((item) => item.ref !== ref) })); closeComposer(); }, [closeComposer]);

  const selectedId = composer?.draftRef ?? threadRef;
  const filterPane = <MailFolders view={folders} place={place} onPlace={choosePlace} onRetry={() => { setFolders({ status: "loading", items: [] }); void loadFolders(); }} connection={connection} draftsAvailable={draftsAvailable} disconnect={disconnect} />;
  const placeKey = place.kind === "drafts" ? "drafts" : `folder:${place.ref ?? ""}`;

  return <>
    <InboxFrame testId="mail" hosted={hosted} slot={slot} filterPane={filterPane} labels={{ filters: t("folders"), filtersDescription: t("foldersDescription"), thread: t("thread.label") }}
      paneOpen={paneOpen} onPaneOpenChange={setPaneOpen} selected={!!threadRef || !!composer} listOpen={listOpen}
      reopenBar={<Button ref={reopen} type="button" variant="outline" size="responsive" aria-expanded={false} aria-controls="inbox-list-pane" onClick={() => toggleList(true)} data-testid="list-expand"><PanelLeftOpen aria-hidden="true" />{t("list.expand")}</Button>}
      list={<MailList key={placeKey} mode={mode} threads={threads} drafts={draftList} search={search} selected={selectedId}
        onSearch={setSearch} onSelect={mode === "drafts" ? selectDraft : selectThread} onLoadMore={() => void loadMore()} onRetry={() => { (mode === "drafts" ? setDraftList : setThreads)(emptyView() as never); void loadFirst(); }}
        onRefresh={() => { void loadFirst(); void loadFolders(); }} onCompose={() => openComposer({})} onFolderPane={() => hosted ? setOpenMobile(true) : setPaneOpen(true)}
        onCollapse={() => toggleList(false)} collapseRef={listToggle} hosted={hosted} folderName={folderName} />}
      thread={composer
        ? <MailComposer key={composer.key} api={api} connectionId={connection.id} seed={composer} onClose={closeComposer} onSaved={onSaved} onDeleted={onDeleted} onReconnect={onReconnect} onDirtyChange={(value) => { dirty.current = value; }} />
        : threadRef
          ? <MailThread key={threadRef} tenantId={tenantId} api={api} connectionId={connection.id} threadRef={threadRef} canReply={canReply} onBack={() => go({ thread: null })} onMarker={onMarker} onReconnect={onReconnect}
            onReply={(thread, message) => openComposer({ reply: true, to: [senderAddress(message.from)], subject: replySubject(thread.subject), body: "" })} />
          : <div className="flex flex-1 items-center justify-center p-6"><EmptyState size="compact" icon={MailOpen} title={t("thread.selectTitle")} description={t("thread.select")} /></div>} />
    <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }} tone="destructive" title={t("compose.discardTitle")} description={t("compose.discardBody")}
      confirmLabel={t("compose.discard")} cancelLabel={t("account.cancel")} onConfirm={() => { const action = pending; setPending(null); dirty.current = false; action?.(); }} />
  </>;
}
