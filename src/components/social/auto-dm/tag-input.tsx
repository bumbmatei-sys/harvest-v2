"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

/** A list of short words: Enter or a comma adds one, Backspace on an empty field removes the last, and each chip has its own remove button. */
export function TagInput({ id, label, values, onChange, max = 15, maxLength = 80, invalid = false }: {
  id: string; label: string; values: readonly string[]; onChange: (values: string[]) => void; max?: number; maxLength?: number; invalid?: boolean;
}) {
  const t = useTranslations("SocialAutoDm.tags"), [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(",").map((part) => part.trim().slice(0, maxLength)).filter(Boolean);
    const next = [...values];
    for (const part of parts) if (next.length < max && !next.some((item) => item.toLowerCase() === part.toLowerCase())) next.push(part);
    if (next.length !== values.length) onChange(next);
    setDraft("");
  };
  return <div className="space-y-2" data-testid={`tags-${id}`}>
    {values.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {values.map((value) => <li key={value} className="inline-flex min-h-9 items-center gap-1 rounded-md bg-secondary pl-2.5 text-sm text-secondary-foreground">
        <span className="max-w-[16rem] truncate">{value}</span>
        <button type="button" aria-label={t("remove", { value })} onClick={() => onChange(values.filter((item) => item !== value))}
          className="inline-flex size-9 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"><X className="size-3.5" aria-hidden="true" /></button></li>)}
    </ul>}
    <Input id={id} value={draft} maxLength={maxLength} aria-label={label} aria-invalid={invalid || undefined} disabled={values.length >= max} className="min-h-11 lg:min-h-9"
      placeholder={values.length >= max ? t("full", { max }) : t("placeholder")}
      onChange={(event) => { const value = event.target.value; if (value.includes(",")) add(value); else setDraft(value); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(draft); } else if (event.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1)); }}
      onBlur={() => { if (draft.trim()) add(draft); }} />
  </div>;
}
