import { message } from "../i18n/messages";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, companies, contacts, crmNotes, crmNotifications, crmTasks, opportunities, users, workspaceMembers } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { RELATED_TASKS_LIMIT, TASK_PAGE_SIZE, noteInput, notePatch, taskInput, taskPatch, zonedDay, zonedToInstant, type NoteInput, type NotePatch, type TaskInput, type TaskPatch, type TaskQuery } from "../lib/crm-tasks";
import { likePattern } from "./crm-filters";
import { emitCrmEvent } from "./crm-events";
import { AccessError, can } from "./permissions";
import { withTenant } from "./tenancy";

const missingTask = () => new AccessError(404, message("Errors.thisTaskIsNotAvailable"));
const missingNote = () => new AccessError(404, message("Errors.thisNoteIsNotAvailable"));
const missingRelated = () => new AccessError(404, message("Errors.theRelatedRecordIsNotAvailable"));
const notMember = () => new AccessError(400, message("Errors.theAssigneeMustBeAWorkspaceMember"));
// Tasks and notes cannot be added to (or relinked onto) an archived deal; restore it first.
const archivedDeal = () => new AccessError(409, message("Errors.restoreTheDealToAddTasksOrNotes"), { reason: "parent_archived" });
const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
function pgMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const own = "message" in error && typeof error.message === "string" ? error.message : "";
  return "cause" in error ? `${own} ${pgMessage(error.cause)}` : own;
}
function guarded(error: unknown): never {
  const text = pgMessage(error);
  if (text.includes("assignee is not a member")) throw notMember();
  if (text.includes("contact is unavailable")) throw missingRelated();
  if (text.includes("deal is archived")) throw archivedDeal();
  throw error;
}

type Relations = { contactId: string | null; companyId: string | null; opportunityId: string | null };
/** Audit metadata carries the related record ids so each record's timeline can find the event. */
function relationMetadata(relations: Relations) {
  return Object.fromEntries(Object.entries(relations).filter(([, value]) => !!value)) as Record<string, string>;
}
async function checkRelations(tx: Transaction, tenantId: string, relations: Partial<Relations>) {
  if (relations.contactId) {
    const [row] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, relations.contactId), isNull(contacts.erasedAt)));
    if (!row) throw missingRelated();
  }
  if (relations.companyId) {
    const [row] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, relations.companyId)));
    if (!row) throw missingRelated();
  }
  if (relations.opportunityId) {
    const [row] = await tx.select({ id: opportunities.id, archivedAt: opportunities.archivedAt }).from(opportunities)
      .where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.id, relations.opportunityId))).for("share");
    if (!row) throw missingRelated();
    if (row.archivedAt) throw archivedDeal();
  }
}
async function checkMember(tx: Transaction, tenantId: string, userId: string | null | undefined) {
  if (!userId) return;
  const [row] = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.tenantId, tenantId), eq(workspaceMembers.userId, userId)));
  if (!row) throw notMember();
}
async function audit(tx: Transaction, tenantId: string, actorId: string, action: string, targetId: string, metadata: Record<string, string> = {}) {
  await tx.insert(auditLogs).values({ tenantId, actorId, action, targetId, metadata });
}
/** Only the assignee is ever notified, and never about their own action. */
async function notifyAssignee(tx: Transaction, tenantId: string, actorId: string, taskId: string, assignee: string | null) {
  if (!assignee || assignee === actorId) return;
  await tx.insert(crmNotifications).values({ tenantId, recipientUserId: assignee, actorUserId: actorId, kind: "task_assigned", taskId });
}

type TaskRow = typeof crmTasks.$inferSelect;
/**
 * Outbox payloads carry ids and small enums only. Task bodies may hold sensitive
 * ministry text, so they are reported as redacted with their length.
 */
function taskPayload(task: TaskRow, actorId: string) {
  return {
    taskId: task.id, tenantId: task.tenantId, actorId, version: task.version, status: task.status, priority: task.priority,
    dueAt: task.dueAt ? task.dueAt.toISOString() : null, assigneeId: task.assigneeUserId,
    contactId: task.contactId, companyId: task.companyId, opportunityId: task.opportunityId,
    body: { redacted: true as const, length: task.body.length },
  };
}

export function createTask(db: Database, userId: string, workspace: string, data: TaskInput) {
  const parsed = taskInput.safeParse(data);
  if (!parsed.success) throw new AccessError(400, message("Errors.checkTheTaskDetails"));
  const input = parsed.data;
  return withTenant(db, userId, uuidInput.parse(workspace), "tasks:write", async (tx, tenantId) => {
    const relations = { contactId: input.contactId ?? null, companyId: input.companyId ?? null, opportunityId: input.opportunityId ?? null };
    await checkRelations(tx, tenantId, relations);
    await checkMember(tx, tenantId, input.assigneeUserId);
    const [task] = await tx.insert(crmTasks).values({
      tenantId, title: input.title, body: input.body, priority: input.priority, dueAt: input.dueAt ?? null,
      assigneeUserId: input.assigneeUserId ?? null, ...relations, createdBy: userId,
    }).returning().catch(guarded);
    await audit(tx, tenantId, userId, "task.create", task.id, relationMetadata(relations));
    await notifyAssignee(tx, tenantId, userId, task.id, task.assigneeUserId);
    await emitCrmEvent(tx, tenantId, "crm.task.created", `crm:task:${task.id}:created`, taskPayload(task, userId));
    return { id: task.id, version: task.version };
  });
}

/**
 * Edit, complete, reopen, reassign, re-link or archive a task under its version.
 * Each kind of change writes its own audit action (task.complete, task.reassign, …)
 * and outbox event, in this transaction.
 */
export function updateTask(db: Database, userId: string, workspace: string, task: string, data: TaskPatch) {
  const id = uuidInput.parse(task);
  const parsed = taskPatch.safeParse(data);
  if (!parsed.success) throw new AccessError(400, message("Errors.checkTheTaskDetails"));
  const { version, archived, ...input } = parsed.data;
  return withTenant(db, userId, uuidInput.parse(workspace), "tasks:write", async (tx, tenantId) => {
    const [current] = await tx.select().from(crmTasks).where(and(eq(crmTasks.tenantId, tenantId), eq(crmTasks.id, id))).for("update");
    if (!current) throw missingTask();
    if (current.version !== version) throw stale();
    const same = (key: keyof typeof input) => key === "dueAt" ? (input.dueAt?.getTime() ?? null) === (current.dueAt?.getTime() ?? null) : input[key] === current[key as keyof TaskRow];
    const keys = ["title", "body", "priority", "dueAt", "assigneeUserId", "status", "contactId", "companyId", "opportunityId"] as const;
    const changed = keys.filter((key) => input[key] !== undefined && !same(key));
    const archive = archived === undefined ? null : archived && !current.archivedAt ? "archive" : !archived && current.archivedAt ? "restore" : null;
    if (!changed.length && !archive) return { id, version: current.version };
    const relationKeys = changed.filter((key) => key === "contactId" || key === "companyId" || key === "opportunityId");
    await checkRelations(tx, tenantId, Object.fromEntries(relationKeys.map((key) => [key, input[key]])));
    if (changed.includes("assigneeUserId")) await checkMember(tx, tenantId, input.assigneeUserId);
    const status = changed.includes("status") ? input.status! : current.status;
    const [row] = await tx.update(crmTasks).set({
      ...Object.fromEntries(changed.map((key) => [key, input[key]])),
      ...(changed.includes("status") ? { completedAt: status === "done" ? new Date() : null } : {}),
      ...(archive ? { archivedAt: archive === "archive" ? new Date() : null } : {}),
      updatedAt: new Date(), version: sql`${crmTasks.version} + 1`,
    }).where(and(eq(crmTasks.tenantId, tenantId), eq(crmTasks.id, id), eq(crmTasks.version, version))).returning().catch(guarded);
    if (!row) throw stale();
    const relations = relationMetadata({ contactId: row.contactId, companyId: row.companyId, opportunityId: row.opportunityId });
    const key = (event: string) => `crm:task:${id}:v${row.version}:${event}`;
    if (changed.includes("status")) {
      await audit(tx, tenantId, userId, status === "done" ? "task.complete" : "task.reopen", id, relations);
      if (status === "done") await emitCrmEvent(tx, tenantId, "crm.task.completed", key("completed"), taskPayload(row, userId));
    }
    if (changed.includes("assigneeUserId")) {
      await audit(tx, tenantId, userId, "task.reassign", id, { ...relations, ...(row.assigneeUserId ? { toUserId: row.assigneeUserId } : {}), ...(current.assigneeUserId ? { fromUserId: current.assigneeUserId } : {}) });
      await notifyAssignee(tx, tenantId, userId, id, row.assigneeUserId);
      await emitCrmEvent(tx, tenantId, "crm.task.reassigned", key("reassigned"), { ...taskPayload(row, userId), previousAssigneeId: current.assigneeUserId });
    }
    const other = changed.filter((item) => item !== "status" && item !== "assigneeUserId");
    if (other.length || archive) {
      await audit(tx, tenantId, userId, archive === "archive" ? "task.archive" : archive === "restore" ? "task.restore" : "task.update", id, { ...relations, ...(other.length ? { fields: other.join(",") } : {}) });
    }
    if (other.length || archive || (changed.includes("status") && status === "open")) {
      await emitCrmEvent(tx, tenantId, "crm.task.updated", key("updated"), { ...taskPayload(row, userId), fields: [...other, ...(changed.includes("status") ? ["status"] : []), ...(archive ? ["archived"] : [])].join(",") });
    }
    return { id, version: row.version };
  });
}

// ---------------------------------------------------------------------------
// Reading tasks.
const taskColumns = {
  id: crmTasks.id, title: crmTasks.title, body: crmTasks.body, status: crmTasks.status, priority: crmTasks.priority, dueAt: crmTasks.dueAt,
  assigneeUserId: crmTasks.assigneeUserId, contactId: crmTasks.contactId, companyId: crmTasks.companyId, opportunityId: crmTasks.opportunityId,
  completedAt: crmTasks.completedAt, archivedAt: crmTasks.archivedAt, version: crmTasks.version, createdAt: crmTasks.createdAt, updatedAt: crmTasks.updatedAt, createdBy: crmTasks.createdBy,
};
type TaskSelect = { [K in keyof typeof taskColumns]: TaskRow[K] };
/** Names for the assignee (current members only) and linked records, tenant-scoped. */
async function attachTaskNames(tx: Transaction, tenantId: string, rows: TaskSelect[]) {
  const ids = (key: "contactId" | "companyId" | "opportunityId" | "assigneeUserId") => [...new Set(rows.map((row) => row[key]).filter((value): value is string => !!value))];
  const [contactIds, companyIds, dealIds, assigneeIds] = [ids("contactId"), ids("companyId"), ids("opportunityId"), ids("assigneeUserId")];
  const people = contactIds.length ? await tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, contactIds), isNull(contacts.erasedAt))) : [];
  const orgs = companyIds.length ? await tx.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.tenantId, tenantId), inArray(companies.id, companyIds))) : [];
  const deals = dealIds.length ? await tx.select({ id: opportunities.id, name: opportunities.name }).from(opportunities).where(and(eq(opportunities.tenantId, tenantId), inArray(opportunities.id, dealIds))) : [];
  const assignees = assigneeIds.length ? await tx.select({ id: users.id, name: users.name, email: users.email }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.tenantId, tenantId), inArray(workspaceMembers.userId, assigneeIds))) : [];
  return rows.map((row) => {
    const assignee = assignees.find((item) => item.id === row.assigneeUserId);
    return {
      ...row,
      contactName: people.find((item) => item.id === row.contactId)?.name ?? null,
      companyName: orgs.find((item) => item.id === row.companyId)?.name ?? null,
      dealName: deals.find((item) => item.id === row.opportunityId)?.name ?? null,
      assigneeName: assignee ? assignee.name || assignee.email : null,
    };
  });
}
export type TaskView = Awaited<ReturnType<typeof attachTaskNames>>[number];
async function loadMembers(tx: Transaction, tenantId: string) {
  const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.tenantId, tenantId)).orderBy(asc(users.name), asc(users.id));
  return rows.map((row) => ({ id: row.id, name: row.name || row.email }));
}
/** Start of today and of tomorrow in the CRM time zone, as instants. */
function dayBounds(now = new Date()) {
  const today = zonedDay(now), next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { start: zonedToInstant(`${today}T00:00`)!, end: zonedToInstant(`${next.toISOString().slice(0, 10)}T00:00`)! };
}
const prioritySort = sql`case ${crmTasks.priority} when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`;
const sortColumns = { due: crmTasks.dueAt, created: crmTasks.createdAt, updated: crmTasks.updatedAt, priority: prioritySort, title: sql`lower(${crmTasks.title})` };

/** The Tasks page: one server query with URL filters, 20 per page. "me" means the signed-in member. */
export function listTasks(db: Database, userId: string, workspace: string, query: TaskQuery) {
  return withTenant(db, userId, uuidInput.parse(workspace), "tasks:read", async (tx, tenantId) => {
    const now = new Date(), { start, end } = dayBounds(now), members = await loadMembers(tx, tenantId);
    const assignee = query.assignee === "me" ? userId : query.assignee;
    if (assignee !== "any" && assignee !== "none" && !members.some((member) => member.id === assignee)) throw notMember();
    const base = and(eq(crmTasks.tenantId, tenantId), isNull(crmTasks.archivedAt));
    const pattern = likePattern(query.q);
    const filters: (SQL | undefined)[] = [
      assignee === "any" ? undefined : assignee === "none" ? isNull(crmTasks.assigneeUserId) : eq(crmTasks.assigneeUserId, assignee),
      query.status === "all" ? undefined : eq(crmTasks.status, query.status),
      query.due === "overdue" ? and(eq(crmTasks.status, "open"), lt(crmTasks.dueAt, now))
        : query.due === "today" ? and(gte(crmTasks.dueAt, start), lt(crmTasks.dueAt, end), or(eq(crmTasks.status, "done"), gte(crmTasks.dueAt, now)))
        : query.due === "upcoming" ? gte(crmTasks.dueAt, end) : query.due === "none" ? isNull(crmTasks.dueAt) : undefined,
      query.related === "person" ? isNotNull(crmTasks.contactId) : query.related === "company" ? isNotNull(crmTasks.companyId) : query.related === "deal" ? isNotNull(crmTasks.opportunityId)
        : query.related === "none" ? and(isNull(crmTasks.contactId), isNull(crmTasks.companyId), isNull(crmTasks.opportunityId)) : undefined,
      query.q ? or(ilike(crmTasks.title, pattern), ilike(crmTasks.body, pattern)) : undefined,
    ];
    const where = and(base, ...filters);
    const [{ total }] = await tx.select({ total: count() }).from(crmTasks).where(where);
    const [direction, key] = query.sort.startsWith("-") ? ["desc", query.sort.slice(1)] as const : ["asc", query.sort] as const;
    const rows = await tx.select(taskColumns).from(crmTasks).where(where)
      .orderBy(sql`${sortColumns[key as keyof typeof sortColumns]} ${sql.raw(direction)} nulls last`, desc(crmTasks.createdAt), asc(crmTasks.id))
      .limit(TASK_PAGE_SIZE).offset((query.page - 1) * TASK_PAGE_SIZE);
    const [{ any }] = await tx.select({ any: count() }).from(crmTasks).where(base);
    return { tasks: await attachTaskNames(tx, tenantId, rows), total, page: query.page, members, empty: any === 0, now: now.toISOString() };
  });
}

export function getTask(db: Database, userId: string, workspace: string, task: string) {
  const id = uuidInput.parse(task);
  return withTenant(db, userId, uuidInput.parse(workspace), "tasks:read", async (tx, tenantId) => {
    const [row] = await tx.select(taskColumns).from(crmTasks).where(and(eq(crmTasks.tenantId, tenantId), eq(crmTasks.id, id)));
    if (!row) throw missingTask();
    return (await attachTaskNames(tx, tenantId, [row]))[0];
  });
}

/** Tasks linked to a person, company or deal: open first (by due date), then recently done. */
export function listRelatedTasks(db: Database, userId: string, workspace: string, type: "person" | "company" | "deal", record: string) {
  const id = uuidInput.parse(record);
  return withTenant(db, userId, uuidInput.parse(workspace), "tasks:read", async (tx, tenantId) => {
    const column = type === "person" ? crmTasks.contactId : type === "company" ? crmTasks.companyId : crmTasks.opportunityId;
    const rows = await tx.select(taskColumns).from(crmTasks).where(and(eq(crmTasks.tenantId, tenantId), eq(column, id), isNull(crmTasks.archivedAt)))
      .orderBy(sql`case when ${crmTasks.status} = 'open' then 0 else 1 end`, sql`${crmTasks.dueAt} asc nulls last`, desc(crmTasks.completedAt), desc(crmTasks.createdAt))
      .limit(RELATED_TASKS_LIMIT);
    return { tasks: await attachTaskNames(tx, tenantId, rows), members: await loadMembers(tx, tenantId), now: new Date().toISOString() };
  });
}

// ---------------------------------------------------------------------------
// Notes.
export function createNote(db: Database, userId: string, workspace: string, data: NoteInput) {
  const parsed = noteInput.safeParse(data);
  if (!parsed.success) throw new AccessError(400, message("Errors.checkTheNote"));
  const input = parsed.data;
  return withTenant(db, userId, uuidInput.parse(workspace), "notes:write", async (tx, tenantId) => {
    const relations = { contactId: input.target === "person" ? input.targetId : null, companyId: input.target === "company" ? input.targetId : null, opportunityId: input.target === "deal" ? input.targetId : null };
    await checkRelations(tx, tenantId, relations);
    const [note] = await tx.insert(crmNotes).values({ tenantId, body: input.body, ...relations, createdBy: userId }).returning().catch(guarded);
    await audit(tx, tenantId, userId, "note.create", note.id, relationMetadata(relations));
    await emitCrmEvent(tx, tenantId, "crm.note.created", `crm:note:${note.id}:created`, notePayload(note, userId));
    return { id: note.id, version: note.version };
  });
}
type NoteRow = typeof crmNotes.$inferSelect;
/** Note bodies never leave the database in events: length only. */
function notePayload(note: NoteRow, actorId: string) {
  return { noteId: note.id, tenantId: note.tenantId, actorId, version: note.version, contactId: note.contactId, companyId: note.companyId, opportunityId: note.opportunityId,
    archived: !!note.archivedAt, body: { redacted: true as const, length: note.body.length } };
}
/** Authors edit or archive their own notes; owners and admins can moderate any note. */
export function updateNote(db: Database, userId: string, workspace: string, note: string, data: NotePatch) {
  const id = uuidInput.parse(note);
  const parsed = notePatch.safeParse(data);
  if (!parsed.success) throw new AccessError(400, message("Errors.checkTheNote"));
  const { version, archived, body } = parsed.data;
  return withTenant(db, userId, uuidInput.parse(workspace), "notes:write", async (tx, tenantId, role) => {
    const [current] = await tx.select().from(crmNotes).where(and(eq(crmNotes.tenantId, tenantId), eq(crmNotes.id, id))).for("update");
    if (!current) throw missingNote();
    if (current.createdBy !== userId && role !== "owner" && role !== "admin") throw new AccessError(403, message("Errors.onlyTheAuthorCanChangeThisNote"));
    if (current.version !== version) throw stale();
    if (current.opportunityId) {
      const [deal] = await tx.select({ archivedAt: opportunities.archivedAt }).from(opportunities).where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.id, current.opportunityId))).for("share");
      if (deal?.archivedAt) throw archivedDeal();
    }
    const edited = body !== undefined && body !== current.body;
    const archive = archived === undefined ? null : archived && !current.archivedAt ? "archive" : !archived && current.archivedAt ? "restore" : null;
    if (!edited && !archive) return { id, version: current.version };
    const [row] = await tx.update(crmNotes).set({
      ...(edited ? { body, editedAt: new Date() } : {}), ...(archive ? { archivedAt: archive === "archive" ? new Date() : null } : {}),
      updatedAt: new Date(), version: sql`${crmNotes.version} + 1`,
    }).where(and(eq(crmNotes.tenantId, tenantId), eq(crmNotes.id, id), eq(crmNotes.version, version))).returning();
    if (!row) throw stale();
    const relations = relationMetadata({ contactId: row.contactId, companyId: row.companyId, opportunityId: row.opportunityId });
    await audit(tx, tenantId, userId, archive === "archive" ? "note.archive" : archive === "restore" ? "note.restore" : "note.update", id, relations);
    await emitCrmEvent(tx, tenantId, archive === "archive" ? "crm.note.archived" : "crm.note.updated", `crm:note:${id}:v${row.version}:${archive === "archive" ? "archived" : "updated"}`, notePayload(row, userId));
    return { id, version: row.version };
  });
}

// ---------------------------------------------------------------------------
// Notifications (bounded: assignment only; overdue is computed on read).
export function listNotifications(db: Database, userId: string, workspace: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "tasks:read", async (tx, tenantId) => {
    // RLS limits these rows to the caller; the explicit filter keeps the intent obvious.
    const rows = await tx.select({ id: crmNotifications.id, kind: crmNotifications.kind, taskId: crmNotifications.taskId, readAt: crmNotifications.readAt, createdAt: crmNotifications.createdAt,
      actorUserId: crmNotifications.actorUserId, taskTitle: crmTasks.title, taskStatus: crmTasks.status, taskArchived: crmTasks.archivedAt })
      .from(crmNotifications).innerJoin(crmTasks, and(eq(crmTasks.tenantId, crmNotifications.tenantId), eq(crmTasks.id, crmNotifications.taskId)))
      .where(and(eq(crmNotifications.tenantId, tenantId), eq(crmNotifications.recipientUserId, userId)))
      .orderBy(desc(crmNotifications.createdAt), desc(crmNotifications.id)).limit(20);
    const actorIds = [...new Set(rows.map((row) => row.actorUserId).filter((value): value is string => !!value))];
    const actors = actorIds.length ? await tx.select({ id: users.id, name: users.name, email: users.email }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.tenantId, tenantId), inArray(workspaceMembers.userId, actorIds))) : [];
    const [{ unread }] = await tx.select({ unread: count() }).from(crmNotifications).where(and(eq(crmNotifications.tenantId, tenantId), eq(crmNotifications.recipientUserId, userId), isNull(crmNotifications.readAt)));
    const [{ overdue }] = await tx.select({ overdue: count() }).from(crmTasks).where(and(eq(crmTasks.tenantId, tenantId), eq(crmTasks.assigneeUserId, userId), eq(crmTasks.status, "open"), isNull(crmTasks.archivedAt), lt(crmTasks.dueAt, new Date())));
    return {
      items: rows.map((row) => { const actor = actors.find((item) => item.id === row.actorUserId); return { ...row, actorName: actor ? actor.name || actor.email : null }; }),
      unread, overdue,
    };
  });
}
export function markNotificationsRead(db: Database, userId: string, workspace: string, ids: string[] | "all") {
  const list = ids === "all" ? "all" : ids.map((id) => uuidInput.parse(id));
  return withTenant(db, userId, uuidInput.parse(workspace), "tasks:read", async (tx, tenantId) => {
    const updated = await tx.update(crmNotifications).set({ readAt: new Date() })
      .where(and(eq(crmNotifications.tenantId, tenantId), eq(crmNotifications.recipientUserId, userId), isNull(crmNotifications.readAt), list === "all" ? undefined : inArray(crmNotifications.id, list.length ? list : ["00000000-0000-4000-8000-000000000000"])))
      .returning({ id: crmNotifications.id });
    return { marked: updated.length };
  });
}
/** Whether a role may write tasks or notes (for hiding controls). */
export const taskAbilities = (role: string) => ({ tasks: can(role, "tasks:write"), notes: can(role, "notes:write"), moderate: role === "owner" || role === "admin" });
