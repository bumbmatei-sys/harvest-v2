"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Megaphone, Plus, RotateCw, Target, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { RangePicker } from "@/components/social/analytics/range-picker";
import { AdsEditPanel, type EditActions } from "@/components/ads/ads-edit-panel";
import { useAdsError } from "@/components/ads/ads-error";
import { AdsHealthBanner } from "@/components/ads/ads-health-banner";
import { AdsSummary } from "@/components/ads/ads-summary";
import { AdsTable, ColumnsMenu } from "@/components/ads/ads-table";
import { useAdsManager } from "@/components/ads/use-ads-manager";
import { bulkItems, columnsFor, flatten, pruneSelection, visibleRows, type ColumnGroup, type ColumnId, type Entity, type Tab } from "@/lib/ads/view";
import { presetRange, todayIn } from "@/lib/social/analytics-view";
import { browserTimeZone } from "@/lib/social/time";
import { notify } from "@/lib/toast";

type Pending = { rows: Entity[]; on: boolean } | null;

/**
 * Social media > Ads. Owner and admin only (the page and every route enforce it). A three-level table (Campaigns, Ad sets, Ads) in the manner of an ads manager: selecting rows on one
 * level filters the next, every row has an on/off switch (turning one on asks first because it can start spending), totals sit under the rows and a columns picker changes what is shown.
 * Numbers come from stored results; a measure nobody reported reads Unavailable, never zero. Everything runs against the in-memory test provider until a real connection is approved.
 */
export function AdsManager({ tenantId }: { tenantId: string }) {
  const t = useTranslations("Ads"), explain = useAdsError();
  const [timezone] = useState(() => browserTimeZone()), [today] = useState(() => todayIn(timezone));
  const [range, setRange] = useState(() => presetRange(28, today));
  const data = useAdsManager(tenantId, range);
  const [tab, setTab] = useState<Tab>("campaigns"), [picked, setPicked] = useState<Record<Tab, string[]>>({ campaigns: [], adsets: [], ads: [] });
  const [group, setGroup] = useState<ColumnGroup>("performance"), [custom, setCustom] = useState<ColumnId[]>([]);
  const [opened, setOpened] = useState<string | null>(null), [pending, setPending] = useState<Pending>(null), [busyId, setBusyId] = useState<string | null>(null), [refreshing, setRefreshing] = useState(false), [finding, setFinding] = useState(false);
  const [notice, setNotice] = useState("");

  const flat = useMemo(() => flatten(data.tree), [data.tree]);
  const selection = useMemo(() => pruneSelection(flat, { campaigns: picked.campaigns, adsets: picked.adsets }), [flat, picked.campaigns, picked.adsets]);
  const rows = useMemo(() => visibleRows(flat, tab, selection), [flat, tab, selection]);
  const counts = useMemo(() => ({ campaigns: flat.campaigns.length, adsets: visibleRows(flat, "adsets", selection).length, ads: visibleRows(flat, "ads", selection).length }), [flat, selection]);
  const all = [...flat.campaigns, ...flat.adSets, ...flat.ads];
  const open = all.find((row) => row.id === opened) ?? null;
  const currency = data.account?.currency ?? "USD", busy = data.status === "loading" || data.reloading;
  const campaignIds = useMemo(() => new Set(visibleRows(flat, "campaigns", selection).map((row) => row.id)), [flat, selection]);

  const toggleNow = async (list: Entity[], on: boolean) => {
    setNotice("");
    try {
      await data.mutate(async () => {
        if (list.length === 1) { setBusyId(list[0].id); await data.api.setStatus({ level: list[0].level, id: list[0].id, status: on ? "active" : "paused", version: list[0].version }); }
        else await data.api.bulkStatus(on ? "active" : "paused", bulkItems(list));
      });
      notify.success(on ? t("table.turnedOn", { count: list.length }) : t("table.turnedOff", { count: list.length }));
    } catch (error) { setNotice(explain(error)); } finally { setBusyId(null); }
  };
  const request = (list: Entity[], on: boolean) => { if (!list.length) return; if (on) setPending({ rows: list, on }); else void toggleNow(list, false); };
  const actions: EditActions = {
    rename: async (row, name) => { await data.mutate(() => data.api.rename({ level: row.level, id: row.id, name, version: row.version })); },
    budget: async (row, change) => { await data.mutate(() => data.api.budget({ level: row.level as "campaign" | "adset", id: row.id, version: row.version, ...change })); },
    toggle: async (row, on) => { await data.mutate(() => data.api.setStatus({ level: row.level, id: row.id, status: on ? "active" : "paused", version: row.version })); },
    remove: async (row) => { await data.mutate(() => data.api.remove({ level: row.level, id: row.id, version: row.version })); setOpened(null); },
  };
  const refresh = async () => { setRefreshing(true); setNotice(""); const result = await data.refresh(); setRefreshing(false); if (result.ok) notify.success(t("refreshed")); else setNotice(t("errors.provider")); };
  const find = async () => { setFinding(true); setNotice(""); try { const result = await data.findAccounts(); if (!result.linked) setNotice(result.connections ? t("empty.noneFound") : t("empty.noConnection")); } catch { setNotice(t("errors.generic")); } finally { setFinding(false); } };

  const header = <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
    <div className="min-w-0"><h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("subtitle", { zone: timezone })}</p></div>
    <div className="flex min-w-0 flex-wrap items-center gap-3 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
      {data.accounts.length > 0 && <NativeSelect value={data.account?.id ?? ""} onChange={(event) => { data.selectAccount(event.target.value); setPicked({ campaigns: [], adsets: [], ads: [] }); }} className="min-h-11 w-auto min-w-44 max-sm:w-full lg:min-h-9" aria-label={t("account.label")} data-ads-account>
        {data.accounts.map((account) => <NativeSelectOption key={account.id} value={account.id}>{t("account.option", { name: account.name, network: t.has(`networks.${account.network}`) ? t(`networks.${account.network}`) : t("networks.other") })}</NativeSelectOption>)}</NativeSelect>}
      {data.account && <RangePicker range={range} today={today} onChange={setRange} />}
      {data.account && <Button type="button" variant="outline" size="responsive" disabled={refreshing} onClick={() => void refresh()}><RotateCw aria-hidden="true" />{refreshing ? t("refreshing") : t("refresh")}</Button>}
      <Button asChild variant="outline" size="responsive"><Link href={`/workspaces/${tenantId}/social/ads/leads`}><Users aria-hidden="true" />{t("leadsLink")}</Link></Button>
      {data.account && <Button asChild size="responsive"><Link href={`/workspaces/${tenantId}/social/ads/new?account=${data.account.id}`}><Plus aria-hidden="true" />{t("create")}</Link></Button>}
    </div>
  </header>;

  let body: React.ReactNode;
  if (data.status === "loading") body = <div className="flex flex-col gap-4 lg:gap-6" data-testid="ads-loading">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 lg:gap-6">{[0, 1, 2, 3].map((item) => <Card key={item}><CardHeader><Skeleton className="h-5 w-28" /></CardHeader><CardContent><Skeleton className="h-9 w-24" /></CardContent></Card>)}</div>
    <Skeleton className="h-64 w-full" /></div>;
  else if (data.status === "unavailable") body = <EmptyState icon={Target} title={t("states.unavailableTitle")} description={t("states.unavailable")} solid />;
  else if (data.status === "error") body = <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{t("states.error")}
    <Button type="button" variant="outline" size="responsive" onClick={data.reload}><RotateCw aria-hidden="true" />{t("states.retry")}</Button></AlertDescription></Alert>;
  else if (!data.account) body = <EmptyState icon={Megaphone} title={t("empty.noAccountsTitle")} description={t("empty.noAccounts")} solid
    action={<Button type="button" size="responsive" disabled={finding} onClick={() => void find()} data-ads-find>{finding ? t("empty.finding") : t("empty.find")}</Button>}
    secondary={<Button asChild variant="outline" size="responsive"><Link href={`/workspaces/${tenantId}/social/accounts`}>{t("empty.connect")}</Link></Button>} />;
  else body = <div className="flex flex-col gap-4 lg:gap-6" data-testid="ads-content" data-ads-ready={busy ? undefined : "true"}>
    <AdsHealthBanner account={data.account} alerts={data.alerts} onDismiss={(id) => void data.mutate(() => data.api.dismissAlert(id)).catch((error) => setNotice(explain(error)))} />
    {data.truncated && <Alert role="status"><AlertDescription>{t("states.truncated")}</AlertDescription></Alert>}
    <AdsSummary results={data.results} ids={campaignIds} range={range} currency={currency} />
    {flat.campaigns.length === 0
      ? <EmptyState icon={Target} title={t("empty.noCampaignsTitle")} description={t("empty.noCampaigns")} solid
        action={<Button asChild size="responsive"><Link href={`/workspaces/${tenantId}/social/ads/new?account=${data.account.id}`}>{t("create")}</Link></Button>}
        secondary={<Button type="button" variant="outline" size="responsive" disabled={refreshing} onClick={() => void refresh()}>{t("refresh")}</Button>} />
      : <AdsTable tab={tab} rows={rows} results={data.results} currency={currency} today={today} columns={columnsFor(group, custom)} selected={picked[tab]} onSelect={(ids) => setPicked((current) => ({ ...current, [tab]: ids }))}
        tabs={{ value: tab, onChange: setTab, counts }} onToggle={(row, on) => request([row], on)} onOpen={(row) => setOpened(row.id)} busyId={busyId} writable loading={busy && rows.length === 0}
        toolbar={<ColumnsMenu group={group} custom={custom} onGroup={setGroup} onCustom={setCustom} />}
        bulk={<><Button type="button" size="responsive" variant="outline" onClick={() => request(rows.filter((row) => picked[tab].includes(row.id)), true)}>{t("table.bulkOn")}</Button>
          <Button type="button" size="responsive" variant="outline" onClick={() => request(rows.filter((row) => picked[tab].includes(row.id)), false)}>{t("table.bulkOff")}</Button></>}
        empty={<EmptyState icon={Target} size="compact" title={t("empty.noRowsTitle")} description={t("empty.noRows")} />} />}
  </div>;

  return <div className="flex min-w-0 flex-col gap-6" data-testid="ads-page" aria-busy={busy || undefined}>
    {header}
    {notice && <Alert variant="destructive" role="alert"><AlertDescription>{notice}</AlertDescription></Alert>}
    <div className={busy && data.status !== "loading" ? "opacity-60 transition-opacity" : undefined}>{body}</div>
    <AdsEditPanel row={open} currency={currency} today={today} actions={actions} onClose={() => setOpened(null)} />
    <ConfirmDialog open={pending !== null} onOpenChange={(next) => { if (!next) setPending(null); }} tone="neutral"
      title={pending && pending.rows.length === 1 ? t("confirmOn.title", { name: pending.rows[0].name }) : t("confirmOn.titleMany", { count: pending?.rows.length ?? 0 })}
      description={t("confirmOn.body")} confirmLabel={t("confirmOn.confirm")} cancelLabel={t("confirmOn.cancel")}
      onConfirm={async () => { const current = pending; setPending(null); if (current) await toggleNow(current.rows, true); }} />
  </div>;
}
