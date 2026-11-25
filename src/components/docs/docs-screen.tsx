/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/file-manager/components/summary-cards.tsx and app/dashboard/(auth)/apps/file-manager/components/file-manager.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Archive, ArchiveRestore, ArrowRight, ChevronDown, Copy, FilePlus2, FileText, FolderInput, FolderPlus, GripVertical, Upload, MoreHorizontal, Pencil, Search, Sheet, Star, Trash2, Undo2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { EntryIcon } from "@/components/files/entry-icon";
import { NameDialog } from "@/components/docs/name-dialog";
import { MoveDialog } from "@/components/docs/move-dialog";
import { NotificationsBell } from "@/components/docs/panels/notifications-bell";
import { useRequest } from "@/hooks/use-request";
import { docHref, docsHref, folderPath, folderSubtree, type ListView } from "@/lib/docs-list";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { DocRow, DocsList, FolderRow } from "@/server/docs";

type Status = "active" | "archived" | "trash";
type DialogState = { kind: "newFolder" } | { kind: "renameFolder"; folder: FolderRow } | { kind: "moveFolder"; folder: FolderRow } | { kind: "deleteFolder"; folder: FolderRow }
  | { kind: "renameDoc"; doc: DocRow } | { kind: "moveDoc"; doc: DocRow } | { kind: "trashDoc"; doc: DocRow } | null;

function FolderCard({ folder, subfolders, canChange, onOpen, onAction, href }: { folder: FolderRow; subfolders: number; canChange: boolean; onOpen: () => void; onAction: (kind: "rename" | "move" | "delete") => void; href: string }) {
  const t = useTranslations("Docs");
  const { setNodeRef, isOver } = useDroppable({ id: `folder:${folder.id}` });
  const meta = [t("docCount", { count: folder.docCount }), subfolders ? t("folderCount", { count: subfolders }) : null].filter(Boolean).join(" · ");
  return <li ref={setNodeRef} data-testid="doc-folder-card" data-drop-over={isOver || undefined}
    className={cn("group relative flex min-h-11 items-center gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors focus-within:ring-[3px] focus-within:ring-ring/50 hover:bg-accent", isOver && "border-primary bg-accent ring-2 ring-primary/40")}>
    <EntryIcon glyph="folder" size="lg" />
    <span className="min-w-0 flex-1">
      <Link href={href} onClick={(e) => { e.preventDefault(); onOpen(); }} className="block max-w-full truncate font-medium outline-none after:absolute after:inset-0 after:rounded-xl">{folder.name}</Link>
      <span className="block truncate text-sm text-muted-foreground">{meta}</span>
    </span>
    {canChange ? <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="relative z-10 size-11" aria-label={t("folderMenu", { name: folder.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="min-h-11" onSelect={() => onAction("rename")}><Pencil aria-hidden="true" />{t("rename")}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={() => onAction("move")}><FolderInput aria-hidden="true" />{t("moveTo")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => onAction("delete")}><Trash2 aria-hidden="true" />{t("deleteFolder")}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu> : <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />}
  </li>;
}

function DragGrip({ doc }: { doc: DocRow }) {
  const t = useTranslations("Docs");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `doc:${doc.id}` });
  return <button type="button" ref={setNodeRef} {...attributes} {...listeners} aria-label={t("dragDoc", { name: doc.title || t("untitled") })} aria-roledescription={t("draggable")}
    className={cn("flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:size-8", isDragging && "opacity-40")}><GripVertical className="size-4" aria-hidden="true" /></button>;
}
function CrumbDrop({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <span ref={setNodeRef} className={cn("rounded-md", isOver && "bg-accent ring-2 ring-primary/40")}>{children}</span>;
}

/** The Docs list: folders on top (open, create, rename, move, delete), then the docs of the open folder, or the search results across every folder with their folder path. */
export function DocsScreen({ tenantId, list, folderId, q, status, sort, favorites }: { tenantId: string; list: DocsList; folderId: string | null; q: string; status: Status; sort: "updated" | "title"; favorites: boolean }) {
  const t = useTranslations("Docs"), format = useFormatter(), router = useRouter(), request = useRequest();
  const [search, setSearch] = useState(q), [dialog, setDialog] = useState<DialogState>(null), [error, setError] = useState(""), [dragging, setDragging] = useState<DocRow | null>(null);
  const canWrite = list.role !== "viewer", manager = list.role === "owner" || list.role === "admin";
  const api = `/api/workspaces/${tenantId}/docs`;
  const view: ListView = { folder: folderId, q, status, sort, favorites };
  const go = (next: ListView, replace = false) => { const href = docsHref(tenantId, next); if (replace) router.replace(href); else router.push(href); };
  const searching = q.length > 0 || favorites || status !== "active";
  const path = folderPath(list.folders, folderId), folder = path[path.length - 1];
  const children = list.folders.filter((f) => f.parentId === folderId).sort((a, b) => a.name.localeCompare(b.name));
  const folderName = (id: string | null) => { const p = folderPath(list.folders, id); return p.length ? p.map((f) => f.name).join(" / ") : t("title"); };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }), useSensor(KeyboardSensor));

  // The search box writes to the URL after a short pause; the typed text stays in the box.
  const [pushed, setPushed] = useState(q), [seen, setSeen] = useState(q);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } const timer = setTimeout(() => { if (search.trim() !== q) { setPushed(search.trim()); go({ ...view, q: search.trim() }, true); } }, 300); return () => clearTimeout(timer); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  // A change of the address that the box did not make (a breadcrumb, Back) replaces the text.
  if (q !== seen) { setSeen(q); if (q !== pushed) setSearch(q); }

  async function call<T = unknown>(method: string, path: string, body?: unknown) {
    const result = await request<T>(`${api}${path}`, { method, body });
    if (!result.ok) { setError(result.error); return result; }
    setError(""); router.refresh(); return result;
  }
  const fail = (result: { ok: boolean; error?: string }) => (result.ok ? undefined : result.error);
  const picker = useRef<HTMLInputElement>(null);
  async function importFile(file: File) {
    if (file.size > 1_000_000) { setError(t("importTooLarge")); return; }
    const r = await call<{ id: string }>("POST", "/import", { format: /\.(md|markdown|txt)$/i.test(file.name) ? "markdown" : "html", text: await file.text(), split: false, title: file.name.replace(/\.[^.]+$/, "").slice(0, 200), folderId });
    if (r.ok) router.push(docHref(tenantId, r.data.id));
  }
  async function createDoc(wiki = false) { const r = await call<{ id: string; pageId: string }>("POST", "", { title: "", folderId, ...(wiki ? { wiki: true } : {}) }); if (r.ok) router.push(docHref(tenantId, r.data.id)); }
  async function moveDoc(doc: DocRow, to: string | null) {
    if (doc.folderId === to) return undefined;
    const r = await call("PATCH", `/${doc.id}`, { folderId: to }); if (r.ok) notify.success(t("movedTo", { name: folderName(to) })); return fail(r);
  }
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const doc = list.docs.find((d) => `doc:${d.id}` === event.active.id), over = event.over?.id ? String(event.over.id) : "";
    if (!doc || !over) return;
    if (over.startsWith("folder:")) void moveDoc(doc, over.slice(7)); else if (over === "crumb:root") void moveDoc(doc, null);
  };

  const columns: DataTableColumn[] = [
    { id: "name", header: t("columns.name"), card: "title", className: "min-w-0 whitespace-normal break-words" }, { id: "owner", header: t("columns.owner"), showFrom: "@3xl" },
    { id: "updated", header: t("columns.updated"), showFrom: "@md" }, { id: "actions", header: t("columns.actions"), srOnlyHeader: true, align: "end", card: "actions", className: "w-32" },
  ];
  const rows: DataTableRow[] = list.docs.map((doc) => {
    const name = doc.title || t("untitled"), where = doc.folderId && (q || favorites || status !== "active") ? folderName(doc.folderId) : null;
    const inTrash = Boolean(doc.deletedAt), mayChange = doc.rights.write;
    return { id: doc.id, label: name, cells: {
      name: <div className="flex min-w-0 items-center gap-2">
        {status === "active" && mayChange && !searching && <DragGrip doc={doc} />}
        {doc.kind === "spreadsheet" ? <Sheet className="size-5 shrink-0 text-muted-foreground" data-doc-kind="spreadsheet" aria-hidden="true" /> : <FileText className="size-5 shrink-0 text-muted-foreground" data-doc-kind="document" aria-hidden="true" />}
        <span className="min-w-0">{inTrash ? <span className="block truncate font-medium">{name}</span> : <Link href={docHref(tenantId, doc.id)} className="flex min-h-11 min-w-0 items-center truncate font-medium hover:underline lg:min-h-9" data-testid="doc-link">{name}</Link>}
          {where && <span className="block truncate text-xs text-muted-foreground" data-testid="doc-path">{where}</span>}</span></div>,
      owner: <span className="text-muted-foreground">{doc.ownerName}</span>,
      updated: <time dateTime={doc.updatedAt} className="whitespace-nowrap text-muted-foreground">{format.dateTime(new Date(doc.updatedAt), { dateStyle: "medium", timeStyle: "short" })}</time>,
      actions: <div className="flex items-center justify-end gap-1">
        {!inTrash && <Button type="button" variant="ghost" size="icon" className="size-11 lg:size-8" aria-pressed={doc.favorite} aria-label={doc.favorite ? t("unfavorite", { name }) : t("favorite", { name })}
          onClick={() => void call(doc.favorite ? "DELETE" : "PUT", `/${doc.id}/favorite`)}><Star className={cn("size-4", doc.favorite && "fill-current text-warning")} aria-hidden="true" /></Button>}
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11 lg:size-8" aria-label={t("docMenu", { name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!inTrash && <DropdownMenuItem className="min-h-11" onSelect={() => router.push(docHref(tenantId, doc.id))}><FileText aria-hidden="true" />{t("open")}</DropdownMenuItem>}
            {mayChange && !inTrash && <DropdownMenuItem className="min-h-11" onSelect={() => setDialog({ kind: "renameDoc", doc })}><Pencil aria-hidden="true" />{t("rename")}</DropdownMenuItem>}
            {canWrite && !inTrash && <DropdownMenuItem className="min-h-11" onSelect={async () => { const r = await call<{ id: string }>("POST", `/${doc.id}/duplicate`); if (r.ok) notify.success(t("duplicated")); }}><Copy aria-hidden="true" />{t("duplicate")}</DropdownMenuItem>}
            {mayChange && !inTrash && <DropdownMenuItem className="min-h-11" onSelect={() => setDialog({ kind: "moveDoc", doc })}><FolderInput aria-hidden="true" />{t("moveTo")}</DropdownMenuItem>}
            {mayChange && !inTrash && (doc.archivedAt
              ? <DropdownMenuItem className="min-h-11" onSelect={() => void call("PATCH", `/${doc.id}`, { archived: false })}><ArchiveRestore aria-hidden="true" />{t("unarchive")}</DropdownMenuItem>
              : <DropdownMenuItem className="min-h-11" onSelect={() => void call("PATCH", `/${doc.id}`, { archived: true })}><Archive aria-hidden="true" />{t("archive")}</DropdownMenuItem>)}
            {mayChange && inTrash && <DropdownMenuItem className="min-h-11" onSelect={() => void call("PATCH", `/${doc.id}`, { trashed: false })}><Undo2 aria-hidden="true" />{t("restore")}</DropdownMenuItem>}
            {mayChange && !inTrash && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => setDialog({ kind: "trashDoc", doc })}><Trash2 aria-hidden="true" />{t("moveToTrash")}</DropdownMenuItem></>}
          </DropdownMenuContent></DropdownMenu></div>,
    } };
  });

  const subfoldersOf = (id: string) => list.folders.filter((f) => f.parentId === id).length;
  const noDocs = list.docs.length === 0;
  const emptyTitle = q ? t("noMatch") : favorites ? t("noFavorites") : status === "archived" ? t("noArchived") : status === "trash" ? t("trashEmpty") : folder ? t("folderEmpty") : t("emptyTitle");
  const deleteFolder = dialog?.kind === "deleteFolder" ? dialog.folder : null;
  const hasItems = deleteFolder ? deleteFolder.docTotal > 0 || subfoldersOf(deleteFolder.id) > 0 : false;

  return <DndContext id="docs-dnd" sensors={sensors} onDragStart={(e) => setDragging(list.docs.find((d) => `doc:${d.id}` === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
    <div className="min-w-0 space-y-6" data-docs-list>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
        <div className="flex flex-wrap items-center gap-2"><NotificationsBell tenantId={tenantId} />
        {canWrite && <>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => picker.current?.click()}><Upload aria-hidden="true" />{t("import")}</Button>
          <input ref={picker} type="file" className="sr-only" tabIndex={-1} aria-label={t("chooseFile")} accept=".html,.htm,.md,.markdown,.txt,text/html,text/markdown,text/plain" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importFile(f); }} />
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setDialog({ kind: "newFolder" })}><FolderPlus aria-hidden="true" />{t("newFolder")}</Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" className="min-h-11"><FilePlus2 aria-hidden="true" />{t("newMenu")}<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem className="min-h-11" onSelect={() => void createDoc()}>{t("newBlankDoc")}</DropdownMenuItem><DropdownMenuItem className="min-h-11" onSelect={() => void createDoc(true)}>{t("newBlankWiki")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </>}</div>
      </header>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="min-h-11 ps-9" type="search" aria-label={t("search")} placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <NativeSelect aria-label={t("status")} className="min-h-11 w-40" value={status} onChange={(e) => go({ ...view, status: e.target.value as Status })}>
          <NativeSelectOption value="active">{t("statusActive")}</NativeSelectOption><NativeSelectOption value="archived">{t("statusArchived")}</NativeSelectOption><NativeSelectOption value="trash">{t("statusTrash")}</NativeSelectOption></NativeSelect>
        <NativeSelect aria-label={t("sort")} className="min-h-11 w-48" value={sort} onChange={(e) => go({ ...view, sort: e.target.value as "updated" | "title" })}>
          <NativeSelectOption value="updated">{t("sortUpdated")}</NativeSelectOption><NativeSelectOption value="title">{t("sortTitle")}</NativeSelectOption></NativeSelect>
        <Button type="button" variant="outline" className="min-h-11" aria-pressed={favorites} onClick={() => go({ ...view, favorites: !favorites })}><Star className={cn(favorites && "fill-current text-warning")} aria-hidden="true" />{t("starred")}</Button>
      </div>
      <Breadcrumb aria-label={t("location")}><BreadcrumbList>
        {path.length === 0 && !searching ? <BreadcrumbItem><BreadcrumbPage>{t("title")}</BreadcrumbPage></BreadcrumbItem>
          : <BreadcrumbItem><CrumbDrop id="crumb:root"><BreadcrumbLink asChild><Link href={docsHref(tenantId)} className="inline-flex min-h-11 items-center px-1 lg:min-h-8">{t("title")}</Link></BreadcrumbLink></CrumbDrop></BreadcrumbItem>}
        {!searching && path.map((f, i) => <Fragment key={f.id}><BreadcrumbSeparator />
          <BreadcrumbItem>{i === path.length - 1 ? <BreadcrumbPage>{f.name}</BreadcrumbPage> : <CrumbDrop id={`folder:${f.id}`}><BreadcrumbLink asChild><Link href={docsHref(tenantId, { folder: f.id })} className="inline-flex min-h-11 items-center px-1 lg:min-h-8">{f.name}</Link></BreadcrumbLink></CrumbDrop>}</BreadcrumbItem></Fragment>)}
        {searching && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{q ? t("searchResults") : favorites ? t("starred") : status === "archived" ? t("statusArchived") : t("statusTrash")}</BreadcrumbPage></BreadcrumbItem></>}
      </BreadcrumbList></Breadcrumb>
      {!searching && list.pinned.length > 0 && <section aria-label={t("favoritesRow")} data-docs-pinned><h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("favoritesRow")}</h2>
        <ul className="flex flex-wrap gap-2">{list.pinned.map((f) => <li key={f.id}><Link href={docHref(tenantId, f.id)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 text-sm hover:bg-accent"><Star className="size-4 fill-current text-warning" aria-hidden="true" /><span className="max-w-48 truncate">{f.title || t("untitled")}</span></Link></li>)}</ul></section>}
      {!searching && children.length > 0 && <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("folders")} data-testid="doc-folder-cards">
        {children.map((f) => <FolderCard key={f.id} folder={f} subfolders={subfoldersOf(f.id)} href={docsHref(tenantId, { folder: f.id })} canChange={manager || (canWrite && f.ownerId === list.userId)}
          onOpen={() => go({ folder: f.id })} onAction={(kind) => setDialog({ kind: kind === "rename" ? "renameFolder" : kind === "move" ? "moveFolder" : "deleteFolder", folder: f })} />)}
      </ul>}
      {noDocs ? <EmptyState icon={searching ? Search : FileText} size={searching ? "compact" : "standard"} title={emptyTitle}
        action={!searching && canWrite ? <Button type="button" className="min-h-11" onClick={() => void createDoc()}><FilePlus2 aria-hidden="true" />{t("newDoc")}</Button> : undefined} />
        : <DataTable label={t("title")} columns={columns} rows={rows} />}
    </div>
    <DragOverlay>{dragging ? <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-lg"><FileText className="size-4" aria-hidden="true" />{dragging.title || t("untitled")}</div> : null}</DragOverlay>

    <NameDialog open={dialog?.kind === "newFolder"} onOpenChange={(o) => !o && setDialog(null)} title={t("newFolder")} label={t("folderName")} submitLabel={t("create")}
      onSubmit={async (name) => fail(await call("POST", "/folders", { name, parentId: folderId }))} />
    <NameDialog open={dialog?.kind === "renameFolder"} onOpenChange={(o) => !o && setDialog(null)} title={t("renameFolder")} label={t("folderName")} submitLabel={t("save")} initial={dialog?.kind === "renameFolder" ? dialog.folder.name : ""}
      onSubmit={async (name) => dialog?.kind === "renameFolder" ? fail(await call("PATCH", `/folders/${dialog.folder.id}`, { name })) : undefined} />
    <NameDialog open={dialog?.kind === "renameDoc"} onOpenChange={(o) => !o && setDialog(null)} title={t("renameDoc")} label={t("docName")} submitLabel={t("save")} maxLength={200} required={false} initial={dialog?.kind === "renameDoc" ? dialog.doc.title : ""}
      onSubmit={async (name) => dialog?.kind === "renameDoc" ? fail(await call("PATCH", `/${dialog.doc.id}`, { title: name })) : undefined} />
    <MoveDialog open={dialog?.kind === "moveDoc"} onOpenChange={(o) => !o && setDialog(null)} title={t("moveDocTitle")} folders={list.folders} current={dialog?.kind === "moveDoc" ? dialog.doc.folderId : null}
      onMove={async (to) => dialog?.kind === "moveDoc" ? moveDoc(dialog.doc, to) : undefined} />
    <MoveDialog open={dialog?.kind === "moveFolder"} onOpenChange={(o) => !o && setDialog(null)} title={t("moveFolderTitle")} folders={list.folders} current={dialog?.kind === "moveFolder" ? dialog.folder.parentId : null}
      disabledIds={dialog?.kind === "moveFolder" ? folderSubtree(list.folders, dialog.folder.id) : []}
      onMove={async (to) => dialog?.kind === "moveFolder" ? fail(await call("PATCH", `/folders/${dialog.folder.id}`, { parentId: to })) : undefined} />
    <ConfirmDialog open={dialog?.kind === "trashDoc"} onOpenChange={(o) => !o && setDialog(null)} title={t("trashTitle")} description={t("trashBody")} confirmLabel={t("moveToTrash")} cancelLabel={t("cancel")}
      onConfirm={async () => { if (dialog?.kind !== "trashDoc") return; const r = await call("PATCH", `/${dialog.doc.id}`, { trashed: true }); return fail(r); }} />
    <ConfirmDialog open={dialog?.kind === "deleteFolder"} onOpenChange={(o) => !o && setDialog(null)} title={t("deleteFolderTitle", { name: deleteFolder?.name ?? "" })}
      description={hasItems && deleteFolder ? t("deleteFolderMove", { docs: deleteFolder.docTotal, folders: subfoldersOf(deleteFolder.id), where: folderName(deleteFolder.parentId) }) : t("deleteFolderEmpty")}
      confirmLabel={hasItems ? t("moveUpAndDelete") : t("deleteFolder")} cancelLabel={t("cancel")}
      onConfirm={async () => { if (!deleteFolder) return; const r = await call("DELETE", `/folders/${deleteFolder.id}`, { mode: hasItems ? "move_to_parent" : "refuse" }); if (r.ok && deleteFolder.id === folderId) go({ folder: deleteFolder.parentId }); return fail(r); }} />
  </DndContext>;
}
