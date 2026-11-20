/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/calendar/components/week-view.tsx; code written for Harvest, no kit code copied. */
"use client";
import Link from "next/link";
import { useMemo } from "react";
import { addDays, format, isSameDay, isToday, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { CalendarEvent } from "@/lib/event-view";
import { cn } from "@/lib/utils";

/**
 * A week of posts by day and hour, Monday first (the planner API groups weeks the same way). Each post is a button (keyboard and screen readers can open
 * it); an hour cell is a drop target for dragging a post or a draft onto that hour. The date and time field in the post's dialog is the alternative to dragging.
 */
export function WeekCalendar({ weekStart, events, weekHref, renderChip, onSelect, onDropOnHour }: {
  weekStart: Date; events: CalendarEvent[]; weekHref: (start: string) => string; renderChip: (event: CalendarEvent) => React.ReactNode;
  onSelect: (event: CalendarEvent) => void; onDropOnHour: (day: Date, hour: number, data: DataTransfer) => void;
}) {
  const t = useTranslations("SocialPublish.planner"), locale = useLocale();
  const start = useMemo(() => startOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(start, index)), [start]);
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const at = (day: Date, hour: number) => events.filter((event) => isSameDay(event.start, day) && event.start.getHours() === hour);
  const key = (date: Date) => format(date, "yyyy-MM-dd");
  return <div data-slot="week-view" className="min-w-0 overflow-hidden rounded-xl border bg-card">
    <div className="flex min-h-14 items-center justify-between gap-2 border-b px-2 sm:px-4">
      <Button asChild variant="ghost" size="icon" className="size-11"><Link href={weekHref(key(addDays(start, -7)))} prefetch={false} aria-label={t("previousWeek")}><ChevronLeft aria-hidden="true" /></Link></Button>
      <h2 className="text-base font-semibold" aria-live="polite">{new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).formatRange(start, addDays(start, 6))}</h2>
      <Button asChild variant="ghost" size="icon" className="size-11"><Link href={weekHref(key(addDays(start, 7)))} prefetch={false} aria-label={t("nextWeek")}><ChevronRight aria-hidden="true" /></Link></Button>
    </div>
    <div className="max-h-[70vh] overflow-y-auto">
      <div className="sticky top-0 z-10 grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] border-b bg-card sm:grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]" aria-hidden="true">
        <span />
        {days.map((day) => <span key={key(day)} className={cn("py-2 text-center text-xs sm:text-sm", isToday(day) ? "font-semibold text-foreground" : "text-muted-foreground")}>
          <span className="sm:hidden">{format(day, "EEEEE")} {format(day, "d")}</span><span className="max-sm:hidden">{format(day, "EEE d")}</span></span>)}
      </div>
      <div role="group" aria-label={t("weekGrid")} className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] sm:grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
        {hours.map((hour) => <div key={hour} className="contents">
          <span aria-hidden="true" className="border-b px-1 pt-1 text-right text-[10px] text-muted-foreground sm:text-xs">{format(new Date(2024, 0, 1, hour), "h a")}</span>
          {days.map((day) => {
            const here = at(day, hour);
            return <div key={key(day)} data-day={key(day)} data-hour={hour}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); onDropOnHour(day, hour, event.dataTransfer); }}
              className="flex min-h-11 min-w-0 flex-col gap-0.5 border-b border-l p-0.5">
              {here.map((event) => <button key={event.id} type="button" onClick={() => onSelect(event)} draggable data-post-id={event.id}
                onDragStart={(drag) => { drag.dataTransfer.setData("application/x-harvest-post", event.id); drag.dataTransfer.effectAllowed = "move"; }}
                className="flex min-h-11 min-w-0 items-center gap-1 rounded bg-primary/10 px-1 text-left text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8">{renderChip(event)}</button>)}
            </div>;
          })}
        </div>)}
      </div>
    </div>
  </div>;
}
