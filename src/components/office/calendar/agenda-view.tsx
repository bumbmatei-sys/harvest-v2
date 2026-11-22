/** Copied from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/calendar/components/agenda-view.tsx, then adapted. Harvest changes: docs/ui-sources.md. */
"use client";

import { useMemo } from "react";
import { addDays, format, isToday } from "date-fns";

import { Calendar } from "lucide-react";
import { useTranslations } from "next-intl";

import { getAgendaEventsForDay } from "@/lib/calendar-days";
import type { CalendarEvent } from "@/lib/event-view";

const AgendaDaysToShow = 30;

interface AgendaViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onEventSelect: (event: CalendarEvent) => void;
  /** What a row looks like (source mark, time and title); Harvest supplies it so the row matches the other views. */
  renderRow: (event: CalendarEvent) => React.ReactNode;
}

export function AgendaView({ currentDate, events, onEventSelect, renderRow }: AgendaViewProps) {
  const t = useTranslations("OfficeCalendar.agenda");
  // Show events for the next days based on constant
  const days = useMemo(() => {
    return Array.from({ length: AgendaDaysToShow }, (_, i) => addDays(new Date(currentDate), i));
  }, [currentDate]);

  const handleEventClick = (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    onEventSelect(event);
  };

  // Check if there are any days with events
  const hasEvents = days.some((day) => getAgendaEventsForDay(events, day).length > 0);

  return (
    <div data-slot="agenda-view" className="border-border/70 border-t px-4" data-testid="agenda">
      {!hasEvents ? (
        <div className="flex min-h-[40svh] flex-col items-center justify-center py-16 text-center">
          <Calendar size={32} className="text-muted-foreground/50 mb-2" aria-hidden="true" />
          <h3 className="text-lg font-medium">{t("emptyTitle")}</h3>
          <p className="text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        days.map((day) => {
          const dayEvents = getAgendaEventsForDay(events, day);

          if (dayEvents.length === 0) return null;

          return (
            <div key={day.toString()} className="border-border/70 relative my-12 border-t first:mt-8">
              <span
                className="bg-background absolute -top-3 left-0 flex h-6 items-center pe-4 text-[10px] uppercase data-today:font-medium sm:pe-4 sm:text-xs"
                data-today={isToday(day) || undefined}>
                {format(day, "d MMM, EEEE")}
              </span>
              <div className="mt-6 space-y-2">
                {dayEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    data-testid="agenda-row"
                    onClick={(e) => handleEventClick(event, e)}
                    className="bg-card hover:bg-muted/60 focus-visible:ring-ring/50 flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md border px-3 text-left text-sm outline-none focus-visible:ring-[3px]">
                    {renderRow(event)}
                  </button>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
