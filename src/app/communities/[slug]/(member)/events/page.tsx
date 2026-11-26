import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { forumContext } from "@/server/community-forum";
import { listEvents } from "@/server/events";
import { orNotFound, requireEvents, serverNow, upcomingRange } from "@/server/event-page";
import { pageSession } from "@/server/page-session";
import { EventsBoard } from "@/components/events/events-board";
import { dateKey, monthKey, parseDate, parseEventsView, parseMonth, viewRange, type EventItem } from "@/lib/event-view";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string; month?: string; date?: string }> };

// C14: the community Events tab. Upcoming list or month calendar over the events this member can see; the server decides which those are.
export default async function EventsPage({ params, searchParams }: Props) {
  requireEvents();
  const session = await pageSession("personal"), { slug } = await params, query = await searchParams;
  const ctx = await forumContext(getDb(), session.user.id, slug);
  if (!ctx) redirect(`/communities/${encodeURIComponent(slug)}`);
  const now = serverNow(), view = parseEventsView(query.view), month = parseMonth(query.month, new Date(now)), date = parseDate(query.date, new Date(now));
  const range = viewRange(view, month, date) ?? upcomingRange(now);
  const events = await orNotFound(listEvents(getDb(), session.user.id, ctx.tenantId, range)) as EventItem[];
  const t = await getTranslations("Events"), base = `/communities/${ctx.slug}/events`;
  return <section className="min-w-0 space-y-4 p-4 lg:p-6" aria-labelledby="events-title">
    <h2 id="events-title" className="text-xl font-semibold">{t(view === "list" ? "upcoming" : "calendar")}</h2>
    <EventsBoard events={events} view={view} month={monthKey(month)} date={dateKey(date)} base={base} detail={base} now={now} />
  </section>;
}
