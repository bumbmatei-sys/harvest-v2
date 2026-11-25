/** Layout and flows follow the founder's reference for a document editor (pages tree, title and owner line, formatting toolbar, slash menu, page-styles rail), built from Harvest shared components in the Studio Admin style; no vendor markup, copy or imagery. Notes: docs/plans/docs-module.md. */
"use client";
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { BadgeCheck, CheckSquare, Columns2, Download, FileText, Link2, ListChecks, Maximize2, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, Paperclip, Star, Table2, Type, UserRound, Wand2, X } from "lucide-react";
import { ShellHeaderPortal } from "@/components/shell-header-slot";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/confirm-dialog";
import UserAvatar from "@/components/user-avatar";
import { DocMenu, type MenuAction } from "@/components/docs/doc-menu";
import { FilePicker } from "@/components/docs/file-picker";
import { MoveDialog } from "@/components/docs/move-dialog";
import type { Person } from "@/components/docs/docs-api";
import { NameDialog } from "@/components/docs/name-dialog";
import { PageShareDialog } from "@/components/docs/page-share-dialog";
import { InsertDialog, type InsertMode } from "@/components/docs/insert-dialog";
import { ShareDialog } from "@/components/docs/share-dialog";
import { DocEditorSurface, type MentionItem, type SurfaceHandle, type SurfaceStats } from "@/components/docs/doc-editor-surface";
import type { Heading } from "@/components/docs/editor/headings";
import { PageStylesPanel, readingLabel } from "@/components/docs/page-styles-panel";
import { PageTree, type PageAction } from "@/components/docs/page-tree";
import { CommentsPanel } from "@/components/docs/panels/comments-panel";
import { ExportPanel, useImport } from "@/components/docs/panels/export-panel";
import { HistoryPanel } from "@/components/docs/panels/history-panel";
import { RelationshipsPanel, linkHref } from "@/components/docs/panels/relationships-panel";
import { SaveTemplateDialog, TemplatesPanel } from "@/components/docs/panels/templates-panel";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useRequest } from "@/hooks/use-request";
import { pendingPageFields, resolvePageStyle, subtreeIds, type DocContent, type PageStyle } from "@/lib/docs";
import { docHref, docsHref, folderPath } from "@/lib/docs-list";
import { copyText } from "@/lib/copy-text";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { DocDetail } from "@/server/docs";
import type { LinkRow } from "@/server/docs-links";
import type { AttachmentRow } from "@/server/docs-io";
import type { TemplateRow } from "@/server/docs-templates";

type PageData = { id: string; parentId: string | null; title: string; subtitle: string; icon: string | null; content: DocContent; style: PageStyle; protected: boolean; version: number; updatedAt: string; archivedAt: string | null; contributors: { userId: string; name: string }[] };
type Save = "saved" | "unsaved" | "saving" | "error" | "conflict";
type Panel = "comments" | "styles" | "relationships" | "templates" | "export" | "history" | null;
type Dlg = "sharePage" | "renameDoc" | "renamePage" | "moveDoc" | "trashDoc" | "deletePage" | "share" | "attach" | "cover" | "saveTemplate" | "updateTemplate" | null;
const pageIcons = ["📄", "📝", "📖", "✝️", "🙏", "🕊️", "🎵", "📅", "✅", "💡", "📌", "⭐", "❤️", "🏠", "👥", "🎓", "📣", "💬", "📊", "🗂️"];
const AUTOSAVE_MS = 900;
// The Pages sidebar's collapsed state is remembered per browser; storage can be blocked, so every access is guarded and the choice also lives in memory.
const collapsedKey = "harvest-docs-pages-collapsed", collapsedEvent = "harvest-docs-pages-collapsed-change";
const readCollapsed = () => { try { return localStorage.getItem(collapsedKey) === "1"; } catch { return false; } };
const subscribeCollapsed = (notify: () => void) => { window.addEventListener("storage", notify); window.addEventListener(collapsedEvent, notify); return () => { window.removeEventListener("storage", notify); window.removeEventListener(collapsedEvent, notify); }; };
const fontClass = { sans: "font-sans", serif: "font-serif", mono: "font-mono" } as const;
const sizeClass = { small: "text-sm", default: "text-[15px]", large: "text-lg" } as const;
const widthClass = { default: "max-w-3xl", wide: "max-w-3xl", full: "max-w-none" } as const;

function Outline({ items, onJump }: { items: readonly Heading[]; onJump: (position: number) => void }) {
  const t = useTranslations("Docs");
  if (!items.length) return <p className="text-sm text-muted-foreground">{t("outlineEmpty")}</p>;
  return <ul className="space-y-0.5" data-docs-outline>{items.map((h) => <li key={h.pos} style={{ paddingInlineStart: `${(h.level - 1) * 0.75}rem` }}>
    <button type="button" className="min-h-11 w-full rounded-md px-2 text-start text-sm hover:bg-accent lg:min-h-8" onClick={() => onJump(h.pos)}>{h.text}</button></li>)}</ul>;
}
const railItems = [{ id: "comments", icon: MessageSquare, label: "comments" }, { id: "styles", icon: Type, label: "pageStyles" }, { id: "relationships", icon: Link2, label: "relationships" }, { id: "templates", icon: Wand2, label: "templates" }, { id: "export", icon: Download, label: "exportTitle" }] as const;

/** The doc editor: pages tree, title and owner line, formatting toolbar, slash menu, autosave with version check, and the right rail (comments, page styles, relationships, templates, export) with page history and sharing. One page is open at a time; the page is chosen in the URL. */
export function DocEditor({ tenantId, detail, page, userId }: { tenantId: string; detail: DocDetail; page: PageData; userId: string }) {
  const t = useTranslations("Docs"), format = useFormatter(), router = useRouter(), request = useRequest();
  const { doc, pages } = detail, pageOnly = detail.rights.pageOnly === true, pageRole = detail.pageRoles?.[page.id] ?? null;
  // A page share limits what the person may do to the one page: the doc-level rights are all closed, so the effective rights follow that page's role.
  const rights = pageOnly ? { read: true, manage: false, write: pageRole === "edit", comment: pageRole === "edit" || pageRole === "comment", pageOnly } : detail.rights;
  const api = `/api/workspaces/${tenantId}/docs/${doc.id}`;
  const [title, setTitle] = useState(page.title), [subtitle, setSubtitle] = useState(page.subtitle), [icon, setIcon] = useState(page.icon), [style, setStyle] = useState<PageStyle>(page.style), [locked, setLocked] = useState(page.protected);
  const [save, setSave] = useState<Save>("saved"), [updatedAt, setUpdatedAt] = useState(doc.updatedAt), [error, setError] = useState("");
  const [panel, setPanel] = useState<Panel>(null), [focusPage, setFocusPage] = useState(false), [focusBlock, setFocusBlock] = useState(false), [pagesOpen, setPagesOpen] = useState(false), [dialog, setDialog] = useState<Dlg>(null);
  const [favorite, setFavorite] = useState(doc.favorite), [favoritePlacement, setFavoritePlacement] = useState(doc.favoritePlacement), [wiki, setWiki] = useState(doc.wiki), [links, setLinks] = useState<LinkRow[]>([]), [attachments, setAttachments] = useState<AttachmentRow[]>([]), [templateRows, setTemplateRows] = useState<readonly TemplateRow[]>([]), [coverUrl, setCoverUrl] = useState("");
  const [pending, setPending] = useState<{ format: "html" | "markdown"; split: boolean } | null>(null);
  const stored = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false), [chosen, setChosen] = useState<boolean | null>(null), treeCollapsed = chosen ?? stored;
  const toggleTree = () => { const next = !treeCollapsed; setChosen(next); try { localStorage.setItem(collapsedKey, next ? "1" : "0"); window.dispatchEvent(new Event(collapsedEvent)); } catch { /* storage unavailable: the choice stays in memory */ } };
  const docked = useMediaQuery("(min-width: 1280px)");
  const editable = rights.write && !locked, resolved = resolvePageStyle(style);
  const pendingStyle = useRef<PageStyle | null>(null);
  const version = useRef(page.version), savedTitle = useRef(page.title), savedSubtitle = useRef(page.subtitle), edits = useRef(0), savedEdits = useRef(0), titleRef = useRef(page.title), subtitleRef = useRef(page.subtitle);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), queue = useRef<Promise<unknown>>(Promise.resolve()), titleInput = useRef<HTMLInputElement>(null), filePicker = useRef<HTMLInputElement>(null);

  const newPage = useRef<(child: boolean) => void>(() => {});
  const surface = useRef<SurfaceHandle | null>(null);
  const [insertMode, setInsertMode] = useState<InsertMode | null>(null), [templatesTick, setTemplatesTick] = useState(0), [outline, setOutline] = useState<Heading[]>([]), [stats, setStats] = useState<SurfaceStats>({ words: 0, characters: 0, readingMinutes: 0 });
  const onChange = useCallback(() => { edits.current++; schedule(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Every change to the page goes through one queue so each request carries the version the previous one returned. */
  const patch = useCallback((build: () => Record<string, unknown> | null) => {
    const run = queue.current.then(async () => {
      const fields = build(); if (!fields) return { ok: true as const, skipped: true };
      const result = await request<{ version: number; updatedAt: string }>(`${api}/pages/${page.id}`, { method: "PATCH", body: { version: version.current, ...fields } });
      if (result.ok) { version.current = result.data.version; setUpdatedAt(result.data.updatedAt); }
      return result;
    });
    queue.current = run.catch(() => undefined);
    return run;
  }, [api, page.id, request]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!rights.write) return true;
    let sentEdits = 0, sentTitle: string | null = null, sentSubtitle: string | null = null, sentStyle: PageStyle | null = null;
    const result = await patch(() => {
      sentEdits = edits.current; sentTitle = titleRef.current !== savedTitle.current ? titleRef.current : null; sentSubtitle = subtitleRef.current !== savedSubtitle.current ? subtitleRef.current : null; sentStyle = pendingStyle.current;
      const fields = pendingPageFields({ edits: sentEdits, savedEdits: savedEdits.current, title: titleRef.current, savedTitle: savedTitle.current, subtitle: subtitleRef.current, savedSubtitle: savedSubtitle.current, style: sentStyle, getContent: () => surface.current?.getContent() });
      if (!fields) return null;
      setSave("saving");
      return fields;
    });
    if (!result.ok) {
      setSave(result.status === 409 && result.details?.reason !== "protected" ? "conflict" : "error"); setError(result.error);
      if (result.status === 409 && result.details?.reason === "protected") { setLocked(true); }
      return false;
    }
    if ("skipped" in result) { setSave((s) => s === "saving" ? "saved" : s); return true; }
    savedEdits.current = sentEdits;
    if (sentStyle !== null && pendingStyle.current === sentStyle) pendingStyle.current = null;
    if (sentSubtitle !== null) savedSubtitle.current = sentSubtitle;
    if (sentTitle !== null) { savedTitle.current = sentTitle; router.refresh(); }
    if (edits.current !== sentEdits || titleRef.current !== savedTitle.current || subtitleRef.current !== savedSubtitle.current || pendingStyle.current !== null) schedule(); else { setSave("saved"); setError(""); }
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch, rights.write, router]);
  function schedule() { setSave((s) => s === "conflict" ? s : "unsaved"); clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), AUTOSAVE_MS); }

  // Leaving the page (a link, the sidebar, closing the tab) sends what is still unsaved: text, title, subtitle and a style change.
  // When the tab is only hidden (a phone switching apps) the normal save runs, which keeps the version in step.
  const latest = useRef({ flush: async () => true as boolean }); latest.current.flush = flush;
  useEffect(() => {
    const send = () => {
      if (!rights.write || locked) return;
      const fields = pendingPageFields({ edits: edits.current, savedEdits: savedEdits.current, title: titleRef.current, savedTitle: savedTitle.current, subtitle: subtitleRef.current, savedSubtitle: savedSubtitle.current, style: pendingStyle.current, getContent: () => surface.current?.getContent() });
      if (!fields) return;
      void fetch(`${api}/pages/${page.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: version.current, ...fields }), keepalive: true });
    };
    const hide = () => { if (document.visibilityState === "hidden") void latest.current.flush(); };
    window.addEventListener("pagehide", send);
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("pagehide", send); document.removeEventListener("visibilitychange", hide); clearTimeout(timer.current); send(); };
  }, [api, locked, page.id, rights.write]);

  /** A style change is saved at once through the shared save (so the status shows Saving, then Saved) and is also sent if the page is left first. */
  async function changeStyle(next: PageStyle) {
    setStyle(next); pendingStyle.current = next;
    await flush();
  }
  async function setProtection(on: boolean) {
    await flush();
    const result = await patch(() => ({ protected: on }));
    if (!result.ok) { setError(result.error); return; }
    setLocked(on); router.refresh();
  }
  async function leaveTo(href: string) { if (await flush()) router.push(href); }

  const call = useCallback(async <T,>(method: string, path: string, body?: unknown) => {
    const result = await request<T>(`${api}${path}`, { method, body });
    if (!result.ok) { setError(result.error); notify.error(result.error); }
    return result;
  }, [api, request]);
  const pageHref = (id: string) => docHref(tenantId, doc.id, id);
  const topPage = () => pages.filter((p) => !p.archivedAt && p.parentId === null).sort((a, b) => a.position - b.position)[0];
  newPage.current = async (child) => { await flush(); const r = await call<{ id: string }>("POST", "/pages", { parentId: child ? page.id : null }); if (r.ok) router.push(pageHref(r.data.id)); };

  // Links, attachments and the cover image of this page.
  const loadLinks = useCallback(async () => { const r = await request<{ links: LinkRow[] }>(`${api}/links?scope=page&pageId=${page.id}`, { method: "GET" }); if (r.ok) setLinks(r.data.links); }, [api, page.id, request]);
  const loadAttachments = useCallback(async () => { const r = await request<AttachmentRow[]>(`${api}/attachments`, { method: "GET" }); if (r.ok) setAttachments(r.data); }, [api, request]);
  useEffect(() => {
    let live = true;
    request<{ links: LinkRow[] }>(`${api}/links?scope=page&pageId=${page.id}`, { method: "GET" }).then((r) => { if (live && r.ok) setLinks(r.data.links); });
    request<AttachmentRow[]>(`${api}/attachments`, { method: "GET" }).then((r) => { if (live && r.ok) setAttachments(r.data); });
    return () => { live = false; };
  }, [api, page.id, request]);
  useEffect(() => {
    let live = true;
    if (!resolved.header.cover || !resolved.coverFileId) return;
    request<{ url: string }>(`/api/workspaces/${tenantId}/files/${resolved.coverFileId}/download`, { method: "GET" }).then((r) => { if (live) setCoverUrl(r.ok ? r.data.url : ""); });
    return () => { live = false; };
  }, [resolved.header.cover, resolved.coverFileId, request, tenantId]);
  async function download(fileId: string) { const r = await request<{ url: string }>(`/api/workspaces/${tenantId}/files/${fileId}/download`, { method: "GET" }); if (r.ok) window.open(r.data.url, "_blank", "noopener"); else notify.error(r.error); }

  const siblings = (p: { parentId: string | null }) => pages.filter((x) => !x.archivedAt && x.parentId === p.parentId).sort((a, b) => a.position - b.position);
  async function treeAction(action: PageAction, target: (typeof pages)[number]) {
    const sib = siblings(target), index = sib.findIndex((x) => x.id === target.id), parent = pages.find((x) => x.id === target.parentId);
    const move = async (parentId: string | null, at: number) => { await flush(); const r = await call("POST", `/pages/${target.id}/move`, { parentId, index: at }); if (r.ok) router.refresh(); };
    switch (action) {
      case "addSubpage": { await flush(); const r = await call<{ id: string }>("POST", "/pages", { parentId: target.id }); if (r.ok) router.push(pageHref(r.data.id)); return; }
      case "rename": if (target.id === page.id) titleInput.current?.focus(); else setRenameTarget(target); return;
      case "duplicate": { await flush(); const r = await call<{ id: string }>("POST", `/pages/${target.id}/duplicate`); if (r.ok) router.push(pageHref(r.data.id)); return; }
      case "moveUp": return move(target.parentId, index - 1);
      case "moveDown": return move(target.parentId, index + 1);
      case "indent": { const above = sib[index - 1]; return above ? move(above.id, pages.filter((x) => !x.archivedAt && x.parentId === above.id).length) : undefined; }
      case "outdent": { if (!parent) return; return move(parent.parentId, siblings(parent).findIndex((x) => x.id === parent.id) + 1); }
      case "archive": { await flush(); const r = await call("POST", `/pages/${target.id}/archive`, { archived: true }); if (r.ok) { if (subtreeIds(pages, target.id).includes(page.id)) router.push(docHref(tenantId, doc.id)); else router.refresh(); } return; }
      case "restore": { const r = await call("POST", `/pages/${target.id}/archive`, { archived: false }); if (r.ok) router.refresh(); return; }
      case "delete": setDeleteTarget(target); return;
    }
  }
  const [renameTarget, setRenameTarget] = useState<(typeof pages)[number] | null>(null), [deleteTarget, setDeleteTarget] = useState<(typeof pages)[number] | null>(null);
  const deleting = deleteTarget ?? pages.find((p) => p.id === page.id)!;
  const deleteCount = subtreeIds(pages, deleting.id).length;
  const imp = useImport(tenantId, doc.id, page.id, () => version.current, (id) => { router.push(pageHref(id)); router.refresh(); });
  const allProtected = pages.length > 0 && pages.every((p) => p.protected);

  async function menuAction(action: MenuAction) {
    const current = pages.find((p) => p.id === page.id)!;
    switch (action) {
      case "renameDoc": setDialog("renameDoc"); return;
      case "copyDocLink": case "copyPageLink": { const ok = await copyText(`${location.origin}${action === "copyDocLink" ? docHref(tenantId, doc.id) : pageHref(page.id)}`); if (ok) notify.success(t("linkCopied")); else notify.error(t("linkNotCopied")); return; }
      case "favorite": { const next = !favorite; setFavorite(next); setFavoritePlacement(next ? "top" : null); const r = await call(next ? "PUT" : "DELETE", "/favorite", next ? { placement: "top" } : undefined); if (!r.ok) { setFavorite(!next); setFavoritePlacement(doc.favoritePlacement); } else router.refresh(); return; }
      case "favoriteTop": case "favoriteSidebar": { const to = action === "favoriteTop" ? "top" : "sidebar"; setFavorite(true); setFavoritePlacement(to); const r = await call("PUT", "/favorite", { placement: to }); if (!r.ok) { setFavorite(doc.favorite); setFavoritePlacement(doc.favoritePlacement); } else router.refresh(); return; }
      case "sharePage": setDialog("sharePage"); return;
      case "duplicateDoc": { await flush(); const r = await call<{ id: string }>("POST", "/duplicate"); if (r.ok) { notify.success(t("duplicated")); router.push(docHref(tenantId, r.data.id)); } return; }
      case "moveDoc": setDialog("moveDoc"); return;
      case "archiveDoc": { await flush(); const r = await call("PATCH", "", { archived: !doc.archivedAt }); if (r.ok) router.refresh(); return; }
      case "trashDoc": setDialog("trashDoc"); return;
      case "toggleWiki": { const next = !wiki; setWiki(next); const r = await call("PATCH", "", { wiki: next }); if (!r.ok) setWiki(!next); else router.refresh(); return; }
      case "protectDoc": { await flush(); const r = await call("PUT", "/protection", { protected: !allProtected }); if (r.ok) { setLocked(!allProtected); router.refresh(); } return; }
      case "protectPage": void setProtection(!locked); return;
      case "renamePage": titleInput.current?.focus(); return;
      case "duplicatePage": await treeAction("duplicate", current); return;
      case "archivePage": await treeAction("archive", current); return;
      case "deletePage": setDeleteTarget(current); setDialog("deletePage"); return;
      case "addSubpage": newPage.current(true); return;
      case "moveUp": case "moveDown": case "makeSubpage": case "moveOut": await treeAction(action === "moveUp" ? "moveUp" : action === "moveDown" ? "moveDown" : action === "makeSubpage" ? "indent" : "outdent", current); return;
      case "attachStorage": setDialog("attach"); return;
      case "attachUpload": window.open(`/workspaces/${tenantId}/files`, "_blank", "noopener"); return;
      case "importHtml": setPending({ format: "html", split: false }); filePicker.current?.click(); return;
      case "importHtmlSplit": setPending({ format: "html", split: true }); filePicker.current?.click(); return;
      case "importMarkdown": setPending({ format: "markdown", split: false }); filePicker.current?.click(); return;
      case "applyTemplate": setPanel("templates"); return;
      case "saveTemplate": setDialog("saveTemplate"); return;
      case "history": setPanel("history"); return;
      case "share": setDialog("share"); return;
    }
  }

  const crumbs = folderPath(detail.folders, doc.folderId);
  const docName = doc.title || t("untitled");
  const current = pages.find((p) => p.id === page.id);
  const children = pages.filter((p) => !p.archivedAt && p.parentId === page.id).sort((a, b) => a.position - b.position);
  const treeEl = <PageTree tenantId={tenantId} favorites={detail.sidebarFavorites} docTitle={docName} pages={pages} current={page.id} canEdit={rights.write && !pageOnly} onOpen={(id) => { setPagesOpen(false); if (id !== page.id) void leaveTo(pageHref(id)); }} onAdd={() => newPage.current(false)} onAction={(a, p) => { setPagesOpen(false); void treeAction(a, p); }} />;
  const closePanel = () => setPanel(null);
  const pageVersion = () => version.current;
  const panelBody = panel === "comments" ? <CommentsPanel tenantId={tenantId} docId={doc.id} pageId={page.id} userId={userId} canComment={rights.comment} canManage={rights.manage} getSelection={() => surface.current?.selectionText() ?? ""} onJump={(q) => surface.current?.jumpToText(q)} onClose={closePanel} />
    : panel === "styles" ? <PageStylesPanel style={resolved} stats={stats} disabled={!rights.write} onChange={(next) => void changeStyle(next)} onApplyAll={async () => { await flush(); const r = await call<{ pages: number }>("POST", "/typography", { font: resolved.font, size: resolved.size, width: resolved.width, exceptPageId: page.id }); if (r.ok) notify.success(t("typographyApplied", { count: r.data.pages + 1 })); }}
      onPickCover={() => setDialog("cover")} focusBlock={focusBlock} onFocusBlock={setFocusBlock} focusPage={focusPage} onFocusPage={(on) => { setFocusPage(on); if (on) setPanel(null); }} onClose={closePanel} />
    : panel === "relationships" ? <RelationshipsPanel tenantId={tenantId} docId={doc.id} pageId={page.id} canEdit={rights.write && !pageOnly} onChanged={() => void loadLinks()} onClose={closePanel} />
    : panel === "templates" ? <TemplatesPanel key={templatesTick} tenantId={tenantId} docId={doc.id} pageId={page.id} canEdit={editable} pageVersion={pageVersion} onApplied={(id) => { setPanel(null); router.push(pageHref(id)); router.refresh(); }} onSave={() => undefined} onClose={closePanel} openSave={(mode, rows) => { setTemplateRows(rows); setDialog(mode === "save" ? "saveTemplate" : "updateTemplate"); }} />
    : panel === "export" ? <ExportPanel tenantId={tenantId} docId={doc.id} pageId={page.id} canEdit={editable} pageVersion={pageVersion} onImported={(id) => { setPanel(null); router.push(pageHref(id)); router.refresh(); }} onClose={closePanel} />
    : panel === "history" ? <HistoryPanel tenantId={tenantId} docId={doc.id} pageId={page.id} canEdit={editable} pageVersion={pageVersion} onRestored={() => location.reload()} onClose={closePanel} />
    : null;
  const saveLabel = save === "saved" ? t("saved") : save === "saving" ? t("saving") : save === "unsaved" ? t("unsaved") : save === "conflict" ? t("conflict") : t("saveFailed");

  const peopleCache = useRef<Person[] | null>(null);
  const mentionSource = useCallback(async (query: string): Promise<MentionItem[]> => {
    const q = query.trim().toLowerCase();
    if (!peopleCache.current) { const r = await call<{ people: Person[] }>("GET", `/comments?pageId=${page.id}`); peopleCache.current = r.ok ? r.data.people : []; }
    const people = peopleCache.current.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5).map((p): MentionItem => ({ kind: "person", id: p.userId, label: p.name }));
    const sub = pages.filter((p) => !p.archivedAt && (p.title || t("untitled")).toLowerCase().includes(q)).slice(0, 5).map((p): MentionItem => ({ kind: "page", id: p.id, label: p.title || t("untitled") }));
    const found = q.length >= 2 ? await call<{ id: string; label: string }[]>("GET", `/links/search?kind=task&q=${encodeURIComponent(q)}`) : null;
    const tasks = found && found.ok ? found.data.slice(0, 5).map((x): MentionItem => ({ kind: "task", id: x.id, label: x.label })) : [];
    return [...people, ...sub, ...tasks];
  }, [call, page.id, pages, t]);
  const rail = <>{railItems.map((r) => <Button key={r.id} type="button" variant="ghost" size="icon" className={cn("size-11 lg:size-9", panel === r.id && "bg-accent")} aria-pressed={panel === r.id} aria-label={t(r.label)} onClick={() => setPanel(panel === r.id ? null : r.id)}><r.icon aria-hidden="true" /></Button>)}</>;
  const alerts = ((save === "conflict" || (save === "error" && error)) || locked) && <div className="shrink-0 space-y-2 border-b p-3">
    {(save === "conflict" || (save === "error" && error)) && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center justify-between gap-2">{error || t("saveFailed")}
      {save === "conflict" ? <Button type="button" variant="outline" className="min-h-11" onClick={() => location.reload()}>{t("reload")}</Button> : <Button type="button" variant="outline" className="min-h-11" onClick={() => void flush()}>{t("retry")}</Button>}</AlertDescription></Alert>}
    {locked && <Alert><AlertDescription className="flex flex-wrap items-center justify-between gap-2">{t("protectedNotice")}
      {rights.write && <Button type="button" variant="outline" className="min-h-11" onClick={() => void setProtection(false)}>{t("unprotect")}</Button>}</AlertDescription></Alert>}
  </div>;

  const leading = <>
    <TooltipProvider delayDuration={400}><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="hidden size-9 shrink-0 lg:inline-flex" aria-expanded={!treeCollapsed} aria-controls="docs-pages-sidebar" aria-label={treeCollapsed ? t("expandPages") : t("collapsePages")} onClick={toggleTree}>
      {treeCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}</Button></TooltipTrigger><TooltipContent>{treeCollapsed ? t("expandPages") : t("collapsePages")}</TooltipContent></Tooltip></TooltipProvider>
    <Breadcrumb aria-label={t("location")} className="hidden min-w-0 lg:block"><BreadcrumbList className="flex-nowrap text-[13px]">
      {crumbs.map((f) => <Fragment key={f.id}><BreadcrumbItem><BreadcrumbLink asChild><Link href={docsHref(tenantId, { folder: f.id })} className="max-w-32 truncate">{f.name}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /></Fragment>)}
      <BreadcrumbItem className="min-w-0"><BreadcrumbPage className="block max-w-48 truncate">{docName}</BreadcrumbPage></BreadcrumbItem>
    </BreadcrumbList></Breadcrumb>
    <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-pressed={favorite} aria-label={favorite ? t("unfavorite", { name: docName }) : t("favorite", { name: docName })} onClick={() => void menuAction("favorite")}><Star className={cn(favorite && "fill-current text-warning")} aria-hidden="true" /></Button>
    {wiki && <Badge variant="secondary" className="gap-1"><BadgeCheck className="size-3" aria-hidden="true" />{t("wiki")}</Badge>}
    {doc.archivedAt && <Badge variant="secondary">{t("statusArchived")}</Badge>}
  </>;
  const trailing = <div className="ml-auto flex shrink-0 items-center gap-1">
    {rights.write && <span role="status" aria-live="polite" data-save-state={save} className={cn("px-2 text-sm", save === "error" || save === "conflict" ? "text-destructive" : "text-muted-foreground")}>{saveLabel}</span>}
    {!pageOnly && <Button type="button" variant="ghost" className="min-h-11 gap-1 px-2 lg:min-h-9" onClick={() => setDialog("share")}><UserRound aria-hidden="true" />{t("share")}</Button>}
    <DocMenu tenantId={tenantId} docId={doc.id} pageId={page.id} canEdit={rights.write && !pageOnly} canManage={rights.manage} favorite={favorite} favoritePlacement={favoritePlacement} archived={Boolean(doc.archivedAt)} wiki={wiki} docProtected={allProtected} pageProtected={locked} publicOffered={false} onAction={(a) => void menuAction(a)} />
    <Button asChild variant="ghost" size="icon" className="size-9"><Link href={docsHref(tenantId, { folder: doc.folderId })} aria-label={t("closeDoc")} onClick={(e) => { e.preventDefault(); void leaveTo(docsHref(tenantId, { folder: doc.folderId })); }}><X aria-hidden="true" /></Link></Button>
  </div>;

  const empty = stats.words === 0 && editable;
  const sideInline = resolved.sections.relationships === "inline";
  // The editor fills the shell below its header edge to edge: the pages sidebar, the card (toolbar and page, which scrolls) and the rail each scroll on their own.
  return <div className="-m-4 flex h-[calc(100dvh-3rem)] min-h-0 lg:-m-6 lg:h-[calc(100dvh-4rem-2px)]" data-docs-editor data-focus={focusPage || undefined}>
    {!focusPage && <ShellHeaderPortal><div className="hidden min-w-0 flex-1 items-center gap-1 md:flex">{leading}{trailing}</div></ShellHeaderPortal>}
    {!focusPage && !treeCollapsed && <aside id="docs-pages-sidebar" className="hidden w-60 shrink-0 overflow-y-auto border-e p-3 lg:block" aria-label={t("pages")}>{treeEl}</aside>}
    <section className="flex min-w-0 flex-1 flex-col" aria-label={t("pageContent")}>
      {!focusPage && <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1 lg:hidden"><Button type="button" variant="ghost" className="min-h-11 shrink-0 px-2" onClick={() => setPagesOpen(true)}><Menu aria-hidden="true" />{t("pages")}</Button><div className="flex md:hidden">{leading}</div><div className="flex items-center">{rail}</div><div className="flex md:hidden ms-auto">{trailing}</div></div>}
      {alerts}
      <DocEditorSurface content={page.content} readOnly={!editable} showToolbar={editable} focusBlock={focusBlock} handleRef={surface} onChange={onChange} onNewPage={(child) => newPage.current(child)} onInsert={(kind) => (kind === "template" ? setPanel("templates") : setInsertMode(kind))} mentionSource={mentionSource} onOutline={setOutline} onStats={setStats}
        bodyClassName={cn("mx-auto px-4 py-6 sm:px-8", widthClass[resolved.width], fontClass[resolved.font], sizeClass[resolved.size])}
        header={<>
          {resolved.header.cover && coverUrl && <div className="-mx-4 mb-4 h-40 overflow-hidden rounded-lg sm:-mx-8" data-docs-cover>
            {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived storage address; the optimiser would only proxy it */}
            <img src={coverUrl} alt="" className="size-full object-cover" /></div>}
          <button type="button" className="mb-2 flex min-h-11 items-center gap-2 text-xs text-muted-foreground hover:text-foreground lg:min-h-7" onClick={() => setPanel("relationships")} data-docs-link-row><Link2 className="size-3.5" aria-hidden="true" />{links.length ? t("linkedCount", { count: links.length }) : t("linkSomething")}</button>
          {sideInline && links.length > 0 && <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={t("relationships")}>{links.map((l) => <li key={l.id}><Link href={linkHref(tenantId, l)} className="inline-flex min-h-7 items-center rounded-full border px-2 text-xs hover:bg-accent">{l.label ?? t("unavailable")}</Link></li>)}</ul>}
          <div className="flex items-start gap-3">
            {resolved.header.icon && (editable
              ? <Popover><PopoverTrigger asChild><Button type="button" variant="ghost" className="size-12 shrink-0 text-3xl" aria-label={t("pageIcon")}>{icon ?? <FileText className="size-7 text-muted-foreground" aria-hidden="true" />}</Button></PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-2"><div className="grid grid-cols-5 gap-1">{pageIcons.map((e) => <button key={e} type="button" className="flex size-11 items-center justify-center rounded-md text-xl hover:bg-accent" aria-label={e} onClick={async () => { setIcon(e); await patch(() => ({ icon: e })); router.refresh(); }}>{e}</button>)}</div>
                  {icon && <Button type="button" variant="ghost" className="mt-1 min-h-11 w-full" onClick={async () => { setIcon(null); await patch(() => ({ icon: null })); router.refresh(); }}>{t("removeIcon")}</Button>}</PopoverContent></Popover>
              : icon ? <span className="text-3xl" aria-hidden="true">{icon}</span> : null)}
            <input ref={titleInput} aria-label={t("pageTitleField")} placeholder={t("untitled")} value={title} maxLength={200} readOnly={!editable} data-docs-title
              className="min-w-0 flex-1 bg-transparent text-4xl font-bold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
              onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; schedule(); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); surface.current?.focusStart(); } }} />
          </div>
          {resolved.header.subtitle && <input aria-label={t("subtitleField")} placeholder={t("subtitlePlaceholder")} value={subtitle} maxLength={200} readOnly={!editable} className="mt-1 w-full bg-transparent text-lg text-muted-foreground outline-none placeholder:text-muted-foreground/50"
            onChange={(e) => { setSubtitle(e.target.value); subtitleRef.current = e.target.value; schedule(); }} />}
          {(resolved.header.owner || resolved.header.updated || (resolved.header.contributors && page.contributors.length > 0)) && <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" data-docs-meta>
            {resolved.header.owner && <><UserAvatar name={doc.ownerName} className="size-6 text-xs" /><span className="max-w-64 truncate">{doc.ownerName}</span></>}
            {resolved.header.owner && resolved.header.updated && <span className="size-1 rounded-full bg-muted-foreground" aria-hidden="true" />}
            {resolved.header.updated && <span>{t("lastUpdated", { when: format.dateTime(new Date(updatedAt), { dateStyle: "medium", timeStyle: "short" }) })}</span>}
            {resolved.header.contributors && page.contributors.length > 0 && <span className="flex items-center gap-1" data-docs-contributors><span className="size-1 rounded-full bg-muted-foreground" aria-hidden="true" />{t("contributorsLine", { names: page.contributors.map((c) => c.name).join(", ") })}</span>}</p>}
          {attachments.length > 0 && <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("attachments")} data-docs-attachments>{attachments.map((a) => <li key={a.fileId} className="flex items-center rounded-full border text-xs"><button type="button" className="inline-flex min-h-11 items-center gap-1 ps-3 pe-2 hover:underline lg:min-h-8" onClick={() => void download(a.fileId)}><Paperclip className="size-3" aria-hidden="true" />{a.name}</button>
            {rights.write && <button type="button" className="inline-flex size-11 items-center justify-center lg:size-8" aria-label={t("detach", { name: a.name })} onClick={async () => { await call("DELETE", `/attachments/${a.fileId}`); void loadAttachments(); }}><X className="size-3" aria-hidden="true" /></button>}</li>)}</ul>}
          {resolved.sections.subpages !== "off" && children.length > 0 && <nav aria-label={t("subpages")} className="mt-4 rounded-lg border p-3" data-docs-subpages><h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("subpages")}</h2>
            {resolved.sections.subpages === "table"
              ? <table className="w-full text-sm"><thead className="sr-only"><tr><th>{t("columns.name")}</th><th>{t("subpages")}</th></tr></thead><tbody>{children.map((c) => <tr key={c.id} className="border-t first:border-t-0"><td><button type="button" className="min-h-11 text-start underline-offset-2 hover:underline lg:min-h-8" onClick={() => void leaveTo(pageHref(c.id))}>{c.title || t("untitled")}</button></td><td className="text-end text-muted-foreground">{t("subpageCount", { count: pages.filter((p) => p.parentId === c.id && !p.archivedAt).length })}</td></tr>)}</tbody></table>
              : <ul>{children.map((c) => <li key={c.id}><button type="button" className="min-h-11 text-start underline-offset-2 hover:underline lg:min-h-8" onClick={() => void leaveTo(pageHref(c.id))}>{c.title || t("untitled")}</button></li>)}</ul>}</nav>}
          {resolved.sections.outline && <div className="mt-4 rounded-lg border p-3"><h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("outline")}</h2><Outline items={outline} onJump={(p) => surface.current?.jumpTo(p)} /></div>}
          {empty && <div className="mt-6 space-y-1 text-muted-foreground" data-docs-start>
            <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-start hover:bg-accent" onClick={() => surface.current?.focusStart()}><FileText className="size-4" aria-hidden="true" />{t("startWriting")}</button>
            <p className="px-2 pt-3 text-xs">{t("addNew")}</p>
            <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-start hover:bg-accent" onClick={() => surface.current?.insertBlock("table")}><Table2 className="size-4" aria-hidden="true" />{t("slash.table")}</button>
            <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-start hover:bg-accent" onClick={() => surface.current?.insertBlock("columns")}><Columns2 className="size-4" aria-hidden="true" />{t("slash.columns")}</button>
            <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-start hover:bg-accent" onClick={() => surface.current?.insertBlock("checklist")}><ListChecks className="size-4" aria-hidden="true" />{t("slash.checklist")}</button>
            <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-start hover:bg-accent" onClick={() => newPage.current(true)}><CheckSquare className="size-4" aria-hidden="true" />{t("slash.suggestSubpage")}</button></div>}
        </>} />
      {resolved.showStats && <p className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground" data-docs-stats>{t("statsLine", { words: stats.words, characters: stats.characters, reading: readingLabel(stats.words, (k, v) => t(`styles.${k}`, v)) })}</p>}
    </section>
    {!focusPage && docked && panelBody && <aside className="w-80 shrink-0 border-s" aria-label={panel ? t(railItems.find((r) => r.id === panel)?.label ?? "pageHistory") : undefined}>{panelBody}</aside>}
    {!focusPage && <nav aria-label={t("pageTools")} className="hidden w-12 shrink-0 flex-col items-center gap-1 border-s py-2 lg:flex" data-docs-rail>{rail}</nav>}
    {focusPage && <Button type="button" variant="outline" className="fixed end-4 bottom-4 z-30 min-h-11 shadow-md" onClick={() => setFocusPage(false)}><Maximize2 aria-hidden="true" />{t("exitFocus")}</Button>}
    <input ref={filePicker} type="file" className="sr-only" tabIndex={-1} aria-label={t("chooseFile")} accept=".html,.htm,.md,.markdown,.txt,text/html,text/markdown,text/plain"
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f && pending) void imp.run(f, pending.format, pending.split, "new_pages"); }} />
    {imp.error && <div className="fixed start-4 bottom-4 z-30 max-w-sm"><Alert variant="destructive" role="alert"><AlertDescription>{imp.error}</AlertDescription></Alert></div>}

    <Sheet open={pagesOpen && !docked} onOpenChange={setPagesOpen}><SheetContent side="left" className="w-80 overflow-y-auto p-4" aria-describedby={undefined}><SheetHeader className="p-0"><SheetTitle className="sr-only">{t("pages")}</SheetTitle></SheetHeader>{treeEl}</SheetContent></Sheet>
    <Sheet open={!docked && panelBody !== null} onOpenChange={(o) => { if (!o) setPanel(null); }}><SheetContent showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-sm" aria-describedby={undefined}><SheetHeader className="sr-only"><SheetTitle>{t("pageTools")}</SheetTitle></SheetHeader><div className="h-full min-h-0">{panelBody}</div></SheetContent></Sheet>

    <ShareDialog open={dialog === "share"} onOpenChange={(o) => !o && setDialog(null)} tenantId={tenantId} docId={doc.id} pageId={page.id} docTitle={doc.title} protectedDoc={allProtected} onProtect={() => void menuAction("protectDoc")} onChanged={() => router.refresh()} />
    <FilePicker open={dialog === "attach"} onOpenChange={(o) => !o && setDialog(null)} tenantId={tenantId} title={t("attachFile")} onPick={async (f) => { const r = await call("POST", "/attachments", { fileId: f.id }); if (!r.ok) return r.error; void loadAttachments(); }} />
    <FilePicker open={dialog === "cover"} onOpenChange={(o) => !o && setDialog(null)} tenantId={tenantId} title={t("chooseCover")} imagesOnly onPick={async (f) => { await changeStyle({ ...style, coverFileId: f.id, header: { ...style.header, cover: true } }); }} />
    <PageShareDialog open={dialog === "sharePage"} onOpenChange={(o) => !o && setDialog(null)} tenantId={tenantId} docId={doc.id} pageId={page.id} />
    <InsertDialog mode={insertMode} onClose={() => setInsertMode(null)} onInsert={(mode, v) => {
      if (mode === "markdown") surface.current?.insertContent(v.blocks);
      else if (mode === "button") surface.current?.insertContent({ type: "button", attrs: { label: v.label, href: v.href } });
      else surface.current?.insertLink(v.label, v.href);
      setInsertMode(null);
    }} />
    <SaveTemplateDialog key={`${dialog}`} open={dialog === "saveTemplate" || dialog === "updateTemplate"} onOpenChange={(o) => !o && setDialog(null)} tenantId={tenantId} docId={doc.id} pageId={page.id} mode={dialog === "updateTemplate" ? "update" : "save"} templates={templateRows} onDone={() => { notify.success(t("templateSaved")); setTemplatesTick((n) => n + 1); }} />
    <NameDialog open={dialog === "renameDoc"} onOpenChange={(o) => !o && setDialog(null)} title={t("renameDoc")} label={t("docName")} submitLabel={t("save")} maxLength={200} required={false} initial={doc.title}
      onSubmit={async (name) => { const r = await call("PATCH", "", { title: name }); if (r.ok) { router.refresh(); return undefined; } return r.error; }} />
    <NameDialog open={renameTarget !== null} onOpenChange={(o) => !o && setRenameTarget(null)} title={t("renamePage")} label={t("pageTitleField")} submitLabel={t("save")} maxLength={200} required={false} initial={renameTarget?.title ?? ""}
      onSubmit={async (name) => {
        if (!renameTarget) return undefined;
        const fresh = await call<{ version: number }>("GET", `/pages/${renameTarget.id}`); if (!fresh.ok) return fresh.error;
        const r = await call("PATCH", `/pages/${renameTarget.id}`, { version: fresh.data.version, title: name }); if (r.ok) { router.refresh(); return undefined; } return r.error;
      }} />
    <MoveDialog open={dialog === "moveDoc"} onOpenChange={(o) => !o && setDialog(null)} title={t("moveDocTitle")} folders={detail.folders} current={doc.folderId}
      onMove={async (to) => { const r = await call("PATCH", "", { folderId: to }); if (r.ok) { router.refresh(); return undefined; } return r.error; }} />
    <ConfirmDialog open={dialog === "trashDoc"} onOpenChange={(o) => !o && setDialog(null)} title={t("trashTitle")} description={t("trashBody")} confirmLabel={t("moveToTrash")} cancelLabel={t("cancel")}
      onConfirm={async () => { await flush(); const r = await call("PATCH", "", { trashed: true }); if (!r.ok) return r.error; router.push(docsHref(tenantId, { folder: doc.folderId })); }} />
    <ConfirmDialog open={deleteTarget !== null || dialog === "deletePage"} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDialog(null); } }} title={t("deletePageTitle", { name: deleting.title || t("untitled") })}
      description={t("deletePageBody", { count: deleteCount })} confirmLabel={t("deletePage")} cancelLabel={t("cancel")}
      onConfirm={async () => { await flush(); const r = await call("DELETE", `/pages/${deleting.id}`); if (!r.ok) return r.error; if (subtreeIds(pages, deleting.id).includes(page.id)) router.push(docHref(tenantId, doc.id, topPage()?.id === deleting.id ? undefined : topPage()?.id)); else router.refresh(); }} />
    {current === undefined && null}
  </div>;
}
