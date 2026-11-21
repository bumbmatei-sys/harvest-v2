"use client";
import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useRuleLabels } from "@/components/social/auto-dm/rule-labels";
import type { AutoDmRuleView } from "@/lib/social/auto-dm-api";
import { promotionalFlags, ruleTemplates } from "@/lib/social/auto-dm-ui";

/**
 * Template review: every template of every rule with its service-only confirmation and the automatic promotional-wording flag. The confirmation is part of
 * the rule revision (who confirmed which version is in the audit log); editing a template asks for it again. The flag is advisory and is not a legal review.
 */
export function TemplatesPanel({ tenantId, rules }: { tenantId: string; rules: readonly AutoDmRuleView[] }) {
  const t = useTranslations("SocialAutoDm.templates"), labels = useRuleLabels(), base = `/workspaces/${tenantId}/social/auto-dm`;
  if (rules.length === 0) return <EmptyState icon={FileCheck2} solid title={t("emptyTitle")} description={t("empty")} />;
  return <section aria-label={t("title")} className="space-y-3" data-testid="templates-panel">
    <p className="text-sm text-muted-foreground">{t("lead")}</p>
    <ul className="space-y-3">{rules.flatMap((rule) => ruleTemplates(rule).map((item) => {
      const flags = promotionalFlags(item.text), confirmed = rule.purpose === "service" ? rule.serviceOnly : null;
      return <li key={`${rule.id}-${item.kind}`} className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[minmax(0,1fr)_auto]" data-testid="template-row" data-flagged={flags.length > 0 || undefined}>
        <div className="min-w-0 space-y-1.5"><p className="flex flex-wrap items-center gap-x-2 text-sm"><span className="font-medium">{rule.name}</span><span className="text-xs text-muted-foreground">{t(`kinds.${item.kind}`)} · {t("version", { version: rule.version })}</span></p>
          <p className="line-clamp-3 text-sm whitespace-pre-wrap break-words text-muted-foreground">{item.text}</p></div>
        <div className="flex flex-wrap items-start gap-2 md:flex-col md:items-end">
          {confirmed === null ? <StatusBadge tone="info" label={labels.purpose(rule.purpose)} /> : <StatusBadge tone={confirmed ? "success" : "danger"} label={confirmed ? t("confirmed") : t("notConfirmed")} />}
          {flags.length > 0 ? <StatusBadge tone="warning" dot label={t("flagged", { words: flags.join(", ") })} /> : <StatusBadge tone="neutral" label={t("clear")} />}
          <Button asChild variant="outline" size="responsive"><Link href={`${base}/${rule.id}#response`} prefetch={false}>{t("review")}</Link></Button></div>
      </li>; }))}</ul>
  </section>;
}
