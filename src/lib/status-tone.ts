/** Tones for StatusBadge. The component knows tones only; each caller maps its own statuses to a tone. */
export const statusTones = ["neutral", "success", "warning", "danger", "info", "pending"] as const;
export type StatusTone = (typeof statusTones)[number];

/**
 * Typed status -> tone mapping supplied by the caller:
 * `const tone = defineStatusTones({ published: "success", draft: "neutral" })`, then `tone(status)`.
 * Unknown statuses fall back to neutral so a new server value never breaks the page.
 */
export function defineStatusTones<const Status extends string>(map: Readonly<Record<Status, StatusTone>>): (status: string) => StatusTone {
  return (status) => (Object.prototype.hasOwnProperty.call(map, status) ? map[status as Status] : "neutral");
}
