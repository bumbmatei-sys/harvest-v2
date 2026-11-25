"use client";
import { Check, CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { stepMarkClass, stepMarkKind, type EditorStepView } from "@/lib/editor-context";
import { scrollToTop } from "@/components/wizard-layout";

const stateKey = { done: "stepDone", attention: "stepAttention", todo: "stepTodo", disabled: "stepDisabled" } as const;

/** Numbered circle; a check when done, an alert mark when it needs attention. Decorative: the state is also read out as text. */
export function StepIndicator({ step, className }: { step: EditorStepView; className?: string }) {
  return <span aria-hidden="true" data-slot="editor-step-indicator" data-state={step.state}
    className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums", stepMarkClass[stepMarkKind(step)], className)}>
    {step.state === "done" ? <Check className="size-3.5" /> : step.state === "attention" ? <CircleAlert className="size-3.5" /> : step.number}</span>;
}

/** The step's state (and "current") as text for assistive technology. */
export function StepStatusText({ step }: { step: EditorStepView }) {
  const t = useTranslations("EditorMode");
  return <>{step.current && <span className="sr-only">{t("stepCurrent")}</span>}<span className="sr-only">{t(stateKey[step.state])}</span></>;
}

/**
 * After a step is chosen from the mobile drawer, focus the step heading once the drawer has closed. The drawer is a dialog that returns focus to
 * its trigger when it unmounts, so the heading is focused after that has happened (it also waits out the close animation).
 */
export function focusStepHeadingWhenDrawerCloses() {
  let tries = 0;
  const tick = () => {
    if (document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]') && tries++ < 60) { requestAnimationFrame(tick); return; }
    window.setTimeout(() => { const heading = document.querySelector<HTMLElement>('[data-slot="wizard-heading"]'); scrollToTop(heading); heading?.focus({ preventScroll: true }); }, 60);
  };
  requestAnimationFrame(tick);
}
