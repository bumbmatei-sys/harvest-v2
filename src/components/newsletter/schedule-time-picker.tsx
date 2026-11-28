/** Derived from Shadcn UI Kit item date-picker-example1 (premium), registry retrieved 2026-11-28, approved 2026-11-27 (Account and newsletter screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NEWSLETTER_SCHEDULE_HORIZON_MS } from "@/lib/newsletter-schedule";

const pad = (value: number) => String(value).padStart(2, "0");
/** The calendar's local day as `YYYY-MM-DD`. */
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** The day an instant falls on in the ministry's zone, as `YYYY-MM-DD`. */
const zonedDay = (ms: number, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

/**
 * A day on the kit's bordered calendar plus a time of day, read in the ministry's zone. Emits one `datetime-local` value (`YYYY-MM-DDTHH:mm`), or "" until
 * both parts are chosen (as the browser's own date and time field does). Days before today, or after the 60-day scheduling limit, in that zone cannot be picked.
 */
export function ScheduleTimePicker({ id, legend, timeLabel, value, onChange, timeZone, describedBy }: {
  id: string; legend: string; timeLabel: string; value: string; onChange: (value: string) => void; timeZone: string; describedBy?: string;
}) {
  const [day, setDay] = React.useState(value.slice(0, 10)), [time, setTime] = React.useState(value.slice(11, 16));
  // A value set from outside (a loaded campaign, a confirmed schedule) replaces the parts shown; "" (an unfinished pick) keeps them.
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) { setSeen(value); if (value) { setDay(value.slice(0, 10)); setTime(value.slice(11, 16)); } }
  const [now] = React.useState(() => Date.now());
  const date = React.useMemo(() => day ? new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) : undefined, [day]);
  const [first, last] = React.useMemo(() => { return [zonedDay(now, timeZone), zonedDay(now + NEWSLETTER_SCHEDULE_HORIZON_MS, timeZone)]; }, [now, timeZone]);
  const emit = (nextDay: string, nextTime: string) => onChange(nextDay && nextTime ? `${nextDay}T${nextTime}` : "");

  return (
    <fieldset className="space-y-3" aria-describedby={describedBy} data-schedule-picker={id}>
      <legend className="mb-2 text-sm leading-none font-medium">{legend}</legend>
      <div className="flex flex-col items-start gap-3 sm:flex-row">
        <div className="border rounded-lg">
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date}
            disabled={(candidate) => dayKey(candidate) < first || dayKey(candidate) > last}
            onSelect={(next) => { if (!next) return; const key = dayKey(next); setDay(key); emit(key, time); }}
            className="rounded-lg [--cell-size:--spacing(11)] lg:[--cell-size:--spacing(8)]"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-time`}>{timeLabel}</Label>
          <Input id={`${id}-time`} type="time" className="min-h-11 w-full sm:w-40" value={time} onChange={(e) => { setTime(e.target.value); emit(day, e.target.value); }} />
        </div>
      </div>
    </fieldset>
  );
}
