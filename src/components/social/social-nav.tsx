"use client";
import Link from "next/link";
import { CalendarClock, FileText, ListOrdered, PenLine, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Schedule } from "@/lib/social/api";
import { cn } from "@/lib/utils";

export type SocialTab = "create" | "queue" | "calendar";
/**
 * The shared header of Compose, Queue and Calendar: the three tabs (as links, so each stays a page of its own), the posting-schedule switcher and
 * the Drafts button with its count. Analytics is not shown until it is built.
 */
export function SocialNav({ tenantId, active, schedules, schedule, onSchedule, onManage, draftCount, onDrafts }: {
  tenantId: string; active: SocialTab; schedules: readonly Schedule[]; schedule: string; onSchedule: (id: string) => void; onManage: () => void; draftCount: number; onDrafts: () => void;
}) {
  const t = useTranslations("SocialPublish.nav"), base = `/workspaces/${tenantId}/social`;
  const tabs: { id: SocialTab; href: string; label: string; icon: typeof PenLine }[] = [
    { id: "create", href: `${base}/compose`, label: t("create"), icon: PenLine },
    { id: "queue", href: `${base}/planner?view=queue`, label: t("queue"), icon: ListOrdered },
    { id: "calendar", href: `${base}/planner?view=calendar`, label: t("calendar"), icon: CalendarClock },
  ];
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <nav aria-label={t("label")} className="inline-flex rounded-lg bg-muted p-[3px]">
      {tabs.map(({ id, href, label, icon: Icon }) => <Link key={id} href={href} prefetch={false} aria-current={active === id ? "page" : undefined}
        className={cn("inline-flex min-h-11 items-center gap-2 rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9", active === id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
        <Icon className="size-4" aria-hidden="true" />{label}</Link>)}
    </nav>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm"><span className="sr-only sm:not-sr-only text-muted-foreground">{t("schedule")}</span>
        <NativeSelect value={schedule} onChange={(event) => onSchedule(event.target.value)} className="min-h-11 w-auto min-w-40 lg:min-h-9" aria-label={t("schedule")}>
          <NativeSelectOption value="">{t("allSchedules")}</NativeSelectOption>
          {schedules.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect></label>
      <Button type="button" variant="outline" size="icon-responsive" aria-label={t("manageSchedules")} onClick={onManage}><Settings2 aria-hidden="true" /></Button>
      <Button type="button" variant="outline" size="responsive" onClick={onDrafts}><FileText aria-hidden="true" />{t("drafts")}<span className="rounded-full bg-muted px-1.5 text-xs tabular-nums" data-testid="draft-count">{draftCount}</span></Button>
    </div>
  </div>;
}
