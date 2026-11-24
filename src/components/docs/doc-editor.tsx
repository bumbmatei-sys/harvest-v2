/** Layout and flows follow the founder's reference for a document editor (pages tree, title and owner line, formatting toolbar, slash menu, page-styles rail), built from Harvest shared components in the Studio Admin style; no vendor markup, copy or imagery. Notes: docs/plans/docs-module.md. */
"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { ListTree, Maximize2, Menu, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Star, X } from "lucide-react";
import { ShellHeaderPortal } from "@/components/shell-header-slot";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/confirm-dialog";
import UserAvatar from "@/components/user-avatar";
import { DocMenu, type DocMenuAction } from "@/components/docs/doc-menu";
import { MoveDialog } from "@/components/docs/move-dialog";
import { NameDialog } from "@/components/docs/name-dialog";
import { DocEditorSurface, type SurfaceHandle, type SurfaceStats } from "@/components/docs/doc-editor-surface";
import type { Heading } from "@/components/docs/editor/headings";
import { PageStylesPanel } from "@/components/docs/page-styles-panel";
import { PageTree, type PageAction } from "@/components/docs/page-tree";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useRequest } from "@/hooks/use-request";
import { resolvePageStyle, subtreeIds, type DocContent, type PageStyle } from "@/lib/docs";
import { docHref, docsHref, folderPath } from "@/lib/docs-list";
import { copyText } from "@/lib/copy-text";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { DocDetail } from "@/server/docs";

type PageData = { id: string; parentId: string | null; title: string; icon: string | null; content: DocContent; style: PageStyle; protected: boolean; version: number; updatedAt: string; archivedAt: string | null };
type Save = "saved" | "unsaved" | "saving" | "error" | "conflict";
type Panel = "styles" | "outline" | null;
type Dlg = "renameDoc" | "renamePage" | "moveDoc" | "trashDoc" | "deletePage" | null;
const AUTOSAVE_MS = 900;
// The Pages sidebar's collapsed state is remembered per browser; storage can be blocked, so every access is guarded and the choice also lives in memory.
const collapsedKey = "harvest-docs-pages-collapsed", collapsedEvent = "harvest-docs-pages-collapsed-change";
const readCollapsed = () => { try { return localStorage.getItem(collapsedKey) === "1"; } catch { return false; } };
const subscribeCollapsed = (notify: () => void) => { window.addEventListener("storage", notify); window.addEventListener(collapsedEvent, notify); return () => { window.removeEventListener("storage", notify); window.removeEventListener(collapsedEvent, notify); }; };
const fontClass = { sans: "font-sans", serif: "font-serif", mono: "font-mono" } as const;
const sizeClass = { small: "text-sm", default: "text-[15px]", large: "text-lg" } as const;
const widthClass = { default: "max-w-3xl", wide: "max-w-5xl", full: "max-w-none" } as const;

function Outline({ items, onJump }: { items: readonly Heading[]; onJump: (position: number) => void }) {
  const t = useTranslations("Docs");
  if (!items.length) return <p className="text-sm text-muted-foreground">{t("outlineEmpty")}</p>;
  return <ul className="space-y-0.5" data-docs-outline>{items.map((h) => <li key={h.pos} style={{ paddingInlineStart: `${(h.level - 1) * 0.75}rem` }}>
    <button type="button" className="min-h-11 w-full rounded-md px-2 text-start text-sm hover:bg-accent lg:min-h-8" onClick={() => onJump(h.pos)}>{h.text}</button></li>)}</ul>;
}

/** The doc editor: pages tree, title and owner line, formatting toolbar, slash menu, autosave with version check, page styles. One page is open at a time; the page is chosen in the URL. */
export function DocEditor({ tenantId, detail, page }: { tenantId: string; detail: DocDetail; page: PageData }) {
  const t = useTranslations("Docs"), format = useFormatter(), router = useRouter(), request = useRequest();
  const { doc, rights, pages } = detail;
  const api = `/api/workspaces/${tenantId}/docs/${doc.id}`;
  const [title, setTitle] = useState(page.title), [style, setStyle] = useState<PageStyle>(page.style), [locked, setLocked] = useState(page.protected);
  const [save, setSave] = useState<Save>("saved"), [updatedAt, setUpdatedAt] = useState(doc.updatedAt), [error, setError] = useState("");
  const [panel, setPanel] = useState<Panel>(null), [focus, setFocus] = useState(false), [pagesOpen, setPagesOpen] = useState(false), [dialog, setDialog] = useState<Dlg>(null);
  const [favorite, setFavorite] = useState(doc.favorite);
  const stored = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false), [chosen, setChosen] = useState<boolean | null>(null), treeCollapsed = chosen ?? stored;
  const toggleTree = () => { const next = !treeCollapsed; setChosen(next); try { localStorage.setItem(collapsedKey, next ? "1" : "0"); window.dispatchEvent(new Event(collapsedEvent)); } catch { /* storage unavailable: the choice stays in memory */ } };
  const docked = useMediaQuery("(min-width: 1280px)");
  const editable = rights.write && !locked, resolved = resolvePageStyle(style);
  const version = useRef(page.version), savedTitle = useRef(page.title), edits = useRef(0), savedEdits = useRef(0), titleRef = useRef(page.title);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), queue = useRef<Promise<unknown>>(Promise.resolve()), titleInput = useRef<HTMLInputElement>(null);

  const newPage = useRef<(child: boolean) => void>(() => {});
  const surface = useRef<SurfaceHandle | null>(null);
  const [outline, setOutline] = useState<Heading[]>([]), [stats, setStats] = useState<SurfaceStats>({ words: 0, characters: 0, readingMinutes: 0 });
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
    let sentEdits = 0, sentTitle: string | null = null;
    const result = await patch(() => {
      sentEdits = edits.current; sentTitle = titleRef.current !== savedTitle.current ? titleRef.current : null;
      if (sentEdits === savedEdits.current && sentTitle === null) return null;
      setSave("saving");
      return { ...(sentEdits !== savedEdits.current ? { content: surface.current?.getContent() } : {}), ...(sentTitle !== null ? { title: sentTitle } : {}) };
    });
    if (!result.ok) {
      setSave(result.status === 409 && result.details?.reason !== "protected" ? "conflict" : "error"); setError(result.error);
      if (result.status === 409 && result.details?.reason === "protected") { setLocked(true); }
      return false;
    }
    if ("skipped" in result) { setSave((s) => s === "saving" ? "saved" : s); return true; }
    savedEdits.current = sentEdits;
    if (sentTitle !== null) { savedTitle.current = sentTitle; router.refresh(); }
    if (edits.current !== sentEdits || titleRef.current !== savedTitle.current) schedule(); else { setSave("saved"); setError(""); }
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch, rights.write, router]);
  function schedule() { setSave((s) => s === "conflict" ? s : "unsaved"); clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), AUTOSAVE_MS); }

  // Leaving the page (a link, the sidebar, closing the tab) sends what is still unsaved.
  const latest = useRef({ flush: async () => true as boolean }); latest.current.flush = flush;
  useEffect(() => {
    const send = () => {
      if (!rights.write || locked || (edits.current === savedEdits.current && titleRef.current === savedTitle.current)) return;
      const body = JSON.stringify({ version: version.current, ...(edits.current !== savedEdits.current ? { content: surface.current?.getContent() } : {}), ...(titleRef.current !== savedTitle.current ? { title: titleRef.current } : {}) });
      void fetch(`${api}/pages/${page.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    };
    window.addEventListener("pagehide", send);
    return () => { window.removeEventListener("pagehide", send); clearTimeout(timer.current); send(); };
  }, [api, locked, page.id, rights.write]);

  async function changeStyle(next: PageStyle) {
    setStyle(next);
    const result = await patch(() => ({ style: next }));
    if (!result.ok) { setError(result.error); setSave(result.status === 409 ? "conflict" : "error"); }
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

  async function menuAction(action: DocMenuAction) {
    const current = pages.find((p) => p.id === page.id)!;
    switch (action) {
      case "renameDoc": setDialog("renameDoc"); return;
      case "copyDocLink": case "copyPageLink": { const ok = await copyText(`${location.origin}${action === "copyDocLink" ? docHref(tenantId, doc.id) : pageHref(page.id)}`); if (ok) notify.success(t("linkCopied")); else notify.error(t("linkNotCopied")); return; }
      case "favorite": { const next = !favorite; setFavorite(next); const r = await call(next ? "PUT" : "DELETE", "/favorite"); if (!r.ok) setFavorite(!next); return; }
      case "duplicateDoc": { await flush(); const r = await call<{ id: string }>("POST", "/duplicate"); if (r.ok) { notify.success(t("duplicated")); router.push(docHref(tenantId, r.data.id)); } return; }
      case "moveDoc": setDialog("moveDoc"); return;
      case "archiveDoc": { await flush(); const r = await call("PATCH", "", { archived: !doc.archivedAt }); if (r.ok) router.refresh(); return; }
      case "trashDoc": setDialog("trashDoc"); return;
      case "renamePage": titleInput.current?.focus(); return;
      case "duplicatePage": await treeAction("duplicate", current); return;
      case "archivePage": await treeAction("archive", current); return;
      case "deletePage": setDeleteTarget(current); setDialog("deletePage"); return;
      case "addSubpage": newPage.current(true); return;
    }
  }

  const crumbs = folderPath(detail.folders, doc.folderId);
  const docName = doc.title || t("untitled");
  const current = pages.find((p) => p.id === page.id);
  const children = pages.filter((p) => !p.archivedAt && p.parentId === page.id).sort((a, b) => a.position - b.position);
  const labels = useMemo(() => ({ styles: t("pageStyles"), outline: t("outline") }), [t]);
  const treeEl = <PageTree pages={pages} current={page.id} canEdit={rights.write} onOpen={(id) => { setPagesOpen(false); if (id !== page.id) void leaveTo(pageHref(id)); }} onAdd={() => newPage.current(false)} onAction={(a, p) => { setPagesOpen(false); void treeAction(a, p); }} />;
  const jump = (position: number) => { surface.current?.jumpTo(position); if (!docked) setPanel(null); };
  const panelBody = panel && (panel === "styles"
    ? <PageStylesPanel style={resolved} stats={stats} disabled={!rights.write} onChange={(next) => void changeStyle(next)} onFocusMode={() => { setFocus(true); setPanel(null); }} />
    : <Outline items={outline} onJump={jump} />);
  const saveLabel = save === "saved" ? t("saved") : save === "saving" ? t("saving") : save === "unsaved" ? t("unsaved") : save === "conflict" ? t("conflict") : t("saveFailed");

  const rail = <>
    <Button type="button" variant="ghost" size="icon" className={cn("size-11 lg:size-9", panel === "styles" && "bg-accent")} aria-pressed={panel === "styles"} aria-label={labels.styles} onClick={() => setPanel(panel === "styles" ? null : "styles")}><PanelsTopLeft aria-hidden="true" /></Button>
    <Button type="button" variant="ghost" size="icon" className={cn("size-11 lg:size-9", panel === "outline" && "bg-accent")} aria-pressed={panel === "outline"} aria-label={labels.outline} onClick={() => setPanel(panel === "outline" ? null : "outline")}><ListTree aria-hidden="true" /></Button>
  </>;
  const alerts = ((save === "conflict" || (save === "error" && error)) || locked) && <div className="shrink-0 space-y-2 border-b p-3">
    {(save === "conflict" || (save === "error" && error)) && <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center justify-between gap-2">{error || t("saveFailed")}
      {save === "conflict" ? <Button type="button" variant="outline" className="min-h-11" onClick={() => location.reload()}>{t("reload")}</Button> : <Button type="button" variant="outline" className="min-h-11" onClick={() => void flush()}>{t("retry")}</Button>}</AlertDescription></Alert>}
    {locked && <Alert><AlertDescription className="flex flex-wrap items-center justify-between gap-2">{t("protectedNotice")}
      {rights.write && <Button type="button" variant="outline" className="min-h-11" onClick={() => void setProtection(false)}>{t("unprotect")}</Button>}</AlertDescription></Alert>}
  </div>;

  const controls = <>
      <Button type="button" variant="ghost" className="min-h-11 shrink-0 px-2 lg:hidden" onClick={() => setPagesOpen(true)}><Menu aria-hidden="true" />{t("pages")}</Button>
      <TooltipProvider delayDuration={400}><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="hidden size-9 shrink-0 lg:inline-flex" aria-expanded={!treeCollapsed} aria-controls="docs-pages-sidebar" aria-label={treeCollapsed ? t("expandPages") : t("collapsePages")} onClick={toggleTree}>
        {treeCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}</Button></TooltipTrigger><TooltipContent>{treeCollapsed ? t("expandPages") : t("collapsePages")}</TooltipContent></Tooltip></TooltipProvider>
      <Breadcrumb aria-label={t("location")} className="hidden min-w-0 lg:block"><BreadcrumbList className="flex-nowrap text-[13px]">
        {crumbs.map((f) => <Fragment key={f.id}><BreadcrumbItem><BreadcrumbLink asChild><Link href={docsHref(tenantId, { folder: f.id })} className="max-w-32 truncate">{f.name}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /></Fragment>)}
        <BreadcrumbItem className="min-w-0"><BreadcrumbPage className="block max-w-48 truncate">{docName}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" aria-pressed={favorite} aria-label={favorite ? t("unfavorite", { name: docName }) : t("favorite", { name: docName })} onClick={() => void menuAction("favorite")}><Star className={cn(favorite && "fill-current text-warning")} aria-hidden="true" /></Button>
      {doc.archivedAt && <Badge variant="secondary">{t("statusArchived")}</Badge>}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {rights.write && <span role="status" aria-live="polite" data-save-state={save} className={cn("px-2 text-sm", save === "error" || save === "conflict" ? "text-destructive" : "text-muted-foreground")}>{saveLabel}</span>}
        <div className="flex lg:hidden">{rail}</div>
        <DocMenu canEdit={rights.write} favorite={favorite} archived={Boolean(doc.archivedAt)} protectedPage={locked} onAction={(a) => void menuAction(a)} onProtect={(on) => void setProtection(on)} />
      </div>
  </>;

  // The editor fills the shell below its header edge to edge: the pages sidebar, the card (toolbar and page, which scrolls) and the rail each scroll on their own.
  return <div className="-m-4 flex h-[calc(100dvh-3rem)] min-h-0 lg:-m-6 lg:h-[calc(100dvh-4rem-2px)]" data-docs-editor data-focus={focus || undefined}>
    {!focus && <ShellHeaderPortal><div className="hidden min-w-0 flex-1 items-center gap-1 md:flex">{controls}</div></ShellHeaderPortal>}
    {!focus && !treeCollapsed && <aside id="docs-pages-sidebar" className="hidden w-60 shrink-0 overflow-y-auto border-e p-3 lg:block" aria-label={t("pages")}>{treeEl}</aside>}
    <section className="flex min-w-0 flex-1 flex-col" aria-label={t("pageContent")}>
      {!focus && <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1 md:hidden">{controls}</div>}
      {alerts}
      <DocEditorSurface content={page.content} readOnly={!editable} showToolbar={editable} handleRef={surface} onChange={onChange} onNewPage={(child) => newPage.current(child)} onOutline={setOutline} onStats={setStats}
        bodyClassName={cn("mx-auto px-4 py-6 sm:px-8", widthClass[resolved.width], fontClass[resolved.font], sizeClass[resolved.size])}
        header={<>
          <input ref={titleInput} aria-label={t("pageTitleField")} placeholder={t("untitled")} value={title} maxLength={200} readOnly={!editable} data-docs-title
            className="w-full bg-transparent text-4xl font-bold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
            onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; schedule(); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); surface.current?.focusStart(); } }} />
          {(resolved.header.owner || resolved.header.updated) && <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" data-docs-meta>
            {resolved.header.owner && <><UserAvatar name={doc.ownerName} className="size-6 text-xs" /><span className="max-w-64 truncate">{doc.ownerName}</span></>}
            {resolved.header.owner && resolved.header.updated && <span className="size-1 rounded-full bg-muted-foreground" aria-hidden="true" />}
            {resolved.header.updated && <span>{t("lastUpdated", { when: format.dateTime(new Date(updatedAt), { dateStyle: "medium", timeStyle: "short" }) })}</span>}</p>}
          {resolved.sections.subpages && children.length > 0 && <nav aria-label={t("subpages")} className="mt-4 rounded-lg border p-3"><h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("subpages")}</h2>
            <ul>{children.map((c) => <li key={c.id}><button type="button" className="min-h-11 text-start underline-offset-2 hover:underline lg:min-h-8" onClick={() => void leaveTo(pageHref(c.id))}>{c.title || t("untitled")}</button></li>)}</ul></nav>}
          {resolved.sections.outline && <div className="mt-4 rounded-lg border p-3"><h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("outline")}</h2><Outline items={outline} onJump={(p) => surface.current?.jumpTo(p)} /></div>}
        </>} />
    </section>
    {!focus && docked && panel && <aside className="w-72 shrink-0 overflow-y-auto border-s p-4" aria-label={panel === "styles" ? labels.styles : labels.outline}>
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{panel === "styles" ? labels.styles : labels.outline}</h2>
        <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={t("closePanel")} onClick={() => setPanel(null)}><X aria-hidden="true" /></Button></div>{panelBody}</aside>}
    {!focus && <nav aria-label={t("pageTools")} className="hidden w-12 shrink-0 flex-col items-center gap-1 border-s py-2 lg:flex" data-docs-rail>{rail}</nav>}
    {focus && <Button type="button" variant="outline" className="fixed end-4 bottom-4 z-30 min-h-11 shadow-md" onClick={() => setFocus(false)}><Maximize2 aria-hidden="true" />{t("exitFocus")}</Button>}

    <Sheet open={pagesOpen && !docked} onOpenChange={setPagesOpen}><SheetContent side="left" className="w-80 overflow-y-auto p-4" aria-describedby={undefined}><SheetHeader className="p-0"><SheetTitle className="sr-only">{t("pages")}</SheetTitle></SheetHeader>{treeEl}</SheetContent></Sheet>
    <Sheet open={!docked && panel !== null} onOpenChange={(o) => { if (!o) setPanel(null); }}><SheetContent className="w-full overflow-y-auto sm:max-w-sm" aria-describedby={undefined}><SheetHeader><SheetTitle>{panel === "outline" ? labels.outline : labels.styles}</SheetTitle></SheetHeader><div className="p-4">{panelBody}</div></SheetContent></Sheet>

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
