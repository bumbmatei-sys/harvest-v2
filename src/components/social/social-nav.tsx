"use client";
import Link from "next/link";
import { CalendarClock, FileText, ListOrdered, PenLine, Settings2, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Schedule } from "@/lib/social/api";
import { cn } from "@/lib/utils";

export type SocialTab = "compose" | "calendar" | "queue";
/**
 * The Planner's page header, as in the founder's first version: the title with a one-line subtitle, and the three tabs Compose, Calendar and Queue
 * (links, so each stays a page of its own). Analytics is not shown until it is built. The sidebar has one row, Planner; these are its own tabs.
 */
export function SocialHeader({ tenantId, active, zone, children }: { tenantId: string; active: SocialTab; zone: string; children?: React.ReactNode }) {
  const t = useTranslations("SocialPublish.nav"), base = `/workspaces/${tenantId}/social`;
  const tabs: { id: SocialTab; href: string; label: string; icon: typeof PenLine }[] = [
    { id: "compose", href: `${base}/compose`, label: t("compose"), icon: PenLine },
    { id: "calendar", href: `${base}/planner?view=calendar`, label: t("calendar"), icon: CalendarClock },
    { id: "queue", href: `${base}/planner?view=queue`, label: t("queue"), icon: ListOrdered },
  ];
  return <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
    <div className="min-w-0"><h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("subtitle", { zone })}</p></div>
    <div className="flex min-w-0 flex-wrap items-center gap-3 max-sm:w-full">
      <nav aria-label={t("label")} className="inline-flex rounded-lg bg-muted p-[3px]">
        {tabs.map(({ id, href, label, icon: Icon }) => <Link key={id} href={href} prefetch={false} aria-current={active === id ? "page" : undefined}
          className={cn("inline-flex min-h-11 items-center gap-2 rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9", active === id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          <Icon className="size-4" aria-hidden="true" />{label}</Link>)}
      </nav>
      <Button asChild variant="outline" size="responsive"><Link href={`${base}/accounts`} prefetch={false}><UserCog aria-hidden="true" />{t("accounts")}</Link></Button>
      {children}
    </div>
  </header>;
}

/** The posting-schedule switcher, the schedule manager and the Drafts button with its count; `children` are the page's own actions. */
export function SocialToolbar({ schedules, schedule, onSchedule, onManage, draftCount, onDrafts, children }: {
  schedules: readonly Schedule[]; schedule: string; onSchedule: (id: string) => void; onManage: () => void; draftCount: number; onDrafts: () => void; children?: React.ReactNode;
}) {
  const t = useTranslations("SocialPublish.nav");
  return <div className="flex flex-wrap items-center justify-between gap-2" data-testid="social-toolbar">
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect value={schedule} onChange={(event) => onSchedule(event.target.value)} className="min-h-11 w-auto min-w-44 lg:min-h-9" aria-label={t("schedule")}>
        <NativeSelectOption value="">{t("allSchedules")}</NativeSelectOption>
        {schedules.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect>
      <Button type="button" variant="outline" size="icon-responsive" aria-label={t("manageSchedules")} onClick={onManage}><Settings2 aria-hidden="true" /></Button>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="responsive" onClick={onDrafts}><FileText aria-hidden="true" />{t("drafts")}<span className="rounded-full bg-muted px-1.5 text-xs tabular-nums" data-testid="draft-count">{draftCount}</span></Button>
      {children}
    </div>
  </div>;
}
