/** Layout and behaviour modelled on Shadcn UI Kit items tables14 (the shared DataTable), switch-card1 and drawer1, approved by the founder 25 Nov 2026; code written for Harvest, no kit code copied. Notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Flag, ListChecks, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { useAdsError } from "@/components/ads/ads-error";
import { useAdAccounts } from "@/components/ads/use-ad-accounts";
import { adLevels } from "@/lib/ads/ads";
import { emptyRuleDraft, isPercentMetric, ruleMetricsOffered, ruleOperatorsOffered, rulePayload, type RuleDraft, type RuleRun, type RuleView } from "@/lib/ads/overview";
import { notify } from "@/lib/toast";

const moneyMetrics = new Set(["spend", "costPerResult", "cpc", "cpm"]);

/**
 * Social media > Ads > Rules. Owner-made rules that watch spend, results and costs and flag what matches. A rule made here never turns anything off and never changes a budget:
 * its only action is to flag. Rules start off; turning one on, checking now and removing one are explicit steps the server audits.
 */
export function AdsRules({ tenantId }: { tenantId: string }) {
  const t = useTranslations("Ads.rules"), l = useTranslations("Ads"), explain = useAdsError(), format = useFormatter();
  const { api, accounts, account, select, status } = useAdAccounts(tenantId);
  const [rules, setRules] = useState<RuleView[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false), [opened, setOpened] = useState<RuleView | null>(null), [removing, setRemoving] = useState<RuleView | null>(null), [version, setVersion] = useState(0);
  const base = `/workspaces/${tenantId}/social/ads`, currency = account?.currency ?? "USD", accountId = account?.id ?? null;

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    api.rules(controller.signal).then((r) => { setRules(r.rules.filter((rule) => rule.adAccountId === accountId)); setLoaded(true); })
      .catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) { setError(explain(cause)); setLoaded(true); } });
    return () => controller.abort();
  }, [api, accountId, version, explain]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const run = async (key: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(key); setError("");
    try { await work(); if (done) notify.success(done); } catch (cause) { setError(explain(cause)); } finally { setBusy(null); reload(); }
  };

  const value = (metric: string, threshold: number) => moneyMetrics.has(metric) ? format.number(threshold, { style: "currency", currency }) : isPercentMetric(metric) ? format.number(threshold, { style: "percent", maximumFractionDigits: 2 }) : format.number(threshold);
  const describe = (rule: RuleView) => t("condition", { metric: t(`metric.${rule.condition.metric}`), operator: t(`operator.${rule.condition.operator}`), value: value(rule.condition.metric, rule.condition.threshold), days: rule.condition.windowDays });

  const columns: DataTableColumn[] = [
    { id: "name", header: t("columns.name"), card: "title", className: "min-w-44" }, { id: "condition", header: t("columns.condition"), className: "min-w-56" },
    { id: "level", header: t("columns.level"), showFrom: "@md" }, { id: "action", header: t("columns.action") }, { id: "on", header: t("columns.on") },
    { id: "actions", header: t("columns.actions"), srOnlyHeader: true, card: "actions" },
  ];
  const rows: DataTableRow[] = rules.map((rule) => ({ id: rule.id, label: rule.name, cells: {
    name: <Button type="button" variant="link" className="h-auto min-h-11 px-0 text-start font-medium whitespace-normal lg:min-h-0" onClick={() => setOpened(rule)}>{rule.name}</Button>,
    condition: describe(rule), level: l(`levels.${rule.level}`),
    action: rule.action === "notify" ? <StatusBadge tone="info" dot label={t("flagOnly")} /> : <StatusBadge tone="warning" dot label={t("pauseAction")} />,
    on: <Switch checked={rule.enabled} disabled={busy !== null || (rule.action !== "notify" && !rule.enabled)} aria-label={t("turnOn", { name: rule.name })} onCheckedChange={(on) => void run(rule.id, () => api.setRuleEnabled(rule.id, on, rule.version), on ? t("turnedOn") : t("turnedOff"))} />,
    actions: <Button type="button" variant="ghost" size="icon" className="size-11 lg:size-8" aria-label={t("remove", { name: rule.name })} onClick={() => setRemoving(rule)}><Trash2 aria-hidden="true" /></Button>,
  } }));
  const enabled = rules.filter((rule) => rule.enabled).length;

  const header = <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
    <div className="min-w-0"><Button asChild variant="ghost" size="sm" className="-ms-2 mb-1"><Link href={`${base}/overview`}><ArrowLeft aria-hidden="true" />{t("back")}</Link></Button>
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p></div>
    <div className="flex min-w-0 flex-wrap items-center gap-3 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
      {accounts.length > 1 && <NativeSelect value={account?.id ?? ""} onChange={(event) => { select(event.target.value); setLoaded(false); }} className="min-h-11 w-auto min-w-44 max-sm:w-full lg:min-h-9" aria-label={l("account.label")}>
        {accounts.map((item) => <option key={item.id} value={item.id}>{l("account.option", { name: item.name, network: l.has(`networks.${item.network}`) ? l(`networks.${item.network}`) : l("networks.other") })}</option>)}</NativeSelect>}
      {account && <Button type="button" variant="outline" size="responsive" disabled={busy !== null || enabled === 0} data-ads-rules-run
        onClick={() => void run("run", async () => { const result = await api.runRules(account.id); notify.success(t("ran", { count: result.triggered })); })}><Flag aria-hidden="true" />{t("checkNow")}</Button>}
      {account && <Button type="button" size="responsive" onClick={() => setCreating(true)} data-ads-new-rule><Plus aria-hidden="true" />{t("new")}</Button>}
    </div>
  </header>;

  let body: React.ReactNode;
  if (status === "loading") body = <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>;
  else if (status === "unavailable") body = <EmptyState icon={ListChecks} title={l("states.unavailableTitle")} description={l("states.unavailable")} solid />;
  else if (status === "error") body = <Alert variant="destructive" role="alert"><AlertDescription>{l("states.error")}</AlertDescription></Alert>;
  else if (!account) body = <EmptyState icon={ListChecks} title={l("empty.noAccountsTitle")} description={l("empty.noAccounts")} solid action={<Button asChild size="responsive"><Link href={base}>{l("empty.find")}</Link></Button>} />;
  else body = <div data-ads-rules-ready={loaded && busy === null ? "true" : undefined}>
    <DataTable label={t("label")} columns={columns} rows={rows} state={loaded ? "ready" : "loading"}
      empty={<EmptyState icon={ListChecks} size="compact" title={t("emptyTitle")} description={t("empty")} action={<Button type="button" size="responsive" onClick={() => setCreating(true)}>{t("new")}</Button>} />} />
  </div>;

  return <div className="flex min-w-0 flex-col gap-6" data-testid="ads-rules-page">
    {header}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {body}
    {account && <NewRuleDialog open={creating} onOpenChange={setCreating} currency={currency} onCreate={async (draft) => {
      const payload = rulePayload(draft, account.id);
      if (!payload.ok) return payload.field;
      await api.createRule(payload.body); setCreating(false); notify.success(t("created")); reload(); return null;
    }} />}
    <RuleSheet rule={opened} describe={describe} api={api} currency={currency} onClose={() => setOpened(null)} />
    <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }} title={t("removeTitle", { name: removing?.name ?? "" })} description={t("removeBody")} confirmLabel={t("removeConfirm")} cancelLabel={t("cancel")}
      onConfirm={async () => { const rule = removing; setRemoving(null); if (rule) await run(rule.id, () => api.deleteRule(rule.id), t("removed")); }} />
  </div>;
}

/** New rule: what to watch, the threshold and the number of days. The action is fixed: the rule flags what matches. */
function NewRuleDialog({ open, onOpenChange, currency, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; currency: string; onCreate: (draft: RuleDraft) => Promise<"name" | "threshold" | "windowDays" | null> }) {
  const t = useTranslations("Ads.rules"), l = useTranslations("Ads"), explain = useAdsError();
  const [draft, setDraft] = useState<RuleDraft>(emptyRuleDraft), [field, setField] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setField(null); };
  const unit = moneyMetrics.has(draft.metric) ? currency : isPercentMetric(draft.metric) ? "%" : null;
  return <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) { setDraft(emptyRuleDraft()); setField(null); setError(""); } }}><DialogContent>
    <form className="flex flex-col gap-4" noValidate onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      try { const wrong = await onCreate(draft); setField(wrong); if (!wrong) setDraft(emptyRuleDraft()); } catch (cause) { setError(explain(cause)); } finally { setBusy(false); }
    }}>
      <DialogHeader><DialogTitle>{t("newTitle")}</DialogTitle><DialogDescription>{t("newDescription")}</DialogDescription></DialogHeader>
      <Field data-invalid={field === "name" || undefined}><FieldLabel htmlFor="ads-rule-name">{t("form.name")}</FieldLabel>
        <Input id="ads-rule-name" className="min-h-11" maxLength={120} value={draft.name} aria-invalid={field === "name" || undefined} onChange={(event) => set("name", event.target.value)} />
        {field === "name" && <FieldError>{t("form.nameInvalid")}</FieldError>}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="ads-rule-level">{t("form.level")}</FieldLabel>
          <NativeSelect id="ads-rule-level" className="min-h-11 w-full" value={draft.level} onChange={(event) => set("level", event.target.value as RuleDraft["level"])}>
            {adLevels.map((level) => <option key={level} value={level}>{l(`levels.${level}`)}</option>)}</NativeSelect></Field>
        <Field><FieldLabel htmlFor="ads-rule-metric">{t("form.metric")}</FieldLabel>
          <NativeSelect id="ads-rule-metric" className="min-h-11 w-full" value={draft.metric} onChange={(event) => set("metric", event.target.value as RuleDraft["metric"])}>
            {ruleMetricsOffered.map((metric) => <option key={metric} value={metric}>{t(`metric.${metric}`)}</option>)}</NativeSelect></Field>
        <Field><FieldLabel htmlFor="ads-rule-operator">{t("form.operator")}</FieldLabel>
          <NativeSelect id="ads-rule-operator" className="min-h-11 w-full" value={draft.operator} onChange={(event) => set("operator", event.target.value as RuleDraft["operator"])}>
            {ruleOperatorsOffered.map((operator) => <option key={operator} value={operator}>{t(`operator.${operator}`)}</option>)}</NativeSelect></Field>
        <Field data-invalid={field === "threshold" || undefined}><FieldLabel htmlFor="ads-rule-threshold">{unit ? t("form.thresholdIn", { unit }) : t("form.threshold")}</FieldLabel>
          <Input id="ads-rule-threshold" className="min-h-11" inputMode="decimal" value={draft.threshold} aria-invalid={field === "threshold" || undefined} onChange={(event) => set("threshold", event.target.value)} />
          {field === "threshold" && <FieldError>{t("form.thresholdInvalid")}</FieldError>}</Field>
      </div>
      <Field data-invalid={field === "windowDays" || undefined}><FieldLabel htmlFor="ads-rule-days">{t("form.days")}</FieldLabel>
        <Input id="ads-rule-days" className="min-h-11 sm:w-32" inputMode="numeric" value={draft.windowDays} aria-invalid={field === "windowDays" || undefined} onChange={(event) => set("windowDays", event.target.value)} />
        {field === "windowDays" && <FieldError>{t("form.daysInvalid")}</FieldError>}</Field>
      <p className="flex items-center gap-2 text-sm"><Flag aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />{t("form.action")}</p>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter><Button type="button" variant="outline" size="responsive" onClick={() => onOpenChange(false)}>{t("cancel")}</Button><Button type="submit" size="responsive" disabled={busy}>{t("create")}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

/** A rule's detail: what it would flag right now (a preview that changes nothing) and its recent checks. */
function RuleSheet({ rule, describe, api, currency, onClose }: { rule: RuleView | null; describe: (rule: RuleView) => string; api: ReturnType<typeof useAdAccounts>["api"]; currency: string; onClose: () => void }) {
  return <Sheet open={rule !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent className="w-full overflow-y-auto sm:max-w-md" data-ads-rule-sheet>
      {rule && <RuleDetail key={rule.id} rule={rule} describe={describe} api={api} currency={currency} />}
    </SheetContent>
  </Sheet>;
}

function RuleDetail({ rule, describe, api, currency }: { rule: RuleView; describe: (rule: RuleView) => string; api: ReturnType<typeof useAdAccounts>["api"]; currency: string }) {
  const t = useTranslations("Ads.rules"), l = useTranslations("Ads"), format = useFormatter(), explain = useAdsError();
  const [preview, setPreview] = useState<{ id: string; name: string; metrics: Record<string, number> }[] | null>(null), [runs, setRuns] = useState<RuleRun[] | null>(null), [error, setError] = useState("");
  const id = rule.id;
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api.previewRule(id, controller.signal), api.ruleRuns(id, controller.signal)]).then(([p, r]) => { setPreview(p.wouldAct); setRuns(r.runs); })
      .catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(explain(cause)); });
    return () => controller.abort();
  }, [api, id, explain]);
  const shown = (metric: string, v: number | undefined) => v === undefined ? t("unavailable") : moneyMetrics.has(metric) ? format.number(v, { style: "currency", currency }) : isPercentMetric(metric) ? format.number(v, { style: "percent", maximumFractionDigits: 2 }) : format.number(v, { maximumFractionDigits: 2 });
  return <div className="flex flex-col gap-5 p-4 pt-12">
    <header className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{l(`levels.${rule.level}`)}</p>
      <SheetTitle className="text-lg break-words">{rule.name}</SheetTitle>
      <SheetDescription>{describe(rule)}</SheetDescription>
      <StatusBadge tone={rule.enabled ? "success" : "neutral"} dot label={rule.enabled ? t("on") : t("off")} />
    </header>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <section className="flex flex-col gap-2" aria-labelledby="ads-rule-preview">
      <h3 id="ads-rule-preview" className="text-sm font-semibold">{t("previewTitle")}</h3>
      {preview === null ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>
        : preview.length === 0 ? <p className="text-sm text-muted-foreground">{t("previewNone")}</p>
          : <ul className="flex flex-col divide-y rounded-lg border" data-ads-rule-preview>{preview.map((item) => <li key={item.id} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 break-words">{item.name}</span><span className="shrink-0 tabular-nums text-muted-foreground">{shown(rule.condition.metric, item.metrics[rule.condition.metric])}</span></li>)}</ul>}
    </section>
    <section className="flex flex-col gap-2" aria-labelledby="ads-rule-runs">
      <h3 id="ads-rule-runs" className="text-sm font-semibold">{t("runsTitle")}</h3>
      {runs === null ? <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>
        : runs.length === 0 ? <p className="text-sm text-muted-foreground">{t("runsNone")}</p>
          : <ul className="flex flex-col divide-y rounded-lg border">{runs.slice(0, 20).map((item) => <li key={item.id} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm">
            <span>{format.dateTime(new Date(item.ranAt), { dateStyle: "medium", timeStyle: "short" })}</span>
            <StatusBadge tone={item.outcome === "triggered" ? "warning" : "danger"} label={item.outcome === "triggered" ? t("flagged") : t("failed")} /></li>)}</ul>}
    </section>
  </div>;
}
