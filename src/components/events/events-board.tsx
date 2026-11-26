/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/calendar/components/agenda-view.tsx; code written for Harvest, no kit code copied. */
"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { getAllEventsForDay } from "@/lib/calendar-days";
import { EmptyState } from "@/components/empty-state";
import { EventCard } from "@/components/events/event-card";
import { MonthCalendar } from "@/components/events/month-calendar";
import { WeekView } from "@/components/calendar/week-view";
import { Button } from "@/components/ui/button";
import { dateKey, eventsViews, formatLongDay, groupByDay, parseDate, shiftDays, toCalendarEvents, weekStart, type CalendarEvent, type EventItem, type EventsView } from "@/lib/event-view";
import { cn } from "@/lib/utils";

export type { EventsView } from "@/lib/event-view";

/**
 * The Events tab body: upcoming list, month, week or day over the same events. The view, the month and the day are in the URL, so every view is server
 * rendered and shareable; choosing a day in the month only changes what is listed under the grid. Week and day use the shared week grid (Social and
 * Office Calendar use the same one), with each event at its own wall-clock time. `base` is the page, `detail` the detail route prefix.
 */
export function EventsBoard({ events, view, month, date, base, detail, now, manage = false, emptyAction }: {
  events: EventItem[]; view: EventsView; month: string; date?: string; base: string; detail: string; now: number; manage?: boolean; emptyAction?: React.ReactNode;
}) {
  const t = useTranslations("Events"), locale = useLocale(), router = useRouter();
  const [selected, setSelected] = useState<Date | null>(null);
  const day = parseDate(date, new Date(now));
  const href = (next: EventsView, value?: string) => next === "list" ? base : next === "calendar" ? `${base}?view=calendar&month=${value ?? month}` : `${base}?view=${next}&date=${value ?? dateKey(day)}`;
  const calendarEvents = useMemo(() => toCalendarEvents(events, now), [events, now]);
  const [year, monthIndex] = month.split("-").map(Number);
  const currentDate = new Date(year, monthIndex - 1, 1);
  const onDay = new Set(selected ? getAllEventsForDay(calendarEvents, selected).map((event) => event.id) : []);
  const dayList = events.filter((event) => onDay.has(event.id));
  const card = (event: EventItem) => <li key={event.id}><EventCard event={event} href={`${detail}/${event.id}`} now={now} manage={manage} /></li>;
  const switcher = <nav aria-label={t("viewLabel")} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-[3px]">
    {eventsViews.map((item) => <Link key={item} href={href(item)} prefetch={false} aria-current={view === item ? "page" : undefined}
      className={cn("inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-4 lg:min-h-9", view === item ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t(item === "calendar" ? "month" : item)}</Link>)}
  </nav>;
  const time = (value: Date) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(value);
  const line = (event: CalendarEvent) => <>
    <span className={cn("truncate font-medium", event.status === "cancelled" && "line-through")}>{event.title}</span>
    <span className="truncate text-muted-foreground">{time(event.start)}</span>
  </>;
  const grid = () => {
    const first = view === "week" ? weekStart(day) : day, step = view === "week" ? 7 : 1;
    const title = view === "week"
      ? new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).formatRange(first, shiftDays(first, 6))
      : new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(first);
    return <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" className="size-11 lg:size-9"><Link href={href(view, dateKey(shiftDays(first, -step)))} prefetch={false} aria-label={t(view === "week" ? "previousWeek" : "previousDay")}><ChevronLeft aria-hidden="true" /></Link></Button>
        <Button asChild variant="outline" size="icon" className="size-11 lg:size-9"><Link href={href(view, dateKey(shiftDays(first, step)))} prefetch={false} aria-label={t(view === "week" ? "nextWeek" : "nextDay")}><ChevronRight aria-hidden="true" /></Link></Button>
        <Button asChild variant="outline" className="min-h-11 lg:min-h-9"><Link href={href(view, dateKey(new Date(now)))} prefetch={false}>{t("today")}</Link></Button>
        <h2 className="min-w-0 text-base font-semibold" aria-live="polite">{title}</h2>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card"><div tabIndex={0} role="region" aria-label={t(view === "week" ? "weekGrid" : "dayGrid")} className="max-h-[42rem] overflow-y-auto outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <WeekView mode={view === "day" ? "day" : "week"} currentDate={first} events={calendarEvents} label={t(view === "week" ? "weekGrid" : "dayGrid")} zoneLabel={t("eventTime")}
          renderChip={line} onEventSelect={(event) => router.push(`${detail}/${event.id}`)} allDay={{ label: t("allDay"), render: (event) => <span className="truncate">{event.title}</span> }}
          overlap={{ moreLabel: (count) => t("moreAtTime", { count }), moreText: (count) => `+${count}`, title: t("sameTime"), renderRow: (event) => <span className="flex min-w-0 flex-col">{line(event)}</span> }} />
      </div></div>
      {events.length === 0 && <p className="text-sm text-muted-foreground">{t(view === "week" ? "emptyWeek" : "emptyDay")}</p>}
    </div>;
  };
  return <div className="min-w-0 space-y-4">
    {switcher}
    {view === "list" ? (events.length === 0
      ? <EmptyState icon={CalendarDays} title={t(manage ? "emptyManage" : "emptyUpcoming")} action={emptyAction} />
      : <div className="space-y-6">{groupByDay(events).map((group) => <section key={group.key} aria-labelledby={`day-${group.key}`} className="space-y-2">
          <h2 id={`day-${group.key}`} className="text-sm font-medium text-muted-foreground">{formatLongDay(group.events[0].startsAt, group.events[0].timeZone, locale)}</h2>
          <ul className="space-y-2">{group.events.map(card)}</ul></section>)}</div>)
      : view === "calendar" ? <div className="space-y-4">
        <MonthCalendar currentDate={currentDate} events={calendarEvents} selectedDay={selected} onDaySelect={setSelected}
          monthHref={(m) => href("calendar", m)} />
        <section aria-live="polite" aria-labelledby="selected-day" className="space-y-2">
          <h2 id="selected-day" className="text-sm font-medium text-muted-foreground">{selected ? format(selected, "EEEE, MMMM d") : t("selectDay")}</h2>
          {selected && (dayList.length === 0 ? <p className="text-sm text-muted-foreground">{t("emptyDay")}</p> : <ul className="space-y-2">{dayList.map(card)}</ul>)}
        </section>
      </div> : grid()}
  </div>;
}
