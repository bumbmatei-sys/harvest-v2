import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { aiToolApprovals, auditLogs } from "../../db/schema";
import { message } from "../../i18n/messages";
import { uuidInput } from "../../lib/contact-input";
import { parseTaskQuery, taskPriorities } from "../../lib/crm-tasks";
import { getTimeline } from "../activity";
import { getCompany, listCompanies } from "../companies";
import { getContact, listContacts } from "../contacts";
import { getDeal, listRelatedDeals, moveDeal } from "../crm-deals";
import { createTask, listTasks } from "../crm-tasks";
import { workFingerprint } from "../jobs/primitives";
import { AccessError, can, type Permission } from "../permissions";
import { withTenant } from "../tenancy";

/**
 * CRM-08: the CRM part of the assistant tool registry (docs/prd/AI-assistant-architecture.md §4).
 *
 * - Tools are model-independent: a validated input schema, a permission, and a `run` that calls the SAME
 *   permission-checked CRM services the app uses (membership, role and tenant are re-checked inside
 *   them). There is no privileged path, no SQL tool and no raw record dump.
 * - Read tools return a fixed, minimal shape. They never return person notes, custom field values,
 *   consent source/evidence, note or task body text, deal close reasons, or the content of recorded
 *   activities (that content is consent-restricted to its purpose, and assistant processing is not one).
 * - Write tools run only with an approval that the same person granted for exactly this tool and these
 *   arguments, in this workspace, that is unexpired and unused. The approval is consumed in the same
 *   transaction as the write; permissions are checked again at that moment.
 *
 * Not built here (no runtime exists yet): the model gateway, conversations, and the screen where a
 * person reviews and approves an action. Until they exist, `decideToolApproval` has no caller in the
 * product, so every write tool is denied by default.
 */
type Context = { db: Database; userId: string; workspaceId: string };
type Tool<S extends z.ZodType> = { name: string; description: string; mode: "read" | "write"; permission: Permission; input: S; run: (context: Context, input: z.output<S>) => Promise<unknown> };
const tool = <S extends z.ZodType>(definition: Tool<S>) => definition;

const id = z.uuid();
const page = z.number().int().min(1).max(100).default(1);
const query = z.string().trim().max(100).default("");
const subject = z.enum(["person", "organization", "deal"]);
const identifier = (rows: { kind: string; value: string }[], kind: string) => rows.find((row) => row.kind === kind)?.value ?? null;
const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

export const crmTools = {
  crm_search_people: tool({
    name: "crm_search_people", mode: "read", permission: "contacts:read",
    description: "Search People in this workspace by name, email, phone or handle. Returns 20 per page.",
    input: z.object({ query, page }).strict(),
    run: async ({ db, userId, workspaceId }, input) => {
      const result = await listContacts(db, userId, workspaceId, { q: input.query, page: input.page });
      return { total: result.total, page: result.page, people: result.rows.map((row) => ({
        id: row.id, name: row.name, email: identifier(row.identifiers, "email"), phone: identifier(row.identifiers, "phone"), handle: identifier(row.identifiers, "social"),
        organizations: row.companies.map((link) => ({ id: link.companyId, name: link.name, title: link.title, primary: link.isPrimary })),
      })) };
    },
  }),
  crm_get_person: tool({
    name: "crm_get_person", mode: "read", permission: "contacts:read",
    description: "Read one person: contact details, Organizations and the current consent status per purpose and channel.",
    input: z.object({ personId: id }).strict(),
    run: async ({ db, userId, workspaceId }, input) => {
      const row = await getContact(db, userId, workspaceId, input.personId);
      return {
        id: row.id, name: row.name, email: identifier(row.identifiers, "email"), phone: identifier(row.identifiers, "phone"), handle: identifier(row.identifiers, "social"),
        organizations: row.companies.map((link) => ({ id: link.companyId, name: link.name, title: link.title, primary: link.isPrimary })),
        consent: row.effectiveConsents.map((event) => ({ purpose: event.purpose, channel: event.channel, status: event.status, at: iso(event.occurredAt) })),
        createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
      };
    },
  }),
  crm_search_organizations: tool({
    name: "crm_search_organizations", mode: "read", permission: "companies:read",
    description: "Search Organizations in this workspace by name or domain. Returns 20 per page.",
    input: z.object({ query, page }).strict(),
    run: async ({ db, userId, workspaceId }, input) => {
      const result = await listCompanies(db, userId, workspaceId, { q: input.query, page: input.page });
      return { total: result.total, page: result.page, organizations: result.rows.map((row) => ({ id: row.id, name: row.name, domain: row.domain })) };
    },
  }),
  crm_get_organization: tool({
    name: "crm_get_organization", mode: "read", permission: "companies:read",
    description: "Read one Organization and the people linked to it.",
    input: z.object({ organizationId: id }).strict(),
    run: async ({ db, userId, workspaceId }, input) => {
      const row = await getCompany(db, userId, workspaceId, input.organizationId);
      return { id: row.id, name: row.name, domain: row.domain, description: row.description,
        people: row.people.map((person) => ({ id: person.id, name: person.name, title: person.title, primary: person.isPrimary })), createdAt: iso(row.createdAt) };
    },
  }),
  crm_get_timeline: tool({
    name: "crm_get_timeline", mode: "read", permission: "workspace:read",
    description: "Read the activity timeline of a person, Organization or deal, newest first, 50 per page. Note text and recorded activity content are not included.",
    input: z.object({ subject, recordId: id, cursor: z.string().max(200).nullable().default(null) }).strict(),
    run: async ({ db, userId, workspaceId }, input) => {
      const result = await getTimeline(db, userId, workspaceId, input.subject === "organization" ? "company" : input.subject, input.recordId, input.cursor);
      return { nextCursor: result.nextCursor, items: result.items.map((item) => {
        if (item.kind === "note") return { kind: "note" as const, at: iso(item.createdAt), author: item.actor.name, text: null, edited: !!item.editedAt };
        if (item.kind === "association") return { kind: "activity" as const, at: iso(item.createdAt), actor: item.actor.name, source: item.source, activity: item.activity,
          purpose: item.purpose, occurredAt: iso(item.occurredAt), removed: item.removed, personId: item.person?.id ?? null };
        return { kind: "event" as const, at: iso(item.createdAt), actor: item.actor.name, action: item.action, fields: item.fields,
          task: item.task ? { id: item.task.id, title: item.task.title } : null, fromStage: item.fromStage, toStage: item.toStage };
      }) };
    },
  }),
  crm_get_deal: tool({
    name: "crm_get_deal", mode: "read", permission: "opportunities:read",
    description: "Read one deal: stage, value, expected close date, owner and linked person and Organization.",
    input: z.object({ dealId: id }).strict(),
    run: async ({ db, userId, workspaceId }, input) => {
      const { deal, pipeline } = await getDeal(db, userId, workspaceId, input.dealId);
      const stage = pipeline.stages.find((item) => item.id === deal.stageId);
      return { id: deal.id, name: deal.name, version: deal.version, amount: deal.amount, currency: deal.currency, expectedCloseDate: deal.expectedCloseDate,
        pipeline: { id: pipeline.id, name: pipeline.name }, stage: stage ? { id: stage.id, name: stage.name, kind: stage.kind } : null,
        stages: pipeline.stages.filter((item) => !item.archivedAt).map((item) => ({ id: item.id, name: item.name, kind: item.kind })),
        ownerId: deal.ownerUserId, personId: deal.contactId, organizationId: deal.companyId, archived: !!deal.archivedAt, updatedAt: iso(deal.updatedAt) };
    },
  }),
  crm_list_related_deals: tool({
    name: "crm_list_related_deals", mode: "read", permission: "opportunities:read",
    description: "List open and closed (not archived) deals linked to a person or an Organization.",
    input: z.object({ subject: z.enum(["person", "organization"]), recordId: id }).strict(),
    run: async ({ db, userId, workspaceId }, input) => {
      const { deals } = await listRelatedDeals(db, userId, workspaceId, input.subject === "organization" ? "company" : "person", input.recordId);
      return { deals: deals.map((deal) => ({ id: deal.id, name: deal.name, amount: deal.amount, currency: deal.currency, stage: deal.stageName, stageKind: deal.stageKind, expectedCloseDate: deal.expectedCloseDate })) };
    },
  }),
  crm_list_my_tasks: tool({
    name: "crm_list_my_tasks", mode: "read", permission: "tasks:read",
    description: "List the caller's own tasks (title, status, priority, due time and what they relate to). Task descriptions are not included.",
    input: z.object({ status: z.enum(["open", "done", "all"]).default("open"), page }).strict(),
    run: async ({ db, userId, workspaceId }, input) => {
      const parsed = parseTaskQuery({ assignee: "me", status: input.status, page: String(input.page) });
      if (!parsed.success) throw parsed.error;
      const result = await listTasks(db, userId, workspaceId, parsed.data);
      return { total: result.total, page: result.page, tasks: result.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, priority: task.priority, dueAt: iso(task.dueAt),
        person: task.contactId ? { id: task.contactId, name: task.contactName } : null, organization: task.companyId ? { id: task.companyId, name: task.companyName } : null,
        deal: task.opportunityId ? { id: task.opportunityId, name: task.dealName } : null })) };
    },
  }),
  crm_create_task: tool({
    name: "crm_create_task", mode: "write", permission: "tasks:write",
    description: "Create a follow-up task for the caller, optionally linked to one person, Organization or deal. Requires the caller's approval.",
    input: z.object({ title: z.string().trim().min(1).max(200), dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
      priority: z.enum(taskPriorities).default("none"), personId: id.nullable().default(null), organizationId: id.nullable().default(null), dealId: id.nullable().default(null) }).strict(),
    run: async ({ db, userId, workspaceId }, input) => {
      const task = await createTask(db, userId, workspaceId, { title: input.title, dueAt: input.dueAt, priority: input.priority, assigneeUserId: userId,
        contactId: input.personId, companyId: input.organizationId, opportunityId: input.dealId });
      return { id: task.id, version: task.version };
    },
  }),
  crm_move_deal: tool({
    name: "crm_move_deal", mode: "write", permission: "opportunities:write",
    description: "Move a deal to another stage of its pipeline. Pass the version read with crm_get_deal. Requires the caller's approval.",
    input: z.object({ dealId: id, stageId: id, version: z.number().int().min(1) }).strict(),
    run: async ({ db, userId, workspaceId }, input) => moveDeal(db, userId, workspaceId, input.dealId, { stageId: input.stageId, version: input.version }),
  }),
} as const;

export type CrmToolName = keyof typeof crmTools;
const unavailable = () => new AccessError(404, message("Errors.assistantToolUnavailable"));
function lookupTool(name: string) {
  if (!Object.hasOwn(crmTools, name)) throw unavailable();
  return crmTools[name as CrmToolName] as Tool<z.ZodType>;
}
/** The approval binds this hash: same tool, same validated (defaulted) arguments, nothing else. */
export function toolArgsHash(name: string, args: unknown) {
  return workFingerprint(`ai-tool:${name}`, { args: args as never });
}

/** Tool definitions for a model, limited to what this caller's role may use in this workspace. */
export async function describeCrmTools(db: Database, userId: string, workspace: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "workspace:read", async (_tx, _tenant, role) =>
    Object.values(crmTools).filter((definition) => can(role, definition.permission)).map((definition) => ({
      name: definition.name, description: definition.description, mode: definition.mode, requiresApproval: definition.mode === "write",
      inputSchema: z.toJSONSchema(definition.input, { io: "input" }),
    })));
}

/**
 * Asks for approval of one write action. Returns the approval id the review screen will show and the
 * caller must pass back. Permission is checked now and again at execution.
 */
export async function requestToolApproval(db: Database, userId: string, workspace: string, name: string, args: unknown) {
  const definition = lookupTool(name);
  if (definition.mode !== "write") throw unavailable();
  const input = definition.input.parse(args);
  return withTenant(db, userId, uuidInput.parse(workspace), definition.permission, async (tx, tenantId) => {
    const [row] = await tx.insert(aiToolApprovals).values({ tenantId, tool: name, argsHash: toolArgsHash(name, input), requestedBy: userId,
      expiresAt: sql`now() + interval '10 minutes'` }).returning({ id: aiToolApprovals.id, expiresAt: aiToolApprovals.expiresAt });
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "ai.tool_approval_request", targetId: row.id, metadata: { tool: name } });
    return { approvalId: row.id, tool: name, expiresAt: row.expiresAt.toISOString() };
  });
}

/**
 * The person's own decision on their pending approval. This must only ever be called from a human
 * action in the product (never from a model tool call); no such screen exists yet.
 */
export async function decideToolApproval(db: Database, userId: string, workspace: string, approval: string, decision: "approve" | "reject") {
  const approvalId = uuidInput.parse(approval), choice = z.enum(["approve", "reject"]).parse(decision);
  return withTenant(db, userId, uuidInput.parse(workspace), "workspace:read", async (tx, tenantId) => {
    const row = await lockApproval(tx, tenantId, approvalId);
    if (!row || row.requestedBy !== userId) throw new AccessError(404, message("Errors.assistantApprovalInvalid"));
    if (row.status !== "pending") throw new AccessError(409, message("Errors.assistantApprovalUsed"));
    if (row.expired) throw new AccessError(409, message("Errors.assistantApprovalExpired"));
    await tx.update(aiToolApprovals).set({ status: choice === "approve" ? "approved" : "rejected", decidedAt: sql`now()` })
      .where(and(eq(aiToolApprovals.tenantId, tenantId), eq(aiToolApprovals.id, approvalId)));
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: choice === "approve" ? "ai.tool_approval_approve" : "ai.tool_approval_reject", targetId: approvalId, metadata: { tool: row.tool } });
    return { approvalId, status: choice === "approve" ? "approved" as const : "rejected" as const };
  });
}

async function lockApproval(tx: Transaction, tenantId: string, approvalId: string) {
  const [row] = await tx.select({ requestedBy: aiToolApprovals.requestedBy, tool: aiToolApprovals.tool, argsHash: aiToolApprovals.argsHash, status: aiToolApprovals.status,
    expired: sql<boolean>`${aiToolApprovals.expiresAt} <= now()` }).from(aiToolApprovals)
    .where(and(eq(aiToolApprovals.tenantId, tenantId), eq(aiToolApprovals.id, approvalId))).for("update");
  return row;
}

/**
 * Runs a tool for the caller. Read tools run directly through the CRM services. Write tools fail closed
 * unless `approvalId` names an approval that is this caller's, for this tool and these exact arguments,
 * approved, unexpired and unused; it is consumed in the same transaction as the write.
 */
export async function executeCrmTool(db: Database, userId: string, workspace: string, name: string, args: unknown, options: { approvalId?: string } = {}) {
  const definition = lookupTool(name), workspaceId = uuidInput.parse(workspace);
  const input = definition.input.parse(args);
  if (definition.mode === "read") return definition.run({ db, userId, workspaceId }, input);
  if (!options.approvalId) throw new AccessError(403, message("Errors.assistantActionNeedsApproval"), { reason: "approval_required" });
  const approvalId = uuidInput.parse(options.approvalId), hash = toolArgsHash(name, input);
  return withTenant(db, userId, workspaceId, definition.permission, async (tx, tenantId) => {
    const row = await lockApproval(tx, tenantId, approvalId);
    if (!row || row.requestedBy !== userId || row.tool !== name || row.argsHash !== hash) throw new AccessError(403, message("Errors.assistantApprovalInvalid"), { reason: "approval_mismatch" });
    if (row.status === "pending") throw new AccessError(403, message("Errors.assistantActionNeedsApproval"), { reason: "approval_pending" });
    if (row.status !== "approved") throw new AccessError(409, message("Errors.assistantApprovalUsed"), { reason: "approval_used" });
    if (row.expired) throw new AccessError(409, message("Errors.assistantApprovalExpired"), { reason: "approval_expired" });
    await tx.update(aiToolApprovals).set({ status: "consumed", consumedAt: sql`now()` }).where(and(eq(aiToolApprovals.tenantId, tenantId), eq(aiToolApprovals.id, approvalId)));
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "ai.tool_execute", targetId: approvalId, metadata: { tool: name } });
    // The service runs inside this transaction (as a savepoint) and checks membership and role again.
    return definition.run({ db: tx as unknown as Database, userId, workspaceId }, input);
  });
}
