/** Derived from Shadcn UI Kit item list-block26 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Link in bio rework). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import type { BioBlock, BioTabId } from "@/lib/link-in-bio";
import { cn } from "@/lib/utils";

/**
 * One block of the editor's reorderable list: a drag handle (mouse, touch and keyboard through @dnd-kit/sortable), the block type, its clicks, move up and
 * down, show or hide and delete, then the block's own fields and the tab it sits on.
 */
export function BioBlockRow({ block, index, count, label, issue, clicks, children, onMove, onToggle, onRemove, onTab, tabs }: {
  onTab: (tab: BioTabId) => void; tabs: { id: string; name: string }[] | null; block: BioBlock; index: number; count: number; label: string; issue?: "url" | "required"; clicks?: number; children: React.ReactNode;
  onMove: (by: number) => void; onToggle: () => void; onRemove: () => void;
}) {
  const t = useTranslations("LinkInBio");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-bio-row={block.id} data-block-type={block.type}
    className={cn("rounded-xl border bg-card", block.hidden && "opacity-70", isDragging && "relative z-10 opacity-80 shadow-lg")}>
    <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
      <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={t("links.drag", { label })}
        className="flex size-11 touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"><GripVertical aria-hidden="true" /></button>
      <Badge variant="secondary">{t(block.type === "link" ? "links.label" : `blocks.${block.type}`)}</Badge>
      {block.hidden && <Badge variant="outline">{t("blocks.hiddenBadge")}</Badge>}
      {clicks !== undefined && <span className="text-xs text-muted-foreground">{t("links.clicks", { count: clicks })}</span>}
      <span className="ms-auto flex flex-wrap items-center">
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === 0} aria-label={t("links.moveUp", { label })} onClick={() => onMove(-1)}><ArrowUp aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === count - 1} aria-label={t("links.moveDown", { label })} onClick={() => onMove(1)}><ArrowDown aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-pressed={block.hidden} aria-label={t(block.hidden ? "links.showLabel" : "links.hideLabel", { label })} onClick={onToggle}>{block.hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</Button>
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("links.removeLabel", { label })} onClick={onRemove}><Trash2 aria-hidden="true" /></Button>
      </span>
    </div>
    <div className="grid gap-4 p-4 sm:grid-cols-2" data-invalid={issue ? true : undefined}>{children}
      {tabs && <Field><FieldLabel htmlFor={`t-${block.id}`}>{t("links.tab")}</FieldLabel>
        <NativeSelect id={`t-${block.id}`} className="min-h-11 w-full" value={tabs.some((x) => x.id === block.tab) ? block.tab : ""} onChange={(e) => onTab(e.target.value)}>
          {!tabs.some((x) => x.id === block.tab) && <option value="" disabled>{t("tabsEditor.noTab")}</option>}
          {tabs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect></Field>}</div>
  </li>;
}
