"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Activity } from "lucide-react";
import { autoDmApi, type ActivityRow, type JobCount, type JobState } from "@/lib/social/auto-dm-api";
import { summarize } from "@/lib/social/auto-dm-ui";
import type { StatusTone } from "@/lib/status-tone";

const tone: Record<JobState, StatusTone> = { queued: "pending", leased: "pending", dispatching: "pending", unknown: "warning", sent: "success", skipped: "neutral", handed_off: "info", cancelled: "neutral" };
export const formatWhen = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Counts and the activity log of one rule: fixed outcome codes, versions and times only. Message text and names are never stored, so none is shown. */
export function RuleActivity({ tenantId, ruleId, stamp }: { tenantId: string; ruleId: string; stamp: number }) {
  const t = useTranslations("SocialAutoDm.activity"), api = useMemo(() => autoDmApi(tenantId), [tenantId]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading"), [counts, setCounts] = useState<JobCount[]>([]), [rows, setRows] = useState<ActivityRow[]>([]);
  const [more, setMore] = useState(false), [older, setOlder] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api.report(ruleId, null, controller.signal).then((report) => { setCounts(report.counts); setRows(report.activity); setMore(report.activity.length === 50); setState("ready"); })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [api, ruleId, stamp]);
  const loadOlder = useCallback(async () => {
    const last = rows.at(-1); if (!last) return; setOlder(true);
    try { const report = await api.report(ruleId, last.createdAt); setRows((current) => [...current, ...report.activity]); setMore(report.activity.length === 50); } catch { setState("error"); } finally { setOlder(false); }
  }, [api, ruleId, rows]);
  if (state === "loading") return <div className="space-y-3" aria-busy="true"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (state === "error") return <Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")}</AlertDescription></Alert>;
  const totals = summarize(counts);
  const tiles: [string, number][] = [["triggered", totals.triggered], ["sent", totals.sent], ["skipped", totals.skippedTotal], ["handedOff", totals.handedOff], ["inProgress", totals.inProgress + totals.unknown]];
  return <div className="space-y-4" data-testid="rule-activity">
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">{tiles.map(([key, value]) => <div key={key} className="rounded-lg border bg-card p-3" data-testid={`count-${key}`}>
      <dt className="text-xs text-muted-foreground">{t(`counts.${key}`)}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd></div>)}</dl>
    {totals.skippedTotal > 0 && <div><h3 className="mb-1.5 text-sm font-medium">{t("skippedBy")}</h3><ul className="flex flex-wrap gap-2" data-testid="skipped-reasons">
      {(Object.entries(totals.skipped) as [string, number][]).filter(([, value]) => value > 0).map(([reason, value]) => <li key={reason} className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">{t(`reasons.${reason}`)} <span className="tabular-nums font-medium">{value}</span></li>)}</ul></div>}
    {rows.length === 0 ? <EmptyState icon={Activity} size="compact" solid title={t("emptyTitle")} description={t("empty")} /> : <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[34rem] text-sm" data-testid="activity-log"><caption className="sr-only">{t("log")}</caption>
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="px-3 py-2 font-medium">{t("when")}</th><th scope="col" className="px-3 py-2 font-medium">{t("step")}</th><th scope="col" className="px-3 py-2 font-medium">{t("result")}</th><th scope="col" className="px-3 py-2 font-medium">{t("reason")}</th><th scope="col" className="px-3 py-2 font-medium">{t("version")}</th><th scope="col" className="px-3 py-2 font-medium">{t("event")}</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0" data-state={row.state}>
          <td className="px-3 py-2 whitespace-nowrap">{formatWhen(row.createdAt)}</td><td className="px-3 py-2">{t(`steps.${row.step}`)}</td>
          <td className="px-3 py-2"><StatusBadge tone={tone[row.state]} label={t(`states.${row.state}`)} /></td>
          <td className="px-3 py-2">{row.reason ? t(`reasons.${row.reason}`) : "-"}</td><td className="px-3 py-2 tabular-nums">{row.version}</td><td className="px-3 py-2 font-mono text-xs">{row.eventId.slice(0, 8)}</td></tr>)}</tbody></table></div>}
    {more && <Button type="button" variant="outline" size="responsive" aria-disabled={older || undefined} onClick={() => { if (!older) void loadOlder(); }}>{t("older")}</Button>}
    <p className="text-xs text-muted-foreground">{t("privacy")}</p>
  </div>;
}
