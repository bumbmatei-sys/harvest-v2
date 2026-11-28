/** Derived from Shadcn UI Kit item tables22 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Gift,
  HandHeart,
  MoreHorizontal,
  Pencil,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { CorrectGiftDialog } from "@/components/fundraising/giving-dialogs";
import { useRequest } from "@/hooks/use-request";
import { formatCents, type FundraisingRow, type GiftRow, type PledgeRow, type PledgeStatus } from "@/lib/fundraising";

const PAGE_SIZE = 10;

const statusMeta: Record<PledgeStatus | "reversal" | "correction" | "reversed", { dot: string }> = {
  pending: { dot: "bg-warning" },
  accepted: { dot: "bg-success" },
  cancelled: { dot: "bg-muted-foreground" },
  reversal: { dot: "bg-warning" },
  correction: { dot: "bg-primary" },
  reversed: { dot: "bg-muted-foreground" },
};

function StatusBadge({ status, label }: { status: keyof typeof statusMeta; label: string }) {
  const meta = statusMeta[status];
  return (
    <Badge variant="outline">
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
      {label}
    </Badge>
  );
}

type View = "gifts" | "pledges";

/**
 * The fundraiser's Gifts and Pledges (owners and admins), one card with the kit's view toggle and ten-row pages, on Harvest's DataTable (cards on phones).
 * Rows open a menu: correct a gift; accept or cancel a pledge (cancel asks first). Every mutation goes to the fundraising API, then refreshes the page.
 */
export function FundraisingRecords({ row, endpoint, gifts, pledges, canRecord, canCorrect, onChanged, onError, actions }: {
  row: FundraisingRow; endpoint: string; gifts: GiftRow[]; pledges: PledgeRow[]; canRecord: boolean; canCorrect: boolean;
  onChanged: () => void; onError: (message: string) => void;
  /** Record gift and Record pledge buttons. */
  actions: React.ReactNode;
}) {
  const t = useTranslations("Fundraising"), format = useFormatter(), locale = useLocale(), request = useRequest();
  const [statusFilter, setStatusFilter] = React.useState<View>("gifts");
  const [pageIndex, setPageIndex] = React.useState(0);
  const [correcting, setCorrecting] = React.useState<GiftRow | null>(null);
  const [cancelling, setCancelling] = React.useState<PledgeRow | null>(null);
  const money = (cents: string) => formatCents(cents, row.currency, locale);
  const formatDate = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00`), { dateStyle: "medium" });

  async function pledgeAction(pledge: PledgeRow, action: "accept" | "cancel") {
    onError("");
    const result = await request(`${endpoint}/pledges/${pledge.id}`, { method: "PATCH", body: { version: pledge.version, action } });
    if (!result.ok) { if (action === "accept") onError(result.error); return result.error; }
    onChanged();
    return null;
  }

  const giftColumns: DataTableColumn[] = [
    { id: "item", header: t("giftColumns.supporter"), card: "title", className: "max-w-36 sm:max-w-64" },
    { id: "status", header: t("pledgeColumns.status"), showFrom: "@md" },
    { id: "customer", header: t("giftColumns.recorded"), showFrom: "@3xl" },
    { id: "date", header: t("giftColumns.date"), showFrom: "@lg" },
    { id: "amount", header: t("giftColumns.amount"), align: "end" },
    ...(canCorrect ? [{ id: "actions", header: t("giftColumns.actions"), srOnlyHeader: true, align: "end", card: "actions" } as const] : []),
  ];
  const giftRows: DataTableRow[] = gifts.map((gift) => {
    const muted = gift.reversed || gift.kind === "reversal";
    return {
      id: gift.id, label: `${formatDate(gift.giftDate)} ${money(gift.amountCents)}`,
      cells: {
        item: (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{gift.supporterName ?? <span className="text-muted-foreground font-normal">{t("anonymous")}</span>}</span>
            </div>
            <div className="text-muted-foreground truncate text-xs">
              {[formatDate(gift.giftDate), gift.methodLabel].filter(Boolean).join(" · ")}
            </div>
          </div>
        ),
        status: <div className="flex flex-wrap gap-1">
          {gift.kind === "reversal" && <StatusBadge status="reversal" label={t("reversalLabel", { reason: t(`reasons.${gift.reason ?? "other"}`) })} />}
          {gift.kind === "gift" && gift.correctionOf && <StatusBadge status="correction" label={t("correction")} />}
          {gift.reversed && <StatusBadge status="reversed" label={t("reversed")} />}
          {gift.kind === "gift" && !gift.correctionOf && !gift.reversed && <span className="text-muted-foreground">{t("kinds.gift")}</span>}
        </div>,
        customer: (
          <span className="text-muted-foreground block max-w-56 truncate">
            {t("confirmedBy", { name: gift.confirmedByName })}
          </span>
        ),
        date: (
          <span className="text-muted-foreground whitespace-nowrap">
            {formatDate(gift.giftDate)}
          </span>
        ),
        amount: (
          <div className="text-right">
            <div className={cn("tabular-nums", muted ? "text-muted-foreground" : "font-medium")}>
              {money(gift.amountCents)}
            </div>
            <div className="text-muted-foreground text-xs">
              {t(`kinds.${gift.kind}`)}
            </div>
          </div>
        ),
        actions: canCorrect && gift.kind === "gift" && !gift.reversed ? (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("actionsFor", { title: `${formatDate(gift.giftDate)} ${money(gift.amountCents)}` })}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem className="max-lg:min-h-11" onSelect={() => setCorrecting(gift)}>
                  <Pencil />
                  {t("correct")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null,
      },
    };
  });

  const pledgeColumns: DataTableColumn[] = [
    { id: "item", header: t("pledgeColumns.supporter"), card: "title", className: "max-w-36 sm:max-w-64" },
    { id: "status", header: t("pledgeColumns.status") },
    { id: "date", header: t("pledgeColumns.expected"), showFrom: "@lg" },
    { id: "amount", header: t("pledgeColumns.amount"), align: "end" },
    { id: "net", header: t("pledgeColumns.gifted"), align: "end", showFrom: "@3xl" },
    ...(canRecord ? [{ id: "actions", header: t("pledgeColumns.actions"), srOnlyHeader: true, align: "end", card: "actions" } as const] : []),
  ];
  const pledgeRows: DataTableRow[] = pledges.map((pledge) => {
    const name = pledge.supporterName ?? t("anonymous");
    return {
      id: pledge.id, label: name,
      cells: {
        item: (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{name}</span>
            </div>
            {pledge.supporterContact && <div className="text-muted-foreground truncate text-xs">
              {pledge.supporterContact}
            </div>}
          </div>
        ),
        status: <StatusBadge status={pledge.status} label={t(`pledgeStatuses.${pledge.status}`)} />,
        date: (
          <span className="text-muted-foreground whitespace-nowrap">
            {pledge.expectedOn ? formatDate(pledge.expectedOn) : t("notSet")}
          </span>
        ),
        amount: (
          <div className="text-right">
            <div className="tabular-nums">
              {money(pledge.amountCents)}
            </div>
          </div>
        ),
        net: (
          <div className="text-right">
            <div className="tabular-nums">
              {money(pledge.giftedCents)}
            </div>
          </div>
        ),
        actions: canRecord && pledge.status !== "cancelled" ? (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("actionsFor", { title: name })}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {pledge.status === "pending" && (
                  <DropdownMenuItem className="max-lg:min-h-11" onSelect={() => void pledgeAction(pledge, "accept")}>
                    <CheckCircle2 />
                    {t("accept")}
                  </DropdownMenuItem>
                )}
                {pledge.status === "pending" && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  variant="destructive"
                  className="max-lg:min-h-11"
                  onSelect={() => setCancelling(pledge)}
                >
                  <X />
                  {t("cancelPledge")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null,
      },
    };
  });

  const counts: Record<View, number> = { gifts: gifts.length, pledges: pledges.length };
  const total = counts[statusFilter];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // A shorter list (after a refresh) keeps the page in range.
  const current = Math.min(pageIndex, pageCount - 1);

  const first = total === 0 ? 0 : current * PAGE_SIZE + 1;
  const last = Math.min(total, (current + 1) * PAGE_SIZE);
  const page = <T,>(list: T[]) => list.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const tableClass = "[&_td:first-child]:ps-4 [&_td:last-child]:pe-4 [&_th:first-child]:ps-4 [&_th:last-child]:pe-4 [&_thead_tr]:bg-muted/50 [&_thead_tr]:hover:bg-muted/50 [&_th]:text-muted-foreground [&_thead_tr]:border-t";

  return (
    <Card className="w-full" data-giving-records>
      <CardHeader>
        <CardTitle><h2>{t("tabs.label")}</h2></CardTitle>
        <CardDescription>
          {t("recordsSummary", { gifts: t("stats.gifts", { count: gifts.length }), pledges: t("stats.pledges", { count: pledges.length }) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-2 px-4">
          <ToggleGroup
            spacing={0}
            type="single"
            variant="outline"
            size="sm"
            value={statusFilter}
            onValueChange={(value) => {
              if (!value) return;
              setStatusFilter(value as View);
              setPageIndex(0);
            }}
            aria-label={t("tabs.label")}
          >
            {(["gifts", "pledges"] as const).map((value) => (
              <ToggleGroupItem key={value} value={value} className="max-lg:min-h-11">
                {t(`tabs.${value}`)}
                <span className="text-muted-foreground tabular-nums">
                  {counts[value]}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="flex flex-wrap items-center gap-2">
            {actions}
          </div>
        </div>

        {statusFilter === "gifts"
          ? <DataTable label={t("giftsLabel")} columns={giftColumns} rows={page(giftRows)} bordered={false} className={tableClass}
            empty={<EmptyState icon={Gift} title={t("giftsEmpty")} size="compact" />} />
          : <DataTable label={t("pledgesLabel")} columns={pledgeColumns} rows={page(pledgeRows)} bordered={false} className={tableClass}
            empty={<EmptyState icon={HandHeart} title={t("pledgesEmpty")} size="compact" />} />}
      </CardContent>
      {total > PAGE_SIZE && (
      <CardFooter className="justify-between gap-3">
        <p className="text-muted-foreground">
          {t.rich("showing", {
            first, last, total,
            strong: (chunks) => <span className="text-foreground font-medium tabular-nums">{chunks}</span>,
          })}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            className="max-lg:size-11"
            onClick={() => setPageIndex(current - 1)}
            disabled={current === 0}
            aria-label={t("previousPage")}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="max-lg:size-11"
            onClick={() => setPageIndex(current + 1)}
            disabled={current >= pageCount - 1}
            aria-label={t("nextPage")}
          >
            <ChevronRight />
          </Button>
        </div>
      </CardFooter>
      )}
      {correcting && <CorrectGiftDialog key={correcting.id} endpoint={endpoint} entryId={correcting.id} currency={row.currency} open
        onOpenChange={(open) => { if (!open) setCorrecting(null); }} onSaved={() => { setCorrecting(null); onChanged(); }} />}
      <ConfirmDialog open={cancelling !== null} onOpenChange={(open) => { if (!open) setCancelling(null); }} tone="neutral" title={t("cancelPledge")} description={t("cancelPledgeConfirm")}
        confirmLabel={t("cancelPledge")} cancelLabel={t("cancel")}
        onConfirm={async () => { if (cancelling) { const problem = await pledgeAction(cancelling, "cancel"); if (problem) return problem; setCancelling(null); } }} />
    </Card>
  );
}
