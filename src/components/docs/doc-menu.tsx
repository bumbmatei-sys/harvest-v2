"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore, BadgeCheck, ChevronRight, Copy, FileInput, FileOutput, FilePlus2, FolderInput, Globe, History, Link2, Lock, MoreHorizontal, Paperclip, Pencil, Save, Share2, Star, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportHref, printHref } from "@/components/docs/panels/export-panel";
import { cn } from "@/lib/utils";

export type MenuAction =
  | "renameDoc" | "copyDocLink" | "favorite" | "duplicateDoc" | "moveDoc" | "archiveDoc" | "trashDoc" | "toggleWiki" | "protectDoc"
  | "renamePage" | "copyPageLink" | "duplicatePage" | "archivePage" | "deletePage" | "addSubpage" | "protectPage"
  | "moveUp" | "moveDown" | "makeSubpage" | "moveOut" | "attachStorage" | "attachUpload" | "importHtml" | "importHtmlSplit" | "importMarkdown"
  | "applyTemplate" | "saveTemplate" | "history" | "share";

const itemClass = "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-start text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50";
function Sub({ icon: Icon, label, children }: { icon: typeof Copy; label: string; children: React.ReactNode }) {
  return <Popover><PopoverTrigger asChild><button type="button" className={cn(itemClass, "justify-between")}><span className="flex items-center gap-3"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{label}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></button></PopoverTrigger>
    <PopoverContent side="left" align="start" className="w-60 p-1" data-docs-submenu>{children}</PopoverContent></Popover>;
}

/** The "..." settings menu: Entire doc and This page, with fly-outs for favourite, attach, move, import and export, and the Sharing and Permissions button. Only what the person may do is shown. */
export function DocMenu({ tenantId, docId, pageId, canEdit, canManage, favorite, archived, wiki, docProtected, pageProtected, onAction, publicOffered }: {
  tenantId: string; docId: string; pageId: string; canEdit: boolean; canManage: boolean; favorite: boolean; archived: boolean; wiki: boolean; docProtected: boolean; pageProtected: boolean; publicOffered: boolean; onAction: (action: MenuAction) => void;
}) {
  const t = useTranslations("Docs"), [open, setOpen] = useState(false), [scope, setScope] = useState("doc");
  const run = (a: MenuAction) => { setOpen(false); onAction(a); };
  const item = (a: MenuAction, Icon: typeof Copy, label: string, danger = false) => <button type="button" className={cn(itemClass, danger && "text-destructive")} onClick={() => run(a)}><Icon className={cn("size-4", danger ? "" : "text-muted-foreground")} aria-hidden="true" />{label}</button>;
  const toggle = (Icon: typeof Copy, label: string, checked: boolean, change: () => void) => <div className="flex min-h-11 items-center justify-between gap-3 px-3"><span className="flex items-center gap-3 text-sm"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{label}</span><Switch aria-label={label} checked={checked} onCheckedChange={() => { setOpen(false); change(); }} /></div>;
  const s = (sc: "doc" | "page") => sc;
  const exportSub = (sc: "doc" | "page") => <Sub icon={FileOutput} label={sc === "doc" ? t("export") : t("exportPage")}>
    <a className={itemClass} href={printHref(tenantId, docId, s(sc), pageId, true)} target="_blank" rel="noopener" onClick={() => setOpen(false)}>{t("exportPdf")}</a>
    <a className={itemClass} href={exportHref(tenantId, docId, s(sc), pageId, "html")} download onClick={() => setOpen(false)}>{t("exportHtml")}</a>
    <a className={itemClass} href={exportHref(tenantId, docId, s(sc), pageId, "markdown")} download onClick={() => setOpen(false)}>{t("exportMarkdown")}</a>
    <a className={itemClass} href={printHref(tenantId, docId, s(sc), pageId)} target="_blank" rel="noopener" onClick={() => setOpen(false)}>{t("print")}</a></Sub>;
  const importSub = canEdit && <Sub icon={FileInput} label={t("import")}>{item("importHtml", FileInput, t("importHtml"))}{item("importHtmlSplit", FileInput, t("importHtmlSplit"))}{item("importMarkdown", FileInput, t("importMarkdown"))}</Sub>;
  const favoriteSub = <button type="button" className={itemClass} aria-pressed={favorite} onClick={() => run("favorite")}><Star className={cn("size-4", favorite ? "fill-current text-warning" : "text-muted-foreground")} aria-hidden="true" />{favorite ? t("removeFavorite") : t("addFavorite")}</button>;
  const attachSub = canEdit && <Sub icon={Paperclip} label={t("attachFile")}>{item("attachUpload", Paperclip, t("uploadFile"))}{item("attachStorage", Paperclip, t("fromStorage"))}</Sub>;
  const templates = canEdit && <div className="my-1 space-y-0 border-t pt-1">{item("applyTemplate", Wand2, t("applyTemplate"))}{item("saveTemplate", Save, t("saveAsTemplate"))}</div>;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-9" aria-label={t("docMenuLabel")}><MoreHorizontal aria-hidden="true" /></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-72 p-2" data-docs-menu>
      <p className="px-3 pb-2 pt-1 font-semibold">{t("settings")}</p>
      <Tabs value={scope} onValueChange={setScope}>
        <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="doc" className="min-h-11 lg:min-h-0">{t("entireDoc")}</TabsTrigger><TabsTrigger value="page" className="min-h-11 lg:min-h-0">{t("thisPage")}</TabsTrigger></TabsList>
        <TabsContent value="doc" className="mt-2 flex flex-col">
          {canEdit && item("renameDoc", Pencil, t("rename"))}
          {item("copyDocLink", Link2, t("copyLink"))}
          {favoriteSub}
          {item("duplicateDoc", Copy, t("duplicate"))}
          {canManage && item("moveDoc", FolderInput, t("moveTo"))}
          {importSub}
          {exportSub("doc")}
          {templates}
          {canManage && <div className="my-1 border-t pt-1">{toggle(Lock, t("protectDoc"), docProtected, () => run("protectDoc"))}{publicOffered && toggle(Globe, t("publicSharing"), false, () => run("share"))}{toggle(BadgeCheck, t("markWiki"), wiki, () => run("toggleWiki"))}</div>}
          {canManage && <div className="my-1 border-t pt-1">{item("archiveDoc", archived ? ArchiveRestore : Archive, archived ? t("unarchive") : t("archive"))}{item("trashDoc", Trash2, t("delete"), true)}</div>}
        </TabsContent>
        <TabsContent value="page" className="mt-2 flex flex-col">
          {canEdit && item("renamePage", Pencil, t("renamePage"))}
          {item("copyPageLink", Link2, t("copyLink"))}
          {favoriteSub}
          {attachSub}
          {canEdit && item("duplicatePage", Copy, t("duplicatePage"))}
          {canEdit && <Sub icon={FolderInput} label={t("movePage")}>{item("moveUp", FolderInput, t("moveUp"))}{item("moveDown", FolderInput, t("moveDown"))}{item("makeSubpage", FolderInput, t("makeSubpage"))}{item("moveOut", FolderInput, t("moveOut"))}</Sub>}
          {importSub}
          {exportSub("page")}
          {templates}
          <div className="my-1 border-t pt-1">{canEdit && item("history", History, t("showHistory"))}{canEdit && toggle(Lock, t("protectPage"), pageProtected, () => run("protectPage"))}</div>
          {canEdit && <div className="my-1 border-t pt-1">{item("addSubpage", FilePlus2, t("addSubpage"))}{item("archivePage", Archive, t("archivePage"))}{item("deletePage", Trash2, t("deletePage"), true)}</div>}
        </TabsContent>
      </Tabs>
      <Button type="button" className="mt-2 min-h-11 w-full gap-2" onClick={() => run("share")}><Share2 aria-hidden="true" />{t("sharingAndPermissions")}</Button>
    </PopoverContent>
  </Popover>;
}
