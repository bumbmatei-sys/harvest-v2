"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArchiveRestore, ChevronRight, CornerDownRight, FilePlus2, FileText, Lock, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { buildPageTree, type PageTreeNode, type TreePage } from "@/lib/docs";
import { cn } from "@/lib/utils";

export type PageAction = "addSubpage" | "rename" | "duplicate" | "moveUp" | "moveDown" | "indent" | "outdent" | "archive" | "delete" | "restore";

/**
 * The Pages tree of a doc: nesting by indentation with collapse, the current page highlighted, and per-page actions in a menu. Reordering and nesting are menu actions
 * (move up or down, make a subpage of the page above, move out one level), so they work from the keyboard and on a touch screen without dragging.
 */
export function PageTree({ pages, current, canEdit, onOpen, onAdd, onAction }: {
  pages: readonly TreePage[]; current: string; canEdit: boolean; onOpen: (id: string) => void; onAdd: () => void; onAction: (action: PageAction, page: TreePage) => void;
}) {
  const t = useTranslations("Docs");
  const active = useMemo(() => pages.filter((p) => !p.archivedAt), [pages]);
  const archived = useMemo(() => pages.filter((p) => p.archivedAt && !pages.some((q) => q.id === p.parentId && q.archivedAt)), [pages]);
  const tree = useMemo(() => buildPageTree(active), [active]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function row(node: PageTreeNode, siblings: readonly PageTreeNode[], parent: PageTreeNode | null): React.ReactNode {
    const index = siblings.findIndex((s) => s.id === node.id), open = !collapsed.has(node.id), name = node.title || t("untitled");
    return <li key={node.id}>
      <div className={cn("group/page flex min-h-11 items-center rounded-md lg:min-h-9", node.id === current ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")} style={{ paddingInlineStart: `${node.depth * 0.9}rem` }}>
        {node.children.length > 0
          ? <button type="button" className="flex size-9 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:size-7" aria-expanded={open} aria-label={open ? t("collapse", { name }) : t("expand", { name })} onClick={() => toggle(node.id)}><ChevronRight className={cn("size-4 transition-transform rtl:rotate-180", open && "rotate-90 rtl:rotate-90")} aria-hidden="true" /></button>
          : <span className="size-9 shrink-0 lg:size-7" aria-hidden="true" />}
        <button type="button" aria-current={node.id === current ? "page" : undefined} data-page-id={node.id}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-start text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9" onClick={() => onOpen(node.id)}>
          {node.icon ? <span aria-hidden="true">{node.icon}</span> : <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="min-w-0 truncate">{name}</span>{node.protected && <Lock className="size-3 shrink-0 text-muted-foreground" aria-label={t("protectedPage")} />}</button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 lg:size-8" aria-label={t("pageMenu", { name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && <DropdownMenuItem className="min-h-11" onSelect={() => onAction("addSubpage", node)}><CornerDownRight aria-hidden="true" />{t("addSubpage")}</DropdownMenuItem>}
            {canEdit && <DropdownMenuItem className="min-h-11" onSelect={() => onAction("rename", node)}>{t("rename")}</DropdownMenuItem>}
            {canEdit && <DropdownMenuItem className="min-h-11" onSelect={() => onAction("duplicate", node)}>{t("duplicate")}</DropdownMenuItem>}
            {canEdit && <><DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-11" disabled={index <= 0} onSelect={() => onAction("moveUp", node)}>{t("moveUp")}</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" disabled={index < 0 || index >= siblings.length - 1} onSelect={() => onAction("moveDown", node)}>{t("moveDown")}</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" disabled={index <= 0} onSelect={() => onAction("indent", node)}>{t("makeSubpage")}</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" disabled={!parent} onSelect={() => onAction("outdent", node)}>{t("moveOut")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-11" onSelect={() => onAction("archive", node)}>{t("archive")}</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => onAction("delete", node)}>{t("deletePage")}</DropdownMenuItem></>}
            {!canEdit && <DropdownMenuItem className="min-h-11" onSelect={() => onOpen(node.id)}>{t("open")}</DropdownMenuItem>}
          </DropdownMenuContent></DropdownMenu>
      </div>
      {node.children.length > 0 && open && <ul>{node.children.map((c) => row(c, node.children, node))}</ul>}
    </li>;
  }
  return <nav aria-label={t("pages")} className="flex min-h-0 flex-col gap-2" data-docs-pages>
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{t("pages")}</h2></div>
    {canEdit && <Button type="button" variant="outline" className="min-h-11 w-full justify-start" onClick={onAdd}><FilePlus2 aria-hidden="true" />{t("addPage")}</Button>}
    <ul className="space-y-0.5">{tree.map((n) => row(n, tree, null))}</ul>
    {archived.length > 0 && <div className="mt-2 space-y-1"><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("archivedPages")}</h3>
      <ul>{archived.map((p) => <li key={p.id} className="flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground lg:min-h-9"><span className="min-w-0 flex-1 truncate">{p.title || t("untitled")}</span>
        {canEdit && <Button type="button" variant="ghost" size="icon" className="size-11 lg:size-8" aria-label={t("restorePage", { name: p.title || t("untitled") })} onClick={() => onAction("restore", p)}><ArchiveRestore aria-hidden="true" /></Button>}</li>)}</ul></div>}
  </nav>;
}
