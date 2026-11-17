/** Derived from Shadcn UI Kit item form-layout20 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 4). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Stepper, type StepperStep } from "@/components/stepper";
import { adjacentStep, stepIndex } from "@/lib/stepper";

export type WizardStep = StepperStep & { description?: string };

/**
 * A guided step frame: the step indicator, the current step's heading and content, and Back / Next / Finish. It holds no data: the caller owns the
 * current step and the values. `validate` is the hook point that runs before Next (return false to stay; show the reason in the step, or pass `error`).
 * Disabled steps are skipped. Moving with Back, Next or Finish puts focus on the step heading; picking a step from a separate step list does not.
 * Pass `stepper={false}` when a surrounding shell already shows the steps, and `focusOnStepChange` when that shell's own step list should also move focus
 * to the heading (the editing sidebar and the phone step sheet do). Without `onFinish` the last step has no primary button.
 */
export function WizardLayout({ steps, current, onStepChange, stepsLabel, stepper = true, focusOnStepChange = false, validate, onFinish, busy = false, error, backLabel, nextLabel, finishLabel, children }: {
  steps: readonly WizardStep[]; current: string; onStepChange: (id: string) => void; stepsLabel: string; stepper?: boolean; focusOnStepChange?: boolean;
  validate?: (stepId: string) => boolean | Promise<boolean>; onFinish?: () => void | Promise<void>; busy?: boolean; error?: string;
  backLabel?: string; nextLabel?: string; finishLabel?: string; children: React.ReactNode;
}) {
  const t = useTranslations("ComponentsWizardLayout");
  const heading = useRef<HTMLHeadingElement>(null), moved = useRef(false), mounted = useRef(true);
  const [checking, setChecking] = useState(false);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const shown = useRef(current);
  useEffect(() => {
    const changed = shown.current !== current;
    shown.current = current;
    if (moved.current || (focusOnStepChange && changed)) { moved.current = false; heading.current?.focus(); }
  }, [current, focusOnStepChange]);
  const at = stepIndex(steps, current), step = steps[at];
  const previous = adjacentStep(steps, current, -1), next = adjacentStep(steps, current, 1);
  const working = busy || checking;

  async function go(direction: 1 | -1) {
    if (working || pending.current) return;
    const target = direction === 1 ? next : previous;
    if (!target) return;
    if (direction === 1 && validate) {
      setChecking(true);
      let ok = false;
      try { ok = await validate(current); } finally { if (mounted.current) setChecking(false); }
      if (!ok) return;
    }
    moved.current = true; onStepChange(target);
  }
  async function finish() {
    if (working || pending.current || !onFinish) return;
    // The ref closes the gap before React commits the pending state, including when busy is omitted.
    pending.current = true; setChecking(true);
    try {
      if (validate && !await validate(current)) return;
      await onFinish();
    } finally {
      pending.current = false;
      if (mounted.current) setChecking(false);
    }
  }
  const busyLabel = <><Spinner decorative size="sm" />{t("working")}</>;
  return <div className="min-w-0 space-y-6" data-slot="wizard-layout">
    {stepper && <Stepper steps={steps} current={current} label={stepsLabel} />}
    <Card>
      <CardHeader><h2 ref={heading} tabIndex={-1} data-slot="wizard-heading" className="text-lg font-semibold leading-none tracking-tight outline-none">{step?.label}</h2>
        {step?.description && <p className="text-sm text-muted-foreground">{step.description}</p>}</CardHeader>
      <CardContent className="space-y-6">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {children}
      </CardContent>
      {(previous || next || onFinish) && <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
        {previous ? <Button type="button" variant="outline" size="responsive" className="aria-disabled:opacity-70" aria-disabled={working || undefined} onClick={() => void go(-1)}>{backLabel ?? t("back")}</Button> : <span />}
        {next ? <Button type="button" size="responsive" className="aria-disabled:opacity-70" aria-disabled={working || undefined} onClick={() => void go(1)}>{working ? busyLabel : (nextLabel ?? t("next"))}</Button>
          : onFinish ? <Button type="button" size="responsive" className="aria-disabled:opacity-70" aria-disabled={working || undefined} onClick={() => void finish()}>{working ? busyLabel : (finishLabel ?? t("finish"))}</Button> : null}
      </CardFooter>}
    </Card>
  </div>;
}
