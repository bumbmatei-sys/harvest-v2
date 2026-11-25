/** Derived from Shadcn UI Kit item stepper1 (free), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 4). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { Fragment } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { stepIndex, stepProgress, stepStates, type StepState } from "@/lib/stepper";

export type StepperStep = { id: string; label: string; done?: boolean; disabled?: boolean; badge?: string; /** A heading shown above the first step of each group (for example Campaign, Ad set, Ad). */ group?: string };

const indicatorTone: Record<StepState, string> = {
  active: "border-primary bg-primary text-primary-foreground",
  done: "border-step-done bg-step-done/10 text-step-done",
  upcoming: "border-border bg-background text-muted-foreground",
};

/** Numbered circle, or a check once the step is done. Decorative: the step's state is announced as text. */
function Indicator({ index, state, done, className }: { index: number; state: StepState; done: boolean; className?: string }) {
  return <span aria-hidden="true" data-slot="stepper-indicator" data-state={state}
    className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums", indicatorTone[state], className)}>
    {done ? <Check className="size-3.5" /> : index + 1}</span>;
}

/**
 * Step indicator, two layouts. `wizard` (default) is a numbered list for a guided flow: horizontal with connectors from 768px, and below that a
 * compact "Step n of m" line with a progress bar (`compact="never"` keeps the whole list, wrapped). `nav` is a list of buttons for an editor whose
 * steps can be visited in any order: a vertical list from 1024px, a scrollable bar below. The current step carries aria-current="step"; completion
 * and the current step are also announced as text. No JavaScript motion; the bar's width change stops under reduced motion.
 */
export function Stepper({ steps, current, label, layout = "wizard", linear, onSelect, compact = "phone", className }: {
  steps: readonly StepperStep[]; current: string; label: string; layout?: "wizard" | "nav"; linear?: boolean;
  onSelect?: (id: string) => void; compact?: "phone" | "never"; className?: string;
}) {
  const t = useTranslations("ComponentsStepper");
  const states = stepStates(steps, current, linear ?? layout === "wizard");
  const at = stepIndex(steps, current);
  const status = (state: StepState, done: boolean) => <span className="sr-only">{state === "active" ? t("currentStep") : done ? t("completed") : t("upcoming")}</span>;

  if (layout === "nav") return <nav aria-label={label} data-slot="stepper" data-layout="nav" className={cn("min-w-0", className)}>
    <ol className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
      {steps.map((step, index) => {
        const { state, done } = states[index];
        return <Fragment key={step.id}>{step.group && step.group !== steps[index - 1]?.group && <li data-slot="step-group" className="flex items-center gap-2 px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground first:pt-0 max-lg:hidden"><span aria-hidden="true" className="size-1.5 rounded-full bg-chart-1" />{step.group}</li>}<li className="shrink-0 lg:shrink">
          <button type="button" onClick={() => { if (!step.disabled) onSelect?.(step.id); }} aria-current={state === "active" ? "step" : undefined} aria-disabled={step.disabled || undefined}
            className={cn("flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9",
              state === "active" ? "bg-muted font-medium" : "hover:bg-muted/60", step.disabled && "cursor-not-allowed text-muted-foreground hover:bg-transparent")}>
            <Indicator index={index} state={state} done={done} />
            <span className="whitespace-nowrap lg:flex-1">{step.label}</span>
            {step.badge && <span className="whitespace-nowrap rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">{step.badge}</span>}
            {status(state, done)}
          </button>
        </li></Fragment>;
      })}
    </ol>
  </nav>;

  const percent = stepProgress(at, steps.length);
  return <div data-slot="stepper" data-layout="wizard" className={cn("min-w-0", className)}>
    {compact === "phone" && at > -1 && <div data-slot="stepper-compact" className="space-y-2 md:hidden">
      <p className="text-sm font-medium">{t("stepOf", { current: at + 1, total: steps.length })}<span className="ml-2 text-muted-foreground">{steps[at].label}</span></p>
      <div role="progressbar" aria-label={t("progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
    </div>}
    <ol aria-label={label} className={cn("items-start gap-x-5 gap-y-2 text-sm md:gap-x-0", compact === "phone" ? "hidden md:flex" : "flex flex-wrap md:flex-nowrap")}>
      {steps.map((step, index) => {
        const { state, done } = states[index];
        return <li key={step.id} aria-current={state === "active" ? "step" : undefined} className="flex min-w-0 items-center gap-2 md:flex-1 md:last:flex-none">
          <Indicator index={index} state={state} done={done} />
          <span className={cn("min-w-0 truncate", state === "active" ? "font-medium text-foreground" : "text-muted-foreground")}>{step.label}</span>
          {status(state, done)}
          {index < steps.length - 1 && <span aria-hidden="true" className={cn("mx-3 hidden h-px min-w-6 flex-1 md:block", done ? "bg-step-done" : "bg-border")} />}
        </li>;
      })}
    </ol>
  </div>;
}
