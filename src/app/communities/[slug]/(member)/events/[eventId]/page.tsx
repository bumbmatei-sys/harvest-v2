import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/db/client";
import { forumContext } from "@/server/community-forum";
import { getEvent } from "@/server/events";
import { orNotFound, requireEvents, serverNow } from "@/server/event-page";
import { pageSession } from "@/server/page-session";
import { EventBadges } from "@/components/events/event-card";
import { EventActions } from "@/components/events/event-actions";
import { formatLongDay, formatTimeRange, type EventItem } from "@/lib/event-view";

// C14: one event. Anything the viewer may not see (a draft, a missing id, another ministry's event) is the same 404.
export default async function EventPage({ params }: { params: Promise<{ slug: string; eventId: string }> }) {
  requireEvents();
  const session = await pageSession("personal"), { slug, eventId } = await params;
  const ctx = await forumContext(getDb(), session.user.id, slug);
  if (!ctx) redirect(`/communities/${encodeURIComponent(slug)}`);
  const event = await orNotFound(getEvent(getDb(), session.user.id, ctx.tenantId, eventId)) as EventItem;
  const t = await getTranslations("Events"), locale = await getLocale(), now = serverNow();
  return <article className="min-w-0 space-y-6 p-4 lg:p-6" aria-labelledby="event-title">
    <Link href={`/communities/${ctx.slug}/events`} prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" aria-hidden="true" />{t("title")}</Link>
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <h2 id="event-title" className="text-2xl font-semibold break-words">{event.title}</h2>
        <EventBadges event={event} now={now} />
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">{t("when")}</dt><dd className="font-medium">{formatLongDay(event.startsAt, event.timeZone, locale)}</dd><dd>{formatTimeRange(event, locale)}</dd></div>
          {event.capacity !== null && <div><dt className="text-muted-foreground">{t("seats")}</dt><dd className="font-medium">{t("seatsTotal", { count: event.capacity })}</dd></div>}
        </dl>
        {event.description && <div className="space-y-1"><h3 className="text-base font-semibold">{t("about")}</h3><p className="whitespace-pre-line break-words">{event.description}</p></div>}
      </div>
      <div className="min-w-0"><EventActions tenantId={ctx.tenantId} initial={event} now={now} /></div>
    </div>
  </article>;
}
