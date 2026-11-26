import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { StatusBadge } from "@/components/status-badge";
import { defineStatusTones } from "@/lib/status-tone";
import { eventPhase, formatDay, formatTimeRange, type EventItem } from "@/lib/event-view";
import { cn } from "@/lib/utils";

const phaseTone = defineStatusTones({ draft: "pending", cancelled: "danger", ended: "neutral", live: "success", upcoming: "info" });
const rsvpTone = defineStatusTones({ going: "success", maybe: "neutral", not_going: "neutral", waitlisted: "warning" });

/** The badges every Events screen shows for an event: where it is in time, my RSVP, and seats. Nothing is shown that the server did not send. */
export function EventBadges({ event, now, manage = false }: { event: EventItem; now: number; manage?: boolean }) {
  const t = useTranslations("Events");
  const phase = eventPhase(event, now), open = phase === "upcoming" || phase === "live";
  return <div className="flex flex-wrap items-center gap-1.5">
    {(phase !== "upcoming" || manage) && <StatusBadge tone={phaseTone(phase)} label={t(`phases.${phase}`)} dot />}
    {open && event.rsvp && event.rsvp !== "not_going" && <StatusBadge tone={rsvpTone(event.rsvp)} label={t(`rsvp.${event.rsvp}`)} />}
    {open && event.capacity !== null && event.available !== null && (event.available === 0
      ? <StatusBadge tone="warning" label={t("full")} />
      : <StatusBadge tone="neutral" label={t("seatsLeft", { count: event.available })} />)}
  </div>;
}

/** An event in a list: date tile, title, time in the event's own zone and badges. The whole card is one link of at least 44px; without `href` (the viewer has
 * no event screen to open, e.g. a campaign showing an event) it is the same card, not a link. */
export function EventCard({ event, href, now, manage = false, className }: { event: EventItem; href?: string; now: number; manage?: boolean; className?: string }) {
  const locale = useLocale();
  const [weekday, ...rest] = formatDay(event.startsAt, event.timeZone, locale).replace(",", "").split(" ");
  const cancelled = event.status === "cancelled";
  const body = <>
    <span className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-muted py-1.5 text-center" aria-hidden="true">
      <span className="text-xs text-muted-foreground uppercase">{weekday}</span>
      <span className="text-sm font-semibold">{rest.join(" ")}</span>
    </span>
    <span className="min-w-0 flex-1 space-y-1.5">
      <span className={cn("block truncate text-base font-semibold", cancelled && "line-through")}>{event.title}</span>
      <span className="block text-sm text-muted-foreground">{formatTimeRange(event, locale)}</span>
      <EventBadges event={event} now={now} manage={manage} />
    </span>
  </>;
  const frame = "flex min-h-11 items-start gap-4 rounded-xl border bg-card p-4";
  return href ? <Link href={href} prefetch={false} className={cn(frame, "outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50", className)}>{body}</Link>
    : <div className={cn(frame, className)}>{body}</div>;
}
