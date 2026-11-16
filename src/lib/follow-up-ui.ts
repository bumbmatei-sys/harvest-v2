import { can } from "./permissions";
import { counselorTransitions, followUpCaseStates, followUpTerminalStates, followUpTransitionAllowed, followUpTransitionTargets, type FollowUpCaseState } from "./follow-up-cases";
import { defineStatusTones } from "./status-tone";
import type { TrackerStep } from "./status-tracker";

// Kit PR 6: presentation helpers for the follow-up queue and case detail. Nothing here decides access: the database policy and the
// definer functions do. These helpers only decide which controls to show, so a role never sees an action the server would refuse.

export const followUpTone = defineStatusTones({
  requested: "pending", awaiting_assignment: "warning", assigned: "info", attempted: "info", no_response: "warning", connected: "success", closed: "neutral", withdrawn: "danger",
});

/** Short, stable reference for a case. The id is random and unrelated to the response, so it reveals nothing. */
export const caseReference = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

/** Roles that may open the queue at all (nav item and page). Viewers and unknown roles never see it. */
export const canOpenFollowUp = (role: string | undefined) => role !== undefined && can(role, "followup:work");
export const canManageFollowUp = (role: string | undefined) => role !== undefined && can(role, "followup:manage");

export type QueueTab = "all" | FollowUpCaseState;
const memberTabs: readonly QueueTab[] = ["all", "assigned", "attempted", "no_response", "connected"];
/** Filter tabs for a role. A counselor only ever sees open cases they hold, so closed and withdrawn would always be empty. */
export function queueTabs(role: string | undefined): QueueTab[] {
  if (canManageFollowUp(role)) return ["all", "requested", "awaiting_assignment", "assigned", "attempted", "no_response", "connected", "closed", "withdrawn"];
  return canOpenFollowUp(role) ? [...memberTabs] : [];
}

/** URL state of the queue: a state filter and the opaque cursor of the page. Unknown values fall back to the first page of everything. */
export function parseQueueQuery(raw: Record<string, string | string[] | undefined>, role?: string): { state: QueueTab; cursor?: string } {
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  const state = one(raw.state), cursor = one(raw.cursor);
  const known = (followUpCaseStates as readonly string[]).includes(state ?? "") && (role === undefined || queueTabs(role).includes(state as QueueTab));
  return { state: known ? (state as FollowUpCaseState) : "all", ...(cursor && cursor.length <= 200 && /^[A-Za-z0-9_-]+$/.test(cursor) ? { cursor } : {}) };
}
export function queueHref(base: string, query: { state: QueueTab; cursor?: string }) {
  const params = new URLSearchParams();
  if (query.state !== "all") params.set("state", query.state);
  if (query.cursor) params.set("cursor", query.cursor);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

/** Progress shown above a case: the main path, with the side states taking the place of the steps they replace. Read-only. */
export function caseTracker(state: FollowUpCaseState): { steps: TrackerStep[]; tone: "default" | "success" | "danger" } {
  const path = ["requested", "awaiting_assignment", "assigned", "attempted"] as const;
  const mk = (ids: readonly string[]) => ids.map((id) => ({ id, label: id }));
  if (state === "withdrawn") return { steps: mk([...path, "withdrawn"]), tone: "danger" };
  if (state === "no_response") return { steps: mk([...path, "no_response", "closed"]), tone: "default" };
  return { steps: mk([...path, "connected", "closed"]), tone: state === "closed" ? "success" : "default" };
}

export type CaseActions = {
  /** Assign or reassign to a member (owner/admin). */
  assign: boolean;
  /** Return the case to the unassigned queue (owner/admin). */
  unassign: boolean;
  /** States a plain transition request may name, in display order. */
  moves: Exclude<FollowUpCaseState, "requested" | "assigned">[];
};
/**
 * Which controls a role may see for one case. Mirrors the server: owners and admins make any legal move; the assigned member only the
 * contact-progress moves; everyone else nothing. The server stays the enforcement and answers every refusal with one 403.
 */
export function caseActions(role: string | undefined, state: FollowUpCaseState, assignedToViewer: boolean): CaseActions {
  const none: CaseActions = { assign: false, unassign: false, moves: [] };
  if (canManageFollowUp(role)) {
    // Unassigning goes through the assignment call; the plain move to "awaiting assignment" is only the first step out of "requested".
    const targets = followUpTransitionTargets.filter((to) => followUpTransitionAllowed(state, to) && (to !== "awaiting_assignment" || state === "requested"));
    return { assign: followUpTransitionAllowed(state, "assigned"), unassign: followUpTransitionAllowed(state, "awaiting_assignment") && state !== "requested", moves: targets };
  }
  if (!canOpenFollowUp(role) || !assignedToViewer) return none;
  return { ...none, moves: (counselorTransitions[state] ?? []) as CaseActions["moves"] };
}
/** Moves that end the case or cannot be undone get a confirmation step. */
export const consequentialMoves: readonly FollowUpCaseState[] = [...followUpTerminalStates];

export type CaseEvent = { kind: "opened" | "assigned" | "state"; at: Date; state?: FollowUpCaseState };
/**
 * The events the case record itself proves: when it was opened, when it was last assigned and when its state last changed. The case keeps no
 * history, so this is not a full log; it never invents an event it holds no timestamp for. Oldest first.
 */
export function caseEvents(item: { state: FollowUpCaseState; createdAt: Date; assignedAt: Date | null; stateChangedAt: Date }): CaseEvent[] {
  const events: CaseEvent[] = [{ kind: "opened", at: item.createdAt }];
  if (item.assignedAt) events.push({ kind: "assigned", at: item.assignedAt });
  const sameAsAssignment = item.assignedAt !== null && item.assignedAt.getTime() === item.stateChangedAt.getTime() && item.state === "assigned";
  if (item.stateChangedAt.getTime() > item.createdAt.getTime() && !sameAsAssignment) events.push({ kind: "state", at: item.stateChangedAt, state: item.state });
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}
