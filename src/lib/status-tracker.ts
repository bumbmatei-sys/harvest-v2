export type TrackerStep = { id: string; label: string };
export type TrackerState = "done" | "current" | "upcoming";

/** State of every step relative to the current one. An unknown current id leaves every step upcoming. */
export function trackerStates(steps: readonly TrackerStep[], currentId: string): TrackerState[] {
  const index = steps.findIndex((step) => step.id === currentId);
  return steps.map((_, position) => (index < 0 ? "upcoming" : position < index ? "done" : position === index ? "current" : "upcoming"));
}

/** "Step n of m" numbers for the compact (phone) line; 0 when the current id is unknown. */
export function trackerPosition(steps: readonly TrackerStep[], currentId: string): { index: number; total: number } {
  return { index: steps.findIndex((step) => step.id === currentId) + 1, total: steps.length };
}
