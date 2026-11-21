/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/pages/settings/notifications/page.tsx; code written for Harvest, no kit code copied. */
"use client";
import { useId } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusBadge } from "@/components/status-badge";
import { Switch } from "@/components/ui/switch";
import type { StepId } from "@/lib/social/auto-dm-ui";
import { cn } from "@/lib/utils";

/** A numbered section of the single-page editor: the number turns into a check when the step is complete, and the badge says what is missing. */
export function StepCard({ id, index, title, issues, active, onFocus, children }: { id: StepId; index: number; title: string; issues: number; active: boolean; onFocus: () => void; children: React.ReactNode }) {
  const t = useTranslations("SocialAutoDm.steps"), done = issues === 0;
  return <section id={id} aria-labelledby={`${id}-title`} data-testid={`step-${id}`} data-state={done ? "done" : "attention"} onFocusCapture={onFocus}
    className={cn("scroll-mt-24 space-y-4 rounded-xl border bg-card p-4 sm:p-5", active && "border-ring/60")}>
    <header className="flex items-center justify-between gap-3"><h2 id={`${id}-title`} className="flex items-center gap-2.5 text-base font-semibold">
      <span aria-hidden="true" className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums", done ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>{done ? <Check className="size-3.5" /> : index}</span>{title}</h2>
      <StatusBadge tone={done ? "success" : "warning"} label={done ? t("done") : t("needs", { count: issues })} /></header>
    <div className="space-y-4">{children}</div>
  </section>;
}

/** The bordered switch row of the composer's option rows: title and a short line on the left, the switch on the right, details below when on. */
export function SwitchRow({ title, note, checked, onChecked, disabled, children }: { title: string; note?: string; checked: boolean; onChecked: (value: boolean) => void; disabled?: boolean; children?: React.ReactNode }) {
  const id = useId();
  return <div className="rounded-lg border" data-state={checked ? "on" : "off"}>
    <div className="flex min-h-14 items-center justify-between gap-3 px-3 py-2">
      <label htmlFor={id} className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center gap-0.5"><span className="text-sm font-medium">{title}</span>{note && <span className="text-xs text-muted-foreground">{note}</span>}</label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChecked} />
    </div>
    {checked && children && <div className="space-y-2 border-t px-3 py-3">{children}</div>}
  </div>;
}

/** A card-style radio list: native radios, so arrow keys and screen readers work; an unavailable option stays visible with its reason. */
export function RadioCards<T extends string>({ name, label, value, onChange, options, columns = 2 }: {
  name: string; label: string; value: T; onChange: (value: T) => void; columns?: 1 | 2 | 3;
  options: { value: T; title: string; note?: string | null; disabled?: boolean; icon?: React.ReactNode; badge?: string }[];
}) {
  return <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium">{label}</legend>
    <div className={cn("grid gap-2", columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "")}>
      {options.map((option) => <label key={option.value} data-state={option.disabled ? "unavailable" : value === option.value ? "selected" : "available"} data-value={option.value}
        className={cn("relative flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
          value === option.value && !option.disabled && "border-primary bg-primary/5", option.disabled && "cursor-not-allowed bg-muted/40 text-muted-foreground", !option.disabled && value !== option.value && "hover:bg-muted/50")}>
        <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={option.disabled} onChange={() => onChange(option.value)} className="sr-only" />
        {option.icon && <span aria-hidden="true" className="mt-0.5 shrink-0 [&_svg]:size-4">{option.icon}</span>}
        <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-medium">{option.title}{option.badge && <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">{option.badge}</span>}</span>
          {option.note && <span className="mt-0.5 block text-xs text-muted-foreground">{option.note}</span>}</span>
        {value === option.value && !option.disabled && <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />}
      </label>)}
    </div></fieldset>;
}
