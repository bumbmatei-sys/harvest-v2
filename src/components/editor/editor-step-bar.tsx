"use client";
import { Fragment } from "react";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowLeft, ChevronsUpDown, Eye, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { editorStepViews, stepPosition, type EditorContextData } from "@/lib/editor-context";
import { stepProgress } from "@/lib/stepper";
import { StepIndicator, StepStatusText } from "@/components/editor/editor-step-parts";
import { scrollToTop } from "@/components/wizard-layout";

/**
 * Phone and tablet step bar (below 1024px, where there is no editing sidebar column): "Step n of m" with the current step, a progress bar,
 * and an All steps sheet with every step's state, the back link and Open page. Picking a step closes the sheet and moves focus to the
 * step's heading (the caller's WizardLayout marks it `data-slot="wizard-heading"`). 44px targets.
 */
export function EditorStepBar({ context, onStep, onPreview, className }: { context: Pick<EditorContextData, "steps" | "current" | "stepsLabel" | "back" | "openPage">; onStep: (id: string) => void; /** Shows a Preview button beside the step trigger (live preview, shell slice 3b). */ onPreview?: () => void; className?: string }) {
  const t = useTranslations("EditorMode");
  const [open, setOpen] = useState(false);
  const picked = useRef(false);
  const position = stepPosition(context.steps, context.current);
  if (!position) return null;
  const steps = editorStepViews(context.steps, context.current);
  return <div data-slot="editor-step-bar" className={cn("sticky top-2 z-10 rounded-xl border bg-card shadow-sm lg:hidden", className)}>
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1 pr-2">
        <SheetTrigger asChild>
          <button type="button" aria-label={t("stepBarLabel", { current: position.current, total: position.total, label: position.label })}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground" aria-hidden="true">{t("stepOf", { current: position.current, total: position.total })}</span>
              <span className="block truncate text-sm font-medium" aria-hidden="true">{position.label}</span>
            </span>
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </SheetTrigger>
        {onPreview && <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={onPreview}><Eye aria-hidden="true" />{t("preview")}</Button>}
      </div>
      <div aria-hidden="true" className="mx-4 mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-[color:var(--accent-current,var(--primary))] transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${stepProgress(position.current - 1, position.total)}%` }} />
      </div>
      <SheetContent side="bottom" className="overflow-y-auto"
        onCloseAutoFocus={(event) => { if (!picked.current) return; picked.current = false; event.preventDefault(); const heading = document.querySelector<HTMLElement>('[data-slot="wizard-heading"]'); scrollToTop(heading); heading?.focus({ preventScroll: true }); }}>
        <SheetHeader><SheetTitle>{t("allSteps")}</SheetTitle></SheetHeader>
        <div className="space-y-2 px-4 pb-4">
          <Button asChild variant="ghost" className="min-h-11 w-full justify-start"><Link href={context.back.href} aria-label={t("backTo", { label: context.back.label })}><ArrowLeft aria-hidden="true" />{context.back.label}</Link></Button>
          <nav aria-label={context.stepsLabel}>
            <ol className="space-y-1">
              {steps.map((step, index) => <Fragment key={step.id}>{step.group && step.group !== steps[index - 1]?.group && <li data-slot="step-group" className="flex items-center gap-2 px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground first:pt-0"><span aria-hidden="true" className="size-1.5 rounded-full bg-chart-1" />{step.group}</li>}<li>
                <button type="button" aria-current={step.current ? "step" : undefined} aria-disabled={!step.selectable || undefined}
                  onClick={() => { if (!step.selectable) return; picked.current = true; onStep(step.id); setOpen(false); }}
                  className={cn("flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    step.current ? "bg-muted font-medium" : "hover:bg-muted/60", !step.selectable && "cursor-not-allowed text-muted-foreground hover:bg-transparent")}>
                  <StepIndicator step={step} />
                  <span className="min-w-0 flex-1 truncate">{step.label}</span>
                  {step.badge && <span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">{step.badge}</span>}
                  <StepStatusText step={step} />
                </button>
              </li></Fragment>)}
            </ol>
          </nav>
          {context.openPage && <Button asChild variant="ghost" className="min-h-11 w-full justify-start"><a href={context.openPage.href} target="_blank" rel="noopener"><ExternalLink aria-hidden="true" />{context.openPage.label}</a></Button>}
        </div>
      </SheetContent>
    </Sheet>
  </div>;
}
