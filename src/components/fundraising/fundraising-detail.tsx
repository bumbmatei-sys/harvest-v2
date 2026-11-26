"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Gift, HandHeart, Pencil, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { FundraisingProgress } from "@/components/fundraising/fundraising-progress";
import { CorrectGiftDialog, FundraisingFormDialog, GiftDialog, PledgeDialog } from "@/components/fundraising/giving-dialogs";
import { useRequest } from "@/hooks/use-request";
import { formatCents, fundraisingTone, pledgeTone, type FundraisingRow, type GiftRow, type PledgeRow } from "@/lib/fundraising";

type Caps = { manage: boolean; publish: boolean; record: boolean; correct: boolean };
const actionsFor = (status: FundraisingRow["status"]) =>
  status === "draft" ? (["open", "archive"] as const) : status === "published" ? (["close"] as const) : status === "closed" ? (["archive"] as const) : ([] as const);

/**
 * One fundraising campaign: header with status and lifecycle actions, the shared progress block, and (owners and admins) the Gifts and Pledges tables
 * with the record, correct, accept and cancel actions. Every mutation goes to the fundraising API and then refreshes the server data.
 */
export function FundraisingDetail({ tenantId, row, pledges, gifts, can, publicPage = null }: { tenantId: string; row: FundraisingRow; pledges: PledgeRow[] | null; gifts: GiftRow[] | null; can: Caps;
  /** The "Public page" section (owners and admins), rendered by the page so its server data stays there. */
  publicPage?: React.ReactNode }) {
  const t = useTranslations("Fundraising"), format = useFormatter(), locale = useLocale(), router = useRouter(), request = useRequest();
  const [error, setError] = useState("");
  const endpoint = `/api/workspaces/${tenantId}/fundraising/${row.id}`, refresh = () => router.refresh();
  const money = (cents: string) => formatCents(cents, row.currency, locale);
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const takesGifts = row.status !== "archived", takesPledges = row.status === "draft" || row.status === "published";

  async function patch(body: Record<string, unknown>) {
    const result = await request(endpoint, { method: "PATCH", body: { version: row.version, ...body } });
    if (!result.ok) return result.error;
    refresh();
  }
  async function pledgeAction(pledge: PledgeRow, action: "accept" | "cancel") {
    setError("");
    const result = await request(`${endpoint}/pledges/${pledge.id}`, { method: "PATCH", body: { version: pledge.version, action } });
    if (!result.ok) { setError(result.error); return; }
    refresh();
  }

  const giftColumns: DataTableColumn[] = [
    { id: "date", header: t("giftColumns.date"), card: "title" },
    { id: "supporter", header: t("giftColumns.supporter") },
    { id: "amount", header: t("giftColumns.amount"), align: "end" },
    { id: "method", header: t("giftColumns.method"), showFrom: "@lg" },
    { id: "recorded", header: t("giftColumns.recorded"), showFrom: "@3xl" },
    { id: "actions", header: t("giftColumns.actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const giftRows: DataTableRow[] = (gifts ?? []).map((gift) => ({
    id: gift.id, label: `${date(gift.giftDate)} ${money(gift.amountCents)}`,
    cells: {
      date: <span className="flex flex-wrap items-center gap-2"><span>{date(gift.giftDate)}</span>
        {gift.kind === "reversal" && <StatusBadge tone="warning" label={t("reversalLabel", { reason: t(`reasons.${gift.reason ?? "other"}`) })} />}
        {gift.kind === "gift" && gift.correctionOf && <StatusBadge tone="info" label={t("correction")} />}
        {gift.reversed && <StatusBadge tone="neutral" label={t("reversed")} />}</span>,
      supporter: gift.supporterName ?? <span className="text-muted-foreground">{t("anonymous")}</span>,
      amount: <span className={gift.reversed || gift.kind === "reversal" ? "tabular-nums text-muted-foreground" : "font-medium tabular-nums"}>{money(gift.amountCents)}</span>,
      method: gift.methodLabel ?? "",
      recorded: <span className="text-xs text-muted-foreground">{t("confirmedBy", { name: gift.confirmedByName })}</span>,
      actions: can.correct && gift.kind === "gift" && !gift.reversed ? <CorrectGiftDialog endpoint={endpoint} entryId={gift.id} onSaved={refresh}
        trigger={<Button type="button" variant="outline" size="sm">{t("correct")}<span className="sr-only"> {money(gift.amountCents)}</span></Button>} /> : null,
    },
  }));
  const pledgeColumns: DataTableColumn[] = [
    { id: "supporter", header: t("pledgeColumns.supporter"), card: "title" },
    { id: "amount", header: t("pledgeColumns.amount"), align: "end" },
    { id: "gifted", header: t("pledgeColumns.gifted"), align: "end", showFrom: "@md" },
    { id: "expected", header: t("pledgeColumns.expected"), showFrom: "@lg" },
    { id: "status", header: t("pledgeColumns.status") },
    { id: "actions", header: t("pledgeColumns.actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const pledgeRows: DataTableRow[] = (pledges ?? []).map((pledge) => {
    const name = pledge.supporterName ?? t("anonymous");
    return { id: pledge.id, label: name, cells: {
      supporter: <span className="min-w-0"><span className="block truncate">{name}</span>{pledge.supporterContact && <span className="block truncate text-xs text-muted-foreground">{pledge.supporterContact}</span>}</span>,
      amount: <span className="tabular-nums">{money(pledge.amountCents)}</span>,
      gifted: <span className="tabular-nums">{money(pledge.giftedCents)}</span>,
      expected: pledge.expectedOn ? date(pledge.expectedOn) : "",
      status: <StatusBadge tone={pledgeTone(pledge.status)} label={t(`pledgeStatuses.${pledge.status}`)} dot />,
      actions: can.record && pledge.status !== "cancelled" ? <>
        {pledge.status === "pending" && <Button type="button" variant="outline" size="sm" onClick={() => void pledgeAction(pledge, "accept")}>{t("accept")}<span className="sr-only"> {name}</span></Button>}
        <ConfirmDialog tone="neutral" title={t("cancelPledge")} description={t("cancelPledgeConfirm")} confirmLabel={t("cancelPledge")} cancelLabel={t("cancel")}
          onConfirm={async () => { const result = await request(`${endpoint}/pledges/${pledge.id}`, { method: "PATCH", body: { version: pledge.version, action: "cancel" } }); if (!result.ok) return result.error; refresh(); }}
          trigger={<Button type="button" variant="ghost" size="sm">{t("cancelPledge")}<span className="sr-only"> {name}</span></Button>} />
      </> : null,
    } };
  });

  const lifecycle = actionsFor(row.status).filter((action) => action === "open" ? can.publish : can.manage);
  const recordGift = can.record && takesGifts && gifts ? <GiftDialog endpoint={endpoint} pledges={pledges ?? []} onSaved={refresh}
    trigger={<Button type="button" className="min-h-11 lg:min-h-9"><Plus aria-hidden="true" />{t("recordGift")}</Button>} /> : null;
  const recordPledge = can.record && takesPledges ? <PledgeDialog endpoint={endpoint} onSaved={refresh}
    trigger={<Button type="button" variant="outline" className="min-h-11 lg:min-h-9"><Plus aria-hidden="true" />{t("recordPledge")}</Button>} /> : null;

  return <div className="min-w-0 space-y-6">
    <Button asChild variant="ghost" className="-ms-3 min-h-11 lg:min-h-9"><Link href={`/workspaces/${tenantId}/giving/fundraising`}><ArrowLeft aria-hidden="true" />{t("back")}</Link></Button>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2"><h1 className="break-words text-[28px] font-semibold tracking-tight">{row.title}</h1>
          <StatusBadge tone={fundraisingTone(row.status)} label={t(`statuses.${row.status}`)} dot /></div>
        {row.campaignName && <p className="text-sm text-muted-foreground">{t("linkedCampaign", { name: row.campaignName })}</p>}
        {row.summary && <p className="max-w-prose whitespace-pre-line text-sm">{row.summary}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {can.manage && row.status !== "archived" && <FundraisingFormDialog endpoint={`/api/workspaces/${tenantId}/fundraising`} row={row} onSaved={refresh}
          trigger={<Button type="button" variant="outline" className="min-h-11 lg:min-h-9"><Pencil aria-hidden="true" />{t("edit")}</Button>} />}
        {lifecycle.map((action) => <ConfirmDialog key={action} tone="neutral" title={t(action)} description={t(`${action}Confirm`)}
          confirmLabel={t("confirmAction")} cancelLabel={t("cancel")} onConfirm={() => patch({ action })}
          trigger={<Button type="button" variant={action === "open" ? "default" : "outline"} className="min-h-11 lg:min-h-9">{t(action)}</Button>} />)}
      </div>
    </div>
    <Card><CardContent className="space-y-3 pt-6"><FundraisingProgress row={row} /><p className="text-xs text-muted-foreground">{t("recordOnly")}</p></CardContent></Card>
    {publicPage}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {gifts && pledges && <Tabs defaultValue="gifts" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList aria-label={t("tabs.label")}><TabsTrigger value="gifts" className="min-h-11 lg:min-h-8">{t("tabs.gifts")}</TabsTrigger><TabsTrigger value="pledges" className="min-h-11 lg:min-h-8">{t("tabs.pledges")}</TabsTrigger></TabsList>
        <div className="flex flex-wrap gap-2">{recordPledge}{recordGift}</div>
      </div>
      <TabsContent value="gifts" className="mt-4">
        {giftRows.length ? <DataTable label={t("giftsLabel")} columns={giftColumns} rows={giftRows} /> : <EmptyState icon={Gift} title={t("giftsEmpty")} size="compact" />}
      </TabsContent>
      <TabsContent value="pledges" className="mt-4">
        {pledgeRows.length ? <DataTable label={t("pledgesLabel")} columns={pledgeColumns} rows={pledgeRows} /> : <EmptyState icon={HandHeart} title={t("pledgesEmpty")} size="compact" />}
      </TabsContent>
    </Tabs>}
  </div>;
}
