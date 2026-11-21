/** Derived from Shadcn UI Kit item form-layout20 (premium), registry retrieved 2026-11-21, approved 2026-11-21 (CRM forms builder). Local changes: docs/ui-sources.md. */
"use client";
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldLabel, FieldTitle } from "@/components/ui/field";

// The same plan card as the radio cards, with a checkbox in place of the radio (the kit has no checkbox card of its own in a form block).
export function CheckboxCards({ options, value, onChange, disabled, labelledBy }: {
  options: readonly string[]; value: string[]; onChange: (value: string[]) => void; disabled?: boolean; labelledBy?: string;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={labelledBy} className="grid gap-3">
      {options.map((option, index) => (
        <FieldLabel
          key={option}
          htmlFor={`${id}-${index}`}
          className="min-h-11 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-muted/50 dark:has-data-[state=checked]:bg-muted/50"
        >
          <Field orientation="horizontal">
            <Checkbox id={`${id}-${index}`} disabled={disabled} checked={value.includes(option)}
              onCheckedChange={(on) => onChange(on === true ? [...value, option] : value.filter((v) => v !== option))} />
            <FieldContent>
              <FieldTitle>{option}</FieldTitle>
            </FieldContent>
          </Field>
        </FieldLabel>
      ))}
    </div>
  );
}
