"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore, Copy, FilePlus2, FolderInput, Link2, Lock, MoreHorizontal, Pencil, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type DocMenuAction = "renameDoc" | "copyDocLink" | "favorite" | "duplicateDoc" | "moveDoc" | "archiveDoc" | "trashDoc" | "renamePage" | "copyPageLink" | "duplicatePage" | "archivePage" | "deletePage" | "addSubpage";

/** The "..." menu: one switch between actions on the Entire doc and on This page. Only what exists is shown; what the person may not change is left out. */
export function DocMenu({ canEdit, favorite, archived, protectedPage, onAction, onProtect }: {
  canEdit: boolean; favorite: boolean; archived: boolean; protectedPage: boolean; onAction: (action: DocMenuAction) => void; onProtect: (on: boolean) => void;
}) {
  const t = useTranslations("Docs"), [open, setOpen] = useState(false), [scope, setScope] = useState("doc");
  const item = (action: DocMenuAction, label: string, Icon: typeof Pencil, destructive = false) =>
    <Button type="button" variant="ghost" className={`min-h-11 w-full justify-start gap-2 ${destructive ? "text-destructive hover:text-destructive" : ""}`} onClick={() => { setOpen(false); onAction(action); }}><Icon aria-hidden="true" />{label}</Button>;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("docMenuLabel")}><MoreHorizontal aria-hidden="true" /></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-72 p-2" data-docs-menu>
      <Tabs value={scope} onValueChange={setScope}>
        <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="doc" className="min-h-11 lg:min-h-0">{t("entireDoc")}</TabsTrigger><TabsTrigger value="page" className="min-h-11 lg:min-h-0">{t("thisPage")}</TabsTrigger></TabsList>
        <TabsContent value="doc" className="mt-2 flex flex-col">
          {canEdit && item("renameDoc", t("rename"), Pencil)}
          {item("copyDocLink", t("copyLink"), Link2)}
          <Button type="button" variant="ghost" className="min-h-11 w-full justify-start gap-2" aria-pressed={favorite} onClick={() => { setOpen(false); onAction("favorite"); }}><Star className={favorite ? "fill-current text-warning" : ""} aria-hidden="true" />{favorite ? t("removeFavorite") : t("addFavorite")}</Button>
          {item("duplicateDoc", t("duplicate"), Copy)}
          {canEdit && item("moveDoc", t("moveTo"), FolderInput)}
          {canEdit && item("archiveDoc", archived ? t("unarchive") : t("archive"), archived ? ArchiveRestore : Archive)}
          {canEdit && item("trashDoc", t("moveToTrash"), Trash2, true)}
        </TabsContent>
        <TabsContent value="page" className="mt-2 flex flex-col">
          {canEdit && item("addSubpage", t("addSubpage"), FilePlus2)}
          {canEdit && item("renamePage", t("rename"), Pencil)}
          {item("copyPageLink", t("copyLink"), Link2)}
          {canEdit && item("duplicatePage", t("duplicate"), Copy)}
          {canEdit && <div className="flex min-h-11 items-center justify-between gap-3 px-3"><Label htmlFor="docs-protect" className="flex items-center gap-2"><Lock className="size-4" aria-hidden="true" />{t("protectPage")}</Label>
            <Switch id="docs-protect" checked={protectedPage} onCheckedChange={(on) => { setOpen(false); onProtect(on); }} /></div>}
          {canEdit && item("archivePage", t("archive"), Archive)}
          {canEdit && item("deletePage", t("deletePage"), Trash2, true)}
        </TabsContent>
      </Tabs>
    </PopoverContent>
  </Popover>;
}
