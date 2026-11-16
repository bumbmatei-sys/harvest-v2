/** Pure step helpers shared by Stepper and WizardLayout. */
export type StepState = "done" | "active" | "upcoming";
export type StepRef = { id: string; done?: boolean; disabled?: boolean };

export const stepIndex = (steps: readonly StepRef[], current: string) => steps.findIndex((step) => step.id === current);

/**
 * State per step. `linear` (a wizard) treats every step before the current one as done; otherwise only steps
 * marked `done` are (a navigation list such as the community editor, where steps can be visited in any order).
 * `done` reports completion separately from `state`, so the current step can also show as completed.
 */
export function stepStates(steps: readonly StepRef[], current: string, linear: boolean): { state: StepState; done: boolean }[] {
  const at = stepIndex(steps, current);
  return steps.map((step, index) => {
    const done = Boolean(step.done) || (linear && at > -1 && index < at);
    return { state: index === at ? "active" : done ? "done" : "upcoming", done };
  });
}

/** Percent through the steps, counting the current one: step 2 of 4 is 50. */
export function stepProgress(index: number, total: number) {
  if (total <= 0 || index < 0) return 0;
  return Math.min(100, Math.round(((index + 1) / total) * 100));
}

/** The next or previous step that is not disabled, or null at either end. */
export function adjacentStep(steps: readonly StepRef[], current: string, direction: 1 | -1): string | null {
  for (let index = stepIndex(steps, current) + direction; index >= 0 && index < steps.length; index += direction) if (!steps[index].disabled) return steps[index].id;
  return null;
}
