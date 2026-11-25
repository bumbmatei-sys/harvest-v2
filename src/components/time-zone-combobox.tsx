/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/pages/settings/account/page.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { groupedTimeZones, localTimeLabel, utcOffsetLabel } from "@/lib/time-zone-label";
import { cn } from "@/lib/utils";

/** Searchable time zone picker grouped by region; each zone shows its local time now and its UTC offset. */
export function TimeZoneCombobox({ id, value, onChange, disabled, labelledBy }: { id: string; value: string; onChange: (zone: string) => void; disabled?: boolean; labelledBy: string }) {
  const t = useTranslations("ComponentsTimeZoneCombobox"), locale = useLocale();
  const [open, setOpen] = useState(false);
  const now = useMemo(() => new Date(), [open]); // eslint-disable-line react-hooks/exhaustive-deps -- refreshed each time the list opens
  const groups = useMemo(() => open ? groupedTimeZones(value) : [], [open, value]);
  const summary = (zone: string) => `${localTimeLabel(zone, now, locale)} · ${utcOffsetLabel(zone, now)}`;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-labelledby={`${labelledBy} ${id}`} disabled={disabled} className="min-h-11 w-full justify-between gap-3 font-normal lg:min-h-9">
        <span className="min-w-0 truncate text-left">{value}{/* The current time differs between the server render and hydration (often by a minute), which is expected here. */}<span className="ml-2 text-muted-foreground" suppressHydrationWarning>{summary(value)}</span></span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0">
      <Command>
        <CommandInput placeholder={t("search")} aria-label={t("search")} />
        <CommandList className="max-h-72">
          <CommandEmpty>{t("none")}</CommandEmpty>
          {groups.map((group) => <CommandGroup key={group.region} heading={group.region === "UTC" ? t("utc") : group.region.replace(/_/g, " ")}>
            {group.zones.map((zone) => <CommandItem key={zone} value={`${zone} ${zone.replace(/_/g, " ")}`} className="min-h-11 lg:min-h-8" onSelect={() => { onChange(zone); setOpen(false); }}>
              <Check className={cn("size-4", zone === value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{zone.includes("/") ? zone.slice(zone.indexOf("/") + 1).replace(/_/g, " ") : zone}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{summary(zone)}</span>
            </CommandItem>)}
          </CommandGroup>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
