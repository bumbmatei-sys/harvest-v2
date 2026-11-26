/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/calendar/components/week-view.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import React, { useEffect, useMemo, useRef } from "react";
import {
  addHours,
  areIntervalsOverlapping,
  differenceInMinutes,
  eachDayOfInterval,
  eachHourOfInterval,
  endOfDay,
  endOfWeek,
  format,
  getHours,
  getMinutes,
  isSameDay,
  isToday,
  startOfDay,
  startOfWeek
} from "date-fns";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { gridScrollTop, isMultiDayEvent } from "@/lib/calendar-days";
import { useCurrentTimeIndicator } from "@/hooks/use-current-time-indicator";
import { useHydrated } from "@/hooks/use-hydrated";
import type { CalendarEvent } from "@/lib/event-view";
import { cn } from "@/lib/utils";

const StartHour = 0;
const EndHour = 24;
const WeekCellsHeight = 64;

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onEventSelect: (event: CalendarEvent) => void;
  /** What a post looks like inside its block (platform marks, time and text). */
  renderChip: (event: CalendarEvent) => React.ReactNode;
  /** A post or draft dropped on a quarter hour of a day. Omit for a read-only grid: nothing is draggable and no cell accepts a drop. */
  onDropAt?: (day: Date, time: number, data: DataTransfer) => void;
  /** `day` shows only the day of `currentDate` (Office Calendar); `week` is the Monday-first week (default). */
  mode?: "week" | "day";
  /** All-day and multi-day entries sit in a row above the grid when this is set and any exist. */
  allDay?: { label: string; render: (event: CalendarEvent) => React.ReactNode };
  /** Label for the grid (screen readers). */
  label: string;
  /** Replaces the viewer's GMT offset above the hour column, when times are not the viewer's (Events show each event in its own zone). */
  zoneLabel?: string;
  /** Posts that overlap in time collapse into the first one plus a "+N" button that opens a list of all of them. */
  overlap: { moreLabel: (count: number) => string; moreText: (count: number) => string; title: string; renderRow: (event: CalendarEvent) => React.ReactNode };
  /** Hour (0-23) to show first, just below the sticky day header, by scrolling the nearest scrolling ancestor once the grid is in the page. Omit to leave the scroll alone. */
  openAt?: number;
}

/** The nearest ancestor that scrolls vertically (the screen's grid region). */
function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let current = node?.parentElement ?? null; current; current = current.parentElement) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") return current;
  }
  return null;
}

interface PositionedEvent {
  event: CalendarEvent;
  top: number;
  height: number;
  left: number;
  width: number;
  zIndex: number;
  /** Every post in an overlapping group (lead first); only set on the lead. */
  group?: CalendarEvent[];
}

export function WeekView({ currentDate, events, onEventSelect, renderChip, onDropAt, label, overlap, mode = "week", allDay, zoneLabel, openAt }: WeekViewProps) {
  // "Today" and the viewer's GMT offset are only known in the browser (the server runs in its own zone): both apply after hydration, so the server
  // render and the first client render are the same.
  const hydrated = useHydrated();
  const root = useRef<HTMLDivElement>(null), header = useRef<HTMLDivElement>(null);
  const days = useMemo(() => {
    if (mode === "day") return [startOfDay(currentDate)];
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: weekStart, end: weekEnd });
  }, [currentDate, mode]);

  const hours = useMemo(() => {
    const dayStart = startOfDay(currentDate);
    return eachHourOfInterval({
      start: addHours(dayStart, StartHour),
      end: addHours(dayStart, EndHour - 1)
    });
  }, [currentDate]);

  // Process events for each day to calculate positions
  const processedDayEvents = useMemo(() => {
    const result = days.map((day) => {
      // Get events for this day that are not all-day events or multi-day events
      const dayEvents = events.filter((event) => {
        // Skip all-day events and multi-day events
        if (event.allDay || isMultiDayEvent(event)) return false;

        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);

        // Check if event is on this day
        return (
          isSameDay(day, eventStart) ||
          isSameDay(day, eventEnd) ||
          (eventStart < day && eventEnd > day)
        );
      });

      // Sort events by start time and duration
      const sortedEvents = [...dayEvents].sort((a, b) => {
        const aStart = new Date(a.start);
        const bStart = new Date(b.start);
        const aEnd = new Date(a.end);
        const bEnd = new Date(b.end);

        // First sort by start time
        if (aStart < bStart) return -1;
        if (aStart > bStart) return 1;

        // If start times are equal, sort by duration (longer events first)
        const aDuration = differenceInMinutes(aEnd, aStart);
        const bDuration = differenceInMinutes(bEnd, bStart);
        return bDuration - aDuration;
      });

      // Calculate positions for each event
      const positionedEvents: PositionedEvent[] = [];
      const dayStart = startOfDay(day);

      // Track columns for overlapping events
      const columns: { event: CalendarEvent; end: Date }[][] = [];
      const spans: { column: number; start: Date; end: Date }[] = [];

      sortedEvents.forEach((event) => {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);

        // Adjust start and end times if they're outside this day
        const adjustedStart = isSameDay(day, eventStart) ? eventStart : dayStart;
        const adjustedEnd = isSameDay(day, eventEnd) ? eventEnd : addHours(dayStart, 24);

        // Calculate top position and height
        const startHour = getHours(adjustedStart) + getMinutes(adjustedStart) / 60;
        const endHour = getHours(adjustedEnd) + getMinutes(adjustedEnd) / 60;

        // Adjust the top calculation to account for the new start time
        const top = (startHour - StartHour) * WeekCellsHeight;
        const height = (endHour - startHour) * WeekCellsHeight;

        // Find a column for this event
        let columnIndex = 0;
        let placed = false;

        while (!placed) {
          const col = columns[columnIndex] || [];
          if (col.length === 0) {
            columns[columnIndex] = col;
            placed = true;
          } else {
            const overlaps = col.some((c) =>
              areIntervalsOverlapping(
                { start: adjustedStart, end: adjustedEnd },
                {
                  start: new Date(c.event.start),
                  end: new Date(c.event.end)
                }
              )
            );
            if (!overlaps) {
              placed = true;
            } else {
              columnIndex++;
            }
          }
        }

        // Ensure column is initialized before pushing
        const currentColumn = columns[columnIndex] || [];
        columns[columnIndex] = currentColumn;
        currentColumn.push({ event, end: adjustedEnd });

        // Calculate width and left position based on number of columns
        const width = 1, left = 0;
        spans.push({ column: columnIndex, start: adjustedStart, end: adjustedEnd });

        positionedEvents.push({
          event,
          top,
          height,
          left,
          width,
          zIndex: 10 + columnIndex // Higher columns get higher z-index
        });
      });

      // Posts that overlap in time (directly or through a chain) collapse into the first one, full width, and a "+N" button lists all of them.
      const clusters: number[][] = [];
      positionedEvents.forEach((_, index) => {
        const mine = spans[index];
        const joined = clusters.filter((cluster) => cluster.some((other) => spans[other].start < mine.end && spans[other].end > mine.start));
        const merged = [index, ...joined.flat()].sort((x, y) => x - y);
        joined.forEach((cluster) => clusters.splice(clusters.indexOf(cluster), 1));
        clusters.push(merged);
      });
      const hidden = new Set<number>();
      clusters.forEach((cluster) => {
        const [lead, ...rest] = cluster;
        positionedEvents[lead].width = 1; positionedEvents[lead].left = 0;
        if (rest.length > 0) { positionedEvents[lead].group = cluster.map((index) => positionedEvents[index].event); rest.forEach((index) => hidden.add(index)); }
      });
      positionedEvents.splice(0, positionedEvents.length, ...positionedEvents.filter((_, index) => !hidden.has(index)));
      return positionedEvents;
    });

    return result;
  }, [days, events]);

  const handleEventClick = (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    onEventSelect(event);
  };

  const { currentTimePosition, currentTimeVisible } = useCurrentTimeIndicator(currentDate, mode);
  const firstDay = days[0]?.getTime();
  useEffect(() => {
    // Client only, after layout: the grid opens at `openAt` with that hour's label fully below the sticky header.
    if (openAt === undefined || !root.current) return;
    const scroller = scrollParent(root.current), row = root.current.querySelector<HTMLElement>(`[data-hour-row="${openAt}"]`);
    if (!scroller || !row) return;
    const rowTop = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = gridScrollTop(rowTop, header.current?.offsetHeight ?? 0);
  }, [openAt, firstDay, mode]);
  const cols = mode === "day" ? "grid-cols-[3rem_1fr] sm:grid-cols-[4rem_1fr]" : "grid-cols-8";
  const spanning = allDay ? events.filter((event) => event.allDay || isMultiDayEvent(event)) : [];

  return (
    <div ref={root} data-slot="week-view" aria-label={label} role="group" className="flex h-full flex-col" style={{ "--week-cells-height": `${WeekCellsHeight}px` } as React.CSSProperties}>
      <div ref={header} className={cn("bg-card/80 border-border/70 sticky top-0 z-30 grid border-b backdrop-blur-md", cols)}>
        <div className="text-muted-foreground py-2 text-center text-sm">
          <span className="max-[479px]:sr-only">{zoneLabel ?? (hydrated ? format(new Date(), "O") : "")}</span>
        </div>
        {days.map((day) => (
          <div
            key={day.toString()}
            className="data-today:text-foreground text-muted-foreground py-2 text-center text-sm data-today:font-medium"
            data-today={(hydrated && isToday(day)) || undefined}>
            <span className="sm:hidden" aria-hidden="true">
              {format(day, "E")[0]} {format(day, "d")}
            </span>
            <span className="max-sm:hidden">{format(day, "EEE dd")}</span>
          </div>
        ))}
      </div>

      {allDay && spanning.length > 0 && <div className={cn("border-border/70 grid border-b", cols)} data-testid="all-day-row">
        <div className="text-muted-foreground flex items-center justify-end pe-2 text-[10px] sm:pe-4 sm:text-xs">{allDay.label}</div>
        {days.map((day) => <div key={day.toString()} className="border-border/70 flex min-w-0 flex-col gap-1 border-r p-1 last:border-r-0">
          {spanning.filter((event) => event.start <= endOfDay(day) && event.end >= day).map((event) => <button key={event.id} type="button" onClick={() => onEventSelect(event)}
            className="bg-card hover:bg-muted/60 focus-visible:ring-ring/50 flex min-h-11 min-w-0 items-center gap-1 overflow-hidden rounded-md border px-1 text-left text-xs outline-none focus-visible:ring-[3px] sm:min-h-6">{allDay.render(event)}</button>)}
        </div>)}
      </div>}
      <div className={cn("grid flex-1 overflow-hidden", cols)}>
        <div className="border-border/70 grid auto-cols-fr border-r">
          {hours.map((hour, index) => (
            <div
              key={hour.toString()}
              data-hour-row={index}
              className="border-border/70 relative min-h-[var(--week-cells-height)] border-b last:border-b-0">
              {index > 0 && (
                <span className="bg-card text-muted-foreground absolute -top-3 left-0 flex h-6 w-16 max-w-full items-center justify-end pe-2 text-[10px] sm:pe-4 sm:text-xs">
                  {format(hour, "h a")}
                </span>
              )}
            </div>
          ))}
        </div>

        {days.map((day, dayIndex) => (
          <div
            key={day.toString()}
            className="border-border/70 relative grid auto-cols-fr border-r last:border-r-0"
            data-today={(hydrated && isToday(day)) || undefined}>
            {/* Positioned events */}
            {(processedDayEvents[dayIndex] ?? []).map((positionedEvent) => (
              <div
                key={positionedEvent.event.id}
                className="absolute z-10 px-0.5"
                style={{
                  top: `${positionedEvent.top}px`,
                  height: `${positionedEvent.height}px`,
                  left: `${positionedEvent.left * 100}%`,
                  width: `${positionedEvent.width * 100}%`,
                  zIndex: positionedEvent.zIndex
                }}
                onClick={(e) => e.stopPropagation()}>
                {positionedEvent.group && <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" data-testid="overlap-more" aria-label={overlap.moreLabel(positionedEvent.group.length - 1)}
                      className="bg-primary text-primary-foreground focus-visible:ring-ring/50 absolute inset-y-0 right-0.5 z-10 flex min-h-11 w-8 items-center justify-center rounded-md text-xs font-semibold outline-none focus-visible:ring-[3px]">
                      <span aria-hidden="true">{overlap.moreText(positionedEvent.group.length - 1)}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 space-y-1 p-2" data-testid="overlap-list">
                    <p className="text-muted-foreground px-2 py-1 text-xs font-medium">{overlap.title}</p>
                    <ul className="m-0 list-none space-y-1 p-0">
                      {positionedEvent.group.map((member) => (
                        <li key={member.id}>
                          <button type="button" data-testid="overlap-row" onClick={() => onEventSelect(member)}
                            className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none focus-visible:ring-[3px]">
                            {overlap.renderRow(member)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>}
                <button
                  type="button"
                  draggable={onDropAt ? true : undefined}
                  data-post-id={positionedEvent.event.id}
                  onClick={(e) => handleEventClick(positionedEvent.event, e)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-harvest-post", positionedEvent.event.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className={cn("@container bg-card hover:bg-muted/60 focus-visible:ring-ring/50 flex size-full min-h-11 min-w-0 flex-col gap-0.5 overflow-hidden rounded-md border p-1 text-left text-xs shadow-xs outline-none focus-visible:ring-[3px] sm:min-h-0", positionedEvent.group && "pe-9")}>
                  {renderChip(positionedEvent.event)}
                </button>
              </div>
            ))}

            {/* Current time indicator - only show for today's column */}
            {currentTimeVisible && hydrated && isToday(day) && (
              <div
                className="pointer-events-none absolute right-0 left-0 z-20"
                style={{ top: `${currentTimePosition}%` }}>
                <div className="relative flex items-center">
                  <div className="bg-primary absolute -left-1 h-2 w-2 rounded-full"></div>
                  <div className="bg-primary h-[2px] w-full"></div>
                </div>
              </div>
            )}
            {hours.map((hour) => {
              const hourValue = getHours(hour);
              return (
                <div
                  key={hour.toString()}
                  className="border-border/70 relative min-h-[var(--week-cells-height)] border-b last:border-b-0">
                  {/* Quarter-hour intervals */}
                  {[0, 1, 2, 3].map((quarter) => {
                    const quarterHourTime = hourValue + quarter * 0.25;
                    return (
                      <div
                        key={`${hour.toString()}-${quarter}`}
                        data-day={format(day, "yyyy-MM-dd")}
                        data-time={quarterHourTime}
                        onDragOver={onDropAt ? (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        } : undefined}
                        onDrop={onDropAt ? (e) => {
                          e.preventDefault();
                          onDropAt(day, quarterHourTime, e.dataTransfer);
                        } : undefined}
                        className={cn(
                          "absolute h-[calc(var(--week-cells-height)/4)] w-full",
                          quarter === 0 && "top-0",
                          quarter === 1 && "top-[calc(var(--week-cells-height)/4)]",
                          quarter === 2 && "top-[calc(var(--week-cells-height)/4*2)]",
                          quarter === 3 && "top-[calc(var(--week-cells-height)/4*3)]"
                        )}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
