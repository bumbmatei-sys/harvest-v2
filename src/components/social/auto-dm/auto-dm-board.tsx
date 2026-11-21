"use client";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MessageCircleReply, Plus, ShieldAlert, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { AutoDmHeader } from "@/components/social/auto-dm/auto-dm-header";
import { EnableReview } from "@/components/social/auto-dm/enable-review";
import { HardOffNotice } from "@/components/social/auto-dm/hard-off-notice";
import { HoursPanel } from "@/components/social/auto-dm/hours-panel";
import { RuleRow } from "@/components/social/auto-dm/rule-row";
import { TemplatesPanel } from "@/components/social/auto-dm/templates-panel";
import { useAutoDmData, useAutoDmReason, useRuleStats } from "@/components/social/auto-dm/use-auto-dm";
import { autoDmApi, type AutoDmRuleView } from "@/lib/social/auto-dm-api";
import { addTotals, emptyTotals, sym } from "@/lib/social/auto-dm-ui";
import { notify } from "@/lib/toast";

const tabs = ["rules", "templates", "hours"] as const;
type Tab = (typeof tabs)[number];

/** Auto-DM: the rules with their on or off switches and counts, template review, and working hours. Owners and admins only; the server answers one neutral 404 otherwise. */
export function AutoDmBoard({ tenantId }: { tenantId: string }) {
  const t = useTranslations("SocialAutoDm"), reason = useAutoDmReason(), router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const data = useAutoDmData(tenantId), api = useMemo(() => autoDmApi(tenantId), [tenantId]);
  const [stamp, setStamp] = useState(0), [reviewing, setReviewing] = useState<AutoDmRuleView | null>(null), [busy, setBusy] = useState<string | null>(null);
  const stats = useRuleStats(tenantId, data.state === "ready" ? data.rules : [], stamp);
  const tab: Tab = tabs.find((name) => name === params.get("tab")) ?? "rules";
  const setTab = useCallback((next: string) => router.replace(next === "rules" ? pathname : `${pathname}?tab=${next}`, { scroll: false }), [pathname, router]);
  const base = `/workspaces/${tenantId}/social/auto-dm`;
  const newRule = data.accounts.length > 0 && <Button asChild size="responsive"><Link href={`${base}/new`} prefetch={false}><Plus aria-hidden="true" />{t("newRule")}</Link></Button>;
  const frame = (body: React.ReactNode) => <div className="min-w-0 space-y-4" data-testid="auto-dm-board"><AutoDmHeader>{newRule}</AutoDmHeader>{body}</div>;

  if (data.state === "loading") return <div className="space-y-4" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (data.state === "unavailable") return frame(<EmptyState icon={ShieldAlert} solid title={t("unavailableTitle")} description={t("unavailable")} />);
  if (data.state === "error") return frame(<Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")} <Button type="button" variant="link" onClick={data.reload}>{t("retry")}</Button></AlertDescription></Alert>);
  if (data.accounts.length === 0) return frame(<><HardOffNotice /><EmptyState icon={UserCog} solid title={t("noAccountsTitle")} description={t("noAccounts")}
    action={<Button asChild size="responsive"><Link href={`/workspaces/${tenantId}/social/accounts`} prefetch={false}>{t("goToAccounts")}</Link></Button>} /></>);

  const accountById = new Map(data.accounts.map((account) => [account.id, account]));
  const totals = data.rules.reduce((sum, rule) => stats[rule.id]?.state === "ready" ? addTotals(sum, stats[rule.id].totals) : sum, emptyTotals());
  const loadedStats = data.rules.every((rule) => stats[rule.id]?.state !== undefined && stats[rule.id].state !== "loading");
  const tiles: [string, string][] = [["active", `${data.rules.filter((rule) => rule.enabled).length}/${data.rules.length}`], ["triggered", String(totals.triggered)], ["sent", String(totals.sent)], ["skipped", String(totals.skippedTotal)], ["handedOff", String(totals.handedOff)]];

  async function onSwitch(rule: AutoDmRuleView, next: boolean) {
    if (next) { setReviewing(rule); return; }
    setBusy(rule.id);
    try { const done = await api.disable(rule.id, rule.version); data.replace(done.rule); setStamp((value) => value + 1); notify.success(t("list.disabledToast", { name: rule.name })); }
    catch (cause) { notify.error(reason(cause)); data.reload(); } finally { setBusy(null); }
  }
  return frame(<>
    <HardOffNotice />
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-auto max-w-full self-start overflow-x-auto" aria-label={t("tabs.label")}>
        {tabs.map((name) => <TabsTrigger key={name} value={name} className="min-h-11 px-4 lg:min-h-8">{t(`tabs.${name}`)}{name === "rules" && <span className="ml-1.5 rounded-full bg-background/60 px-1.5 text-xs tabular-nums">{data.rules.length}</span>}</TabsTrigger>)}
      </TabsList>
    </Tabs>
    {tab === "rules" && <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" data-testid="board-tiles" data-ready={loadedStats || undefined}>{tiles.map(([key, value]) => <div key={key} className="rounded-xl border bg-card p-3" data-testid={`tile-${key}`}>
        <dt className="text-xs text-muted-foreground">{t(`tiles.${key}`)}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{key === "active" || loadedStats ? value : sym.pending}</dd></div>)}</dl>
      {data.rules.length === 0 ? <EmptyState icon={MessageCircleReply} solid title={t("emptyTitle")} description={t("empty")} action={<Button asChild size="responsive"><Link href={`${base}/new`} prefetch={false}><Plus aria-hidden="true" />{t("newRule")}</Link></Button>} />
        : <ul className="space-y-3" aria-label={t("tabs.rules")}>{data.rules.map((rule) => <RuleRow key={rule.id} tenantId={tenantId} rule={rule} account={accountById.get(rule.connectionId)} stats={stats[rule.id]} busy={busy === rule.id} onSwitch={(item, next) => void onSwitch(item, next)} />)}</ul>}
    </div>}
    {tab === "templates" && <TemplatesPanel tenantId={tenantId} rules={data.rules} />}
    {tab === "hours" && <HoursPanel tenantId={tenantId} accounts={data.accounts} />}
    <EnableReview tenantId={tenantId} rule={reviewing} account={reviewing ? accountById.get(reviewing.connectionId) ?? null : null} open={reviewing !== null} onOpenChange={(open) => { if (!open) setReviewing(null); }}
      onEnabled={(rule) => { data.replace(rule); setStamp((value) => value + 1); notify.success(t("list.enabledToast", { name: rule.name })); }} />
  </>);
}
