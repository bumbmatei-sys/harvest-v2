import { z } from "zod";

// HC-13: follow-up case lifecycle. Pure data shared by the schema, the service and tests. The database holds the same
// transition table (followup_case_transition_allowed) and a test compares the two, so neither can drift alone.
export const followUpCaseStates = ["requested", "awaiting_assignment", "assigned", "attempted", "no_response", "connected", "closed", "withdrawn"] as const;
export type FollowUpCaseState = typeof followUpCaseStates[number];
export const followUpTerminalStates = ["closed", "withdrawn"] as const satisfies readonly FollowUpCaseState[];

/** Legal state changes. `assigned -> assigned` is a reassignment to a different member; no other state repeats. */
export const followUpTransitions: Readonly<Record<FollowUpCaseState, readonly FollowUpCaseState[]>> = {
  requested: ["awaiting_assignment", "withdrawn"],
  awaiting_assignment: ["assigned", "withdrawn"],
  assigned: ["assigned", "awaiting_assignment", "attempted", "withdrawn"],
  attempted: ["assigned", "awaiting_assignment", "connected", "no_response", "withdrawn"],
  no_response: ["assigned", "awaiting_assignment", "attempted", "closed", "withdrawn"],
  connected: ["closed", "withdrawn"],
  closed: [],
  withdrawn: [],
};
export const followUpTransitionAllowed = (from: FollowUpCaseState, to: FollowUpCaseState) => followUpTransitions[from].includes(to);

/** What the assigned counselor (a member who is not an owner/admin) may do; owners and admins may make any legal change. */
export const counselorTransitions: Readonly<Partial<Record<FollowUpCaseState, readonly FollowUpCaseState[]>>> = {
  assigned: ["attempted"], attempted: ["connected", "no_response"], no_response: ["attempted"], connected: ["closed"],
};
/** Targets a plain transition request may name: assigning and unassigning go through the assignment call. */
export const followUpTransitionTargets = ["awaiting_assignment", "attempted", "no_response", "connected", "closed", "withdrawn"] as const;

export const FOLLOW_UP_PAGE_DEFAULT = 50, FOLLOW_UP_PAGE_MAX = 200;
export const followUpPageInput = z.object({ limit: z.number().int().min(1).optional(), cursor: z.string().max(200).optional(),
  state: z.enum(followUpCaseStates).optional() }).strict();
export const followUpOpenInput = z.object({ limit: z.number().int().min(1).optional() }).strict();
/** assigneeId null unassigns (back to awaiting_assignment). */
export const followUpAssignInput = z.object({ assigneeId: z.string().min(1).max(200).nullable(), version: z.number().int().min(1) }).strict();
export const followUpTransitionInput = z.object({ to: z.enum(followUpTransitionTargets), version: z.number().int().min(1) }).strict();
