/** Layout and behaviour modelled on Shadcn UI Kit item drawer1, approved by the founder 25 Nov 2026; code written for Harvest, no kit code copied. Notes: docs/ui-sources.md. */
"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { deliveryOf, statusSwitchable, type Entity } from "@/lib/ads/view";
import { useAdsError } from "@/components/ads/ads-error";
import { notify } from "@/lib/toast";

export type EditActions = {
  rename: (row: Entity, name: string) => Promise<void>;
  budget: (row: Entity, change: { budgetAmount?: number; endDate?: string }) => Promise<void>;
  toggle: (row: Entity, on: boolean) => Promise<void>;
  remove: (row: Entity) => Promise<void>;
};

/** The right-hand edit panel: name, on or off, budget and end date (campaign and ad set), review result (ad) and remove. Every spend-affecting change asks for an explicit confirmation. */
export function AdsEditPanel({ row, currency, today, actions, onClose }: { row: Entity | null; currency: string; today: string; actions: EditActions; onClose: () => void }) {
  const t = useTranslations("Ads.panel"), l = useTranslations("Ads"), explain = useAdsError(), format = useFormatter();
  return <Sheet open={row !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-md" data-ads-panel>
      {row && <PanelBody key={`${row.id}:${row.version}`} {...{ row, currency, today, actions, t, l, explain, format }} />}
    </SheetContent>
  </Sheet>;
}

type Common = { t: ReturnType<typeof useTranslations>; l: ReturnType<typeof useTranslations>; explain: (error: unknown) => string; format: ReturnType<typeof useFormatter> };
function PanelBody({ row, currency, today, actions, t, l, explain, format }: { row: Entity; currency: string; today: string; actions: EditActions } & Common) {
  const [name, setName] = useState(row.name), [budget, setBudget] = useState(row.budgetAmount === null ? "" : String(row.budgetAmount)), [end, setEnd] = useState(row.endDate ?? "");
  const [confirmSpend, setConfirmSpend] = useState(false), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState(""), [removing, setRemoving] = useState(false);
  const delivery = deliveryOf(row, today), canBudget = row.level !== "ad" && row.budgetAmount !== null;
  const amount = Number(budget), amountOk = budget.trim() !== "" && Number.isFinite(amount) && amount > 0 && Math.round(amount * 100) / 100 === amount;
  const budgetChanged = canBudget && (amountOk && amount !== row.budgetAmount || end !== (row.endDate ?? "") && end !== "");
  const run = async (key: string, work: () => Promise<void>, done: string) => {
    setBusy(key); setError("");
    try { await work(); notify.success(done); } catch (cause) { setError(explain(cause)); } finally { setBusy(null); }
  };
  const money = (v: number) => format.number(v, { style: "currency", currency });
  return <div className="flex flex-col gap-5 p-4 pt-12">
    <header className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{l(`levels.${row.level}`)}</p>
      <SheetTitle className="text-lg break-words">{row.name}</SheetTitle><SheetDescription className="sr-only">{t("description")}</SheetDescription>
      <div className="flex flex-wrap items-center gap-2"><StatusBadge tone={delivery === "rejected" ? "danger" : delivery === "active" ? "success" : "neutral"} dot label={l(`delivery.${delivery}`)} />
        {row.parentName && <span className="text-sm text-muted-foreground">{row.parentName}</span>}</div>
    </header>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {row.level === "ad" && (row.reviewStatus === "rejected" || row.deliveryIssue) && <Alert role="status"><AlertDescription>{row.reviewStatus === "rejected" ? row.reviewReason ?? t("rejected") : t("issue", { issue: row.deliveryIssue ?? "" })}</AlertDescription></Alert>}
    <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void run("name", () => actions.rename(row, name.trim()), t("renamed")); }}>
      <Label htmlFor="ads-edit-name">{t("name")}</Label>
      <div className="flex gap-2"><Input id="ads-edit-name" value={name} maxLength={200} className="min-h-11 lg:min-h-9" onChange={(event) => setName(event.target.value)} />
        <Button type="submit" size="responsive" variant="outline" disabled={busy !== null || !name.trim() || name.trim() === row.name}>{t("saveName")}</Button></div>
    </form>
    {statusSwitchable(row) && <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <Label htmlFor="ads-edit-switch" className="min-h-11 flex-1 items-center">{t("delivering")}</Label>
      <Switch id="ads-edit-switch" checked={row.status === "active"} disabled={busy !== null} onCheckedChange={(on) => void run("switch", () => actions.toggle(row, on), on ? t("turnedOn") : t("turnedOff"))} />
    </div>}
    {canBudget && <section className="flex flex-col gap-3 rounded-lg border p-3" aria-label={t("budget")}>
      <h3 className="text-sm font-semibold">{t("budget")}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5"><Label htmlFor="ads-edit-budget">{row.budgetType === "lifetime" ? t("lifetimeBudget") : t("dailyBudget")}</Label>
          <Input id="ads-edit-budget" inputMode="decimal" value={budget} className="min-h-11 lg:min-h-9" onChange={(event) => { setBudget(event.target.value); setConfirmSpend(false); }} /></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="ads-edit-end">{t("endDate")}</Label>
          <Input id="ads-edit-end" type="date" value={end} min={today} className="min-h-11 lg:min-h-9" onChange={(event) => { setEnd(event.target.value); setConfirmSpend(false); }} /></div>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox checked={confirmSpend} onCheckedChange={(on) => setConfirmSpend(on === true)} />{t("confirmSpend", { current: row.budgetAmount === null ? "" : money(row.budgetAmount) })}</label>
      <Button type="button" size="responsive" disabled={busy !== null || !budgetChanged || !confirmSpend || (budget.trim() !== "" && !amountOk)}
        onClick={() => void run("budget", () => actions.budget(row, { ...(amountOk && amount !== row.budgetAmount ? { budgetAmount: amount } : {}), ...(end && end !== (row.endDate ?? "") ? { endDate: end } : {}) }), t("budgetSaved"))}>{t("saveBudget")}</Button>
    </section>}
    {row.level === "ad" && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">{t("format")}</dt><dd>{row.format ? l(`formats.${row.format}`) : ""}</dd>
      <dt className="text-muted-foreground">{t("review")}</dt><dd>{row.reviewStatus ? l(`review.${row.reviewStatus}`) : ""}</dd>
      {row.sourcePostRef && <><dt className="text-muted-foreground">{t("boosted")}</dt><dd>{t("boostedPost")}</dd></>}
    </dl>}
    <div className="mt-auto border-t pt-4">
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={t("removeTitle", { name: row.name })} description={t("removeBody")} confirmLabel={t("removeConfirm")} cancelLabel={t("cancel")}
        onConfirm={async () => { try { await actions.remove(row); notify.success(t("removed")); } catch (cause) { return explain(cause); } }} />
      {statusSwitchable(row) && <Button type="button" variant="destructive" size="responsive" disabled={busy !== null} onClick={() => setRemoving(true)}>{t("remove")}</Button>}
    </div>
  </div>;
}
