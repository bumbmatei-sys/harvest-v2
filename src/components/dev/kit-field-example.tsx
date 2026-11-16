/** Derived from Shadcn UI Kit item field1 (free), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 4). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** The kit's field demo (a labelled input in a field group), with the invalid state added. Uses Harvest's own Field primitives. */
export function KitFieldExample() {
  const t = useTranslations("UiShowcase.forms"), id = useId();
  const [value, setValue] = useState("");
  const invalid = value.trim().length === 0;
  return <FieldGroup>
    <Field data-invalid={invalid ? true : undefined}><FieldLabel htmlFor={`${id}-title`}>{t("fieldTitle")}</FieldLabel>
      <Input id={`${id}-title`} className="min-h-11" value={value} aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} onChange={event => setValue(event.target.value)} />
      {invalid && <FieldError id={`${id}-error`}>{t("fieldRequired")}</FieldError>}</Field>
  </FieldGroup>;
}
