"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, CalendarDays, Columns2, Copy, GripVertical, HandHeart, ImageIcon, Minus, MoveVertical, PanelTop, PenLine, Play, Plus, Quote, Share2, Sparkles, Trash2, Type, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BlockSettings } from "@/components/newsletter/block-settings";
import { blockTypes, moveBlock, newBlock, newId, type BlockType, type EmailBlock } from "@/lib/email/blocks";
import { plainText } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

export const blockIcons: Record<BlockType, LucideIcon> = { header: PanelTop, hero: Sparkles, text: Type, imageText: ImageIcon, columns: Columns2, quote: Quote, event: CalendarDays, giving: HandHeart, video: Play, image: ImageIcon, social: Share2, divider: Minus, spacer: MoveVertical, footer: PenLine };

function summary(block: EmailBlock): string {
  switch (block.type) {
    case "header": return block.title;
    case "hero": case "giving": case "imageText": return block.heading;
    case "text": return plainText(block.doc).slice(0, 80);
    case "columns": return block.leftHeading;
    case "quote": return block.text;
    case "event": return block.title;
    case "video": return block.caption;
    case "image": return block.alt;
    case "social": return block.links.map((l) => l.label).join(", ");
    case "footer": return block.note;
    default: return "";
  }
}

type Change = (fn: (blocks: EmailBlock[]) => EmailBlock[], key?: string) => void;

function SortableBlock({ tenantId, suggestions, block, index, count, selected, label, onSelect, onPatch, onMove, onRemove, onDuplicate }: {
  tenantId: string; suggestions: boolean; block: EmailBlock; index: number; count: number; selected: boolean; label: string; onSelect: () => void;
  onPatch: (patch: Record<string, unknown>, key?: string) => void; onMove: (by: number) => void; onRemove: () => void; onDuplicate: () => void;
}) {
  const t = useTranslations("NewsletterCampaigns.editor"), types = useTranslations("NewsletterCampaigns.blocks");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const Icon = blockIcons[block.type], text = summary(block);
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} data-block={block.id} data-block-type={block.type}
    className={cn("rounded-xl border bg-card", selected && "border-primary/50 ring-1 ring-primary/30", isDragging && "relative z-10 opacity-80 shadow-lg")}>
    <div className="flex min-h-11 flex-wrap items-center gap-1 px-2 py-1">
      <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={t("drag", { label })}
        className="flex size-11 touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"><GripVertical aria-hidden="true" /></button>
      <button type="button" aria-expanded={selected} aria-label={t("editBlock", { label })} onClick={onSelect}
        className="flex min-h-11 min-w-44 flex-1 items-center gap-2 overflow-hidden rounded-md px-2 text-left outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><Badge variant="secondary" className="shrink-0">{types(block.type)}</Badge>
        <span className="truncate text-sm text-muted-foreground">{text}</span></button>
      <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === 0} aria-label={t("moveUp", { label })} onClick={() => onMove(-1)}><ArrowUp aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" disabled={index === count - 1} aria-label={t("moveDown", { label })} onClick={() => onMove(1)}><ArrowDown aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("duplicateBlock", { label })} onClick={onDuplicate}><Copy aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("remove", { label })} onClick={onRemove}><Trash2 aria-hidden="true" /></Button>
    </div>
    {selected && <BlockSettings block={block} onChange={onPatch} tenantId={tenantId} suggestions={suggestions} />}
  </li>;
}

/** The block canvas: drag (or Move up and Move down) to reorder, select a block to edit its settings, add from the searchable menu. */
export function BlockCanvas({ tenantId, suggestions, blocks, change, selected, setSelected, notify, copy }: {
  tenantId: string; suggestions: boolean; blocks: EmailBlock[]; change: Change; selected: string | null; setSelected: (id: string | null) => void; notify: (message: string) => void; copy: () => Record<string, string>;
}) {
  const t = useTranslations("NewsletterCampaigns.editor"), types = useTranslations("NewsletterCampaigns.blocks");
  const [open, setOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const name = (id: string | number) => { const b = blocks.find((x) => x.id === id); return b ? types(b.type) : ""; };
  const ids = useMemo(() => blocks.map((b) => b.id), [blocks]);
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dndStart", { label: name(active.id) }),
    onDragOver: ({ active, over }) => over ? t("dndOver", { label: name(active.id), position: ids.indexOf(String(over.id)) + 1, total: ids.length }) : undefined,
    onDragEnd: ({ active, over }) => over ? t("dndEnd", { label: name(active.id), position: ids.indexOf(String(over.id)) + 1, total: ids.length }) : t("dndCancel", { label: name(active.id) }),
    onDragCancel: ({ active }) => t("dndCancel", { label: name(active.id) }),
  };
  function end({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    change((list) => moveBlock(list, list.findIndex((x) => x.id === active.id), list.findIndex((x) => x.id === over.id)));
  }
  const move = (index: number, by: number) => { change((list) => moveBlock(list, index, index + by)); notify(t("moved", { label: name(blocks[index].id), position: index + by + 1, total: blocks.length })); };
  function add(type: BlockType) {
    const block = newBlock(type, copy());
    change((list) => { const at = list.findIndex((x) => x.id === selected); return at < 0 ? [...list, block] : [...list.slice(0, at + 1), block, ...list.slice(at + 1)]; });
    setSelected(block.id); setOpen(false); notify(t("added", { label: types(type) }));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-block="${block.id}"]`)?.scrollIntoView({ block: "nearest" }));
  }
  const patch = (id: string) => (p: Record<string, unknown>, key?: string) => change((list) => list.map((x) => x.id === id ? { ...x, ...p } as EmailBlock : x), key);
  return <div className="space-y-3" data-block-canvas>
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={end} accessibility={{ announcements }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="space-y-3" aria-label={t("blockCount", { count: blocks.length })}>
          {blocks.map((block, index) => <SortableBlock key={block.id} tenantId={tenantId} suggestions={suggestions} block={block} index={index} count={blocks.length} label={types(block.type)} selected={selected === block.id}
            onSelect={() => setSelected(selected === block.id ? null : block.id)} onPatch={patch(block.id)} onMove={(by) => move(index, by)}
            onDuplicate={() => { const clone = { ...block, id: newId() } as EmailBlock; change((list) => [...list.slice(0, index + 1), clone, ...list.slice(index + 1)]); setSelected(clone.id); }}
            onRemove={() => { change((list) => list.filter((x) => x.id !== block.id)); if (selected === block.id) setSelected(null); notify(t("removed", { label: types(block.type) })); }} />)}
        </ol>
      </SortableContext>
    </DndContext>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button type="button" variant="outline" className="min-h-11 w-full border-dashed"><Plus aria-hidden="true" />{t("addBlock")}</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command><CommandInput placeholder={t("searchBlocks")} aria-label={t("searchBlocks")} />
          <CommandList><CommandEmpty>{t("noBlocks")}</CommandEmpty><CommandGroup>
            {blockTypes.map((type) => { const Icon = blockIcons[type]; return <CommandItem key={type} value={types(type)} className="min-h-11" onSelect={() => add(type)}><Icon aria-hidden="true" />{types(type)}</CommandItem>; })}
          </CommandGroup></CommandList></Command>
      </PopoverContent>
    </Popover>
  </div>;
}
