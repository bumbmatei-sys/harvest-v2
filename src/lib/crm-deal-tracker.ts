import type { TrackerStep } from "./status-tracker";

type StageLike = { id: string; name: string; kind: "open" | "won" | "lost"; archived?: boolean };

/**
 * Steps shown on a deal's status tracker: the pipeline's open stages in order, then the current stage when
 * the deal is closed (won or lost). Archived stages appear only when the deal still sits in one.
 */
export function dealTrackerSteps(stages: readonly StageLike[], currentId: string): { steps: TrackerStep[]; tone: "default" | "success" | "danger" } {
  const current = stages.find((stage) => stage.id === currentId);
  const steps = stages.filter((stage) => stage.kind === "open" && (!stage.archived || stage.id === currentId)).map(({ id, name }) => ({ id, label: name }));
  if (current && current.kind !== "open") steps.push({ id: current.id, label: current.name });
  return { steps, tone: current?.kind === "won" ? "success" : current?.kind === "lost" ? "danger" : "default" };
}
