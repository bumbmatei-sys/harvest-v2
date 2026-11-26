// Editor mode (shell slice 3a): pure rules for the editing sidebar. No React here, so the same logic is unit-tested and shared
// by the sidebar, the phone step bar and the All steps sheet.

export type EditorStepState = "done" | "attention" | "todo" | "disabled";
export type EditorStatusKind = "draft" | "live" | "other";
export type EditorStepData = { id: string; label: string; state: EditorStepState; badge?: string; /** Heading above the first step of each group. */ group?: string };
/** Everything a page registers except its step handler. Plain data only (no functions, nodes or secrets), so it can be compared by value. */
export type EditorContextData = {
  title: string; typeLabel?: string; status: { kind: EditorStatusKind; label: string };
  back: { href: string; label: string };
  steps: EditorStepData[]; current: string; stepsLabel: string;
  openPage?: { href: string; label: string };
  /** Unsaved or unsynced changes. Informational for the shell; the leave guard itself stays with the page. */
  dirty?: boolean;
};
export type EditorContext = EditorContextData & { onStep: (id: string) => void };

/** What an editor step says about itself: disabled wins, then done, then needs attention, otherwise not started. */
export function editorStepState(step: { disabled?: boolean; done?: boolean; attention?: boolean }): EditorStepState {
  return step.disabled ? "disabled" : step.done ? "done" : step.attention ? "attention" : "todo";
}

export type EditorStepView = EditorStepData & { number: number; current: boolean; selectable: boolean };
export function editorStepViews(steps: readonly EditorStepData[], current: string): EditorStepView[] {
  return steps.map((step, index) => ({ ...step, number: index + 1, current: step.id === current, selectable: step.state !== "disabled" }));
}
/** "Step n of m" counts every listed step, disabled ones included, so the number matches the one beside the step. Null for an unknown step. */
export function stepPosition(steps: readonly EditorStepData[], current: string) {
  const index = steps.findIndex((step) => step.id === current);
  return index < 0 ? null : { current: index + 1, total: steps.length, label: steps[index].label };
}
/** The registered context is compared and copied by this key; a non-serialisable value would not survive it. */
export const editorContextKey = (data: EditorContextData) => JSON.stringify(data);

/** How a step's marker is drawn: done is a green check, attention an alert mark, the current step stays the filled primary circle, the rest a plain numbered circle. */
export type StepMarkKind = "done" | "attention" | "current" | "todo";
export function stepMarkKind(step: { state: EditorStepState; current: boolean }): StepMarkKind {
  if (step.state === "done") return "done";
  if (step.state === "attention") return "attention";
  return step.current && step.state !== "disabled" ? "current" : "todo";
}
/** Marker classes by kind. Done uses the `--success` token (tuned for AA on the sidebar and card backgrounds in both colour schemes). */
export const stepMarkClass: Record<StepMarkKind, string> = {
  done: "border-step-done bg-step-done/10 text-step-done",
  attention: "border-destructive/30 bg-destructive/10 text-destructive",
  current: "border-primary bg-primary text-primary-foreground",
  todo: "border-border bg-background text-muted-foreground",
};
