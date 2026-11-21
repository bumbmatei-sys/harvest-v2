"use client";
import { sym } from "@/lib/social/auto-dm-ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/social/platform-logo";
import { StatusBadge } from "@/components/status-badge";
import { useRuleLabels } from "@/components/social/auto-dm/rule-labels";
import { formatWhen } from "@/components/social/auto-dm/rule-activity";
import type { RuleStats } from "@/components/social/auto-dm/use-auto-dm";
import type { AutoDmAccountView, AutoDmRuleView } from "@/lib/social/auto-dm-api";
import { platformLabels } from "@/lib/social/labels";

const accountOk = (account: AutoDmAccountView | undefined) => !!account && account.status === "active" && account.health !== "failing";
/** One rule in the list: platform mark, name, trigger and scope, counts, last activity and the on or off switch (turning on opens the enable review). */
export function RuleRow({ tenantId, rule, account, stats, busy, onSwitch }: {
  tenantId: string; rule: AutoDmRuleView; account: AutoDmAccountView | undefined; stats: RuleStats | undefined; busy: boolean; onSwitch: (rule: AutoDmRuleView, next: boolean) => void;
}) {
  const t = useTranslations("SocialAutoDm.list"), labels = useRuleLabels(), base = `/workspaces/${tenantId}/social/auto-dm/${rule.id}`;
  const counts: [string, number | null][] = [["triggered", stats?.state === "ready" ? stats.totals.triggered : null], ["sent", stats?.state === "ready" ? stats.totals.sent : null],
    ["skipped", stats?.state === "ready" ? stats.totals.skippedTotal : null], ["handedOff", stats?.state === "ready" ? stats.totals.handedOff : null]];
  return <li className="rounded-xl border bg-card" data-testid="rule-row" data-rule-id={rule.id} data-enabled={rule.enabled}>
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_auto] lg:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">{account ? <PlatformLogo colored platform={account.platform} className="size-4" /> : null}</span>
        <div className="min-w-0 space-y-1">
          <Link href={base} prefetch={false} className="block truncate font-medium outline-none hover:underline focus-visible:underline">{rule.name}</Link>
          <p className="text-xs text-muted-foreground">{[labels.trigger(rule.trigger), labels.scope(rule), account ? account.name ?? platformLabels[account.platform] : t("accountMissing")].join(sym.dot)}</p>
          {rule.match.keywords.length > 0 && <ul className="flex flex-wrap gap-1" aria-label={t("keywords")}>{rule.match.keywords.slice(0, 3).map((word) => <li key={word} className="rounded-md border px-1.5 py-0.5 text-xs">{word}</li>)}
            {rule.match.keywords.length > 3 && <li className="px-1 py-0.5 text-xs text-muted-foreground">{sym.plus}{rule.match.keywords.length - 3}</li>}</ul>}
        </div>
      </div>
      <div className="min-w-0 space-y-1.5">
        <dl className="grid grid-cols-4 gap-2 text-center sm:text-left">{counts.map(([key, value]) => <div key={key} data-testid={`row-count-${key}`}><dt className="text-[11px] text-muted-foreground">{t(`counts.${key}`)}</dt>
          <dd className="text-sm font-medium tabular-nums">{value === null ? (stats?.state === "error" ? sym.dash : sym.pending) : value}</dd></div>)}</dl>
        <p className="text-xs text-muted-foreground" data-testid="row-last">{stats?.state === "ready" ? (stats.lastAt ? t("last", { when: formatWhen(stats.lastAt) }) : t("never")) : " "}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {!accountOk(account) && <StatusBadge tone="warning" label={t("accountAttention")} />}
        <label className="inline-flex min-h-11 items-center gap-2 lg:min-h-9"><StatusBadge tone={rule.enabled ? "success" : "neutral"} dot label={rule.enabled ? t("on") : t("off")} />
          <Switch checked={rule.enabled} disabled={busy} aria-label={t("switch", { name: rule.name })} onCheckedChange={(next) => onSwitch(rule, next)} /></label>
        <Button asChild variant="outline" size="responsive"><Link href={base} prefetch={false}>{t("edit")}</Link></Button>
        <Button asChild variant="ghost" size="responsive"><Link href={`${base}?tab=activity`} prefetch={false}>{t("activity")}</Link></Button>
      </div>
    </div>
  </li>;
}
