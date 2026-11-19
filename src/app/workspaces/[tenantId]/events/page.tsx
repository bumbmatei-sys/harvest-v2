import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarDays, Plus } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listEvents } from "@/server/events";
import { orNotFound, requireEvents, serverNow, upcomingRange } from "@/server/event-page";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { Button } from "@/components/ui/button";
import { EventsBoard } from "@/components/events/events-board";
import { monthKey, monthRange, parseMonth, type EventItem } from "@/lib/event-view";

type Props = { params: Promise<{ tenantId: string }>; searchParams: Promise<{ view?: string; month?: string }> };

// C14: the ministry's events for owners and admins, drafts included. Members see events in their communities instead.
export default async function WorkspaceEventsPage({ params, searchParams }: Props) {
  requireEvents();
  const t = await getTranslations("Events"), session = await pageSession(), { tenantId } = await params, query = await searchParams;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "communities:manage")) return <AccessState />;
  const now = serverNow(), view = query.view === "calendar" ? "calendar" : "list", month = parseMonth(query.month, new Date(now));
  const events = await orNotFound(listEvents(getDb(), session.user.id, tenantId, view === "calendar" ? monthRange(month) : upcomingRange(now))) as EventItem[];
  const base = `/workspaces/${tenantId}/events`;
  const create = <Button asChild className="min-h-11"><Link href={`${base}/new`} prefetch={false}><Plus aria-hidden="true" />{t("newEvent")}</Link></Button>;
  return <div className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><CalendarDays className="mb-4 size-5 text-muted-foreground" aria-hidden="true" /><h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1></div>
      {create}
    </div>
    <EventsBoard events={events} view={view} month={monthKey(month)} base={base} detail={base} now={now} manage emptyAction={create} />
  </div>;
}
