/** Derived from Shadcn UI Kit item kanban-board3 (premium), registry retrieved 2026-11-26, approved 2026-11-26 (campaign boards). Local changes: docs/ui-sources.md. */
"use client";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { closestCenter, DndContext, DragOverlay, PointerSensor, TouchSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarIcon, MoreHorizontalIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type KanbanAction = { label: string; icon?: LucideIcon; onSelect: () => void; destructive?: boolean; separatorBefore?: boolean };
export type KanbanColumn = {
  id: string; title: string; count: number;
  /** Accessible name of the column, e.g. "To do, 3 tasks". */
  label: string;
  /** Shown when the column has no cards. */
  empty: string;
  /** Before the title (a colour dot). */
  marker?: ReactNode;
  /** After the count, right-aligned (totals, probability). */
  meta?: ReactNode;
  /** The column's options menu (add a card, sort). Its trigger is named by `menuLabel`. */
  actions?: KanbanAction[]; menuLabel?: string;
};
export type KanbanItem = { id: string; column: string; label: string };
export type KanbanCopy<T extends KanbanItem = KanbanItem> = {
  board: string; hint: string;
  pickedUp: (item: T) => string; over: (column: KanbanColumn) => string; dropped: (column: KanbanColumn) => string; cancelled: string;
};

/**
 * Harvest's shared Kanban board. Layout and styling follow kit item kanban-board3 (columns with a colour dot, count, totals and an options menu; rounded
 * cards with a per-card menu; sortable cards inside a column); behaviour is Harvest's, from the CRM deal board: the consumer owns the data, the
 * optimistic state and the server call, and every pointer drop or keyboard move becomes one `onMove(item, column, index)` request.
 * Keyboard: arrows move focus between cards and columns, Enter opens a card, Shift+←/→ moves a card to the next column and, with `reorder`,
 * Shift+↑/↓ moves it within its column. Screen-reader instructions and announcements come from the consumer's i18n messages. Columns scroll
 * sideways inside the board on narrow screens; the page itself never does. Touch drags start after a short press so the board still scrolls.
 */
export function KanbanBoard<T extends KanbanItem>({ columns, items, writable, copy, cardAttribute = "data-board-card", reorder = false, renderCard, cardMenu, overlay, onMove, onOpen }: {
  columns: KanbanColumn[]; items: T[]; writable: boolean; copy: KanbanCopy<T>;
  /** The data attribute each card carries (its value is the item id), so tests and focus code can find cards. */
  cardAttribute?: `data-${string}`;
  /** Allow moving within a column (drop on a card, Shift+↑/↓). */
  reorder?: boolean;
  renderCard: (item: T) => ReactNode;
  /** Per-card menu: its accessible name and actions. */
  cardMenu?: (item: T) => { label: string; actions: KanbanAction[] } | null;
  overlay: (item: T) => ReactNode;
  onMove: (item: T, column: string, index: number | undefined) => void;
  onOpen?: (item: T) => void;
}) {
  const hintId = useId();
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }));
  const columnOf = (id: string) => columns.find((column) => column.id === id);
  const cardsOf = (column: string) => items.filter((item) => item.column === column);
  /** A drop target is a column, or a card: dropping on a card (with reorder) puts the dragged card in its place. */
  const target = (overId: string) => {
    const column = columnOf(overId);
    if (column) return { column, index: undefined };
    const card = items.find((item) => item.id === overId), host = card && columnOf(card.column);
    return host && card ? { column: host, index: cardsOf(host.id).findIndex((item) => item.id === card.id) } : null;
  };
  function move(item: T, column: string, index?: number) {
    if (!writable) return;
    if (item.column === column && (index === undefined || cardsOf(column).findIndex((card) => card.id === item.id) === index)) return;
    onMove(item, column, index);
  }
  function onDragStart(event: DragStartEvent) { setDragging(String(event.active.id)); }
  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const item = items.find((card) => card.id === String(event.active.id)), over = event.over ? target(String(event.over.id)) : null;
    if (item && over && String(event.over?.id) !== item.id) move(item, over.column.id, reorder ? over.index : undefined);
  }
  const focusItem = (id: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[${cardAttribute}="${id}"]`)?.focus());
  function focusCard(columnIndex: number, cardIndex: number) {
    const column = document.querySelector<HTMLElement>(`[data-board-column="${columnIndex}"]`);
    const cards = column ? [...column.querySelectorAll<HTMLElement>(`[${cardAttribute}]`)] : [];
    cards[Math.min(Math.max(cardIndex, 0), cards.length - 1)]?.focus();
  }
  function onCardKeyDown(event: KeyboardEvent, item: T, columnIndex: number, cardIndex: number) {
    if (event.target !== event.currentTarget) return; // keys inside the card's menu stay with the menu
    if (event.key === "Enter" && onOpen) { event.preventDefault(); onOpen(item); return; }
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const next = columns[columnIndex + (event.key === "ArrowLeft" ? -1 : 1)];
      if (next && writable) { move(item, next.id); focusItem(item.id); }
      return;
    }
    if (reorder && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const index = cardIndex + (event.key === "ArrowUp" ? -1 : 1);
      if (writable && index >= 0 && index < cardsOf(item.column).length) { move(item, item.column, index); focusItem(item.id); }
      return;
    }
    const moves: Record<string, () => void> = {
      ArrowUp: () => focusCard(columnIndex, cardIndex - 1), ArrowDown: () => focusCard(columnIndex, cardIndex + 1),
      ArrowLeft: () => { for (let index = columnIndex - 1; index >= 0; index -= 1) if (cardsOf(columns[index].id).length) return focusCard(index, 0); },
      ArrowRight: () => { for (let index = columnIndex + 1; index < columns.length; index += 1) if (cardsOf(columns[index].id).length) return focusCard(index, 0); },
    };
    if (moves[event.key]) { event.preventDefault(); moves[event.key](); }
  }
  const dragged = dragging ? items.find((item) => item.id === dragging) : undefined;
  return <>
    <p id={hintId} className="sr-only">{copy.hint}</p>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}
      accessibility={{ screenReaderInstructions: { draggable: copy.hint },
        announcements: {
          onDragStart: ({ active }) => { const item = items.find((card) => card.id === active.id); return item ? copy.pickedUp(item) : ""; },
          onDragOver: ({ over }) => { const hit = over ? target(String(over.id)) : null; return hit ? copy.over(hit.column) : undefined; },
          onDragEnd: ({ over }) => { const hit = over ? target(String(over.id)) : null; return hit ? copy.dropped(hit.column) : copy.cancelled; },
          onDragCancel: () => copy.cancelled,
        } }}>
      <div role="region" aria-label={copy.board} className="-mx-1 flex min-w-0 snap-x gap-3 overflow-x-auto px-1 pb-3">
        {columns.map((column, columnIndex) => {
          const cards = cardsOf(column.id);
          return <Column key={column.id} column={column} index={columnIndex}>
            <SortableContext items={cards.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              {cards.map((item, cardIndex) => <SortableCard key={item.id} item={item} attribute={cardAttribute} writable={writable} reorder={reorder} hintId={hintId}
                menu={cardMenu?.(item) ?? null} onKeyDown={(event) => onCardKeyDown(event, item, columnIndex, cardIndex)}>{renderCard(item)}</SortableCard>)}
            </SortableContext>
          </Column>;
        })}
      </div>
      <DragOverlay dropAnimation={null}>{dragged ? <Card className="w-72 gap-3 rounded-xl p-3 text-sm font-medium shadow-sm ring-2 ring-primary">{overlay(dragged)}</Card> : null}</DragOverlay>
    </DndContext>
  </>;
}

function ActionsMenu({ label, actions }: { label: string; actions: KanbanAction[] }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon-xs" className="size-11 text-muted-foreground lg:size-6" aria-label={label} onPointerDown={(event) => event.stopPropagation()}><MoreHorizontalIcon aria-hidden="true" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-44">
      {actions.map((action) => <div key={action.label} className="contents">
        {action.separatorBefore && <DropdownMenuSeparator />}
        <DropdownMenuItem variant={action.destructive ? "destructive" : "default"} onSelect={action.onSelect}>{action.icon && <action.icon aria-hidden="true" />}{action.label}</DropdownMenuItem>
      </div>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function Column({ column, index, children }: { column: KanbanColumn; index: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const empty = column.count === 0;
  return <div ref={setNodeRef} data-board-column={index} role="group" aria-label={column.label}
    className={cn("flex w-72 shrink-0 snap-start flex-col rounded-xl bg-muted/50 text-sm ring-1 transition-colors", isOver ? "ring-primary/20" : "ring-transparent")}>
    <div className="flex items-center gap-2 px-3 pt-3 pb-1 font-medium">
      {column.marker}
      <h2 className="min-w-0 truncate text-sm font-medium">{column.title}</h2>
      <span className="text-muted-foreground tabular-nums">{column.count}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs font-normal text-muted-foreground tabular-nums">{column.meta}</span>
      {column.actions?.length ? <ActionsMenu label={column.menuLabel ?? column.title} actions={column.actions} /> : null}
    </div>
    <ul className="flex min-h-24 flex-1 flex-col gap-2 p-2">{children}{empty && <li className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{column.empty}</li>}</ul>
  </div>;
}

function SortableCard({ item, attribute, writable, reorder, hintId, menu, onKeyDown, children }: {
  item: KanbanItem; attribute: string; writable: boolean; reorder: boolean; hintId: string; menu: { label: string; actions: KanbanAction[] } | null;
  onKeyDown: (event: KeyboardEvent) => void; children: ReactNode;
}) {
  const { listeners, setNodeRef, transition, transform, isDragging } = useSortable({ id: item.id, disabled: !writable });
  // Without reorder a card does not shift its neighbours while dragging; it only lands in the column it is dropped on.
  const style = reorder ? { transition, transform: CSS.Transform.toString(transform) } : undefined;
  return <li ref={setNodeRef} style={style}>
    <Card {...listeners} {...{ [attribute]: item.id }} tabIndex={0} role="group" aria-label={item.label} aria-describedby={hintId} onKeyDown={onKeyDown}
      className={cn("gap-3 rounded-xl p-3 shadow-none outline-none focus-visible:ring-2 focus-visible:ring-ring", writable && "cursor-grab touch-manipulation active:cursor-grabbing", isDragging && "opacity-30")}>
      <div className="flex items-start justify-between gap-2"><div className="min-w-0 flex-1 space-y-1">{children}</div>{menu && <ActionsMenu label={menu.label} actions={menu.actions} />}</div>
    </Card>
  </li>;
}

/** The person a card belongs to: initials avatar and name (no remote image). */
export function BoardPerson({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  return <span className="flex min-w-0 items-center gap-1.5">
    <Avatar size="sm"><AvatarFallback>{initials}</AvatarFallback></Avatar>
    <span className="line-clamp-1">{name}</span>
  </span>;
}

/** A due date, red when overdue (with a spoken "overdue"). */
export function BoardDue({ label, overdue, overdueLabel }: { label: string; overdue: boolean; overdueLabel: string }) {
  return <span className={cn("flex shrink-0 items-center gap-1 text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
    <CalendarIcon className="size-3.5" aria-hidden="true" />{label}{overdue && <span className="sr-only">{overdueLabel}</span>}
  </span>;
}
