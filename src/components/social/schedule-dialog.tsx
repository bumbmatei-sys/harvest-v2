"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import type { Schedule, Target } from "@/lib/social/api";
import { browserTimeZone, instantFrom, localValue, timeZones } from "@/lib/social/time";

/**
 * Picks when a post goes out: an exact date and time in a chosen time zone, or the next free slot of a posting schedule (when `allowNext`).
 * The date and time field is the keyboard and touch alternative to dragging in the planner. `confirmLabel` names the consequence.
 */
export function ScheduleDialog({ open, onOpenChange, title, confirmLabel, schedules, scheduleId, initialIso, initialZone, allowNext = true, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; confirmLabel: string; schedules: readonly Schedule[]; scheduleId?: string;
  initialIso?: string; initialZone?: string; allowNext?: boolean; onConfirm: (target: Target) => Promise<void>;
}) {
  const t = useTranslations("SocialPublish.schedule");
  const zone0 = initialZone ?? browserTimeZone();
  const [mode, setMode] = useState<"time" | "next">("time"), [zone, setZone] = useState(zone0);
  const [local, setLocal] = useState(() => initialIso ? localValue(initialIso, zone0) : ""), [schedule, setSchedule] = useState(scheduleId ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const zones = useMemo(() => timeZones(zone0), [zone0]);
  const instant = mode === "time" ? instantFrom(local, zone) : null;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    const past = instant !== null && new Date(instant).getTime() <= Date.now();
    if (mode === "time" && (!instant || past)) { setError(t(past ? "inThePast" : "chooseTime")); return; }
    setBusy(true);
    try { await onConfirm(mode === "time" ? { kind: "time", scheduledFor: instant!, timezone: zone } : { kind: "next", ...(schedule ? { scheduleId: schedule } : {}) }); onOpenChange(false); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("failed")); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{title}</DialogDescription></DialogHeader>
        {allowNext && <div role="radiogroup" aria-label={t("how")} className="grid grid-cols-2 gap-2">
          {(["time", "next"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)}
            className="min-h-11 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-checked:border-primary aria-checked:bg-selected">{t(value === "time" ? "setTime" : "nextSlot")}</button>)}
        </div>}
        {mode === "time" ? <div className="space-y-3">
          <label className="block space-y-1 text-sm font-medium">{t("dateTime")}<Input type="datetime-local" required value={local} onChange={(event) => setLocal(event.target.value)} className="min-h-11" /></label>
          <label className="block space-y-1 text-sm font-medium">{t("timeZone")}<NativeSelect value={zone} onChange={(event) => { const next = event.target.value; if (local && instant) setLocal(localValue(instant, next)); setZone(next); }} className="min-h-11">
            {zones.map((value) => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect></label>
        </div> : <label className="block space-y-1 text-sm font-medium">{t("schedule")}<NativeSelect value={schedule} onChange={(event) => setSchedule(event.target.value)} className="min-h-11">
          <NativeSelectOption value="">{t("automatic")}</NativeSelectOption>
          {schedules.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect></label>}
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" size="responsive" disabled={busy} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="submit" size="responsive" aria-disabled={busy || undefined}>{busy && <Spinner />}{confirmLabel}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
