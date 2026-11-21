"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TabNav } from "@/components/social/auto-dm/tab-nav";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { AutoDmHeader } from "@/components/social/auto-dm/auto-dm-header";
import { HardOffNotice } from "@/components/social/auto-dm/hard-off-notice";
import { RuleActivity } from "@/components/social/auto-dm/rule-activity";
import { RuleEditor } from "@/components/social/auto-dm/rule-editor";
import { useAutoDmData } from "@/components/social/auto-dm/use-auto-dm";
import { SearchX, UserCog } from "lucide-react";

/** One rule: its settings in the editor and its activity, or the new-rule editor when `ruleId` is null. A rule that is not visible to this person reads as not found. */
export function RuleScreen({ tenantId, ruleId, you }: { tenantId: string; ruleId: string | null; you: { id: string; name: string } }) {
  const t = useTranslations("SocialAutoDm"), router = useRouter(), pathname = usePathname(), params = useSearchParams(), data = useAutoDmData(tenantId), [stamp, setStamp] = useState(0);
  const tab = params.get("tab") === "activity" && ruleId ? "activity" : "settings";
  const setTab = useCallback((next: string) => router.replace(next === "activity" ? `${pathname}?tab=activity` : pathname, { scroll: false }), [pathname, router]);
  const back = <Button asChild variant="ghost" size="responsive"><Link href={`/workspaces/${tenantId}/social/auto-dm`} prefetch={false}><ArrowLeft aria-hidden="true" />{t("back")}</Link></Button>;
  const frame = (body: React.ReactNode, title?: string) => <div className="min-w-0 space-y-4" data-testid="auto-dm-rule"><AutoDmHeader title={title}>{back}</AutoDmHeader>{body}</div>;
  if (data.state === "loading") return <div className="space-y-4" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (data.state === "unavailable") return frame(<EmptyState icon={ShieldAlert} solid title={t("unavailableTitle")} description={t("unavailable")} />);
  if (data.state === "error") return frame(<Alert variant="destructive" role="alert"><AlertDescription>{t("loadFailed")} <Button type="button" variant="link" onClick={data.reload}>{t("retry")}</Button></AlertDescription></Alert>);
  const existing = ruleId ? data.rules.find((rule) => rule.id === ruleId) ?? null : null;
  if (ruleId && !existing) return frame(<EmptyState icon={SearchX} solid title={t("notFoundTitle")} description={t("notFound")} />);
  if (!existing && data.accounts.length === 0) return frame(<EmptyState icon={UserCog} solid title={t("noAccountsTitle")} description={t("noAccounts")}
    action={<Button asChild size="responsive"><Link href={`/workspaces/${tenantId}/social/accounts`} prefetch={false}>{t("goToAccounts")}</Link></Button>} />);
  return <div className="min-w-0 space-y-4" data-testid="auto-dm-rule">
    <AutoDmHeader title={existing ? existing.name : t("newRule")} subtitle={existing ? t("rule.subtitle", { version: existing.version }) : t("rule.newSubtitle")}>
      {existing && <StatusBadge tone={existing.enabled ? "success" : "neutral"} dot label={existing.enabled ? t("list.on") : t("list.off")} />}{back}</AutoDmHeader>
    <HardOffNotice />
    {existing && <TabNav label={t("rule.tabs")} value={tab} onChange={setTab} items={[{ value: "settings", label: t("rule.settings") }, { value: "activity", label: t("rule.activity") }]} />}
    {tab === "activity" && existing ? <RuleActivity tenantId={tenantId} ruleId={existing.id} stamp={stamp} />
      : <RuleEditor key={existing ? `${existing.id}` : "new"} tenantId={tenantId} you={you} existing={existing} accounts={data.accounts} onChanged={(rule) => { data.replace(rule); setStamp((value) => value + 1); }} />}
  </div>;
}
