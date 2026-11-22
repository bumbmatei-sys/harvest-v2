"use client";
import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { CalendarClock } from "lucide-react";
import type { CalendarApi, Slot } from "@/lib/office/calendar";

const durations = [15, 30, 60, 90] as const;
type Load = { status: "loading" } | { status: "error" } | { status: "ready"; slots: Slot[]; partial: boolean };

/** Free time in the shown week, from the provider's availability (live, nothing stored). Past time is never offered. */
export function AvailabilityView({ api, connectionId, from, to, onReconnect }: { api: CalendarApi; connectionId: string; from: Date; to: Date; onReconnect: () => void }) {
  const t = useTranslations("OfficeCalendar.availability"), locale = useLocale();
  const [minutes, setMinutes] = useState<number>(30), [load, setLoad] = useState<Load>({ status: "loading" }), [version, setVersion] = useState(0);
  const [opened] = useState(() => Date.now());
  const start = useMemo(() => new Date(Math.max(from.getTime(), Math.ceil(opened / 900_000) * 900_000)), [from, opened]);
  const startIso = start.toISOString(), endIso = to.toISOString(), past = start >= to;
  useEffect(() => {
    if (past) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      setLoad({ status: "loading" });
      try {
        const result = await api.availability(connectionId, { start: startIso, end: endIso, durationMinutes: minutes }, controller.signal);
        if (controller.signal.aborted) return;
        if (result.state === "reconnect_needed") return onReconnect();
        setLoad(result.state === "available" ? { status: "ready", slots: result.data.items, partial: !!result.data.partial } : { status: "error" });
      } catch { if (!controller.signal.aborted) setLoad({ status: "error" }); }
    });
    return () => controller.abort();
  }, [api, connectionId, startIso, endIso, minutes, onReconnect, past, version]);

  const days = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    if (load.status === "ready") for (const slot of load.slots) { const key = new Date(slot.start).toDateString(); groups.set(key, [...(groups.get(key) ?? []), slot]); }
    return [...groups.entries()];
  }, [load]);
  const day = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }), time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  return <section className="space-y-3 rounded-xl border bg-card p-3 sm:p-4" aria-label={t("label")} data-testid="availability">
    <Field className="max-w-48"><FieldLabel htmlFor="availability-length">{t("length")}</FieldLabel>
      <NativeSelect id="availability-length" className="w-full" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} data-testid="availability-length">
        {durations.map((value) => <NativeSelectOption key={value} value={value}>{t("minutes", { count: value })}</NativeSelectOption>)}</NativeSelect></Field>
    {past && <EmptyState icon={CalendarClock} title={t("past")} size="compact" />}
    {!past && load.status === "loading" && <div role="status" aria-busy="true" aria-label={t("loading")} className="space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-10 w-full" /></div>}
    {!past && load.status === "error" && <Alert variant="destructive" role="alert" data-testid="availability-error"><AlertDescription className="flex flex-wrap items-center gap-2">{t("failed")}
      <Button type="button" variant="outline" size="responsive" onClick={() => setVersion((value) => value + 1)}>{t("retry")}</Button></AlertDescription></Alert>}
    {!past && load.status === "ready" && <>
      {load.partial && <Alert role="status" data-testid="availability-partial"><TriangleAlert aria-hidden="true" /><AlertDescription>{t("partial")}</AlertDescription></Alert>}
      {days.length === 0 ? <EmptyState icon={CalendarClock} title={t("none")} size="compact" />
        : <ul className="space-y-4" data-testid="availability-list">{days.map(([key, slots]) => <li key={key}><h3 className="mb-2 text-sm font-semibold">{day.format(new Date(slots[0].start))}</h3>
          <ul className="flex flex-wrap gap-2">{slots.map((slot) => <li key={slot.start} className="rounded-md border px-3 py-2 text-sm" data-testid="slot">{time.format(new Date(slot.start))} – {time.format(new Date(slot.end))}</li>)}</ul></li>)}</ul>}
    </>}
  </section>;
}
