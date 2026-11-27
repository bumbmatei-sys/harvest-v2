"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { resolveStepParam, stepParam, withStepParam, type StepParamStep } from "@/lib/step-param";

/** Writes the step into the address without a server round trip (Next keeps useSearchParams in step with the History API). */
function writeStep(id: string | null) {
  const next = withStepParam(window.location.href, id);
  if (next !== window.location.href) window.history.replaceState(null, "", next);
}

/**
 * `?step=` deep links for an editor (shell slice S8). On mount a known, unlocked step from the address is opened through `onStep`
 * (the same path as the step list) and `focus` runs once it shows; an unknown or locked value leaves the editor on its own step and is
 * removed from the address. After that, every step change replaces `?step=` (no new history entry, so Back still leaves the editor).
 * The address is not touched until the step changes, so an editor opened without the parameter keeps its plain address.
 */
export function useStepParam({ steps, current, onStep, focus, enabled = true }: {
  steps: readonly StepParamStep[]; current: string; onStep: (id: string) => void; focus: () => void; enabled?: boolean;
}) {
  const latest = useRef({ steps, onStep, focus });
  useLayoutEffect(() => { latest.current = { steps, onStep, focus }; });
  const ready = useRef(false), shown = useRef(current), pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const result = resolveStepParam(latest.current.steps, new URL(window.location.href).searchParams.get(stepParam));
    ready.current = true;
    if (result.kind === "fallback") writeStep(null);
    else if (result.kind === "open") {
      if (result.id === shown.current) latest.current.focus();
      else { pendingFocus.current = result.id; latest.current.onStep(result.id); }
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !ready.current || shown.current === current) return;
    shown.current = current;
    writeStep(current);
    if (pendingFocus.current === current) { pendingFocus.current = null; latest.current.focus(); }
  }, [current, enabled]);
}
