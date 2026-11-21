/** Derived from Shadcn UI Kit item radio-group8 (free), registry retrieved 2026-11-21, approved 2026-11-21 (CRM forms builder). Local changes: docs/ui-sources.md. */
"use client";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// The kit's radio-group8 card: same border, spacing and state classes; demo copy and description removed, text comes from the form definition.
export function RadioCards({ name, options, value, onChange, disabled, invalid, labelledBy }: {
  name: string; options: readonly string[]; value: string; onChange: (value: string) => void; disabled?: boolean; invalid?: boolean; labelledBy?: string;
}) {
  const id = useId();
  return (
    <RadioGroup className="w-full gap-2" name={name} value={value} onValueChange={onChange} disabled={disabled} aria-invalid={invalid} aria-labelledby={labelledBy}>
      {options.map((option, index) => (
        <div key={option} className="border-input has-data-[state=checked]:border-primary/50 relative flex min-h-11 w-full items-center gap-2 rounded-md border p-4 shadow-xs outline-none">
          <RadioGroupItem value={option} id={`${id}-${index}`} className="size-5 after:absolute after:inset-0 [&_svg]:size-3" />
          <div className="grid grow gap-2">
            <Label htmlFor={`${id}-${index}`} className="justify-between">{option}</Label>
          </div>
        </div>
      ))}
    </RadioGroup>
  );
}

