/** Search appears only for people who belong to more than this many ministries. */
export const MINISTRY_SEARCH_THRESHOLD = 5;

export type SwitcherMinistry = { tenantId: string; name: string; role: string; memberCount?: number };

/** Up to two initials from the first two words of a ministry name; "M" when the name has no letters or digits. */
export function ministryInitials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "M";
}

export function shouldShowMinistrySearch(count: number): boolean {
  return count > MINISTRY_SEARCH_THRESHOLD;
}

/** Case-insensitive substring match on the ministry name; a blank query matches everything. */
export function ministryMatches(name: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || name.toLocaleLowerCase().includes(needle);
}

export function filterMinistries<T extends { name: string }>(ministries: readonly T[], query: string): T[] {
  return ministries.filter((item) => ministryMatches(item.name, query));
}

export function ministryHref(tenantId: string): string {
  return `/workspaces/${tenantId}/crm/people`;
}

const switcherRoles = ["owner", "admin", "member", "viewer", "collaborator", "guest"] as const;
export type SwitcherRoleKey = typeof switcherRoles[number];
/**
 * The catalogue key for a role shown in the switcher. A collaborator's role token (`collaborator;crm=manage`) shows as Collaborator, and the
 * campaign invitation role (`campaign_guest`, treated exactly like guest) as Guest. Null for an id with no label, which is then shown as stored.
 */
export function switcherRoleKey(role: string): SwitcherRoleKey | null {
  const base = role.split(";")[0];
  if (base === "campaign_guest") return "guest";
  return (switcherRoles as readonly string[]).includes(base) ? base as SwitcherRoleKey : null;
}
