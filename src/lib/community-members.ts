import type { StatusTone } from "@/lib/status-tone";
import { defineStatusTones } from "@/lib/status-tone";

/** Pure helpers for the community member list (presentation only; the server decides who may see which members). */
export const memberStatusTone = defineStatusTones({ active: "success", pending: "pending", banned: "danger", left: "neutral", removed: "neutral" }) as (status: string) => StatusTone;
const staffRoles = new Set(["owner", "admin", "moderator"]);
export const isStaffRole = (role: string) => staffRoles.has(role);

/** One or two capital letters for the avatar mark; "?" when the member has no name. */
export function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0]!)[0] ?? "?", last = parts.length > 1 ? Array.from(parts[parts.length - 1]!)[0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}

/** Case-insensitive name filter; an empty query keeps everyone. */
export function filterMembers<T extends { name: string }>(members: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  return needle ? members.filter((member) => member.name.toLowerCase().includes(needle)) : [...members];
}

/** Status tabs for the owner list: "all" first, then each status that is present, in first-seen order, with counts. */
export function statusTabs(members: readonly { status?: string }[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const member of members) if (member.status) counts.set(member.status, (counts.get(member.status) ?? 0) + 1);
  return [{ value: "all", count: members.length }, ...[...counts].map(([value, count]) => ({ value, count }))];
}
