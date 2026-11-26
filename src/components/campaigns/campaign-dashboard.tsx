import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CampaignOverview } from "@/server/campaign-overview";

/**
 * The campaign dashboard for people who set the campaign up: what the finished draft configured (departments, who leads and who joined, the tools that
 * are on) as stat cards and a staffing bar per department, plus the setup checklist progress. Only figures that exist are shown. Progress, events,
 * funding and tasks are not recorded anywhere yet, so they are listed as not available, never as zero. No donor, response or Connect data appears.
 * Colours are the theme's own: surface and border tokens, with the brand token for the bars.
 */
const digitsOf = (currency: string) => { try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; } };

export async function CampaignDashboard({ overview, connectHref, formHref }: { overview: CampaignOverview; connectHref: string; formHref: string | null }) {
  const t = await getTranslations("CampaignDashboard"), tw = await getTranslations("CampaignWizard"), format = await getFormatter();
  const config = overview.configuration;
  const staffed = config ? config.departments.filter((department) => department.leaders.length > 0).length : 0;
  const people = config ? config.departments.reduce((total, department) => total + department.leaders.length + department.members.length, 0) : 0;
  const stats: [string, string, string?][] = config ? [
    [t("departments"), String(config.departments.length)],
    [t("leadersAssigned"), t("ofTotal", { done: staffed, total: config.departments.length })],
    [t("peoplePlaced"), String(people)],
    [t("toolsOn"), t("ofTotal", { done: config.modules.length, total: 18 })],
    [t("setup"), t("ofTotal", { done: overview.checklist.done, total: overview.checklist.total })],
  ] : [[t("setup"), t("ofTotal", { done: overview.checklist.done, total: overview.checklist.total })]];
  const amount = (minor: number | null) => minor === null || !config ? t("notSet") : format.number(minor / 10 ** digitsOf(config.budget.currency), { style: "currency", currency: config.budget.currency });
  const widest = config ? Math.max(1, ...config.departments.map((department) => department.leaders.length + department.members.length)) : 1;
  return <section aria-labelledby="campaign-dashboard-title" className="space-y-4">
    <h2 id="campaign-dashboard-title" className="text-base font-semibold">{t("title")}</h2>
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label={t("title")}>
      {stats.map(([label, value]) => <li key={label}><Card className="h-full gap-0 py-0"><CardContent className="space-y-1 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{value}</p></CardContent></Card></li>)}
    </ul>
    {config ? <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle><h3 className="text-sm font-semibold">{t("teams")}</h3></CardTitle><CardDescription>{t("teamsDescription")}</CardDescription></CardHeader>
        <CardContent>{config.departments.length ? <ul className="space-y-3">{config.departments.map((department) => {
          const count = department.leaders.length + department.members.length;
          return <li key={department.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3"><span className="min-w-0 break-words text-sm font-medium">{tw(`departments.${department.key}` as "departments.volunteers")}</span><span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t("people", { count })}</span></div>
            <div role="img" aria-label={t("barLabel", { count })} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((count / widest) * 100)}%` }} /></div>
            <p className="break-words text-xs text-muted-foreground">{[department.leaders.length ? t("leaders", { names: department.leaders.join(", ") || t("aMember") }) : t("noLeader"), department.pending ? t("pending", { count: department.pending }) : ""].filter(Boolean).join(" · ")}</p>
          </li>;
        })}</ul> : <p className="text-sm text-muted-foreground">{t("noDepartments")}</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle><h3 className="text-sm font-semibold">{t("tools")}</h3></CardTitle><CardDescription>{t("toolsDescription")}</CardDescription></CardHeader>
        <CardContent>{config.modules.length ? <ul className="flex flex-wrap gap-2">{config.modules.map((key) => <li key={key} className="rounded-md border bg-muted/40 px-2 py-1 text-sm">{tw(`modules.${key}` as "modules.tasks_boards")}</li>)}</ul> : <p className="text-sm text-muted-foreground">{t("noTools")}</p>}</CardContent></Card>
    </div> : <p className="text-sm text-muted-foreground">{t("noConfiguration")}</p>}
    {config && <Card><CardHeader><CardTitle><h3 className="text-sm font-semibold">{t("budget")}</h3></CardTitle><CardDescription>{t("budgetDescription")}</CardDescription></CardHeader>
      <CardContent><dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([
        [t("estimated"), amount(config.budget.estimatedBudgetMinor)], [t("fundraising"), t(config.budget.fundraisingEnabled ? "on" : "off")],
        [t("goal"), config.budget.fundraisingEnabled ? amount(config.budget.fundraisingGoalMinor) : t("notSet")], [t("online"), t(config.budget.onlineDonations ? "on" : "off")],
      ] as [string, string][]).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>)}</dl></CardContent></Card>}
    {config && <Card><CardHeader><CardTitle><h3 className="text-sm font-semibold">{t("connect")}</h3></CardTitle><CardDescription>{t("connectDescription")}</CardDescription></CardHeader>
      <CardContent className="space-y-3">{config.connect.length ? <ul className="flex flex-wrap gap-2">{config.connect.map((key) => <li key={key} className="rounded-md border bg-muted/40 px-2 py-1 text-sm">{tw(`connect.options.${key}` as "connect.options.registration")}</li>)}</ul> : <p className="text-sm text-muted-foreground">{t("noConnect")}</p>}
        {config.connect.includes("registration") && (config.registrationFormId
          ? (formHref ? <Button asChild variant="outline" className="min-h-11"><Link href={`${formHref}/${config.registrationFormId}`}>{t("openForm")}</Link></Button> : <p className="text-sm text-muted-foreground">{t("formCreated")}</p>)
          : <p className="text-sm text-muted-foreground">{t("noForm")}</p>)}
        {config.connect.includes("qrResponse") && <Button asChild variant="outline" className="min-h-11"><Link href={connectHref}>{t("openLinks")}</Link></Button>}</CardContent></Card>}
    <Card><CardHeader><CardTitle><h3 className="text-sm font-semibold">{t("notYet")}</h3></CardTitle><CardDescription>{t("notYetDescription")}</CardDescription></CardHeader>
      <CardContent><ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">{overview.unavailable.map((key) => <li key={key} className="rounded-lg border border-dashed p-3"><p className="text-xs text-muted-foreground">{t(`unavailable.${key}`)}</p><p className="mt-1 text-sm">{t("notAvailable")}</p></li>)}</ul></CardContent></Card>
  </section>;
}
