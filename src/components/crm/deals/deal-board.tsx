"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { isStale, type StageColor, type StageKind } from "@/lib/crm-deals";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { KanbanBoard, type KanbanColumn } from "@/components/board/kanban-board";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useCrmRequest } from "../request";
import { StaleBadge, StageDot } from "./stage-badge";

export type BoardStage = { id: string; name: string; kind: StageKind; probability: number | null; color: StageColor };
export type BoardDeal = { id: string; name: string; stageId: string; amount: string | null; expectedCloseDate: string | null; companyName: string | null; contactName: string | null; version: number };

/**
 * Kanban board for one pipeline, on the shared KanbanBoard. A drop (or Shift+←/→ on a focused card) moves the
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
  const [items, setItems] = useState(deals), [seen, setSeen] = useState(deals);
  const versions = useRef<Record<string, number>>({});
  // A server refresh delivers fresh deals; adopt them (and their versions).
  if (deals !== seen) { setSeen(deals); setItems(deals); }
  const [announcement, setAnnouncement] = useState(""), [error, setError] = useState(""), [stale, setStale] = useState(false);
  const [closing, setClosing] = useState<{ dealId: string; stageId: string; reason: string } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
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
  const columns: KanbanColumn[] = stages.map((stage) => {
    const cards = items.filter((item) => item.stageId === stage.id), loaded = deals.filter((item) => item.stageId === stage.id);
    const count = (totals[stage.id]?.count ?? 0) + cards.length - loaded.length;
    const sum = (totals[stage.id]?.amount ?? 0) + cards.reduce((value, item) => value + Number(item.amount ?? 0), 0) - loaded.reduce((value, item) => value + Number(item.amount ?? 0), 0);
    return { id: stage.id, title: stage.name, count, label: t("stageColumn", { stage: stage.name, count }), empty: t("noDealsInStage"), marker: <StageDot color={stage.color} />,
      meta: <>{sum > 0 ? money(sum) : null}{stage.probability !== null && <span>{t("probabilityValue", { value: stage.probability })}</span>}</> };
  });
  const cards = items.map((deal) => ({ ...deal, column: deal.stageId, label: t("dealCardLabel", { deal: deal.name, stage: stageOf(deal.stageId)?.name ?? "" }) }));
  return <div className="space-y-2">
    <p aria-live="polite" className="sr-only">{announcement}</p>
    {error && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-2">{error}{stale && <Button size="sm" variant="outline" onClick={() => { setStale(false); setError(""); router.refresh(); }}>{t("reload")}</Button>}</AlertDescription></Alert>}
    <KanbanBoard columns={columns} items={cards} writable={writable} cardAttribute="data-deal-card"
      copy={{ board: t("board"), hint: writable ? t("boardKeyboardHint") : t("boardKeyboardHintReadOnly"), pickedUp: (item) => t("pickedUp", { deal: item.name }),
        over: (column) => t("overStage", { stage: column.title }), dropped: (column) => t("droppedIn", { stage: column.title }), cancelled: t("dragCancelled") }}
      onMove={(deal, stageId) => requestMove(deal.id, stageId)} onOpen={(deal) => router.push(`/workspaces/${tenantId}/crm/deals/${deal.id}`)}
      overlay={(deal) => deal.name}
      renderCard={(deal) => {
        const stage = stageOf(deal.stageId);
        return <DealCardBody deal={deal} href={`/workspaces/${tenantId}/crm/deals/${deal.id}`} stale={stage && isStale(stage.kind, deal.expectedCloseDate, today) ? t("stale") : null}
          amount={deal.amount === null ? null : money(deal.amount)} relation={deal.companyName ?? deal.contactName ?? t("noRelation")}
          close={deal.expectedCloseDate ? format.dateTime(new Date(`${deal.expectedCloseDate}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }) : null} />;
      }} />
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

function DealCardBody({ deal, href, stale, amount, close, relation }: { deal: BoardDeal; href: string; stale: string | null; amount: string | null; close: string | null; relation: string }) {
  return <>
    <Link href={href} tabIndex={-1} className="block truncate text-sm font-medium hover:underline">{deal.name}</Link>
    <p className="truncate text-xs text-muted-foreground">{relation}</p>
    {(amount || close || stale) && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs">
      {amount && <span className="font-medium tabular-nums">{amount}</span>}
      {close && <span className="flex items-center gap-1 text-muted-foreground"><CalendarClock className="size-3" aria-hidden="true" />{close}</span>}
      {stale && <StaleBadge label={stale} />}
    </div>}
  </>;
}
