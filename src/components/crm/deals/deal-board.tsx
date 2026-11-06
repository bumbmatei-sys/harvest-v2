"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { isStale, type StageColor, type StageKind } from "@/lib/crm-deals";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useCrmRequest } from "../request";
import { StaleBadge, StageDot } from "./stage-badge";

export type BoardStage = { id: string; name: string; kind: StageKind; probability: number | null; color: StageColor };
export type BoardDeal = { id: string; name: string; stageId: string; amount: string | null; expectedCloseDate: string | null; companyName: string | null; contactName: string | null; version: number };

/**
 * Kanban board for one pipeline. A drop (or Shift+←/→ on a focused card) moves the
 * card at once, then the move is sent with the version the card was loaded at. Moves
 * are queued, so a quick second move always carries the version the first returned.
 * A refused move puts the card back and shows why.
 */
export function DealBoard({ tenantId, stages, deals, totals, writable, today }: {
  tenantId: string; stages: BoardStage[]; deals: BoardDeal[]; totals: Record<string, { count: number; amount: number }>; writable: boolean; today: string;
}) {
  const t = useTranslations("Deals");
  const format = useFormatter();
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const hintId = useId();
  const [items, setItems] = useState(deals), [seen, setSeen] = useState(deals);
  const versions = useRef<Record<string, number>>({});
  // A server refresh delivers fresh deals; adopt them (and their versions).
  if (deals !== seen) { setSeen(deals); setItems(deals); }
  const [announcement, setAnnouncement] = useState(""), [error, setError] = useState(""), [stale, setStale] = useState(false);
  const [closing, setClosing] = useState<{ dealId: string; stageId: string; reason: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const stageOf = (id: string) => stages.find((stage) => stage.id === id);
  const money = (value: number | string) => format.number(Number(value), { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  function requestMove(dealId: string, stageId: string) {
    const deal = items.find((item) => item.id === dealId), target = stageOf(stageId);
    if (!deal || !target || deal.stageId === stageId || !writable) return;
    if (target.kind !== "open") { setClosing({ dealId, stageId, reason: "" }); return; }
    commitMove(dealId, stageId, null);
  }
  function commitMove(dealId: string, stageId: string, reason: string | null) {
    const deal = items.find((item) => item.id === dealId)!, from = deal.stageId, target = stageOf(stageId)!;
    setError("");
    // Optimistic: the card joins the end of its new column, where the server puts it too.
    setItems((list) => [...list.filter((item) => item.id !== dealId), { ...deal, stageId }]);
    setAnnouncement(t("movedTo", { deal: deal.name, stage: target.name }));
    queue.current = queue.current.then(async () => {
      const version = Math.max(versions.current[dealId] ?? 0, deal.version);
      const result = await crmRequest<{ version: number }>(`/api/workspaces/${tenantId}/crm/deals/${dealId}/move`, { method: "POST", body: { stageId, version, ...(reason ? { closedReason: reason } : {}) } });
      if (!result.ok) {
        setItems((list) => list.map((item) => (item.id === dealId ? { ...item, stageId: from } : item)));
        setError(result.error); setAnnouncement(result.error);
        if (result.details?.reason === "stale") setStale(true);
        router.refresh();
        return;
      }
      versions.current[dealId] = result.data.version;
      router.refresh();
    });
  }
  function onDragStart(event: DragStartEvent) { setDragging(String(event.active.id)); }
  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    if (event.over) requestMove(String(event.active.id), String(event.over.id));
  }
  function focusCard(stageIndex: number, cardIndex: number) {
    const column = document.querySelector<HTMLElement>(`[data-board-column="${stageIndex}"]`);
    const cards = column ? [...column.querySelectorAll<HTMLElement>("[data-deal-card]")] : [];
    cards[Math.min(Math.max(cardIndex, 0), cards.length - 1)]?.focus();
  }
  function onCardKeyDown(event: React.KeyboardEvent, deal: BoardDeal, stageIndex: number, cardIndex: number) {
    if (event.key === "Enter") { event.preventDefault(); router.push(`/workspaces/${tenantId}/crm/deals/${deal.id}`); return; }
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const target = stages[stageIndex + (event.key === "ArrowLeft" ? -1 : 1)];
      if (target && writable) { requestMove(deal.id, target.id); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-deal-card="${deal.id}"]`)?.focus()); }
      return;
    }
    const moves: Record<string, () => void> = {
      ArrowUp: () => focusCard(stageIndex, cardIndex - 1), ArrowDown: () => focusCard(stageIndex, cardIndex + 1),
      ArrowLeft: () => { for (let index = stageIndex - 1; index >= 0; index -= 1) if (items.some((item) => item.stageId === stages[index].id)) return focusCard(index, 0); },
      ArrowRight: () => { for (let index = stageIndex + 1; index < stages.length; index += 1) if (items.some((item) => item.stageId === stages[index].id)) return focusCard(index, 0); },
    };
    if (moves[event.key]) { event.preventDefault(); moves[event.key](); }
  }
  const dragged = dragging ? items.find((item) => item.id === dragging) : undefined;
  return <div className="space-y-2">
    <p id={hintId} className="sr-only">{writable ? t("boardKeyboardHint") : t("boardKeyboardHintReadOnly")}</p>
    <p aria-live="polite" className="sr-only">{announcement}</p>
    {error && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-2">{error}{stale && <Button size="sm" variant="outline" onClick={() => { setStale(false); setError(""); router.refresh(); }}>{t("reload")}</Button>}</AlertDescription></Alert>}
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}
      accessibility={{ screenReaderInstructions: { draggable: writable ? t("boardKeyboardHint") : t("boardKeyboardHintReadOnly") },
        announcements: {
          onDragStart: ({ active }) => t("pickedUp", { deal: items.find((item) => item.id === active.id)?.name ?? "" }),
          onDragOver: ({ over }) => (over ? t("overStage", { stage: stageOf(String(over.id))?.name ?? "" }) : undefined),
          onDragEnd: ({ over }) => (over ? t("droppedIn", { stage: stageOf(String(over.id))?.name ?? "" }) : t("dragCancelled")),
          onDragCancel: () => t("dragCancelled"),
        } }}>
      {/* Columns scroll sideways inside the board by design; the page itself never does. */}
      <div role="region" aria-label={t("board")} className="-mx-1 flex min-w-0 snap-x gap-3 overflow-x-auto px-1 pb-3">
        {stages.map((stage, stageIndex) => {
          const cards = items.filter((item) => item.stageId === stage.id);
          const loaded = deals.filter((item) => item.stageId === stage.id);
          const count = (totals[stage.id]?.count ?? 0) + cards.length - loaded.length;
          const sum = (totals[stage.id]?.amount ?? 0) + cards.reduce((value, item) => value + Number(item.amount ?? 0), 0) - loaded.reduce((value, item) => value + Number(item.amount ?? 0), 0);
          return <BoardColumn key={stage.id} stage={stage} index={stageIndex} count={count} sum={sum > 0 ? money(sum) : null} label={t("stageColumn", { stage: stage.name, count })}
            probability={stage.probability === null ? null : t("probabilityValue", { value: stage.probability })} empty={t("noDealsInStage")}>
            {cards.map((deal, cardIndex) => <DealCard key={deal.id} deal={deal} href={`/workspaces/${tenantId}/crm/deals/${deal.id}`} writable={writable} hintId={hintId}
              stale={isStale(stage.kind, deal.expectedCloseDate, today) ? t("stale") : null} amount={deal.amount === null ? null : money(deal.amount)}
              close={deal.expectedCloseDate ? format.dateTime(new Date(`${deal.expectedCloseDate}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) : null}
              label={t("dealCardLabel", { deal: deal.name, stage: stage.name })} relation={deal.companyName ?? deal.contactName ?? t("noRelation")} dimmed={dragging === deal.id}
              onKeyDown={(event) => onCardKeyDown(event, deal, stageIndex, cardIndex)} />)}
          </BoardColumn>;
        })}
      </div>
      <DragOverlay dropAnimation={null}>{dragged ? <Card className="w-64 gap-0 rounded-lg p-3 text-sm font-medium shadow-lg">{dragged.name}</Card> : null}</DragOverlay>
    </DndContext>
    <Dialog open={!!closing} onOpenChange={(open) => { if (!open) setClosing(null); }}>
      <DialogContent className="rounded-xl sm:max-w-[440px]">
        <DialogHeader><DialogTitle>{closing ? t("closeDealTitle", { stage: stageOf(closing.stageId)?.name ?? "" }) : ""}</DialogTitle><DialogDescription>{t("closeDealDescription")}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (closing) commitMove(closing.dealId, closing.stageId, closing.reason.trim() || null); setClosing(null); }}>
          <Field className="gap-2"><FieldLabel htmlFor="close-reason">{t("closedReason")} <span className="text-xs text-muted-foreground">{t("optional")}</span></FieldLabel>
            <Textarea id="close-reason" maxLength={500} value={closing?.reason ?? ""} onChange={(event) => setClosing((value) => (value ? { ...value, reason: event.target.value } : value))} className="min-h-20" autoFocus /></Field>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => setClosing(null)}>{t("cancel")}</Button><Button>{t("moveDeal")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

function BoardColumn({ stage, index, count, sum, label, probability, empty, children }: { stage: BoardStage; index: number; count: number; sum: string | null; label: string; probability: string | null; empty: string; children: React.ReactNode[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return <Card ref={setNodeRef} data-board-column={index} role="group" aria-label={label}
    className={cn("w-72 shrink-0 snap-start gap-0 bg-muted/40 py-0 shadow-none transition-colors", isOver && "border-ring bg-selected")}>
    <CardHeader className="flex items-center gap-2 px-3 pt-3 pb-2">
      <StageDot color={stage.color} />
      <CardTitle role="heading" aria-level={2} className="min-w-0 truncate text-sm font-medium">{stage.name}</CardTitle>
      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">{sum}{probability && <span>{probability}</span>}</span>
    </CardHeader>
    <CardContent className="flex min-h-24 flex-1 flex-col px-2 pb-2">
      <ul className="flex flex-1 flex-col gap-2">{children.length ? children : <li className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{empty}</li>}</ul>
    </CardContent>
  </Card>;
}

function DealCard({ deal, href, writable, hintId, stale, amount, close, label, relation, dimmed, onKeyDown }: {
  deal: BoardDeal; href: string; writable: boolean; hintId: string; stale: string | null; amount: string | null; close: string | null; label: string; relation: string; dimmed: boolean;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: deal.id, disabled: !writable });
  return <li>
    <Card ref={setNodeRef} {...listeners} data-deal-card={deal.id} tabIndex={0} role="group" aria-label={label} aria-describedby={hintId} onKeyDown={onKeyDown}
      className={cn("gap-0 rounded-lg p-3 shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring", writable && "cursor-grab touch-none active:cursor-grabbing", dimmed && "opacity-40")}>
      <Link href={href} tabIndex={-1} className="block truncate text-sm font-medium hover:underline">{deal.name}</Link>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{relation}</p>
      {(amount || close || stale) && <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {amount && <span className="font-medium tabular-nums">{amount}</span>}
        {close && <span className="flex items-center gap-1 text-muted-foreground"><CalendarClock className="size-3" aria-hidden="true" />{close}</span>}
        {stale && <StaleBadge label={stale} />}
      </div>}
    </Card>
  </li>;
}
