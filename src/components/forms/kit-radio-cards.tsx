/** Derived from Shadcn UI Kit item form-layout20 (premium), registry retrieved 2026-11-21, approved 2026-11-21 (CRM forms builder). Local changes: docs/ui-sources.md. */
"use client";
import { useId } from "react";
import { Field, FieldContent, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

// The plan card of the kit's onboarding form: a FieldLabel card that takes the checked border and tint from the radio inside it. The plan names,
// prices, badges and descriptions are removed; the options are a prop and the group takes name, value, disabled, invalid and an external label id.
export function RadioCards({ name, options, value, onChange, disabled, invalid, labelledBy }: {
  name: string; options: readonly string[]; value: string; onChange: (value: string) => void; disabled?: boolean; invalid?: boolean; labelledBy?: string;
}) {
  const id = useId();
  return (
    <RadioGroup name={name} value={value} onValueChange={onChange} disabled={disabled} aria-invalid={invalid} aria-labelledby={labelledBy} className="gap-3">
      {options.map((option, index) => (
        <FieldLabel
          key={option}
          htmlFor={`${id}-${index}`}
          className="min-h-11 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-muted/50 dark:has-data-[state=checked]:bg-muted/50"
        >
          <Field orientation="horizontal">
            <RadioGroupItem value={option} id={`${id}-${index}`} aria-label={option} />
            <FieldContent>
              <FieldTitle>{option}</FieldTitle>
            </FieldContent>
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  );
}
