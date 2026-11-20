/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/calendar/components/agenda-view.tsx; code written for Harvest, no kit code copied. */
"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { getAllEventsForDay } from "@/lib/calendar-days";
import { EmptyState } from "@/components/empty-state";
import { EventCard } from "@/components/events/event-card";
import { MonthCalendar } from "@/components/events/month-calendar";
import { formatLongDay, groupByDay, toCalendarEvents, type EventItem } from "@/lib/event-view";
import { cn } from "@/lib/utils";

export type EventsView = "list" | "calendar";

/**
 * The Events tab body: upcoming list or month calendar over the same events. The view and the month are in the URL, so both are server
 * rendered and shareable; choosing a day only changes what is listed under the grid. `base` is the page, `detail` the detail route prefix.
 */
export function EventsBoard({ events, view, month, base, detail, now, manage = false, emptyAction }: {
  events: EventItem[]; view: EventsView; month: string; base: string; detail: string; now: number; manage?: boolean; emptyAction?: React.ReactNode;
}) {
  const t = useTranslations("Events"), locale = useLocale();
  const [selected, setSelected] = useState<Date | null>(null);
  const href = (next: EventsView, m?: string) => next === "list" ? base : `${base}?view=calendar&month=${m ?? month}`;
  const calendarEvents = useMemo(() => toCalendarEvents(events, now), [events, now]);
  const [year, monthIndex] = month.split("-").map(Number);
  const currentDate = new Date(year, monthIndex - 1, 1);
  const onDay = new Set(selected ? getAllEventsForDay(calendarEvents, selected).map((event) => event.id) : []);
  const dayList = events.filter((event) => onDay.has(event.id));
  const card = (event: EventItem) => <li key={event.id}><EventCard event={event} href={`${detail}/${event.id}`} now={now} manage={manage} /></li>;
  const switcher = <nav aria-label={t("viewLabel")} className="inline-flex rounded-lg bg-muted p-[3px]">
    {(["list", "calendar"] as const).map((item) => <Link key={item} href={href(item)} prefetch={false} aria-current={view === item ? "page" : undefined}
      className={cn("inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9", view === item ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t(item)}</Link>)}
  </nav>;
  return <div className="min-w-0 space-y-4">
    {switcher}
    {view === "list" ? (events.length === 0
      ? <EmptyState icon={CalendarDays} title={t(manage ? "emptyManage" : "emptyUpcoming")} action={emptyAction} />
      : <div className="space-y-6">{groupByDay(events).map((group) => <section key={group.key} aria-labelledby={`day-${group.key}`} className="space-y-2">
          <h2 id={`day-${group.key}`} className="text-sm font-medium text-muted-foreground">{formatLongDay(group.events[0].startsAt, group.events[0].timeZone, locale)}</h2>
          <ul className="space-y-2">{group.events.map(card)}</ul></section>)}</div>)
      : <div className="space-y-4">
        <MonthCalendar currentDate={currentDate} events={calendarEvents} selectedDay={selected} onDaySelect={setSelected}
          monthHref={(m) => href("calendar", m)} />
        <section aria-live="polite" aria-labelledby="selected-day" className="space-y-2">
          <h2 id="selected-day" className="text-sm font-medium text-muted-foreground">{selected ? format(selected, "EEEE, MMMM d") : t("selectDay")}</h2>
          {selected && (dayList.length === 0 ? <p className="text-sm text-muted-foreground">{t("emptyDay")}</p> : <ul className="space-y-2">{dayList.map(card)}</ul>)}
        </section>
      </div>}
  </div>;
}
