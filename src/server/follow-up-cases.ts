import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { uuidInput } from "../lib/contact-input";
import { FOLLOW_UP_PAGE_DEFAULT, FOLLOW_UP_PAGE_MAX, followUpAssignInput, followUpOpenInput, followUpPageInput, followUpTransitionInput, type FollowUpCaseState } from "../lib/follow-up-cases";
import { message } from "../i18n/messages";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

// HC-13 server side. A follow-up case references a verified, associated CRM contact; it holds ids, a state and timestamps only. Reads
// run under the database policy (owner/admin: every case; the assigned member: their own open cases) and writes only through the
// followup_* definers, which re-check role, assignment and the legal transitions. This layer maps outcomes: every denial is one 403
// body (non-member, viewer, unassigned member, other ministry, unknown id for a counselor), and nothing here returns a count or total.
// Only existing catalogue messages are used; callers distinguish outcomes by status and details.reason.
export type FollowUpCase = { id: string; state: FollowUpCaseState; contactId: string; assigneeId: string | null; version: number;
  createdAt: Date; updatedAt: Date; stateChangedAt: Date; assignedAt: Date | null };

const denied = () => new AccessError(403, message("Errors.workspaceAccessDenied"));
const caseMissing = () => new AccessError(404, message("Errors.requestFailed"), { reason: "not_found" });
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });

function pgError(error: unknown): { code?: string; message: string } {
  let code: string | undefined, text = "";
  for (let current: unknown = error, depth = 0; current && typeof current === "object" && depth < 5; current = "cause" in current ? current.cause : undefined, depth += 1) {
    if (!code && "code" in current && typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) code = current.code;
    if ("message" in current && typeof current.message === "string") text += ` ${current.message}`;
  }
  return { code, message: text };
}
/** One answer for every denial; the database's own outcomes become the documented statuses. Anything else is re-thrown untouched. */
function mapped(error: unknown): never {
  if (error instanceof AccessError) throw error.status === 403 ? denied() : error;
  const { code, message: text } = pgError(error);
  if (code === "42501") throw denied();
  if (code === "P0002") throw caseMissing();
  if (code === "40001" || code === "40P01") throw stale();
  if (code === "23514") {
    if (text.includes("assignee is not an eligible member")) throw new AccessError(400, message("Errors.theAssigneeMustBeAWorkspaceMember"), { reason: "assignee_not_eligible" });
    if (text.includes("case transition is not allowed") || text.includes("case assignment is not allowed")) throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "illegal_transition" });
    if (text.includes("follow-up consent is not in effect")) throw new AccessError(409, message("Errors.requestFailed"), { reason: "consent_not_in_effect" });
    if (text.includes("use assignment")) throw new AccessError(400, message("Errors.checkTheSuppliedDetails"));
  }
  throw error;
}

const cursorKey = z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?[+-]\d\d(:?\d\d)?$/);
const encodeCursor = (key: string, id: string) => Buffer.from(JSON.stringify([key, id])).toString("base64url");
function decodeCursor(token: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new z.ZodError([{ code: "custom", path: ["cursor"], message: "invalid cursor" }]);
  return z.tuple([cursorKey, uuidInput]).parse(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
}

type Row = { id: string; state: FollowUpCaseState; contact_id: string; assignee_id: string | null; version: number;
  created_at: Date | string; updated_at: Date | string; state_changed_at: Date | string; assigned_at: Date | string | null };
const columns = sql`id, state, contact_id, assignee_id, version, created_at, updated_at, state_changed_at, assigned_at`;
const fromRow = (row: Row): FollowUpCase => ({ id: row.id, state: row.state, contactId: row.contact_id, assigneeId: row.assignee_id, version: row.version,
  createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at), stateChangedAt: new Date(row.state_changed_at), assignedAt: row.assigned_at ? new Date(row.assigned_at) : null });
type Json = { id: string; state: FollowUpCaseState; contactId: string; assigneeId: string | null; version: number;
  createdAt: string; updatedAt: string; stateChangedAt: string; assignedAt: string | null };
const fromJson = (json: Json): FollowUpCase => ({ ...json, createdAt: new Date(json.createdAt), updatedAt: new Date(json.updatedAt), stateChangedAt: new Date(json.stateChangedAt), assignedAt: json.assignedAt ? new Date(json.assignedAt) : null });

/**
 * One bounded page, oldest first (default 50, at most 200, keyset on created time then id). Owners/admins see every case in the ministry;
 * a member sees only open cases assigned to them (the database policy decides, not this query). No total is ever returned.
 */
export async function listFollowUpCases(db: Database, userId: string, workspace: string, pageInput: { limit?: number; cursor?: string; state?: FollowUpCaseState } = {}) {
  const page = followUpPageInput.parse(pageInput), tenant = uuidInput.parse(workspace);
  const limit = Math.min(page.limit ?? FOLLOW_UP_PAGE_DEFAULT, FOLLOW_UP_PAGE_MAX), after = page.cursor !== undefined ? decodeCursor(page.cursor) : null;
  return withTenant(db, userId, tenant, "followup:work", async (tx, tenantId) => {
    const result = await tx.execute(sql`select ${columns}, created_at::text as cursor_key from public.followup_cases
      where tenant_id = ${tenantId}::uuid ${page.state ? sql`and state = ${page.state}` : sql``}
      ${after ? sql`and (created_at, id) > (${after[0]}::timestamptz, ${after[1]}::uuid)` : sql``}
      order by created_at, id limit ${limit + 1}`);
    const rows = result.rows as (Row & { cursor_key: string })[], items = rows.slice(0, limit), last = items.at(-1);
    return { items: items.map(fromRow), nextCursor: rows.length > limit && last ? encodeCursor(last.cursor_key, last.id) : null };
  }).catch(mapped);
}

/** One case. Owners/admins get 404 for an unknown id; every other caller gets the same 403 whether or not it exists. */
export async function getFollowUpCase(db: Database, userId: string, workspace: string, caseId: string) {
  const id = uuidInput.parse(caseId), tenant = uuidInput.parse(workspace);
  return withTenant(db, userId, tenant, "followup:work", async (tx, tenantId, role) => {
    const result = await tx.execute(sql`select ${columns} from public.followup_cases where tenant_id = ${tenantId}::uuid and id = ${id}::uuid`);
    const row = result.rows[0] as Row | undefined;
    if (!row) throw role === "owner" || role === "admin" ? caseMissing() : denied();
    return fromRow(row);
  }).catch(mapped);
}

/** Owner/admin: open cases for verified associated responses whose follow-up consent is in effect. Idempotent; at most 200 per call. */
export async function openEligibleFollowUpCases(db: Database, userId: string, workspace: string, input: { limit?: number } = {}) {
  const { limit } = followUpOpenInput.parse(input), tenant = uuidInput.parse(workspace);
  return withTenant(db, userId, tenant, "followup:manage", async (tx, tenantId) => {
    const result = await tx.execute(sql`select public.open_eligible_followup_cases(${tenantId}::uuid, ${limit ?? FOLLOW_UP_PAGE_DEFAULT}::integer) as opened`);
    return { opened: Number(result.rows[0]?.opened ?? 0) };
  }).catch(mapped);
}

/** Owner/admin: assign or reassign to an active member (owner, admin or member role), or unassign with assigneeId null. */
export async function assignFollowUpCase(db: Database, userId: string, workspace: string, caseId: string, input: unknown) {
  const id = uuidInput.parse(caseId), tenant = uuidInput.parse(workspace), data = followUpAssignInput.parse(input);
  return withTenant(db, userId, tenant, "followup:manage", async (tx, tenantId) => {
    const result = await tx.execute(sql`select public.assign_followup_case(${tenantId}::uuid, ${id}::uuid, ${data.assigneeId}::text, ${data.version}::integer) as result`);
    return fromJson(result.rows[0]?.result as Json);
  }).catch(mapped);
}

/** Owner/admin: any legal transition. The assigned member: contact progress on their own open case only. */
export async function transitionFollowUpCase(db: Database, userId: string, workspace: string, caseId: string, input: unknown) {
  const id = uuidInput.parse(caseId), tenant = uuidInput.parse(workspace), data = followUpTransitionInput.parse(input);
  return withTenant(db, userId, tenant, "followup:work", async (tx, tenantId) => {
    const result = await tx.execute(sql`select public.transition_followup_case(${tenantId}::uuid, ${id}::uuid, ${data.to}::text, ${data.version}::integer) as result`);
    return fromJson(result.rows[0]?.result as Json);
  }).catch(mapped);
}
