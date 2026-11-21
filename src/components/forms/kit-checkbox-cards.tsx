/** Derived from Shadcn UI Kit item checkbox9 (free), registry retrieved 2026-11-21, approved 2026-11-21 (CRM forms builder). Local changes: docs/ui-sources.md. */
"use client";
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// The kit's checkbox9 card: same border, spacing and state classes; demo copy, sublabel and description removed.
export function CheckboxCards({ options, value, onChange, disabled, labelledBy }: {
  options: readonly string[]; value: string[]; onChange: (value: string[]) => void; disabled?: boolean; labelledBy?: string;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={labelledBy} className="grid w-full gap-2">
      {options.map((option, index) => (
        <div key={option} className="relative flex min-h-11 w-full items-start gap-2 rounded-md border border-input p-4 shadow-xs outline-none has-data-[state=checked]:border-primary/50">
          <Checkbox className="order-1 after:absolute after:inset-0" id={`${id}-${index}`} disabled={disabled} checked={value.includes(option)}
            onCheckedChange={(on) => onChange(on === true ? [...value, option] : value.filter((v) => v !== option))} />
          <div className="grid grow gap-2">
            <Label htmlFor={`${id}-${index}`}>{option}</Label>
          </div>
        </div>
      ))}
    </div>
  );
}

