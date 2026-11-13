// Connect retention policy numbers (HC-DEC3 and HC-DEC4 directions selected by the founder on 13 Nov 2026).
// These are engineering defaults, not approved policy: legal review may change them. The same numbers live in the
// SQL function public.connect_retention_policy() (migration 0043); a test fails if the two differ.
export const CONNECT_RETENTION_POLICY = {
  /** Longest retention a form version may set for unverified entries (shorter is allowed). */
  maxPendingDays: 30,
  /** How long an erased tombstone (campaign, link, form version, day) is kept before it is deleted. */
  tombstoneDays: 90,
  /** Reports hide counts of 1 up to one less than this. */
  smallGroupMin: 5,
  /** A retention run is overdue if none succeeded within this many hours. */
  healthWindowHours: 26,
} as const;

/**
 * Small-group suppression: a count of 1 to 4 can point at one person, so reports show nothing instead. Zero and counts of
 * five or more are shown. Every aggregate report over responses or tombstones (HC-15) must pass its counts through this.
 */
export function suppressSmall(count: number, minimum: number = CONNECT_RETENTION_POLICY.smallGroupMin): number | null {
  if (!Number.isFinite(count) || count < 0) return null;
  return count > 0 && count < minimum ? null : count;
}
