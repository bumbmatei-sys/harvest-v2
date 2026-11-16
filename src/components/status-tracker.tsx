/** Derived from Shadcn UI Kit item todo-app6 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 5). Visual reference only; local changes: docs/ui-sources.md. */
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { trackerPosition, trackerStates, type TrackerStep } from "@/lib/status-tracker";

const fill = { default: "bg-primary", success: "bg-success", danger: "bg-destructive" } as const;

/**
 * Read-only progress through ordered steps: one segment per step, the current step marked with `aria-current="step"`,
 * and done / current / upcoming also spelled out for screen readers. From 640px every label shows;
 * below that only the current one does, with a "Step n of m" count. The caller owns the data and any
 * control that changes it; nothing here moves a record.
 */
export function StatusTracker({ steps, current, label, tone = "default", className }: {
  steps: readonly TrackerStep[]; current: string; label: string; tone?: keyof typeof fill; className?: string;
}) {
  const t = useTranslations("ComponentsStatusTracker");
  const states = trackerStates(steps, current), { index, total } = trackerPosition(steps, current);
  if (steps.length === 0) return null;
  return <div data-status-tracker className={cn("space-y-1.5", className)}>
    <ol aria-label={label} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((step, position) => {
        const state = states[position];
        return <li key={step.id} data-state={state} aria-current={state === "current" ? "step" : undefined} className="min-w-0 space-y-1.5">
          <span aria-hidden="true" className={cn("block h-1 rounded-full", state === "upcoming" ? "bg-muted" : fill[tone])} />
          <span className={cn("block truncate text-xs leading-tight", state === "current" ? "font-medium" : "sr-only text-muted-foreground sm:not-sr-only sm:block")} title={step.label}>{step.label}
            <span className="sr-only"> {t(state)}</span></span>
        </li>;
      })}
    </ol>
    {index > 0 && <p aria-hidden="true" className="text-xs text-muted-foreground sm:hidden">{t("position", { index, total })}</p>}
  </div>;
}
