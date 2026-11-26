/** Derived from Shadcn UI Kit item select14 (premium), registry retrieved 2026-11-25, approved by the founder 2026-11-25 (Discover category control). Code written for Harvest on the shared Command and Popover; local changes: docs/ui-sources.md. */
"use client";
import { useState } from "react";
import type { ComponentType } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** `icon`: a lucide icon or any component taking `className` (brand marks); it is decorative, the label names the option. */
export type SearchableSelectOption = { value: string; label: string; icon?: ComponentType<{ className?: string; "aria-hidden"?: true | "true" }> };

/**
 * One-line select with type-to-search, an optional icon per option and an optional "all" row that clears the value. Shared: any screen with a long, fixed list
 * (categories, types) can use it instead of a tile grid or a long native select.
 */
export function SearchableSelect({ id, value, onChange, options, allLabel, placeholder, searchLabel, emptyLabel, ariaLabel, className }: {
  id?: string; value: string | undefined; onChange: (value: string | undefined) => void; options: readonly SearchableSelectOption[];
  allLabel?: string; placeholder: string; searchLabel: string; emptyLabel: string; ariaLabel?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  const pick = (next: string | undefined) => { onChange(next); setOpen(false); };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-label={ariaLabel}
        className={cn("min-h-11 justify-between gap-2 px-3 font-normal lg:min-h-9", className)}>
        <span className={cn("flex min-w-0 items-center gap-2", !current && "text-muted-foreground")}>
          {current?.icon && <current.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="truncate">{current?.label ?? allLabel ?? placeholder}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground/80" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-full min-w-(--radix-popper-anchor-width) p-0 sm:min-w-56">
      <Command>
        <CommandInput placeholder={searchLabel} aria-label={searchLabel} />
        <CommandList className="max-h-72">
          <CommandEmpty>{emptyLabel}</CommandEmpty>
          <CommandGroup>
            {allLabel && <CommandItem value={`__all ${allLabel}`} className="min-h-11 lg:min-h-8" onSelect={() => pick(undefined)}>
              <span className="flex-1">{allLabel}</span>{!current && <Check className="size-4" aria-hidden="true" />}
            </CommandItem>}
            {options.map((option) => <CommandItem key={option.value} value={`${option.value} ${option.label}`} className="min-h-11 lg:min-h-8" onSelect={() => pick(option.value)}>
              {option.icon && <option.icon className="size-4 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === value && <Check className="size-4" aria-hidden="true" />}
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
