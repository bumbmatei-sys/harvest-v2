import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client";
import { auditLogs, companies, contacts, crmAssociations, crmNotes, crmPipelineStages, crmTasks, opportunities, users, workspaceMembers } from "../db/schema";
import { TIMELINE_PAGE_SIZE, decodeCursor, encodeCursor } from "../lib/crm-tasks";
import { AccessError } from "./permissions";
import { message } from "../i18n/messages";
import { uuidInput } from "../lib/contact-input";
import { withTenant } from "./tenancy";
import { emitCrmEvent } from "./crm-events";

/**
 * CRM activity is the append-only audit ledger, not a second copy of events.
 * Contact-related actions stay in the contact.* namespace and target the contact,
 * so the erasure definer unlinks them together with the rest of that person's history.
 */
export const crmActions = ["contact.create", "contact.update", "contact.consent_record", "contact.company_link", "contact.company_link_update", "contact.company_unlink", "company.create", "company.update", "contact.merge"] as const;
/** Ledger actions the unified timeline also shows (CRM-04 deals, CRM-05 tasks). Note text comes from the notes table. */
export const timelineActions = [...crmActions, "opportunity.create", "opportunity.update", "opportunity.move", "opportunity.archive", "opportunity.restore",
  "task.create", "task.update", "task.complete", "task.reopen", "task.reassign", "task.archive", "task.restore",
  // Note lifecycle events that the live note itself cannot show (create/update are represented by the note).
  "note.archive", "note.restore",
  // CRM-07: an association event (Zernio, form or touchpoint); its content comes from crm_associations.
  "association.record"] as const;
export type CrmAction = typeof crmActions[number];
export type ActivityMetadata = { companyId?: string; fields?: string };

/**
 * Writes the ledger row and, in the same transaction, the matching CRM-08 lifecycle event. The
 * ledger row id keys the outbox entry, so each audited People/Organization change emits exactly once.
 */
export async function recordActivity(tx: Transaction, event: { tenantId: string; actorId: string; action: CrmAction; targetId: string; metadata?: ActivityMetadata }) {
  const [row] = await tx.insert(auditLogs).values({ tenantId: event.tenantId, actorId: event.actorId, action: event.action, targetId: event.targetId, metadata: { ...event.metadata } }).returning({ id: auditLogs.id });
  const key = `crm:activity:${row.id}`, base = { tenantId: event.tenantId, actorId: event.actorId };
  // Field names recorded by the writer (never values); the contract rejects any name it does not list.
  const fields = () => (event.metadata?.fields ? event.metadata.fields.split(",").filter(Boolean) : []) as never[];
  switch (event.action) {
    case "contact.create": return emitCrmEvent(tx, event.tenantId, "crm.person.created", key, { ...base, contactId: event.targetId });
    case "contact.update": return emitCrmEvent(tx, event.tenantId, "crm.person.updated", key, { ...base, contactId: event.targetId,
      // A full-form save does not record field names; it may have changed any of them.
      fields: event.metadata?.fields ? fields() : ["name", "notes", "email", "phone", "social"] });
    case "contact.company_link": return emitCrmEvent(tx, event.tenantId, "crm.person.organization_linked", key, { ...base, contactId: event.targetId, companyId: event.metadata!.companyId! });
    case "contact.company_link_update": return emitCrmEvent(tx, event.tenantId, "crm.person.organization_link_updated", key, { ...base, contactId: event.targetId, companyId: event.metadata!.companyId!, fields: fields() });
    case "contact.company_unlink": return emitCrmEvent(tx, event.tenantId, "crm.person.organization_unlinked", key, { ...base, contactId: event.targetId, companyId: event.metadata!.companyId! });
    case "company.create": return emitCrmEvent(tx, event.tenantId, "crm.organization.created", key, { ...base, companyId: event.targetId });
    case "company.update": return emitCrmEvent(tx, event.tenantId, "crm.organization.updated", key, { ...base, companyId: event.targetId, fields: fields() });
    // contact.consent_record and contact.merge are written by their own paths, which emit their own events.
    default: return undefined;
  }
}

export type ActivityItem = {
  id: string; action: CrmAction; createdAt: Date; actor: { id: string; name: string | null; isMember: boolean };
  fields: string[]; channel?: string; status?: string;
  company?: { id: string; name: string } | null; contact?: { id: string; name: string } | null;
};
const ACTIVITY_LIMIT = 50;

async function shape(tx: Transaction, tenantId: string, rows: (typeof auditLogs.$inferSelect)[]): Promise<ActivityItem[]> {
  const actorIds = [...new Set(rows.map((row) => row.actorId))];
  // Names come only from users who belong to this workspace; former members stay anonymous.
  const actors = actorIds.length ? await tx.select({ id: users.id, name: users.name }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.tenantId, tenantId), inArray(workspaceMembers.userId, actorIds))) : [];
  const companyIds = [...new Set(rows.map((row) => row.action === "company.create" || row.action === "company.update" ? row.targetId : row.metadata.companyId).filter((value): value is string => !!value && uuidInput.safeParse(value).success))];
  const contactIds = [...new Set(rows.filter((row) => row.action.startsWith("contact.")).map((row) => row.targetId).filter((value): value is string => !!value && uuidInput.safeParse(value).success))];
  const companyRows = companyIds.length ? await tx.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.tenantId, tenantId), inArray(companies.id, companyIds))) : [];
  const contactRows = contactIds.length ? await tx.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, contactIds), isNull(contacts.erasedAt))) : [];
  return rows.map((row) => {
    const actor = actors.find((item) => item.id === row.actorId);
    const companyId = row.action.startsWith("company.") ? row.targetId : row.metadata.companyId;
    return {
      id: row.id, action: row.action as CrmAction, createdAt: row.createdAt,
      actor: { id: row.actorId, name: actor?.name ?? null, isMember: !!actor },
      fields: row.metadata.fields ? row.metadata.fields.split(",").filter(Boolean) : [],
      channel: row.metadata.channel, status: row.metadata.status,
      company: companyId ? companyRows.find((item) => item.id === companyId) ?? null : undefined,
      contact: row.action.startsWith("contact.") && row.targetId ? contactRows.find((item) => item.id === row.targetId) ?? null : undefined,
    };
  });
}

export function listContactActivity(db: Database, userId: string, workspace: string, contact: string) {
  const id = uuidInput.parse(contact);
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:read", async (tx, tenantId) => {
    const [live] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt)));
    if (!live) return [];
    const rows = await tx.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.targetId, id), like(auditLogs.action, "contact.%")))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(ACTIVITY_LIMIT);
    return shape(tx, tenantId, rows);
  });
}

export function listCompanyActivity(db: Database, userId: string, workspace: string, company: string) {
  const id = uuidInput.parse(company);
  return withTenant(db, userId, uuidInput.parse(workspace), "companies:read", async (tx, tenantId) => {
    const rows = await tx.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), or(
      and(eq(auditLogs.targetId, id), like(auditLogs.action, "company.%")),
      and(inArray(auditLogs.action, ["contact.company_link", "contact.company_link_update", "contact.company_unlink"]), sql`${auditLogs.metadata}->>'companyId' = ${id}`),
    ))).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(ACTIVITY_LIMIT);
    return shape(tx, tenantId, rows);
  });
}

// ---------------------------------------------------------------------------
// CRM-05 unified timeline. Sources, newest first:
//   - the audit ledger (the single source of truth for events): the record's own
//     actions, plus task.* rows whose metadata names the record;
//   - the record's live notes (their text lives only in crm_notes).
// Future sources (purchases, email, social, forms: CRM-07) add a new `kind` here.
/**
 * CRM-07 association content by id. The tenant filter is in the query itself, not left to RLS
 * alone, so a broken policy can never widen what a timeline returns (tested with RLS bypassed).
 */
export async function loadAssociations(tx: Transaction, tenantId: string, ids: string[]) {
  if (!ids.length) return [];
  return tx.select().from(crmAssociations).where(and(eq(crmAssociations.tenantId, tenantId), inArray(crmAssociations.id, ids)));
}
export type TimelineSubject = "person" | "company" | "deal";
export type TimelineEvent = Omit<ActivityItem, "action"> & {
  kind: "event"; action: typeof timelineActions[number]; task: { id: string; title: string } | null; fromStage: string | null; toStage: string | null; toUserName: string | null;
};
export type TimelineNote = { kind: "note"; id: string; createdAt: Date; actor: { id: string; name: string | null; isMember: boolean }; body: string; editedAt: Date | null; version: number };
/**
 * CRM-07 association: a ledger row `association.record` joined to its content. `removed` means the
 * content is gone (the person was erased); `redacted` means erasure of someone else scrubbed its text.
 */
export type TimelineAssociation = {
  kind: "association"; action: "association.record"; id: string; createdAt: Date; actor: { id: string; name: string | null; isMember: boolean };
  associationId: string; source: string; activity: string; purpose: string; occurredAt: Date | null; summary: string;
  redacted: boolean; removed: boolean; person: { id: string; name: string } | null;
};
export type TimelineItem = TimelineEvent | TimelineNote | TimelineAssociation;
const subjectPermission = { person: "contacts:read", company: "companies:read", deal: "opportunities:read" } as const;

export function getTimeline(db: Database, userId: string, workspace: string, subject: TimelineSubject, record: string, cursor?: string | null) {
  const id = uuidInput.parse(record), after = decodeCursor(cursor);
  if (after === undefined) throw new AccessError(400, message("Errors.requestFailed"));
  return withTenant(db, userId, uuidInput.parse(workspace), subjectPermission[subject], async (tx, tenantId) => {
    const exists = subject === "person"
      ? await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt)))
      : subject === "company" ? await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, id)))
        : await tx.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.tenantId, tenantId), eq(opportunities.id, id)));
    if (!exists.length) throw new AccessError(404, message(subject === "person" ? "Errors.thisContactIsNotAvailableInThisWorkspace" : subject === "company" ? "Errors.thisCompanyIsNotAvailableInThisWorkspace" : "Errors.thisDealIsNotAvailable"));
    const metaKey = subject === "person" ? "contactId" : subject === "company" ? "companyId" : "opportunityId";
    // A person's associations are also found through the association row itself: a merge moves the row to the
    // kept person while its ledger entry keeps the merged person's id (which erasure then strips).
    const currentAssociations = subject === "person"
      ? sql` or (${auditLogs.action} = 'association.record' and ${auditLogs.targetId} in (select ${crmAssociations.id}::text from ${crmAssociations} where ${crmAssociations.tenantId} = ${tenantId} and ${crmAssociations.contactId} = ${id}))`
      : sql``;
    const relatedRows = sql`(((${auditLogs.action} like 'task.%' or ${auditLogs.action} in ('note.archive', 'note.restore', 'association.record')) and ${auditLogs.metadata}->>${metaKey} = ${id})${currentAssociations})`;
    const own = subject === "person" ? and(eq(auditLogs.targetId, id), like(auditLogs.action, "contact.%"))
      : subject === "company" ? or(and(eq(auditLogs.targetId, id), like(auditLogs.action, "company.%")),
        and(inArray(auditLogs.action, ["contact.company_link", "contact.company_link_update", "contact.company_unlink"]), sql`${auditLogs.metadata}->>'companyId' = ${id}`))
        : and(eq(auditLogs.targetId, id), like(auditLogs.action, "opportunity.%"));
    const before = (at: typeof auditLogs.createdAt | typeof crmNotes.createdAt, key: typeof auditLogs.id | typeof crmNotes.id) => (after ? sql`(${at}, ${key}) < (${after.at}::timestamptz, ${after.id}::uuid)` : undefined);
    const stamp = (at: typeof auditLogs.createdAt | typeof crmNotes.createdAt) => sql<string>`to_char(${at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const events = await tx.select({ row: auditLogs, at: stamp(auditLogs.createdAt) }).from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), or(own, relatedRows), before(auditLogs.createdAt, auditLogs.id)))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(TIMELINE_PAGE_SIZE + 1);
    const noteColumn = subject === "person" ? crmNotes.contactId : subject === "company" ? crmNotes.companyId : crmNotes.opportunityId;
    const notes = await tx.select({ note: crmNotes, at: stamp(crmNotes.createdAt) }).from(crmNotes).where(and(eq(crmNotes.tenantId, tenantId), eq(noteColumn, id), isNull(crmNotes.archivedAt), before(crmNotes.createdAt, crmNotes.id)))
      .orderBy(desc(crmNotes.createdAt), desc(crmNotes.id)).limit(TIMELINE_PAGE_SIZE + 1);
    // Merge both sources on (time, id), newest first, and keep one page.
    const merged = [...events.map(({ row, at }) => ({ at, id: row.id, row, note: null })), ...notes.map(({ note, at }) => ({ at, id: note.id, row: null, note }))]
      .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
    const page = merged.slice(0, TIMELINE_PAGE_SIZE);
    const shaped = await shape(tx, tenantId, page.flatMap((item) => (item.row ? [item.row] : [])));
    const taskIds = [...new Set(page.flatMap((item) => (item.row?.action.startsWith("task.") && item.row.targetId ? [item.row.targetId] : [])))];
    const tasks = taskIds.length ? await tx.select({ id: crmTasks.id, title: crmTasks.title }).from(crmTasks).where(and(eq(crmTasks.tenantId, tenantId), inArray(crmTasks.id, taskIds))) : [];
    const stageIds = [...new Set(page.flatMap((item) => (item.row ? [item.row.metadata.fromStageId, item.row.metadata.toStageId] : [])).filter((value): value is string => !!value && uuidInput.safeParse(value).success))];
    const stages = stageIds.length ? await tx.select({ id: crmPipelineStages.id, name: crmPipelineStages.name }).from(crmPipelineStages).where(and(eq(crmPipelineStages.tenantId, tenantId), inArray(crmPipelineStages.id, stageIds))) : [];
    const people = [...new Set([...page.flatMap((item) => (item.note ? [item.note.createdBy] : [])), ...page.flatMap((item) => (item.row?.metadata.toUserId ? [item.row.metadata.toUserId] : []))])];
    const members = people.length ? await tx.select({ id: users.id, name: users.name, email: users.email }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.tenantId, tenantId), inArray(workspaceMembers.userId, people))) : [];
    const memberName = (memberId: string) => { const found = members.find((item) => item.id === memberId); return found ? found.name || found.email : null; };
    const associationIds = page.flatMap((item) => (item.row?.action === "association.record" && item.row.targetId && uuidInput.safeParse(item.row.targetId).success ? [item.row.targetId] : []));
    const associations = await loadAssociations(tx, tenantId, associationIds);
    const associationPeople = [...new Set(associations.map((row) => row.contactId))];
    const peopleNames = associationPeople.length ? await tx.select({ id: contacts.id, name: contacts.name }).from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.id, associationPeople), isNull(contacts.erasedAt))) : [];
    const items: TimelineItem[] = page.map((item) => {
      if (item.row?.action === "association.record") {
        const base = shaped.find((entry) => entry.id === item.row!.id)!, content = associations.find((row) => row.id === item.row!.targetId);
        const person = content ? peopleNames.find((row) => row.id === content.contactId) ?? null : null;
        return { kind: "association", action: "association.record", id: item.row.id, createdAt: base.createdAt, actor: base.actor, associationId: item.row.targetId ?? "",
          source: content?.source ?? item.row.metadata.source ?? "", activity: content?.kind ?? item.row.metadata.kind ?? "", purpose: content?.purpose ?? item.row.metadata.purpose ?? "",
          occurredAt: content?.occurredAt ?? null, summary: content?.summary ?? "", redacted: !!content?.redactedAt, removed: !content, person };
      }
      if (item.note) return { kind: "note", id: item.note.id, createdAt: item.note.createdAt, body: item.note.body, editedAt: item.note.editedAt, version: item.note.version,
        actor: { id: item.note.createdBy, name: memberName(item.note.createdBy), isMember: members.some((member) => member.id === item.note!.createdBy) } };
      const base = shaped.find((entry) => entry.id === item.row!.id)!;
      const stageName = (stageId?: string) => (stageId ? stages.find((stage) => stage.id === stageId)?.name ?? null : null);
      return { ...base, kind: "event", action: item.row!.action as TimelineEvent["action"],
        task: item.row!.action.startsWith("task.") ? tasks.find((task) => task.id === item.row!.targetId) ?? null : null,
        fromStage: stageName(item.row!.metadata.fromStageId), toStage: stageName(item.row!.metadata.toStageId),
        toUserName: item.row!.metadata.toUserId ? memberName(item.row!.metadata.toUserId) : null };
    });
    const last = page.at(-1);
    return { items, nextCursor: merged.length > TIMELINE_PAGE_SIZE && last ? encodeCursor(last.at, last.id) : null };
  });
}
