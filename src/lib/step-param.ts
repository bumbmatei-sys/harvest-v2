// `?step=` deep links for the shared editor shell (shell slice S8). Pure rules, unit-tested; the hook in `src/hooks/use-step-param.ts` applies them.

export const stepParam = "step";
/** Longer than any step id; anything longer is treated as unknown without comparing it. */
const maxStepParamLength = 64;

export type StepParamStep = { id: string; disabled?: boolean };
/**
 * What a `?step=` value asks for:
 * - `none`: no value (or an empty one), the editor keeps its own first step and the URL is left alone;
 * - `open`: a known step that can be opened now, the same rule as picking it in the step list;
 * - `fallback`: an unknown or locked step, the editor keeps its own step and the value is removed from the URL.
 */
export type StepParamResult = { kind: "none" } | { kind: "open"; id: string } | { kind: "fallback" };

export function resolveStepParam(steps: readonly StepParamStep[], raw: string | null | undefined): StepParamResult {
  if (raw === null || raw === undefined || raw === "") return { kind: "none" };
  if (raw.length > maxStepParamLength) return { kind: "fallback" };
  const step = steps.find((item) => item.id === raw);
  return step && !step.disabled ? { kind: "open", id: step.id } : { kind: "fallback" };
}

/** The same address with `?step=` set to `id` (or removed when null); other parameters and the hash are kept. */
export function withStepParam(href: string, id: string | null) {
  const url = new URL(href);
  if (id) url.searchParams.set(stepParam, id); else url.searchParams.delete(stepParam);
  return url.toString();
}
