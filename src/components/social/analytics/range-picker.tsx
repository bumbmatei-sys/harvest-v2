"use client";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { matchPreset, presetRange, presets, rangeIsValid, type Preset } from "@/lib/social/analytics-view";
import { cn } from "@/lib/utils";

/** Date range: three presets and a custom pair of dates (at most 366 days, as the route allows). */
export function RangePicker({ range, today, onChange }: { range: { from: string; to: string }; today: string; onChange: (range: { from: string; to: string }) => void }) {
  const t = useTranslations("SocialAnalytics.range"), format = useFormatter();
  const [open, setOpen] = useState(false), [from, setFrom] = useState(range.from), [to, setTo] = useState(range.to);
  const active = matchPreset(range.from, range.to, today);
  const valid = rangeIsValid(from, to) && from <= to && to <= today;
  const label = (value: string) => format.dateTime(new Date(`${value}T12:00:00Z`), { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  const choose = (days: Preset) => { onChange(presetRange(days, today)); setOpen(false); };
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) { setFrom(range.from); setTo(range.to); } }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="responsive" className="max-sm:w-full max-sm:justify-start" data-testid="range-trigger" aria-label={t("label")}>
          <CalendarDays aria-hidden="true" />{active ? t("last", { days: active }) : t("span", { from: label(range.from), to: label(range.to) })}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-4" data-testid="range-popover">
        <div className="flex flex-col gap-1" role="group" aria-label={t("presets")}>
          {presets.map((days) => <Button key={days} type="button" variant={active === days ? "secondary" : "ghost"} size="responsive" className={cn("justify-start", active === days && "font-semibold")} aria-pressed={active === days} onClick={() => choose(days)}>{t("last", { days })}</Button>)}
        </div>
        <div className="flex flex-col gap-3 border-t pt-4">
          <div className="grid grid-cols-1 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="analytics-from">{t("from")}</Label><Input id="analytics-from" type="date" value={from} max={to || today} className="min-h-11 lg:min-h-9" onChange={(event) => setFrom(event.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="analytics-to">{t("to")}</Label><Input id="analytics-to" type="date" value={to} min={from} max={today} className="min-h-11 lg:min-h-9" onChange={(event) => setTo(event.target.value)} /></div>
          </div>
          {!valid && <p role="alert" className="text-xs text-destructive">{t("invalid")}</p>}
          <Button type="button" size="responsive" disabled={!valid} onClick={() => { onChange({ from, to }); setOpen(false); }}>{t("apply")}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
