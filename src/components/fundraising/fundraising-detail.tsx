"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { FundraisingProgress } from "@/components/fundraising/fundraising-progress";
import { FundraisingFormDialog, GiftDialog, PledgeDialog } from "@/components/fundraising/giving-dialogs";
import { FundraisingRecords } from "@/components/fundraising/fundraising-records";
import { useRequest } from "@/hooks/use-request";
import { fundraisingTone, type FundraisingRow, type GiftRow, type PledgeRow } from "@/lib/fundraising";

type Caps = { manage: boolean; publish: boolean; record: boolean; correct: boolean };
const actionsFor = (status: FundraisingRow["status"]) =>
  status === "draft" ? (["open", "archive"] as const) : status === "published" ? (["close"] as const) : status === "closed" ? (["archive"] as const) : ([] as const);

/**
 * One fundraising campaign: header with status and the Harvest-owned lifecycle actions (open, close, archive; no kit match), the goal, raised and pledged
 * tiles, and (owners and admins) the Gifts and Pledges card with the record, correct, accept and cancel actions. Every mutation goes to the fundraising API
 * and then refreshes the server data.
 */
export function FundraisingDetail({ tenantId, row, pledges, gifts, can, publicPage = null }: { tenantId: string; row: FundraisingRow; pledges: PledgeRow[] | null; gifts: GiftRow[] | null; can: Caps;
  /** The "Public page" section (owners and admins), rendered by the page so its server data stays there. */
  publicPage?: React.ReactNode }) {
  const t = useTranslations("Fundraising"), router = useRouter(), request = useRequest();
  const [error, setError] = useState("");
  const endpoint = `/api/workspaces/${tenantId}/fundraising/${row.id}`, refresh = () => router.refresh();
  const takesGifts = row.status !== "archived", takesPledges = row.status === "draft" || row.status === "published";

  async function patch(body: Record<string, unknown>) {
    const result = await request(endpoint, { method: "PATCH", body: { version: row.version, ...body } });
    if (!result.ok) return result.error;
    refresh();
  }
  const lifecycle = actionsFor(row.status).filter((action) => action === "open" ? can.publish : can.manage);
  const recordGift = can.record && takesGifts && gifts ? <GiftDialog endpoint={endpoint} currency={row.currency} pledges={pledges ?? []} onSaved={refresh}
    trigger={<Button type="button" size="sm" className="max-lg:min-h-11"><Plus aria-hidden="true" />{t("recordGift")}</Button>} /> : null;
  const recordPledge = can.record && takesPledges ? <PledgeDialog endpoint={endpoint} currency={row.currency} onSaved={refresh}
    trigger={<Button type="button" size="sm" variant="outline" className="max-lg:min-h-11"><Plus aria-hidden="true" />{t("recordPledge")}</Button>} /> : null;

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
    <div className="space-y-3"><FundraisingProgress row={row} /><p className="text-xs text-muted-foreground">{t("recordOnly")}</p></div>
    {publicPage}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {gifts && pledges && <FundraisingRecords row={row} endpoint={endpoint} gifts={gifts} pledges={pledges} canRecord={can.record} canCorrect={can.correct}
      onChanged={refresh} onError={setError} actions={<>{recordPledge}{recordGift}</>} />}
  </div>;
}
