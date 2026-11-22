/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/calendar/components/month-view.tsx. Harvest changes: docs/ui-sources.md. */
"use client";
import React, { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek
} from "date-fns";

import { getAllEventsForDay, getEventsForDay, getSpanningEventsForDay, sortEvents } from "@/lib/calendar-days";
import { monthKey, shiftMonth, type CalendarEvent } from "@/lib/event-view";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onDaySelect: (day: Date) => void;
  selectedDay: Date | null;
  monthHref: (month: string) => string;
  /** Message namespace for the header, day and overflow labels (previousMonth, nextMonth, dayCell, moreEvents). Events by default. */
  namespace?: "Events" | "SocialPublish.planner" | "OfficeCalendar.month";
  /** Replaces the text of a chip (Social shows a platform mark and the post text). */
  renderChip?: (event: CalendarEvent) => React.ReactNode;
  /** Makes chips draggable and days drop targets: `onDropOnDay` receives the day and what was dropped (an event id, or a draft). */
  onDropOnDay?: (day: Date, data: DataTransfer) => void;
  /** First day of the week: 0 Sunday (Events default), 1 Monday (Social, like its week view). */
  weekStartsOn?: 0 | 1;
  /** Hides the built-in month header (title and previous or next links) when the page supplies its own toolbar (Office Calendar). */
  hideHeader?: boolean;
}

export function MonthCalendar({ currentDate, events, onDaySelect, selectedDay, monthHref, namespace = "Events", renderChip, onDropOnDay, weekStartsOn = 0, hideHeader = false }: MonthViewProps) {
  const t = useTranslations(namespace as "Events");
  const days = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn });

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentDate, weekStartsOn]);

  const weekdays = useMemo(() => {
    return Array.from({ length: 7 }).map((_, i) => {
      const date = addDays(startOfWeek(new Date(2024, 0, 7), { weekStartsOn }), i);
      return format(date, "EEE");
    });
  }, [weekStartsOn]);

  const weeks = useMemo(() => {
    const result = [];
    let week = [];

    for (let i = 0; i < days.length; i++) {
      week.push(days[i]);
      if (week.length === 7 || i === days.length - 1) {
        result.push(week);
        week = [];
      }
    }

    return result;
  }, [days]);

  // "Today" is only known in the browser: it is applied after the first render so the page never mismatches.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  return (
    <div data-slot="month-view" className="min-w-0 overflow-hidden rounded-xl border bg-card">
      {!hideHeader && <div className="flex min-h-14 items-center justify-between gap-2 border-b px-2 sm:px-4">
        <Button asChild variant="ghost" size="icon" className="size-11"><Link href={monthHref(monthKey(shiftMonth(currentDate, -1)))} prefetch={false} aria-label={t("previousMonth")}><ChevronLeft aria-hidden="true" /></Link></Button>
        <h2 className="text-base font-semibold" aria-live="polite">{format(currentDate, "MMMM yyyy")}</h2>
        <Button asChild variant="ghost" size="icon" className="size-11"><Link href={monthHref(monthKey(shiftMonth(currentDate, 1)))} prefetch={false} aria-label={t("nextMonth")}><ChevronRight aria-hidden="true" /></Link></Button>
      </div>}
      <div className="border-border/70 grid grid-cols-7 border-b" aria-hidden="true">
        {weekdays.map((day) => (
          <div key={day} className="text-muted-foreground py-2 text-center text-xs sm:text-sm">
            {day}
          </div>
        ))}
      </div>
      <div className="grid flex-1 auto-rows-fr">
        {weeks.map((week, weekIndex) => (
          <div key={`week-${weekIndex}`} className="grid grid-cols-7 [&:last-child>*]:border-b-0">
            {week.map((day) => {
              if (!day) return null; // Skip if day is undefined

              const dayEvents = getEventsForDay(events, day);
              const spanningEvents = getSpanningEventsForDay(events, day);
              const isCurrentMonth = isSameMonth(day, currentDate);
              const allDayEvents = [...spanningEvents, ...dayEvents];
              const allEvents = getAllEventsForDay(events, day);
              const selected = selectedDay !== null && isSameDay(day, selectedDay);

              return (
                <div
                  key={day.toString()}
                  className="group border-border/70 data-outside-cell:bg-muted/25 data-outside-cell:text-muted-foreground border-r border-b last:border-r-0"
                  data-today={(mounted && isToday(day)) || undefined}
                  data-outside-cell={!isCurrentMonth || undefined}
                  data-day={format(day, "yyyy-MM-dd")}
                  onDragOver={onDropOnDay ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } : undefined}
                  onDrop={onDropOnDay ? (e) => { e.preventDefault(); onDropOnDay(day, e.dataTransfer); } : undefined}>
                  <button
                    type="button"
                    onClick={() => onDaySelect(day)}
                    aria-pressed={selected}
                    aria-label={t("dayCell", { day: format(day, "EEEE, MMMM d"), count: allEvents.length })}
                    className={cn(
                      "flex min-h-14 w-full flex-col items-center gap-1 p-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-28 sm:items-stretch",
                      selected ? "bg-muted" : "hover:bg-muted/50"
                    )}>
                    <span className="group-data-today:bg-primary group-data-today:text-primary-foreground mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm">
                      {format(day, "d")}
                    </span>
                    <span className="flex gap-0.5 sm:hidden" aria-hidden="true">
                      {sortEvents(allDayEvents).slice(0, 3).map((event) => (
                        <span key={event.id} className={cn("size-1.5 rounded-full", event.status === "cancelled" ? "bg-muted-foreground/50" : "bg-primary")} />
                      ))}
                    </span>
                    <span className="hidden min-w-0 flex-1 flex-col gap-1 sm:flex" aria-hidden="true">
                      {sortEvents(allDayEvents).slice(0, 3).map((event) => (
                        <span
                          key={event.id}
                          draggable={onDropOnDay ? true : undefined}
                          onDragStart={onDropOnDay ? (e) => { e.dataTransfer.setData("application/x-harvest-post", event.id); e.dataTransfer.effectAllowed = "move"; } : undefined}
                          data-past-event={event.ended || undefined}
                          data-cancelled={event.status === "cancelled" || undefined}
                          className="bg-primary/10 text-foreground flex h-6 items-center truncate rounded px-2 text-xs font-medium data-cancelled:line-through data-past-event:opacity-70">
                          {renderChip ? renderChip(event) : <span className="truncate">
                            <span className="font-normal opacity-70">{format(event.start, "h:mma").toLowerCase()} </span>
                            {event.title}
                          </span>}
                        </span>
                      ))}
                      {allDayEvents.length > 3 && <span className="text-muted-foreground px-1 text-xs">{t("moreEvents", { count: allDayEvents.length - 3 })}</span>}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
