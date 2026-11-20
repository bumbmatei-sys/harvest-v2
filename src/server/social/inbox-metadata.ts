import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { auditLogs, socialConnections, socialInboxHours, socialInboxItemLabels, socialInboxItems, socialInboxLabels, socialInboxNotes,
  socialInboxReads, socialInboxSavedReplies, workspaceMembers } from "../../db/schema";
import { taskInput } from "../../lib/crm-tasks";
import { loadLiveContact } from "../contacts";
import { createTaskInTenant } from "../crm-tasks";
import { AccessError, requirePermission } from "../permissions";
import { auditInbox, inboxItem, inboxText, withInbox } from "./inbox-access";
import { publishConflict, publishInvalid, recordId, unavailable, versionInput } from "./publish-access";
import { defaultSocialDeps } from "./registry";

const bulkAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), value: z.boolean() }).strict(),
  z.object({ action: z.literal("assign"), assigneeId: inboxText(200).nullable() }).strict(),
  z.object({ action: z.literal("status"), value: z.enum(["open", "done"]) }).strict(),
  z.object({ action: z.literal("label"), labelId: z.uuid(), value: z.boolean() }).strict(),
  z.object({ action: z.literal("star"), value: z.boolean() }).strict(),
]);
const itemAction = z.union([bulkAction, z.object({ action: z.literal("snooze"), until: z.iso.datetime({ offset: true }).nullable() }).strict(),
  z.object({ action: z.literal("linkContact"), contactId: z.uuid().nullable() }).strict()]);
type ItemAction = z.infer<typeof itemAction>;
const itemVersion = z.object({ id: z.uuid(), version: versionInput }).strict();

async function checkVersion(tx: Transaction, tenant: string, id: string, version: number) {
  const loaded = await inboxItem(tx, tenant, id, true);
  if (loaded.item.version !== version) throw publishConflict();
  return loaded.item;
}
async function touchItem(tx: Transaction, tenant: string, id: string, version: number, fields: Partial<typeof socialInboxItems.$inferInsert> = {}) {
  await tx.update(socialInboxItems).set({ ...fields, version: version + 1 })
    .where(and(eq(socialInboxItems.tenantId, tenant), eq(socialInboxItems.id, id), eq(socialInboxItems.version, version)));
  return version + 1;
}

async function changeItem(tx: Transaction, tenant: string, user: string, role: string, now: Date, id: string, version: number, action: ItemAction) {
  const item = await checkVersion(tx, tenant, id, version);
  const values: Partial<typeof socialInboxItems.$inferInsert> = {};
  switch (action.action) {
    case "read": {
      if (action.value) {
        const readThrough = item.activityAt ?? now;
        await tx.insert(socialInboxReads).values({ tenantId: tenant, itemId: id, readerId: user, readThrough })
          .onConflictDoUpdate({ target: [socialInboxReads.tenantId, socialInboxReads.itemId, socialInboxReads.readerId], set: { readThrough } });
      } else {
        await tx.delete(socialInboxReads).where(and(eq(socialInboxReads.tenantId, tenant), eq(socialInboxReads.itemId, id), eq(socialInboxReads.readerId, user)));
      }
      break;
    }
    case "assign": {
      requirePermission(role, "social:assign");
      if (action.assigneeId) {
        const [assignee] = await tx.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(
          eq(workspaceMembers.tenantId, tenant), eq(workspaceMembers.userId, action.assigneeId), inArray(workspaceMembers.roleId, ["owner", "admin"]))).for("share");
        if (!assignee) throw unavailable();
      }
      values.assigneeId = action.assigneeId;
      break;
    }
    case "status": values.status = action.value; break;
    case "star": values.starred = action.value; break;
    case "snooze": values.snoozedUntil = action.until ? new Date(action.until) : null; break;
    case "linkContact":
      requirePermission(role, "contacts:read");
      if (action.contactId) await loadLiveContact(tx, tenant, action.contactId, "share");
      values.contactId = action.contactId;
      break;
    case "label": {
      const [label] = await tx.select({ id: socialInboxLabels.id }).from(socialInboxLabels).where(and(
        eq(socialInboxLabels.tenantId, tenant), eq(socialInboxLabels.id, action.labelId), eq(socialInboxLabels.archived, false))).for("share");
      if (!label) throw unavailable();
      if (action.value) await tx.insert(socialInboxItemLabels).values({ tenantId: tenant, itemId: id, labelId: action.labelId }).onConflictDoNothing();
      else await tx.delete(socialInboxItemLabels).where(and(eq(socialInboxItemLabels.tenantId, tenant),
        eq(socialInboxItemLabels.itemId, id), eq(socialInboxItemLabels.labelId, action.labelId)));
      break;
    }
  }
  const next = await touchItem(tx, tenant, id, version, values);
  await auditInbox(tx, tenant, user, action.action, id, next);
  return { id, version: next };
}

export function mutateInboxItem(db: Database, user: string, workspace: string, id: string, body: unknown, deps = defaultSocialDeps()) {
  const { version, change } = z.object({ version: versionInput, change: itemAction }).strict().parse(body);
  return withInbox(db, user, workspace, deps, (tx, tenant, role) =>
    changeItem(tx, tenant, user, role, deps.now(), id, version, change));
}

export function bulkInboxItems(db: Database, user: string, workspace: string, body: unknown, deps = defaultSocialDeps()) {
  const { items, change } = z.object({ items: z.array(itemVersion).min(1).max(25)
    .refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length), change: bulkAction }).strict().parse(body);
  return withInbox(db, user, workspace, deps, async (tx, tenant, role) => {
    const results = new Map<string, { id: string; version?: number; status: "updated" | "unavailable" | "stale" }>();
    for (const item of [...items].sort((left, right) => left.id.localeCompare(right.id))) {
      try {
        const result = await tx.transaction(inner => changeItem(inner, tenant, user, role, deps.now(), item.id, item.version, change));
        results.set(item.id, { ...result, status: "updated" });
      } catch (error) {
        if (!(error instanceof AccessError) || (error.status !== 404 && error.status !== 409)) throw error;
        results.set(item.id, { id: item.id, status: error.status === 404 ? "unavailable" : "stale" });
      }
    }
    return { results: items.map(item => results.get(item.id)!) };
  });
}

export function mutateInboxNote(db: Database, user: string, workspace: string, itemId: string, body: unknown, deps = defaultSocialDeps()) {
  const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("create"), itemVersion: versionInput, note: inboxText(5_000) }).strict(),
    z.object({ action: z.literal("update"), itemVersion: versionInput, id: z.uuid(), version: versionInput, note: inboxText(5_000) }).strict(),
    z.object({ action: z.literal("delete"), itemVersion: versionInput, id: z.uuid(), version: versionInput }).strict(),
  ]).parse(body);
  return withInbox(db, user, workspace, deps, async (tx, tenant) => {
    await checkVersion(tx, tenant, itemId, input.itemVersion);
    let noteId: string;
    if (input.action === "create") {
      const { rows: [created] } = await tx.execute<{ id: string }>(sql`insert into public.social_inbox_notes
        (tenant_id,item_id,author_id,note) values (${tenant},${itemId},${user},${input.note}) returning id`);
      noteId = created.id;
    } else {
      const where = and(eq(socialInboxNotes.tenantId, tenant), eq(socialInboxNotes.itemId, itemId),
        eq(socialInboxNotes.id, input.id), eq(socialInboxNotes.authorId, user));
      const [note] = await tx.select({ version: socialInboxNotes.version }).from(socialInboxNotes).where(where).for("update");
      if (!note) throw unavailable();
      if (note.version !== input.version) throw publishConflict();
      if (input.action === "delete") await tx.delete(socialInboxNotes).where(where);
      else await tx.update(socialInboxNotes).set({ note: input.note, version: input.version + 1 }).where(where);
      noteId = input.id;
    }
    const version = await touchItem(tx, tenant, itemId, input.itemVersion);
    await auditInbox(tx, tenant, user, `note_${input.action}`, noteId, version);
    return { id: noteId, itemVersion: version, version: input.action === "update" ? input.version + 1 : 1 };
  });
}

const name = inboxText(80);
const labelEdit = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name }).strict(),
  z.object({ action: z.literal("update"), id: z.uuid(), version: versionInput, name }).strict(),
  z.object({ action: z.literal("archive"), id: z.uuid(), version: versionInput }).strict(),
]);
export function mutateInboxLabel(db: Database, user: string, workspace: string, body: unknown, deps = defaultSocialDeps()) {
  const input = labelEdit.parse(body);
  return withInbox(db, user, workspace, deps, async (tx, tenantId) => {
    const [row] = input.action === "create"
      ? await tx.insert(socialInboxLabels).values({ tenantId, name: input.name }).onConflictDoNothing().returning()
      : await tx.update(socialInboxLabels).set({ ...(input.action === "update" ? { name: input.name } : { archived: true }), version: input.version + 1 })
        .where(and(eq(socialInboxLabels.tenantId, tenantId), eq(socialInboxLabels.id, input.id), eq(socialInboxLabels.version, input.version),
          eq(socialInboxLabels.archived, false))).returning().catch(error => {
          if (error.cause?.code === "23505") throw publishConflict("INBOX_DUPLICATE_LABEL");
          throw error;
        });
    if (!row) {
      if (input.action === "create") throw publishConflict("INBOX_DUPLICATE_LABEL");
      const [label] = await tx.select({ id: socialInboxLabels.id }).from(socialInboxLabels)
        .where(and(eq(socialInboxLabels.tenantId, tenantId), eq(socialInboxLabels.id, input.id)));
      if (!label) throw unavailable();
      throw publishConflict();
    }
    await auditInbox(tx, tenantId, user, `label_${input.action}`, row.id, row.version);
    return { label: row };
  });
}

const variablesPattern = /{{\s*([a-zA-Z][a-zA-Z0-9_]{0,39})\s*}}/g;
export const savedReplyVariables = (template: string) => [...new Set([...template.matchAll(variablesPattern)].map(match => match[1]))];
const template = inboxText(5_000).refine(value => {
  const stripped = value.replace(variablesPattern, "");
  return !stripped.includes("{{") && !stripped.includes("}}") && savedReplyVariables(value).length <= 20;
});
export function renderSavedReply(value: string, variables: Record<string, string>) {
  const keys = savedReplyVariables(value);
  if (keys.length !== Object.keys(variables).length || keys.some(key => !Object.hasOwn(variables, key))) throw publishInvalid("INBOX_TEMPLATE_VARIABLES");
  return inboxText(10_000).parse(value.replace(variablesPattern, (_token, key: string) => variables[key]));
}
const savedEdit = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name, template }).strict(),
  z.object({ action: z.literal("update"), id: z.uuid(), version: versionInput, name, template }).strict(),
  z.object({ action: z.literal("archive"), id: z.uuid(), version: versionInput }).strict(),
]);
export function listSavedInboxReplies(db: Database, user: string, workspace: string, deps = defaultSocialDeps()) {
  return withInbox(db, user, workspace, deps, async (tx, tenant) => {
    const rows = await tx.select().from(socialInboxSavedReplies).where(and(eq(socialInboxSavedReplies.tenantId, tenant), eq(socialInboxSavedReplies.archived, false)))
      .orderBy(asc(socialInboxSavedReplies.name), asc(socialInboxSavedReplies.id)).limit(200);
    return { replies: rows.map(row => ({ ...row, variables: savedReplyVariables(row.template) })) };
  }, "social:saved_replies");
}
export function mutateSavedInboxReply(db: Database, user: string, workspace: string, body: unknown, deps = defaultSocialDeps()) {
  const input = savedEdit.parse(body);
  return withInbox(db, user, workspace, deps, async (tx, tenantId) => {
    const [row] = input.action === "create"
      ? await tx.insert(socialInboxSavedReplies).values({ tenantId, name: input.name, template: input.template }).returning()
      : await tx.update(socialInboxSavedReplies).set({ ...(input.action === "update" ? { name: input.name, template: input.template } : { archived: true }),
        version: input.version + 1 }).where(and(eq(socialInboxSavedReplies.tenantId, tenantId), eq(socialInboxSavedReplies.id, input.id),
          eq(socialInboxSavedReplies.version, input.version), eq(socialInboxSavedReplies.archived, false))).returning();
    if (!row) {
      const [saved] = input.action === "create" ? [] : await tx.select({ id: socialInboxSavedReplies.id }).from(socialInboxSavedReplies)
        .where(and(eq(socialInboxSavedReplies.tenantId, tenantId), eq(socialInboxSavedReplies.id, input.id)));
      if (!saved) throw unavailable();
      throw publishConflict();
    }
    await auditInbox(tx, tenantId, user, `saved_reply_${input.action}`, row.id, row.version);
    return { reply: { ...row, variables: savedReplyVariables(row.template) } };
  }, "social:saved_replies");
}

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const workingHours = z.array(z.object({ day: z.number().int().min(1).max(7), start: time, end: time }).strict()).max(28)
  .transform(slots => [...slots].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)))
  .refine(slots => slots.every((slot, index) => slot.start < slot.end &&
    (!index || slots[index - 1].day !== slot.day || slots[index - 1].end <= slot.start)));
const workspaceTimezone = z.string().min(1).max(80).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return !/^[+-]/.test(value); } catch { return false; }
});
async function accountExists(tx: Transaction, tenant: string, id: string) {
  const [row] = await tx.select({ id: socialConnections.id }).from(socialConnections)
    .where(and(eq(socialConnections.tenantId, tenant), eq(socialConnections.id, recordId(id)))).for("share");
  if (!row) throw unavailable();
}
export function getInboxHours(db: Database, user: string, workspace: string, connectionId: string, deps = defaultSocialDeps()) {
  return withInbox(db, user, workspace, deps, async (tx, tenantId) => {
    await accountExists(tx, tenantId, connectionId);
    const [row] = await tx.select().from(socialInboxHours)
      .where(and(eq(socialInboxHours.tenantId, tenantId), eq(socialInboxHours.connectionId, connectionId)));
    return { settings: row ?? { connectionId, version: 0, timezone: "UTC", hours: [], awayTemplate: null } };
  });
}
export function saveInboxHours(db: Database, user: string, workspace: string, connectionId: string, body: unknown, deps = defaultSocialDeps()) {
  const { version, ...fields } = z.object({ version: z.union([z.literal(0), versionInput]), timezone: workspaceTimezone,
    hours: workingHours, awayTemplate: template.nullable() }).strict().parse(body);
  return withInbox(db, user, workspace, deps, async (tx, tenantId) => {
    await accountExists(tx, tenantId, connectionId);
    const [settings] = version === 0
      ? await tx.insert(socialInboxHours).values({ tenantId, connectionId, ...fields }).onConflictDoNothing().returning()
      : await tx.update(socialInboxHours).set({ ...fields, version: version + 1 }).where(and(eq(socialInboxHours.tenantId, tenantId),
        eq(socialInboxHours.connectionId, connectionId), eq(socialInboxHours.version, version))).returning();
    if (!settings) throw publishConflict();
    await auditInbox(tx, tenantId, user, "hours", connectionId, settings.version);
    return { settings };
  });
}

export function createInboxFollowUp(db: Database, user: string, workspace: string, id: string, body: unknown, deps = defaultSocialDeps()) {
  const input = z.object({ version: versionInput, task: taskInput.omit({ contactId: true, companyId: true, opportunityId: true }) }).strict().parse(body);
  return withInbox(db, user, workspace, deps, async (tx, tenant, role) => {
    requirePermission(role, "tasks:write");
    const item = await checkVersion(tx, tenant, id, input.version);
    // The task is authored explicitly. No participant identity or live message content enters CRM.
    const result = await createTaskInTenant(tx, user, tenant, { ...input.task, contactId: item.contactId });
    const version = await touchItem(tx, tenant, id, item.version);
    await tx.insert(auditLogs).values({ tenantId: tenant, actorId: user,
      action: "social.inbox.follow_up", targetId: id, metadata: { taskId: result.id, version: String(version) } });
    return { task: result, itemVersion: version };
  });
}
